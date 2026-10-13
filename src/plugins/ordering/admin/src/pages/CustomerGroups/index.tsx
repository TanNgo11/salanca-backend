import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  EmptyStateLayout,
  Field,
  Flex,
  Loader,
  NumberInput,
  Searchbar,
  Table,
  Tbody,
  Td,
  TextInput,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { ArrowLeft, Plus } from '@strapi/icons';
import { Layouts, Page, useFetchClient, useNotification } from '@strapi/strapi/admin';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';

import { useErrorToast } from '../../lib/api';
import { useLocale, useT } from '../../lib/i18n';
import { PERMISSIONS } from '../../lib/permissions';

type GroupRow = {
  id: number;
  code: string;
  name: { vi: string; en?: string };
  auto: { minTotalSpent?: number; minOrderCount?: number; sinceDays?: number } | null;
  active: boolean;
  memberCount: number;
};

type Member = { customerId: string; name: string | null; phoneMasked: string | null; source: 'manual' | 'auto' };
type Hit = { id: string; name: string | null; phoneMasked: string | null };

const List = () => {
  const t = useT();
  const locale = useLocale();
  const { get } = useFetchClient();
  const toast = useErrorToast();
  const navigate = useNavigate();
  const [rows, setRows] = useState<GroupRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await get('/ordering/customer-groups');
      setRows((data as { items: GroupRow[] }).items);
      setFailed(false);
    } catch (error) {
      setFailed(true);
      setRows([]);
      toast(error);
    }
  }, [get, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <Layouts.Header
        title={t('group.title')}
        primaryAction={
          <Button startIcon={<Plus />} onClick={() => navigate('new')}>
            {t('group.new')}
          </Button>
        }
      />
      <Layouts.Content>
        {rows === null ? (
          <Flex justifyContent="center" padding={8}>
            <Loader>{t('common.loading')}</Loader>
          </Flex>
        ) : failed ? (
          <Alert closeLabel={t('common.close')} title={t('common.error.title')} variant="danger">
            {t('group.loadFailed')}
          </Alert>
        ) : rows.length === 0 ? (
          <EmptyStateLayout content={t('group.empty')} />
        ) : (
          <Table colCount={5} rowCount={rows.length + 1}>
            <Thead>
              <Tr>
                {['code', 'name', 'members', 'auto', 'active'].map((column) => (
                  <Th key={column}>
                    <Typography variant="sigma">{t(`group.col.${column}`)}</Typography>
                  </Th>
                ))}
              </Tr>
            </Thead>
            <Tbody>
              {rows.map((row) => (
                <Tr key={row.id}>
                  <Td>
                    <Link to={String(row.id)}>{row.code}</Link>
                  </Td>
                  <Td>
                    <Typography>{(locale === 'en' && row.name.en) || row.name.vi}</Typography>
                  </Td>
                  <Td>
                    <Typography>{row.memberCount}</Typography>
                  </Td>
                  <Td>
                    <Badge>{row.auto ? t('group.auto.on') : t('group.auto.off')}</Badge>
                  </Td>
                  <Td>
                    <Typography>{row.active ? t('group.field.active') : '—'}</Typography>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Layouts.Content>
    </>
  );
};

const Editor = () => {
  const t = useT();
  const { id } = useParams();
  const creating = !id;
  const { get, post, put } = useFetchClient();
  const toast = useErrorToast();
  const { toggleNotification } = useNotification();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [nameVi, setNameVi] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [active, setActive] = useState(true);
  const [automatic, setAutomatic] = useState(false);
  const [minTotalSpent, setMinTotalSpent] = useState<number | undefined>();
  const [minOrderCount, setMinOrderCount] = useState<number | undefined>();
  const [sinceDays, setSinceDays] = useState<number | undefined>();
  const [members, setMembers] = useState<Member[]>([]);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);

  useEffect(() => {
    if (!id) return undefined;
    let live = true;
    void get(`/ordering/customer-groups/${id}`)
      .then(({ data }) => {
        if (!live) return;
        const body = data as { item: GroupRow; members: Member[] };
        setCode(body.item.code);
        setNameVi(body.item.name.vi);
        setNameEn(body.item.name.en ?? '');
        setActive(body.item.active);
        setAutomatic(body.item.auto != null);
        setMinTotalSpent(body.item.auto?.minTotalSpent);
        setMinOrderCount(body.item.auto?.minOrderCount);
        setSinceDays(body.item.auto?.sinceDays);
        setMembers(body.members);
      })
      .catch(toast);
    return () => {
      live = false;
    };
  }, [get, id, toast]);

  const auto = automatic
    ? {
        ...(minTotalSpent != null ? { minTotalSpent } : {}),
        ...(minOrderCount != null ? { minOrderCount } : {}),
        ...(sinceDays != null ? { sinceDays } : {}),
      }
    : null;

  const save = async () => {
    const body = {
      code,
      name: { vi: nameVi, ...(nameEn ? { en: nameEn } : {}) },
      active,
      auto,
    };
    try {
      if (creating) {
        const { data } = await post('/ordering/customer-groups', body);
        toggleNotification({ type: 'success', message: t('group.saved') });
        navigate(`../${(data as { item: GroupRow }).item.id}`);
      } else {
        await put(`/ordering/customer-groups/${id}`, body);
        toggleNotification({ type: 'success', message: t('group.saved') });
      }
    } catch (error) {
      toast(error);
    }
  };

  const search = async (value: string) => {
    setQuery(value);
    if (value.trim().length < 2) {
      setHits([]);
      return;
    }
    try {
      const { data } = await get(`/ordering/customer-groups/search?q=${encodeURIComponent(value)}`);
      setHits((data as { items: Hit[] }).items);
    } catch (error) {
      toast(error);
    }
  };

  const changeMembers = async (add: string[], remove: string[]) => {
    if (!id) return;
    try {
      const { data } = await post(`/ordering/customer-groups/${id}/members`, { add, remove });
      setMembers((data as { members: Member[] }).members);
      toggleNotification({ type: 'success', message: t('group.membersSaved') });
    } catch (error) {
      toast(error);
    }
  };

  return (
    <>
      <Layouts.Header
        title={creating ? t('group.new') : code || t('group.title')}
        navigationAction={
          <Link to="..">
            <ArrowLeft />
          </Link>
        }
        subtitle={t('group.back')}
        primaryAction={<Button onClick={() => void save()}>{t('group.save')}</Button>}
      />
      <Layouts.Content>
        <Flex direction="column" alignItems="stretch" gap={4}>
          <Field.Root required hint={t('group.field.codeHint')}>
            <Field.Label>{t('group.field.code')}</Field.Label>
            <TextInput value={code} disabled={!creating} onChange={(event: { target: { value: string } }) => setCode(event.target.value)} />
          </Field.Root>
          <Field.Root required>
            <Field.Label>{t('group.field.nameVi')}</Field.Label>
            <TextInput value={nameVi} onChange={(event: { target: { value: string } }) => setNameVi(event.target.value)} />
          </Field.Root>
          <Field.Root>
            <Field.Label>{t('group.field.nameEn')}</Field.Label>
            <TextInput value={nameEn} onChange={(event: { target: { value: string } }) => setNameEn(event.target.value)} />
          </Field.Root>
          <Checkbox checked={active} onCheckedChange={(checked: boolean) => setActive(checked === true)}>
            {t('group.field.active')}
          </Checkbox>
          <Checkbox checked={automatic} onCheckedChange={(checked: boolean) => setAutomatic(checked === true)}>
            {t('group.field.auto')}
          </Checkbox>
          {automatic ? (
            <Flex gap={4}>
              <Field.Root>
                <Field.Label>{t('group.field.minSpent')}</Field.Label>
                <NumberInput value={minTotalSpent} min={0} onValueChange={(value?: number) => setMinTotalSpent(value)} />
              </Field.Root>
              <Field.Root>
                <Field.Label>{t('group.field.minOrders')}</Field.Label>
                <NumberInput value={minOrderCount} min={0} onValueChange={(value?: number) => setMinOrderCount(value)} />
              </Field.Root>
              <Field.Root>
                <Field.Label>{t('group.field.sinceDays')}</Field.Label>
                <NumberInput value={sinceDays} min={1} max={3650} onValueChange={(value?: number) => setSinceDays(value)} />
              </Field.Root>
            </Flex>
          ) : null}
          {id ? (
            <Box>
              <Typography variant="delta">{t('group.members')}</Typography>
              <Box paddingTop={2}>
                <Searchbar
                  name="member-search"
                  clearLabel={t('common.clear')}
                  placeholder={t('group.search')}
                  value={query}
                  onClear={() => {
                    setQuery('');
                    setHits([]);
                  }}
                  onChange={(event: { target: { value: string } }) => void search(event.target.value)}
                >
                  {t('group.search')}
                </Searchbar>
              </Box>
              {hits.map((hit) => (
                <Flex key={hit.id} gap={2} paddingTop={2} justifyContent="space-between">
                  <Typography>
                    {hit.name ?? '—'} · {hit.phoneMasked ?? '—'}
                  </Typography>
                  <Button size="S" onClick={() => void changeMembers([hit.id], [])}>
                    {t('group.add')}
                  </Button>
                </Flex>
              ))}
              <Box paddingTop={3}>
                <Table colCount={4} rowCount={members.length + 1}>
                  <Thead>
                    <Tr>
                      <Th>
                        <Typography variant="sigma">{t('group.col.name')}</Typography>
                      </Th>
                      <Th>
                        <Typography variant="sigma">{t('group.field.code')}</Typography>
                      </Th>
                      <Th>
                        <Typography variant="sigma">{t('group.col.auto')}</Typography>
                      </Th>
                      <Th>
                        <Typography variant="sigma">{t('group.remove')}</Typography>
                      </Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {members.map((member) => (
                      <Tr key={member.customerId}>
                        <Td>
                          <Typography>{member.name ?? '—'}</Typography>
                        </Td>
                        <Td>
                          <Typography>{member.phoneMasked ?? '—'}</Typography>
                        </Td>
                        <Td>
                          <Badge>{t(`group.source.${member.source}`)}</Badge>
                        </Td>
                        <Td>
                          <Button size="S" variant="danger-light" onClick={() => void changeMembers([], [member.customerId])}>
                            {t('group.remove')}
                          </Button>
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </Box>
            </Box>
          ) : null}
        </Flex>
      </Layouts.Content>
    </>
  );
};

const CustomerGroupsPage = () => {
  const t = useT();
  return (
    <Page.Protect permissions={PERMISSIONS.price}>
      <Page.Title>{t('group.title')}</Page.Title>
      <Page.Main>
        <Routes>
          <Route index element={<List />} />
          <Route path="new" element={<Editor />} />
          <Route path=":id" element={<Editor />} />
        </Routes>
      </Page.Main>
    </Page.Protect>
  );
};

export default CustomerGroupsPage;
