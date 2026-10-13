import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Combobox,
  ComboboxOption,
  Field,
  Flex,
  Grid,
  IconButton,
  Loader,
  NumberInput,
  Textarea,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { ArrowLeft, Trash } from '@strapi/icons';
import { Layouts, useFetchClient, useNotification, useRBAC } from '@strapi/strapi/admin';
import { useNavigate, useParams } from 'react-router-dom';

import { normalizeVietnamesePhone } from '../../../../shared/contact/phone';
import { foldDiacritics } from '../../../../shared/text/fold';
import { apiErrorOf, httpStatusOf, useErrorToast } from '../../lib/api';
import { formatMoney, formatTime } from '../../lib/format';
import { useT, type Translate } from '../../lib/i18n';
import { RBAC_DETAIL } from '../../lib/permissions';
import type { EditPreview, OrderDetail } from '../../lib/types';
import { Frame } from './OrderDialogs';

type CatalogChoice = { id: string; name: string; price: number; available?: boolean };
type CatalogGroup = { id: string; group: string; required: boolean; min: number; max: number | null; choices: CatalogChoice[] };
type CatalogVariant = { id: string; name: string; price: number | null; available?: boolean; default?: boolean };
type CatalogProduct = {
  id: string;
  name: string;
  price: number;
  available: boolean;
  unavailableReason?: string;
  variants?: CatalogVariant[];
  options: CatalogGroup[];
};
type AddedLine = {
  key: string;
  sellableUid: string;
  variantUid?: string;
  title: string;
  quantity: number;
  note: string;
  options: Array<{ groupUid: string; optionUid: string; quantity: number; name: string }>;
};
type Slot = { startsAt: string; localStart: string; available: boolean };
type Province = { code: string; name: string };
type Commune = { code: string; name: string; provinceName: string };
type AddressForm = { provinceCode: string; communeCode: string; communeName: string; line1: string; recipientName: string; phone: string };
type Post = (url: string, data?: unknown, config?: { signal?: AbortSignal }) => Promise<{ data: unknown }>;

const liveQty = (line: OrderDetail['lines'][number]) => Math.max(0, line.quantity - line.canceledQuantity);

const emptyAddress = (): AddressForm => ({
  provinceCode: '',
  communeCode: '',
  communeName: '',
  line1: '',
  recipientName: '',
  phone: '',
});

const addressFromDetail = (detail: OrderDetail): AddressForm => {
  const stored = detail.delivery?.address;
  return {
    provinceCode: stored?.provinceCode ?? '',
    communeCode: stored?.wardCode ?? '',
    communeName: stored?.wardName ?? '',
    line1: stored?.line1 ?? '',
    recipientName: stored?.recipientName ?? '',
    phone: stored?.phone ?? '',
  };
};

const warningText = (code: string, t: Translate): string => {
  if (code === 'below-min-order') return t('edit.warning.below-min-order');
  if (code === 'promotion-kept') return t('edit.warning.promotion-kept');
  return code;
};

const previewErrorText = (code: string | undefined, t: Translate): string => {
  switch (code) {
    case 'ORDER_CHANGED':
      return t('error.ORDER_CHANGED');
    case 'ITEM_SOLD_OUT':
      return t('error.ITEM_SOLD_OUT');
    case 'SLOT_FULL':
      return t('error.SLOT_FULL');
    case 'DELIVERY_UNAVAILABLE':
      return t('error.DELIVERY_UNAVAILABLE');
    case 'ORDER_NOT_EDITABLE':
      return t('error.ORDER_NOT_EDITABLE');
    case 'EDIT_EMPTY':
      return t('error.EDIT_EMPTY');
    default:
      return t('error.generic');
  }
};

type EditBody = {
  revision: number;
  reason: string;
  notifyCustomer: boolean;
  add?: Array<{ sellableUid: string; variantUid?: string; quantity: number; note?: string; options?: Array<{ groupUid: string; optionUid: string; quantity: number }> }>;
  reduce?: Array<{ lineId: number; quantity: number }>;
  timing?: { kind: 'asap' } | { kind: 'scheduled'; startsAt: string };
  address?: { communeCode: string; line1: string; recipientName: string; phone: string };
};

/** Builds the preview body. Returns null when the form is not ready to price. */
const buildEdit = (input: {
  detail: OrderDetail;
  qty: Record<number, number>;
  adds: AddedLine[];
  timingChoice: 'keep' | 'asap' | 'scheduled';
  slot: string;
  address: AddressForm;
  reason: string;
  notify: boolean;
}): { body: EditBody | null; blocked: 'reason' | 'address' | 'phone' | 'slot' | null } => {
  const reduce = input.detail.lines.flatMap((line) => {
    const live = liveQty(line);
    if (live <= 0) return [];
    const next = input.qty[line.id] ?? live;
    const delta = live - next;
    return delta > 0 ? [{ lineId: line.id, quantity: delta }] : [];
  });
  const add = input.adds.map((line) => ({
    sellableUid: line.sellableUid,
    ...(line.variantUid ? { variantUid: line.variantUid } : {}),
    quantity: line.quantity,
    ...(line.note.trim() ? { note: line.note.trim() } : {}),
    ...(line.options.length > 0 ? { options: line.options.map(({ groupUid, optionUid, quantity }) => ({ groupUid, optionUid, quantity })) } : {}),
  }));
  const currentStart = input.detail.order.receiveMethod.timing?.slot?.startsAt ?? null;
  let timing: EditBody['timing'];
  if (input.timingChoice === 'asap' && currentStart) timing = { kind: 'asap' };
  if (input.timingChoice === 'scheduled') {
    if (!input.slot) return { body: null, blocked: 'slot' };
    if (input.slot !== currentStart) timing = { kind: 'scheduled', startsAt: input.slot };
  }
  const stored = input.detail.delivery?.address;
  const addressChanged =
    input.detail.order.receiveMethod.kind === 'delivery' &&
    (input.address.communeCode !== (stored?.wardCode ?? '') ||
      input.address.line1.trim() !== (stored?.line1 ?? '') ||
      input.address.recipientName.trim() !== (stored?.recipientName ?? '') ||
      input.address.phone.trim() !== (stored?.phone ?? ''));
  if (addressChanged) {
    const phone = normalizeVietnamesePhone(input.address.phone);
    if (!phone.valid) return { body: null, blocked: 'phone' };
    if (!input.address.communeCode || input.address.line1.trim() === '' || input.address.recipientName.trim() === '') {
      return { body: null, blocked: 'address' };
    }
  }
  const changed = reduce.length > 0 || add.length > 0 || timing !== undefined || addressChanged;
  if (!changed) return { body: null, blocked: null };
  const reason = input.reason.trim();
  if (reason.length < 1 || reason.length > 500) return { body: null, blocked: 'reason' };
  return {
    blocked: null,
    body: {
      revision: input.detail.order.editRevision ?? input.detail.editRevision ?? 0,
      reason,
      notifyCustomer: input.notify,
      ...(add.length > 0 ? { add } : {}),
      ...(reduce.length > 0 ? { reduce } : {}),
      ...(timing ? { timing } : {}),
      ...(addressChanged
        ? {
            address: {
              communeCode: input.address.communeCode,
              line1: input.address.line1.trim(),
              recipientName: input.address.recipientName.trim(),
              phone: input.address.phone.trim(),
            },
          }
        : {}),
    },
  };
};

const ProductPicker = ({
  product,
  onClose,
  onAdd,
}: {
  product: CatalogProduct;
  onClose: () => void;
  onAdd: (line: Omit<AddedLine, 'key'>) => void;
}) => {
  const t = useT();
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');
  const [variant, setVariant] = useState(product.variants?.find((item) => item.default)?.id ?? product.variants?.[0]?.id ?? '');
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const missing = product.options.some((group) => (group.required || group.min > 0) && (picked[group.id]?.length ?? 0) < Math.max(1, group.min));
  return (
    <Frame
      title={product.name}
      onClose={onClose}
      action={
        <Button
          disabled={missing}
          onClick={() =>
            onAdd({
              sellableUid: product.id,
              ...(variant ? { variantUid: variant } : {}),
              title: product.name,
              quantity,
              note,
              options: Object.entries(picked).flatMap(([groupUid, ids]) =>
                ids.map((optionUid) => ({
                  groupUid,
                  optionUid,
                  quantity: 1,
                  name: product.options.flatMap((group) => group.choices).find((choice) => choice.id === optionUid)?.name ?? optionUid,
                })),
              ),
            })
          }
        >
          {t('create.addToOrder')}
        </Button>
      }
    >
      {product.variants && product.variants.length > 1 ? (
        <Box>
          <Typography fontWeight="bold">{t('edit.variant')}</Typography>
          <Flex gap={2} wrap="wrap" paddingTop={2}>
            {product.variants.map((item) => (
              <Button
                key={item.id}
                size="S"
                variant={variant === item.id ? 'default' : 'tertiary'}
                disabled={item.available === false}
                onClick={() => setVariant(item.id)}
              >
                {item.name}
                {item.available === false ? ` · ${t('edit.soldOut')}` : ''}
              </Button>
            ))}
          </Flex>
        </Box>
      ) : null}
      {product.options.map((group) => (
        <Box key={group.id}>
          <Typography fontWeight="bold">
            {group.group}
            {group.required ? ' *' : ''}
          </Typography>
          <Flex gap={2} wrap="wrap" paddingTop={2}>
            {group.choices.map((choice) => {
              const chosen = picked[group.id] ?? [];
              const checked = chosen.includes(choice.id);
              return (
                <Button
                  key={choice.id}
                  size="S"
                  variant={checked ? 'default' : 'tertiary'}
                  disabled={choice.available === false || (!checked && group.max !== null && chosen.length >= group.max)}
                  onClick={() =>
                    setPicked((current) => ({
                      ...current,
                      [group.id]: checked
                        ? (current[group.id] ?? []).filter((id) => id !== choice.id)
                        : [...(current[group.id] ?? []), choice.id],
                    }))
                  }
                >
                  {choice.name}
                  {choice.price ? ` (+${formatMoney(choice.price)})` : ''}
                  {choice.available === false ? ` · ${t('edit.soldOut')}` : ''}
                </Button>
              );
            })}
          </Flex>
        </Box>
      ))}
      <Field.Root>
        <Field.Label>{t('create.quantity')}</Field.Label>
        <NumberInput value={quantity} onValueChange={(value?: number) => setQuantity(Math.max(1, Math.min(99, value ?? 1)))} />
      </Field.Root>
      <Field.Root>
        <Field.Label>{t('create.lineNote')}</Field.Label>
        <TextInput value={note} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setNote(event.target.value.slice(0, 200))} />
      </Field.Root>
    </Frame>
  );
};

const MoneyLines = ({ preview, t }: { preview: EditPreview; t: Translate }) => {
  const { money } = preview;
  return (
    <Flex direction="column" alignItems="stretch" gap={1}>
      {money.refundCash > 0 ? (
        <Typography textColor="danger600">{t('edit.refundCash', { amount: formatMoney(money.refundCash) })}</Typography>
      ) : null}
      {money.refundTransferPending > 0 ? (
        <Typography>{t('edit.refundTransfer', { amount: formatMoney(money.refundTransferPending) })}</Typography>
      ) : null}
      {money.extraDue > 0 && money.paymentLink ? (
        <Typography>{t('edit.extraLink', { amount: formatMoney(money.extraDue) })}</Typography>
      ) : null}
      {money.extraDue > 0 && !money.paymentLink ? (
        <Typography>{t('edit.extraCollect', { amount: formatMoney(money.extraDue) })}</Typography>
      ) : null}
    </Flex>
  );
};

/** Full-page order edit (screens E3). Preview is debounced and never writes. */
export const OrderEditPage = () => {
  const t = useT();
  const navigate = useNavigate();
  const params = useParams();
  const orderId = Number(params.id);
  const { get, post } = useFetchClient();
  const postWithSignal = post as Post;
  const { toggleNotification } = useNotification();
  const toastError = useErrorToast();
  const { allowedActions: can, isLoading: rbacLoading } = useRBAC(RBAC_DETAIL);

  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'missing'>('loading');
  const [qty, setQty] = useState<Record<number, number>>({});
  const [adds, setAdds] = useState<AddedLine[]>([]);
  const [timingChoice, setTimingChoice] = useState<'keep' | 'asap' | 'scheduled'>('keep');
  const [slotDate, setSlotDate] = useState('');
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slot, setSlot] = useState('');
  const [address, setAddress] = useState<AddressForm>(emptyAddress);
  const [reason, setReason] = useState('');
  const [notify, setNotify] = useState(true);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [picking, setPicking] = useState<CatalogProduct | null>(null);
  const [provinces, setProvinces] = useState<Province[]>([]);
  const [provinceQuery, setProvinceQuery] = useState('');
  const [communeQuery, setCommuneQuery] = useState('');
  const [communes, setCommunes] = useState<Commune[]>([]);
  const [preview, setPreview] = useState<EditPreview | null>(null);
  const [previewError, setPreviewError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [soldOutUid, setSoldOutUid] = useState<string | null>(null);
  const generation = useRef(0);

  const applyDetail = useCallback((next: OrderDetail, keepNote: boolean) => {
    setDetail(next);
    setQty(Object.fromEntries(next.lines.filter((line) => liveQty(line) > 0).map((line) => [line.id, liveQty(line)])));
    setAdds([]);
    setTimingChoice('keep');
    setSlot('');
    setSlotDate(String(next.order.businessDate).slice(0, 10));
    setAddress(addressFromDetail(next));
    setPreview(null);
    setPreviewError(null);
    setSoldOutUid(null);
    if (!keepNote) {
      setReason('');
      setNotify(true);
    }
  }, []);

  const load = useCallback(
    async (keepNote: boolean) => {
      try {
        const { data } = await get(`/ordering/orders/${orderId}`);
        applyDetail(data as OrderDetail, keepNote);
        setStatus('ready');
      } catch (error) {
        setStatus(httpStatusOf(error) === 404 ? 'missing' : 'error');
      }
    },
    [applyDetail, get, orderId],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const timezone = detail?.order.branch.timezone ?? 'Asia/Ho_Chi_Minh';
  const receiveKind = detail?.order.receiveMethod.kind ?? 'pickup';
  const catalogDate = timingChoice === 'scheduled' && slotDate ? slotDate : String(detail?.order.businessDate ?? '').slice(0, 10);

  useEffect(() => {
    if (!detail) return;
    void get(`/api/v1/ordering/catalog/products?location=${encodeURIComponent(detail.order.locationRef)}&date=${encodeURIComponent(catalogDate)}&limit=50`)
      .then(({ data }) => setProducts(((data as { items?: CatalogProduct[] })?.items ?? []) as CatalogProduct[]))
      .catch(() => setProducts([]));
  }, [catalogDate, detail, get]);

  useEffect(() => {
    if (!detail || timingChoice !== 'scheduled' || !slotDate) return;
    void get(`/api/v1/ordering/slots?branch=${encodeURIComponent(detail.order.locationRef)}&date=${encodeURIComponent(slotDate)}`)
      .then(({ data }) => setSlots(((data as { items?: Slot[] })?.items ?? []) as Slot[]))
      .catch(() => setSlots([]));
  }, [detail, get, slotDate, timingChoice]);

  useEffect(() => {
    if (receiveKind !== 'delivery') return;
    void get('/api/v1/ordering/admin-units')
      .then(({ data }) => setProvinces(((data as { provinces?: Province[] })?.provinces ?? []) as Province[]))
      .catch(() => setProvinces([]));
  }, [get, receiveKind]);

  useEffect(() => {
    if (!address.provinceCode) {
      setCommunes([]);
      return;
    }
    const timer = window.setTimeout(() => {
      const query = communeQuery.trim();
      void get(
        `/api/v1/ordering/admin-units?province=${encodeURIComponent(address.provinceCode)}&limit=20${query ? `&q=${encodeURIComponent(query)}` : ''}`,
      )
        .then(({ data }) => setCommunes(((data as { communes?: Commune[] })?.communes ?? []) as Commune[]))
        .catch(() => setCommunes([]));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [address.provinceCode, communeQuery, get]);

  const draft = useMemo(
    () =>
      detail
        ? buildEdit({ detail, qty, adds, timingChoice, slot, address, reason, notify })
        : { body: null, blocked: null },
    [adds, address, detail, notify, qty, reason, slot, timingChoice],
  );
  const draftKey = JSON.stringify(draft.body);

  useEffect(() => {
    if (!draft.body) {
      setPreview(null);
      setPreviewError(null);
      setPending(false);
      return;
    }
    const request = ++generation.current;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setPending(true);
      void postWithSignal(`/ordering/orders/${orderId}/edit/preview`, draft.body, { signal: controller.signal })
        .then(({ data }) => {
          if (request !== generation.current) return;
          setPreview(data as EditPreview);
          setPreviewError(null);
          setSoldOutUid(null);
        })
        .catch((error: unknown) => {
          if (request !== generation.current || controller.signal.aborted) return;
          const name = (error as { name?: string; code?: string }).name ?? (error as { code?: string }).code;
          if (name === 'AbortError' || name === 'CanceledError' || name === 'ERR_CANCELED') return;
          setPreview(null);
          setPreviewError(error);
          const api = apiErrorOf(error);
          if (api.code === 'SLOT_FULL') setSlot('');
          if (api.code === 'ITEM_SOLD_OUT' && typeof api.details?.sellableUid === 'string') setSoldOutUid(api.details.sellableUid);
          if (api.code === 'ORDER_NOT_EDITABLE') {
            toastError(error);
            navigate('..');
          }
        })
        .finally(() => {
          if (request === generation.current) setPending(false);
        });
    }, 400);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [draft.body, draftKey, navigate, orderId, postWithSignal, toastError]);

  const save = async () => {
    if (!draft.body) return;
    setSaving(true);
    try {
      await post(`/ordering/orders/${orderId}/edit`, draft.body);
      toggleNotification({ type: 'success', message: t('edit.saved') });
      navigate('..');
    } catch (error) {
      const api = apiErrorOf(error);
      setPreviewError(error);
      if (api.code === 'SLOT_FULL') setSlot('');
      if (api.code === 'ITEM_SOLD_OUT' && typeof api.details?.sellableUid === 'string') setSoldOutUid(api.details.sellableUid);
      if (api.code === 'ORDER_NOT_EDITABLE') {
        toastError(error);
        navigate('..');
      }
    } finally {
      setSaving(false);
      setConfirming(false);
    }
  };

  if (rbacLoading || status === 'loading') {
    return (
      <Flex justifyContent="center" padding={10}>
        <Loader />
      </Flex>
    );
  }
  if (!can.canEdit) {
    return (
      <Box padding={6}>
        <Alert variant="danger" closeLabel={t('common.close')} title={t('common.forbidden.title')}>
          {t('common.forbidden.body')}
        </Alert>
      </Box>
    );
  }
  if (status !== 'ready' || !detail) {
    return (
      <Box padding={6}>
        <Alert
          variant="danger"
          closeLabel={t('common.close')}
          title={status === 'missing' ? t('detail.missing') : t('common.error.title')}
          action={<Button onClick={() => void load(false)}>{t('common.retry')}</Button>}
        >
          {status === 'missing' ? t('detail.missing.body') : t('detail.loadFailed')}
        </Alert>
      </Box>
    );
  }
  if (!detail.editable) {
    return (
      <Box padding={6}>
        <Alert variant="danger" closeLabel={t('common.close')} title={t('error.ORDER_NOT_EDITABLE')}>
          <Button onClick={() => navigate('..')}>{t('common.back')}</Button>
        </Alert>
      </Box>
    );
  }

  const liveLines = detail.lines.filter((line) => liveQty(line) > 0);
  const errorCode = apiErrorOf(previewError).code;
  const provinceMatches = provinces
    .filter((item) => foldDiacritics(item.name).includes(foldDiacritics(provinceQuery)))
    .slice(0, 12);
  const phoneInvalid = address.phone.trim() !== '' && !normalizeVietnamesePhone(address.phone).valid;

  return (
    <>
      <Layouts.Header
        navigationAction={
          <IconButton label={t('common.back')} variant="ghost" onClick={() => navigate('..')}>
            <ArrowLeft />
          </IconButton>
        }
        title={t('edit.title', { code: detail.order.code })}
        subtitle={t('edit.revision', { revision: detail.order.editRevision ?? detail.editRevision })}
        primaryAction={
          <Button disabled={!preview || pending || saving || draft.blocked !== null} loading={saving} onClick={() => setConfirming(true)}>
            {t('edit.save')}
          </Button>
        }
      />
      <Layouts.Content>
        <Grid.Root gap={4}>
          <Grid.Item col={7} s={12} direction="column" alignItems="stretch" gap={4}>
            <Box background="neutral0" hasRadius shadow="tableShadow" padding={5}>
              <Typography variant="delta" tag="h2">
                {t('edit.items')}
              </Typography>
              <Flex direction="column" alignItems="stretch" gap={3} paddingTop={3}>
                {liveLines.map((line) => {
                  const next = qty[line.id] ?? liveQty(line);
                  return (
                    <Flex key={line.id} justifyContent="space-between" gap={3} alignItems="center">
                      <Typography style={next === 0 ? { textDecoration: 'line-through' } : undefined}>{line.title}</Typography>
                      <Box style={{ width: 120 }}>
                        <NumberInput
                          value={next}
                          onValueChange={(value?: number) =>
                            setQty((current) => ({ ...current, [line.id]: Math.max(0, Math.min(liveQty(line), value ?? 0)) }))
                          }
                        />
                      </Box>
                    </Flex>
                  );
                })}
                {adds.map((line) => (
                  <Flex key={line.key} justifyContent="space-between" gap={3} alignItems="center">
                    <Box>
                      <Typography>{line.title}</Typography>
                      {line.options.length > 0 ? (
                        <Typography variant="pi" textColor="neutral600" tag="p">
                          {line.options.map((option) => option.name).join(' · ')}
                        </Typography>
                      ) : null}
                      {soldOutUid === line.sellableUid ? (
                        <Typography variant="pi" textColor="danger600" tag="p">
                          {t('edit.soldOut')}
                        </Typography>
                      ) : null}
                    </Box>
                    <Flex gap={2} alignItems="center">
                      <Box style={{ width: 120 }}>
                        <NumberInput
                          value={line.quantity}
                          onValueChange={(value?: number) =>
                            setAdds((items) =>
                              items.map((item) => (item.key === line.key ? { ...item, quantity: Math.max(1, Math.min(99, value ?? 1)) } : item)),
                            )
                          }
                        />
                      </Box>
                      <IconButton label={t('edit.removeAdd')} variant="ghost" onClick={() => setAdds((items) => items.filter((item) => item.key !== line.key))}>
                        <Trash />
                      </IconButton>
                    </Flex>
                  </Flex>
                ))}
              </Flex>
              <Box paddingTop={4}>
                <Field.Root>
                  <Field.Label>{t('edit.add')}</Field.Label>
                  <Combobox
                    placeholder={t('create.findItem.placeholder')}
                    value=""
                    onChange={(value?: string) => {
                      const product = products.find((item) => item.id === value);
                      if (!product || !product.available) return;
                      const needsPicker = (product.options?.length ?? 0) > 0 || (product.variants?.length ?? 0) > 1;
                      if (needsPicker) {
                        setPicking(product);
                        return;
                      }
                      setAdds((items) => [
                        ...items,
                        {
                          key: crypto.randomUUID(),
                          sellableUid: product.id,
                          ...(product.variants?.[0]?.id ? { variantUid: product.variants[0].id } : {}),
                          title: product.name,
                          quantity: 1,
                          note: '',
                          options: [],
                        },
                      ]);
                    }}
                  >
                    {products.map((product) => (
                      <ComboboxOption key={product.id} value={product.id} disabled={!product.available}>
                        {`${product.name} · ${formatMoney(product.price)}${product.available ? '' : ` · ${product.unavailableReason === 'sold-out-today' ? t('edit.soldOut') : t('create.unavailable')}`}`}
                      </ComboboxOption>
                    ))}
                  </Combobox>
                </Field.Root>
              </Box>
            </Box>

            <Box background="neutral0" hasRadius shadow="tableShadow" padding={5}>
              <Typography variant="delta" tag="h2">
                {t('edit.timing')}
              </Typography>
              <Flex gap={2} wrap="wrap" paddingTop={3}>
                {(['keep', 'asap', 'scheduled'] as const).map((choice) => (
                  <Button key={choice} size="S" variant={timingChoice === choice ? 'default' : 'tertiary'} onClick={() => setTimingChoice(choice)}>
                    {t(choice === 'keep' ? 'edit.keepTiming' : choice === 'asap' ? 'edit.asap' : 'edit.scheduled')}
                  </Button>
                ))}
              </Flex>
              {timingChoice === 'keep' && detail.order.receiveMethod.timing?.slot?.startsAt ? (
                <Box paddingTop={2}>
                  <Typography textColor="neutral600">
                    {formatTime(detail.order.receiveMethod.timing.slot.startsAt, timezone)}
                  </Typography>
                </Box>
              ) : null}
              {timingChoice === 'scheduled' ? (
                <Flex direction="column" alignItems="stretch" gap={2} paddingTop={3}>
                  <Field.Root>
                    <Field.Label>{t('edit.slotDate')}</Field.Label>
                    <TextInput type="date" value={slotDate} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setSlotDate(event.target.value)} />
                  </Field.Root>
                  <Box style={{ maxHeight: 240, overflow: 'auto' }}>
                    <Flex gap={2} wrap="wrap">
                      {slots.map((item) => (
                        <Button
                          key={item.startsAt}
                          size="S"
                          variant={slot === item.startsAt ? 'default' : 'tertiary'}
                          disabled={!item.available}
                          onClick={() => setSlot(item.startsAt)}
                        >
                          {item.available ? item.localStart : `${item.localStart} · ${t('edit.slotFull')}`}
                        </Button>
                      ))}
                    </Flex>
                  </Box>
                  {draft.blocked === 'slot' ? <Typography textColor="danger600">{t('edit.needSlot')}</Typography> : null}
                </Flex>
              ) : null}
            </Box>

            {receiveKind === 'delivery' ? (
              <Box background="neutral0" hasRadius shadow="tableShadow" padding={5}>
                <Typography variant="delta" tag="h2">
                  {t('edit.address')}
                </Typography>
                <Flex direction="column" alignItems="stretch" gap={3} paddingTop={3}>
                  <Field.Root>
                    <Field.Label>{t('edit.province')}</Field.Label>
                    <TextInput value={provinceQuery} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setProvinceQuery(event.target.value)} />
                  </Field.Root>
                  <Flex gap={2} wrap="wrap">
                    {provinceMatches.map((item) => (
                      <Button
                        key={item.code}
                        size="S"
                        variant={address.provinceCode === item.code ? 'default' : 'tertiary'}
                        onClick={() => setAddress((current) => ({ ...current, provinceCode: item.code, communeCode: '', communeName: '' }))}
                      >
                        {item.name}
                      </Button>
                    ))}
                  </Flex>
                  <Field.Root>
                    <Field.Label>{t('edit.communeSearch')}</Field.Label>
                    <TextInput value={communeQuery} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setCommuneQuery(event.target.value)} />
                  </Field.Root>
                  <Flex gap={2} wrap="wrap">
                    {communes.map((item) => (
                      <Button
                        key={item.code}
                        size="S"
                        variant={address.communeCode === item.code ? 'default' : 'tertiary'}
                        onClick={() => setAddress((current) => ({ ...current, communeCode: item.code, communeName: item.name }))}
                      >
                        {item.name}
                      </Button>
                    ))}
                  </Flex>
                  {address.communeName ? <Typography>{address.communeName}</Typography> : null}
                  <Field.Root>
                    <Field.Label>{t('edit.line1')}</Field.Label>
                    <TextInput value={address.line1} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setAddress((current) => ({ ...current, line1: event.target.value }))} />
                  </Field.Root>
                  <Field.Root>
                    <Field.Label>{t('edit.recipient')}</Field.Label>
                    <TextInput
                      value={address.recipientName}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) => setAddress((current) => ({ ...current, recipientName: event.target.value }))}
                    />
                  </Field.Root>
                  <Field.Root error={phoneInvalid ? t('create.phoneInvalid') : undefined}>
                    <Field.Label>{t('edit.phone')}</Field.Label>
                    <TextInput value={address.phone} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setAddress((current) => ({ ...current, phone: event.target.value }))} />
                    <Field.Error />
                  </Field.Root>
                  {draft.blocked === 'address' ? <Typography textColor="danger600">{t('edit.addressIncomplete')}</Typography> : null}
                  {errorCode === 'DELIVERY_UNAVAILABLE' ? <Typography textColor="danger600">{t('error.DELIVERY_UNAVAILABLE')}</Typography> : null}
                </Flex>
              </Box>
            ) : null}

            <Field.Root required>
              <Field.Label>{t('edit.reason')}</Field.Label>
              <Textarea value={reason} onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setReason(event.target.value.slice(0, 500))} />
            </Field.Root>
            <Checkbox checked={notify} onCheckedChange={(value: boolean) => setNotify(value)}>
              {t('edit.notify')}
            </Checkbox>
          </Grid.Item>

          <Grid.Item col={5} s={12}>
            <Box background="neutral0" hasRadius shadow="tableShadow" padding={5} style={{ position: 'sticky', top: 16 }}>
              <Typography variant="delta" tag="h2">
                {t('edit.result')}
              </Typography>
              <Box paddingTop={3}>
                {pending ? <Typography textColor="neutral600">{t('edit.calculating')}</Typography> : null}
                {draft.blocked === 'reason' ? <Typography>{t('edit.needReason')}</Typography> : null}
                {!draft.body && draft.blocked === null && !pending ? <Typography textColor="neutral600">{t('edit.empty')}</Typography> : null}
                {previewError && errorCode !== 'DELIVERY_UNAVAILABLE' ? (
                  <Alert
                    variant="danger"
                    closeLabel={t('common.close')}
                    action={
                      errorCode === 'ORDER_CHANGED' ? (
                        <Button onClick={() => void load(true)}>{t('edit.reload')}</Button>
                      ) : undefined
                    }
                  >
                    {previewErrorText(errorCode, t)}
                  </Alert>
                ) : null}
                {preview ? (
                  <Flex direction="column" alignItems="stretch" gap={2} paddingTop={2}>
                    {(['subtotal', 'adjustment', 'fulfillment', 'total'] as const).map((key) => (
                      <Flex key={key} justifyContent="space-between">
                        <Typography>{t(key === 'fulfillment' ? 'edit.fee' : key === 'subtotal' ? 'edit.subtotal' : key === 'adjustment' ? 'edit.adjustment' : 'edit.total')}</Typography>
                        <Typography>
                          {formatMoney(preview.totals.before[key === 'fulfillment' ? 'fulfillment' : key === 'subtotal' ? 'subtotal' : key === 'adjustment' ? 'adjustment' : 'total'])}
                          {' → '}
                          {formatMoney(preview.totals.after[key === 'fulfillment' ? 'fulfillment' : key === 'subtotal' ? 'subtotal' : key === 'adjustment' ? 'adjustment' : 'total'])}
                        </Typography>
                      </Flex>
                    ))}
                    <MoneyLines preview={preview} t={t} />
                    {preview.warnings.map((code) => (
                      <Alert key={code} variant="warning" closeLabel={t('common.close')}>
                        {warningText(code, t)}
                      </Alert>
                    ))}
                  </Flex>
                ) : null}
              </Box>
            </Box>
          </Grid.Item>
        </Grid.Root>
        {picking ? (
          <ProductPicker
            product={picking}
            onClose={() => setPicking(null)}
            onAdd={(line) => {
              setAdds((items) => [...items, { ...line, key: crypto.randomUUID() }]);
              setPicking(null);
            }}
          />
        ) : null}
        {confirming && preview ? (
          <Frame
            title={t('edit.confirmTitle')}
            onClose={() => setConfirming(false)}
            action={
              <Button loading={saving} onClick={() => void save()}>
                {t('edit.save')}
              </Button>
            }
          >
            <Typography>
              {formatMoney(preview.totals.before.total)} → {formatMoney(preview.totals.after.total)}
            </Typography>
            <MoneyLines preview={preview} t={t} />
          </Frame>
        ) : null}
      </Layouts.Content>
    </>
  );
};
