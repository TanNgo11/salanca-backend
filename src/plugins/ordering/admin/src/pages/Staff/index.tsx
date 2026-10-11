import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Field,
  Flex,
  Loader,
  Modal,
  MultiSelect,
  MultiSelectOption,
  Switch,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { Layouts, Page, useFetchClient, useNotification } from '@strapi/strapi/admin';

import { useErrorToast } from '../../lib/api';
import { localized } from '../../lib/format';
import { useLocale, useT } from '../../lib/i18n';
import { PERMISSIONS } from '../../lib/permissions';

type StaffRow = {
  adminUserId: number;
  name: string | null;
  email: string | null;
  roles: string[];
  isSuperAdmin: boolean;
  allLocations: boolean;
  locationRefs: string[];
  assigned: boolean;
};
type Branch = { code: string; name: Record<string, string> };

/**
 * "Nhân viên và chi nhánh" (screens S8; Saleor channel permissions): who sees which branch.
 * Unassigned staff sort first with a red badge — they see no order at all.
 */
const StaffPage = () => {
  const t = useT();
  const locale = useLocale();
  const { get, put } = useFetchClient();
  const { toggleNotification } = useNotification();
  const toastError = useErrorToast();
  const [rows, setRows] = useState<StaffRow[] | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [editing, setEditing] = useState<StaffRow | null>(null);
  const [all, setAll] = useState(false);
  const [refs, setRefs] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [{ data: staff }, { data: branchList }] = await Promise.all([
        get('/ordering/staff-scopes'),
        get('/ordering/orders/branches'),
      ]);
      setRows((staff as { results: StaffRow[] }).results);
      setBranches((branchList as { results: Branch[] }).results);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [get]);

  useEffect(() => {
    void load();
  }, [load]);

  const branchName = (code: string) => localized(branches.find((item) => item.code === code)?.name, locale) || code;

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await put(`/ordering/staff-scopes/${editing.adminUserId}`, { allLocations: all, locationRefs: all ? [] : refs });
      toggleNotification({ type: 'success', message: t('staff.saved') });
      setEditing(null);
      await load();
    } catch (error) {
      toastError(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page.Protect permissions={PERMISSIONS.scope}>
      <Page.Title>{t('staff.title')}</Page.Title>
      <Page.Main>
        <Layouts.Header title={t('staff.title')} subtitle={t('staff.subtitle')} />
        <Layouts.Content>
          {status === 'loading' ? (
            <Flex justifyContent="center" padding={8}>
              <Loader>{t('common.loading')}</Loader>
            </Flex>
          ) : status === 'error' || !rows ? (
            <Alert variant="danger" closeLabel={t('common.close')} title={t('common.error.title')} action={<Button onClick={() => void load()}>{t('common.retry')}</Button>}>
              {t('staff.loadFailed')}
            </Alert>
          ) : (
            <Table colCount={4} rowCount={rows.length + 1}>
              <Thead>
                <Tr>
                  {['person', 'role', 'branches', 'actions'].map((column) => (
                    <Th key={column}>
                      <Typography variant="sigma">{t(`staff.col.${column}`)}</Typography>
                    </Th>
                  ))}
                </Tr>
              </Thead>
              <Tbody>
                {rows.map((row) => (
                  <Tr key={row.adminUserId}>
                    <Td>
                      <Typography fontWeight="semiBold">{row.name ?? '—'}</Typography>
                      <Typography variant="pi" textColor="neutral600" tag="p">
                        {row.email}
                      </Typography>
                    </Td>
                    <Td>
                      <Typography>{row.roles.join(', ')}</Typography>
                    </Td>
                    <Td>
                      {row.isSuperAdmin ? (
                        <Typography>{t('staff.superAdmin')}</Typography>
                      ) : !row.assigned ? (
                        <Badge textColor="danger700" backgroundColor="danger100">
                          {t('staff.unassigned')}
                        </Badge>
                      ) : row.allLocations ? (
                        <Badge>{t('staff.allBranches')}</Badge>
                      ) : (
                        <Flex gap={1} wrap="wrap">
                          {row.locationRefs.map((code) => (
                            <Badge key={code}>{branchName(code)}</Badge>
                          ))}
                        </Flex>
                      )}
                    </Td>
                    <Td>
                      {row.isSuperAdmin ? null : (
                        <Button
                          size="S"
                          variant="secondary"
                          onClick={() => {
                            setEditing(row);
                            setAll(row.allLocations);
                            setRefs(row.locationRefs);
                          }}
                        >
                          {t('common.edit')}
                        </Button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
          {editing ? (
            <Modal.Root open onOpenChange={(open: boolean) => (!open ? setEditing(null) : undefined)}>
              <Modal.Content>
                <Modal.Header>
                  <Modal.Title>{editing.name ?? editing.email}</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                  <Flex direction="column" alignItems="stretch" gap={4}>
                    <Flex gap={2}>
                      <Switch checked={all} onCheckedChange={setAll} />
                      <Typography>{t('staff.allBranchesSwitch')}</Typography>
                    </Flex>
                    {!all ? (
                      <Field.Root required>
                        <Field.Label>{t('staff.pickBranches')}</Field.Label>
                        <MultiSelect value={refs} onChange={(value: string[]) => setRefs(value)} withTags>
                          {branches.map((item) => (
                            <MultiSelectOption key={item.code} value={item.code}>
                              {branchName(item.code)}
                            </MultiSelectOption>
                          ))}
                        </MultiSelect>
                      </Field.Root>
                    ) : null}
                  </Flex>
                </Modal.Body>
                <Modal.Footer>
                  <Button variant="tertiary" onClick={() => setEditing(null)}>
                    {t('common.cancel')}
                  </Button>
                  <Button loading={saving} disabled={!all && refs.length === 0} onClick={() => void save()}>
                    {t('common.save')}
                  </Button>
                </Modal.Footer>
              </Modal.Content>
            </Modal.Root>
          ) : null}
        </Layouts.Content>
      </Page.Main>
    </Page.Protect>
  );
};

export default StaffPage;
