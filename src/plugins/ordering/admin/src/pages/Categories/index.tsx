import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Dialog,
  Divider,
  Field,
  Flex,
  IconButton,
  LinkButton,
  Loader,
  SingleSelect,
  SingleSelectOption,
  TextInput,
  Typography,
} from '@strapi/design-system';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Drag,
  Pencil,
  Plus,
  Trash,
} from '@strapi/icons';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';
import { useIntl } from 'react-intl';
import { NavLink } from 'react-router-dom';

import LocalizedTextInput from '../../components/LocalizedTextInput';
import { PLUGIN_ID } from '../../pluginId';

type LocalizedMap = Record<string, string>;

type TreeItem = {
  ref: string;
  parentRef: string | null;
  rank: number;
  name: string;
  names: LocalizedMap;
  slugs: LocalizedMap;
  descriptions: LocalizedMap;
  isActive: boolean;
  isInternal: boolean;
  kitchenStation: string | null;
  productCount: number;
};

type TreeNode = { item: TreeItem; children: TreeNode[] };

type FormState = {
  ref: string | null;
  name: LocalizedMap;
  slug: LocalizedMap;
  description: LocalizedMap;
  parentRef: string | null;
  isActive: boolean;
  isInternal: boolean;
  kitchenStation: string;
};

type DeleteState = {
  item: TreeItem;
  /** Products reported by CATEGORY_HAS_PRODUCTS — shown when confirmation is required. */
  linkedProducts: { documentId: string; name: string }[];
};

type DropZone = 'before' | 'inside' | 'after';

const EMPTY_FORM: FormState = {
  ref: null,
  name: {},
  slug: {},
  description: {},
  parentRef: null,
  isActive: true,
  isInternal: false,
  kitchenStation: '',
};

const nonEmpty = (map: LocalizedMap): LocalizedMap =>
  Object.fromEntries(Object.entries(map).filter(([, v]) => v.trim() !== ''));

/** Refs inside `ref`'s subtree — a drop onto any of them would cycle. */
const subtreeRefs = (nodes: TreeNode[], ref: string): Set<string> => {
  const out = new Set<string>();
  const walk = (list: TreeNode[]) => {
    for (const node of list) {
      out.add(node.item.ref);
      walk(node.children);
    }
  };
  const find = (list: TreeNode[]): TreeNode | undefined => {
    for (const node of list) {
      if (node.item.ref === ref) return node;
      const hit = find(node.children);
      if (hit) return hit;
    }
    return undefined;
  };
  const start = find(nodes);
  if (start) {
    out.add(start.item.ref);
    walk(start.children);
  }
  return out;
};

const flatten = (nodes: TreeNode[], collapsed: Set<string>, depth = 0): { node: TreeNode; depth: number }[] =>
  nodes.flatMap((node) => [
    { node, depth },
    ...(node.children.length > 0 && !collapsed.has(node.item.ref)
      ? flatten(node.children, collapsed, depth + 1)
      : []),
  ]);

const findNode = (nodes: TreeNode[], ref: string): TreeNode | undefined => {
  for (const node of nodes) {
    if (node.item.ref === ref) return node;
    const hit = findNode(node.children, ref);
    if (hit) return hit;
  }
  return undefined;
};

const siblingsOf = (nodes: TreeNode[], parentRef: string | null): TreeNode[] =>
  parentRef === null ? nodes : (findNode(nodes, parentRef)?.children ?? []);

/**
 * "Danh mục" admin screen (plan step 7b / mockup 4b): tree with per-node counts, create /
 * edit / delete with the product-guard dialog, and one `move` call per drag or button press.
 * Native HTML5 drag/drop (no extra dependency); ↑/↓ buttons and the parent select are the
 * documented fallback.
 */
const CategoriesPage = () => {
  const { formatMessage } = useIntl();
  const { get, post, put, del } = useFetchClient();
  const { toggleNotification } = useNotification();

  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [form, setForm] = useState<FormState | null>(null);
  const [deleting, setDeleting] = useState<DeleteState | null>(null);
  const [dragRef, setDragRef] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{ ref: string; zone: DropZone } | null>(null);
  const [busy, setBusy] = useState(false);

  const t = useCallback(
    (key: string, fallback: string, values?: Record<string, string | number>) =>
      formatMessage({ id: `${PLUGIN_ID}.categories.${key}`, defaultMessage: fallback }, values),
    [formatMessage],
  );

  const notifyError = useCallback(
    (error: unknown) => {
      const api = (error as { response?: { data?: { error?: { code?: string; message?: string } } } })
        ?.response?.data?.error;
      const copy =
        api?.code === 'CATEGORY_MOVE_CYCLE'
          ? t('error.cycle', 'Không thể đưa danh mục vào chính nhánh con của nó')
          : api?.code === 'CATEGORY_HAS_CHILDREN'
            ? t('error.children', 'Chuyển hoặc xóa các danh mục con trước')
            : api?.message ?? t('error.generic', 'Thao tác thất bại, thử lại sau');
      toggleNotification({ type: 'danger', message: copy });
    },
    [t, toggleNotification],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await get(`/${PLUGIN_ID}/categories?locale=vi`);
      const items = (data as { items?: TreeNode[] } | undefined)?.items;
      setTree(Array.isArray(items) ? items : []);
    } catch (error) {
      notifyError(error);
    } finally {
      setLoading(false);
    }
  }, [get, notifyError]);

  useEffect(() => {
    void load();
  }, [load]);

  const forbidden = useMemo(
    () => (dragRef ? subtreeRefs(tree, dragRef) : new Set<string>()),
    [tree, dragRef],
  );

  const rows = useMemo(() => flatten(tree, collapsed), [tree, collapsed]);

  const move = useCallback(
    async (ref: string, parentRef: string | null, index: number) => {
      setBusy(true);
      try {
        await post(`/${PLUGIN_ID}/categories/${ref}/move`, { parentId: parentRef, index });
        await load();
      } catch (error) {
        notifyError(error);
      } finally {
        setBusy(false);
        setDropHint(null);
      }
    },
    [post, load, notifyError],
  );

  /** Fallback ↑/↓ reorder inside the same sibling set. */
  const step = (node: TreeNode, delta: -1 | 1) => {
    const siblings = siblingsOf(tree, node.item.parentRef).map((s) => s.item.ref);
    const at = siblings.indexOf(node.item.ref) + delta;
    if (at < 0 || at >= siblings.length) return;
    const without = siblings.filter((ref) => ref !== node.item.ref);
    without.splice(at, 0, node.item.ref);
    void move(node.item.ref, node.item.parentRef, without.indexOf(node.item.ref));
  };

  const onDrop = (target: TreeItem, zone: DropZone) => {
    if (!dragRef || forbidden.has(target.ref)) return;
    if (zone === 'inside') {
      void move(dragRef, target.ref, findNode(tree, target.ref)?.children.length ?? 0);
      return;
    }
    const siblings = siblingsOf(tree, target.parentRef)
      .map((s) => s.item.ref)
      .filter((ref) => ref !== dragRef);
    const at = siblings.indexOf(target.ref) + (zone === 'after' ? 1 : 0);
    void move(dragRef, target.parentRef, at);
  };

  const save = async () => {
    if (!form) return;
    setBusy(true);
    const body = {
      name: nonEmpty(form.name),
      slug: nonEmpty(form.slug),
      description: nonEmpty(form.description),
      isActive: form.isActive,
      isInternal: form.isInternal,
      kitchenStation: form.kitchenStation,
      ...(form.parentRef !== (findNode(tree, form.ref ?? '')?.item.parentRef ?? null)
        ? { parent: form.parentRef }
        : {}),
    };
    try {
      if (form.ref) {
        await put(`/${PLUGIN_ID}/categories/${form.ref}`, body);
      } else {
        await post(`/${PLUGIN_ID}/categories`, { ...body, parent: form.parentRef });
      }
      setForm(null);
      await load();
      toggleNotification({ type: 'success', message: t('saved', 'Đã lưu danh mục') });
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      const { data } = await del(
        `/${PLUGIN_ID}/categories/${deleting.item.ref}${deleting.linkedProducts.length > 0 ? '?confirm=true' : ''}`,
      );
      setDeleting(null);
      const orphans = ((data as { productsWithoutCategory?: { name: string }[] } | undefined)?.productsWithoutCategory ?? []);
      toggleNotification({
        type: orphans.length > 0 ? 'warning' : 'success',
        message:
          orphans.length > 0
            ? t('deleted.orphans', 'Đã xóa; các món không còn danh mục: {names}', {
                names: orphans.map((o) => o.name).join(', '),
              })
            : t('deleted', 'Đã xóa danh mục'),
      });
      await load();
    } catch (error) {
      const api = (error as { response?: { data?: { error?: { code?: string; details?: { products?: { documentId: string; name: string }[] } } } } })
        ?.response?.data?.error;
      if (api?.code === 'CATEGORY_HAS_PRODUCTS') {
        setDeleting({ ...deleting, linkedProducts: api.details?.products ?? [] });
      } else {
        notifyError(error);
        setDeleting(null);
      }
    } finally {
      setBusy(false);
    }
  };

  const localizedProps = (key: 'name' | 'slug' | 'description') => ({
    name: key,
    value: form?.[key] ?? {},
    onChange: (event: { target: { name: string; value: LocalizedMap } }) =>
      setForm((f) => (f ? { ...f, [key]: event.target.value } : f)),
  });

  const parentOptions = useMemo(() => {
    if (!form?.ref) return rows.map(({ node }) => node.item);
    const own = subtreeRefs(tree, form.ref);
    return rows.map(({ node }) => node.item).filter((item) => !own.has(item.ref));
  }, [form?.ref, rows, tree]);

  /** Existing kitchen-station values — datalist suggestions keep spellings consistent. */
  const stationSuggestions = useMemo(() => {
    const found = new Set<string>();
    const walk = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        if (node.item.kitchenStation) found.add(node.item.kitchenStation);
        walk(node.children);
      }
    };
    walk(tree);
    return [...found].sort();
  }, [tree]);

  return (
    <Box padding={8}>
      <Flex justifyContent="space-between" alignItems="flex-start" gap={4}>
        <Box>
          <Typography variant="alpha" tag="h1">
            {t('title', 'Danh mục')}
          </Typography>
          <Typography variant="epsilon" textColor="neutral600">
            {t('subtitle', 'Kéo để đổi thứ tự hoặc đổi danh mục cha')}
          </Typography>
        </Box>
        <Flex gap={3}>
          <LinkButton tag={NavLink} to="/plugins/ordering/catalog-import" variant="secondary">
            {t('exportCsv', 'Xuất CSV')}
          </LinkButton>
          <Button
            startIcon={<Plus />}
            onClick={() => setForm({ ...EMPTY_FORM })}
            disabled={busy}
          >
            {t('add', 'Thêm danh mục')}
          </Button>
        </Flex>
      </Flex>

      <Flex alignItems="flex-start" gap={6} paddingTop={6}>
        {/* ------- Tree panel ------- */}
        <Box
          background="neutral0"
          borderColor="neutral200"
          hasRadius
          padding={4}
          style={{ flex: '1 1 55%', minWidth: 420 }}
        >
          {loading ? (
            <Flex justifyContent="center" padding={6}>
              <Loader />
            </Flex>
          ) : rows.length === 0 ? (
            <Box padding={6}>
              <Typography textColor="neutral600">{t('empty', 'Chưa có danh mục nào')}</Typography>
            </Box>
          ) : (
            rows.map(({ node, depth }) => {
              const item = node.item;
              const muted = !item.isActive || item.isInternal;
              const hint = dropHint?.ref === item.ref ? dropHint.zone : null;
              return (
                <Flex
                  key={item.ref}
                  tag="li"
                  justifyContent="space-between"
                  alignItems="center"
                  gap={2}
                  padding={2}
                  style={{
                    listStyle: 'none',
                    paddingLeft: depth * 22 + 8,
                    borderTop: hint === 'before' ? '2px solid var(--colors-primary600, #4945ff)' : undefined,
                    borderBottom:
                      hint === 'after' ? '2px solid var(--colors-primary600, #4945ff)' : undefined,
                    background:
                      hint === 'inside' ? 'var(--colors-primary100, #f0f0ff)' : undefined,
                    borderRadius: 4,
                    opacity: dragRef === item.ref ? 0.4 : 1,
                  }}
                  draggable
                  onDragStart={(event: React.DragEvent) => {
                    event.dataTransfer.setData('text/plain', item.ref);
                    event.dataTransfer.effectAllowed = 'move';
                    setDragRef(item.ref);
                  }}
                  onDragEnd={() => {
                    setDragRef(null);
                    setDropHint(null);
                  }}
                  onDragOver={(event: React.DragEvent) => {
                    if (!dragRef || forbidden.has(item.ref)) return;
                    event.preventDefault();
                    const rect = event.currentTarget.getBoundingClientRect();
                    const ratio = (event.clientY - rect.top) / rect.height;
                    const zone: DropZone = ratio < 0.3 ? 'before' : ratio > 0.7 ? 'after' : 'inside';
                    setDropHint((h) =>
                      h?.ref === item.ref && h.zone === zone ? h : { ref: item.ref, zone },
                    );
                  }}
                  onDrop={(event: React.DragEvent) => {
                    event.preventDefault();
                    if (dropHint?.ref === item.ref) onDrop(item, dropHint.zone);
                  }}
                >
                  <Flex gap={2} alignItems="center">
                    <Box color="neutral500" style={{ cursor: 'grab' }} aria-hidden>
                      <Drag />
                    </Box>
                    {node.children.length > 0 ? (
                      <IconButton
                        label={t('toggle', 'Thu/mở')}
                        onClick={() =>
                          setCollapsed((set) => {
                            const next = new Set(set);
                            if (next.has(item.ref)) next.delete(item.ref);
                            else next.add(item.ref);
                            return next;
                          })
                        }
                        variant="ghost"
                      >
                        {collapsed.has(item.ref) ? <ChevronRight /> : <ChevronDown />}
                      </IconButton>
                    ) : (
                      <Box width="32px" />
                    )}
                    <Typography
                      fontWeight={item.isActive && !item.isInternal ? 'bold' : 'regular'}
                      textColor={muted ? 'neutral500' : 'neutral800'}
                    >
                      {item.name || '—'}
                    </Typography>
                    {item.isInternal ? <Badge>{t('internal', 'nội bộ')}</Badge> : null}
                    {!item.isActive ? <Badge>{t('inactive', 'tắt')}</Badge> : null}
                    {item.kitchenStation ? <Badge>{item.kitchenStation}</Badge> : null}
                  </Flex>
                  <Flex gap={1} alignItems="center">
                    <Typography variant="pi" textColor="neutral500">
                      {t('count', '{n} món', { n: item.productCount })}
                    </Typography>
                    <IconButton
                      label={t('move.up', 'Lên')}
                      onClick={() => step(node, -1)}
                      disabled={busy}
                      variant="ghost"
                    >
                      <ArrowUp />
                    </IconButton>
                    <IconButton
                      label={t('move.down', 'Xuống')}
                      onClick={() => step(node, 1)}
                      disabled={busy}
                      variant="ghost"
                    >
                      <ArrowDown />
                    </IconButton>
                    <Button
                      size="S"
                      variant="tertiary"
                      onClick={() =>
                        setForm({ ...EMPTY_FORM, parentRef: item.ref })
                      }
                    >
                      {t('add.child', '+ Con')}
                    </Button>
                    <IconButton
                      label={t('edit', 'Sửa')}
                      onClick={() =>
                        setForm({
                          ref: item.ref,
                          name: { ...item.names },
                          slug: { ...item.slugs },
                          description: { ...item.descriptions },
                          parentRef: item.parentRef,
                          isActive: item.isActive,
                          isInternal: item.isInternal,
                          kitchenStation: item.kitchenStation ?? '',
                        })
                      }
                      variant="ghost"
                    >
                      <Pencil />
                    </IconButton>
                    <IconButton
                      label={t('delete', 'Xóa')}
                      onClick={() => setDeleting({ item, linkedProducts: [] })}
                      variant="ghost"
                    >
                      <Trash />
                    </IconButton>
                  </Flex>
                </Flex>
              );
            })
          )}
        </Box>

        {/* ------- Edit / create form ------- */}
        {form ? (
          <Box
            background="neutral0"
            borderColor="neutral200"
            hasRadius
            padding={6}
            style={{ flex: '1 1 45%', minWidth: 340 }}
          >
            <Typography variant="beta" tag="h2">
              {form.ref
                ? t('form.edit', 'Sửa: {name}', { name: form.name.vi || '—' })
                : t('form.new', 'Thêm danh mục')}
            </Typography>
            <Box paddingTop={4}>
              <LocalizedTextInput
                {...localizedProps('name')}
                required
                intlLabel={{ defaultMessage: t('form.name', 'Tên') }}
              />
            </Box>
            <Box paddingTop={3}>
              <LocalizedTextInput
                {...localizedProps('slug')}
                intlLabel={{ defaultMessage: 'Slug' }}
              />
            </Box>
            <Box paddingTop={3}>
              <Field.Root name="parent">
                <Field.Label>{t('form.parent', 'Danh mục cha')}</Field.Label>
                <SingleSelect
                  value={form.parentRef ?? ''}
                  onChange={(value: string | number) =>
                    setForm((f) => (f ? { ...f, parentRef: value === '' ? null : String(value) } : f))
                  }
                >
                  <SingleSelectOption value="">{t('form.root', '— Gốc —')}</SingleSelectOption>
                  {parentOptions.map((item) => (
                    <SingleSelectOption key={item.ref} value={item.ref}>
                      {item.name || item.ref}
                    </SingleSelectOption>
                  ))}
                </SingleSelect>
              </Field.Root>
            </Box>
            <Box paddingTop={3}>
              <LocalizedTextInput
                {...localizedProps('description')}
                intlLabel={{ defaultMessage: t('form.description', 'Mô tả') }}
              />
            </Box>
            <Box paddingTop={3}>
              <Field.Root name="kitchenStation">
                <Field.Label>
                  {t('form.kitchenStation', 'Trạm bếp')}
                </Field.Label>
                <TextInput
                  aria-label="kitchenStation"
                  list="ordering-kitchen-stations"
                  placeholder={t('form.kitchenStation.hint', 'VD: Bếp nóng — để trống kế thừa danh mục cha')}
                  value={form.kitchenStation}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    setForm((f) => (f ? { ...f, kitchenStation: event.target.value } : f))
                  }
                />
                <datalist id="ordering-kitchen-stations">
                  {stationSuggestions.map((station) => (
                    <option key={station} value={station} />
                  ))}
                </datalist>
              </Field.Root>
            </Box>
            <Flex gap={6} paddingTop={4}>
              <Checkbox
                checked={form.isActive}
                onCheckedChange={(checked: boolean) =>
                  setForm((f) => (f ? { ...f, isActive: checked === true } : f))
                }
              >
                {t('form.visible', 'Hiện cho khách')}
              </Checkbox>
              <Checkbox
                checked={form.isInternal}
                onCheckedChange={(checked: boolean) =>
                  setForm((f) => (f ? { ...f, isInternal: checked === true } : f))
                }
              >
                {t('form.internal', 'Nội bộ')}
              </Checkbox>
            </Flex>
            <Divider marginTop={5} marginBottom={4} />
            <Flex gap={3} justifyContent="flex-end">
              <Button variant="tertiary" onClick={() => setForm(null)} disabled={busy}>
                {t('form.cancel', 'Hủy')}
              </Button>
              <Button
                onClick={() => void save()}
                loading={busy}
                disabled={Object.values(form.name).every((v) => !v || !v.trim())}
              >
                {t('form.save', 'Lưu')}
              </Button>
            </Flex>
          </Box>
        ) : null}
      </Flex>

      {/* ------- Delete dialog ------- */}
      <Dialog.Root open={deleting !== null} onOpenChange={(open: boolean) => !open && setDeleting(null)}>
        <Dialog.Content>
          <Dialog.Header>
            {t('delete.title', 'Xóa danh mục "{name}"?', {
              name: deleting?.item.name ?? '',
            })}
          </Dialog.Header>
          <Dialog.Body>
            {deleting && deleting.linkedProducts.length === 0 ? (
              <Typography>
                {deleting.item.productCount > 0
                  ? t('delete.products.pending', 'Kiểm tra {n} món đang gắn danh mục này…', {
                      n: deleting.item.productCount,
                    })
                  : t('delete.empty', 'Danh mục sẽ bị xóa vĩnh viễn. Đơn cũ không bị ảnh hưởng.')}
              </Typography>
            ) : (
              <Flex direction="column" alignItems="flex-start" gap={2}>
                <Typography>
                  {t('delete.products.warn', '{n} món đang thuộc danh mục này:', {
                    n: deleting?.linkedProducts.length ?? 0,
                  })}
                </Typography>
                <Typography textColor="neutral600">
                  {deleting?.linkedProducts.map((p) => p.name).join(', ')}
                </Typography>
                <Typography>
                  {t('delete.products.note', 'Chỉ gỡ liên kết, món không bị xóa. Món nào hết danh mục sẽ được báo sau khi xóa.')}
                </Typography>
              </Flex>
            )}
          </Dialog.Body>
          <Dialog.Footer>
            <Dialog.Cancel>
              <Button variant="tertiary" disabled={busy}>
                {t('form.cancel', 'Hủy')}
              </Button>
            </Dialog.Cancel>
            <Dialog.Action>
              <Button
                variant="danger"
                onClick={() => void confirmDelete()}
                loading={busy}
              >
                {deleting && deleting.linkedProducts.length > 0
                  ? t('delete.confirm.unlink', 'Gỡ liên kết và xóa')
                  : t('delete.confirm', 'Xóa')}
              </Button>
            </Dialog.Action>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
    </Box>
  );
};

export default CategoriesPage;
