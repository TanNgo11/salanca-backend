import {
  Box,
  Button,
  Checkbox,
  Field,
  Flex,
  Grid,
  IconButton,
  NumberInput,
  SingleSelect,
  SingleSelectOption,
  Switch,
  Table,
  Tbody,
  Td,
  TextInput,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { Plus, Trash } from '@strapi/icons';

import { useT } from '../../lib/i18n';

export type BranchFee = {
  code: string;
  label: Record<string, string>;
  kind: 'service' | 'packaging';
  amount?: number;
  percent?: number;
  receiveKinds: ('pickup' | 'delivery' | 'dine-in')[];
  taxable: boolean;
  minSubtotal?: number;
};

export type Printing = {
  width: 58 | 80;
  header?: string;
  footer?: string;
  autoKitchenTicket: boolean;
} | null;

export type DineIn = {
  enabled: boolean;
  sessionPayment: 'per-order' | 'at-close';
  autoRejectAfterMinutes: number | null;
} & Record<string, unknown>;

const RECEIVE_KINDS = ['pickup', 'delivery', 'dine-in'] as const;

const blankFee = (fees: BranchFee[]): BranchFee => {
  let n = fees.length + 1;
  while (fees.some((fee) => fee.code === `phi-${n}`)) n += 1;
  return {
    code: `phi-${n}`,
    label: { vi: '', en: '' },
    kind: 'service',
    amount: 0,
    receiveKinds: ['pickup', 'delivery'],
    taxable: true,
  };
};

/** Value-or-empty number box: minutes fields where "trống = tắt". */
const OptionalMinutes = ({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: number | null;
  onChange: (next: number | null) => void;
  hint?: string;
}) => {
  const t = useT();
  return (
    <Field.Root hint={hint}>
      <Field.Label>{label}</Field.Label>
      <Flex gap={2} alignItems="center">
        <Switch
          checked={value !== null}
          onCheckedChange={(checked: boolean) => onChange(checked ? 15 : null)}
        />
        {value === null ? (
          <Typography textColor="neutral600">{t('branch.autoRejectOff')}</Typography>
        ) : (
          <NumberInput value={value} min={1} max={1440} onValueChange={(next?: number) => onChange(next ?? null)} />
        )}
      </Flex>
      <Field.Hint />
    </Field.Root>
  );
};

/**
 * "Nhà hàng" tab inside Chi nhánh (screens N4): service/packaging fees, per-kind auto-reject
 * minutes, receipt printing and the dine-in toggle. Tip is intentionally absent (deferred
 * pending the accounting decision).
 */
export const RestaurantTab = ({
  fees,
  printing,
  pickupAutoReject,
  deliveryAutoReject,
  dineIn,
  onFees,
  onPrinting,
  onPickupAutoReject,
  onDeliveryAutoReject,
  onDineIn,
}: {
  fees: BranchFee[];
  printing: Printing;
  pickupAutoReject: number | null;
  deliveryAutoReject: number | null;
  dineIn: DineIn;
  onFees: (next: BranchFee[] | null) => void;
  onPrinting: (next: Printing) => void;
  onPickupAutoReject: (next: number | null) => void;
  onDeliveryAutoReject: (next: number | null) => void;
  onDineIn: (next: DineIn) => void;
}) => {
  const t = useT();
  const patch = (index: number, next: Partial<BranchFee>) =>
    onFees(fees.map((fee, i) => (i === index ? { ...fee, ...next } : fee)));
  const printingValue = printing ?? { width: 80 as const, autoKitchenTicket: false };
  return (
    <Flex direction="column" alignItems="stretch" gap={8}>
      {/* ── Fees ─────────────────────────────────────────────────────────── */}
      <Flex direction="column" alignItems="stretch" gap={3}>
        <Typography variant="delta">{t('branch.fees.title')}</Typography>
        {fees.length === 0 ? (
          <Typography textColor="neutral600">{t('branch.fees.empty')}</Typography>
        ) : (
          <Table colCount={8} rowCount={fees.length + 1}>
            <Thead>
              <Tr>
                <Th>{t('branch.fees.code')}</Th>
                <Th>{t('branch.fees.labelVi')}</Th>
                <Th>{t('branch.fees.labelEn')}</Th>
                <Th>{t('branch.fees.kind')}</Th>
                <Th>{t('branch.fees.amount')}</Th>
                <Th>{t('branch.fees.percent')}</Th>
                <Th>{t('branch.fees.applies')}</Th>
                <Th>{t('branch.fees.remove')}</Th>
              </Tr>
            </Thead>
            <Tbody>
              {fees.map((fee, index) => (
                <Tr key={index}>
                  <Td>
                    <TextInput
                      aria-label={t('branch.fees.code')}
                      value={fee.code}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                        patch(index, { code: event.target.value })
                      }
                    />
                  </Td>
                  <Td>
                    <TextInput
                      aria-label={t('branch.fees.labelVi')}
                      value={fee.label.vi ?? ''}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                        patch(index, { label: { ...fee.label, vi: event.target.value } })
                      }
                    />
                  </Td>
                  <Td>
                    <TextInput
                      aria-label={t('branch.fees.labelEn')}
                      value={fee.label.en ?? ''}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                        patch(index, { label: { ...fee.label, en: event.target.value } })
                      }
                    />
                  </Td>
                  <Td>
                    <SingleSelect
                      value={fee.kind}
                      onChange={(value: string | number) =>
                        patch(index, { kind: String(value) as BranchFee['kind'] })
                      }
                    >
                      <SingleSelectOption value="service">{t('branch.fees.kind.service')}</SingleSelectOption>
                      <SingleSelectOption value="packaging">{t('branch.fees.kind.packaging')}</SingleSelectOption>
                    </SingleSelect>
                  </Td>
                  <Td>
                    <Flex direction="column" gap={1}>
                      <Checkbox
                        checked={fee.amount !== undefined}
                        onCheckedChange={(checked: boolean) =>
                          patch(index, checked ? { amount: 0, percent: undefined } : { amount: undefined })
                        }
                      >
                        {t('branch.fees.amount')}
                      </Checkbox>
                      {fee.amount !== undefined ? (
                        <NumberInput
                          aria-label={t('branch.fees.amount')}
                          value={fee.amount}
                          min={0}
                          onValueChange={(next?: number) => patch(index, { amount: next ?? 0 })}
                        />
                      ) : null}
                    </Flex>
                  </Td>
                  <Td>
                    <Flex direction="column" gap={1}>
                      <Checkbox
                        checked={fee.percent !== undefined}
                        onCheckedChange={(checked: boolean) =>
                          patch(index, checked ? { percent: 5, amount: undefined } : { percent: undefined })
                        }
                      >
                        {t('branch.fees.percent')}
                      </Checkbox>
                      {fee.percent !== undefined ? (
                        <NumberInput
                          aria-label={t('branch.fees.percent')}
                          value={fee.percent}
                          min={0}
                          max={100}
                          onValueChange={(next?: number) => patch(index, { percent: next ?? 0 })}
                        />
                      ) : null}
                    </Flex>
                  </Td>
                  <Td>
                    <Flex direction="column" gap={1}>
                      {RECEIVE_KINDS.map((kind) => (
                        <Checkbox
                          key={kind}
                          checked={fee.receiveKinds.includes(kind)}
                          onCheckedChange={(checked: boolean) =>
                            patch(index, {
                              receiveKinds: checked
                                ? [...fee.receiveKinds, kind]
                                : fee.receiveKinds.filter((item) => item !== kind),
                            })
                          }
                        >
                          {t(`kind.${kind === 'dine-in' ? 'dineIn' : kind}`)}
                        </Checkbox>
                      ))}
                      <Checkbox
                        checked={fee.taxable}
                        onCheckedChange={(checked: boolean) => patch(index, { taxable: checked })}
                      >
                        {t('branch.fees.taxable')}
                      </Checkbox>
                    </Flex>
                  </Td>
                  <Td>
                    <IconButton
                      label={t('branch.fees.remove')}
                      variant="ghost"
                      onClick={() => onFees(fees.filter((_, i) => i !== index))}
                    >
                      <Trash />
                    </IconButton>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
        <Box>
          <Button size="S" variant="tertiary" startIcon={<Plus />} onClick={() => onFees([...fees, blankFee(fees)])}>
            {t('branch.fees.add')}
          </Button>
        </Box>
      </Flex>

      {/* ── Auto-reject ──────────────────────────────────────────────────── */}
      <Flex direction="column" alignItems="stretch" gap={3}>
        <Typography variant="delta">{t('branch.autoReject.title')}</Typography>
        <Typography variant="pi" textColor="neutral600">
          {t('branch.autoReject.hint')}
        </Typography>
        <Grid.Root gap={4}>
          <Grid.Item col={4} s={12}>
            <OptionalMinutes
              label={t('kind.pickup')}
              value={pickupAutoReject}
              onChange={onPickupAutoReject}
            />
          </Grid.Item>
          <Grid.Item col={4} s={12}>
            <OptionalMinutes
              label={t('kind.delivery')}
              value={deliveryAutoReject}
              onChange={onDeliveryAutoReject}
            />
          </Grid.Item>
          <Grid.Item col={4} s={12}>
            <OptionalMinutes
              label={t('kind.dineIn')}
              value={dineIn.autoRejectAfterMinutes}
              onChange={(next) => onDineIn({ ...dineIn, autoRejectAfterMinutes: next })}
            />
          </Grid.Item>
        </Grid.Root>
      </Flex>

      {/* ── Dine-in ──────────────────────────────────────────────────────── */}
      <Flex direction="column" alignItems="stretch" gap={3}>
        <Typography variant="delta">{t('branch.dineIn.title')}</Typography>
        <Flex gap={2}>
          <Switch checked={dineIn.enabled} onCheckedChange={(value: boolean) => onDineIn({ ...dineIn, enabled: value })} />
          <Typography>{t('branch.dineIn.enabled')}</Typography>
        </Flex>
        <Grid.Root gap={4}>
          <Grid.Item col={4} s={12}>
            <Field.Root>
              <Field.Label>{t('branch.dineIn.sessionPayment')}</Field.Label>
              <SingleSelect
                value={dineIn.sessionPayment}
                onChange={(value: string | number) =>
                  onDineIn({ ...dineIn, sessionPayment: String(value) as DineIn['sessionPayment'] })
                }
              >
                <SingleSelectOption value="per-order">{t('branch.dineIn.perOrder')}</SingleSelectOption>
                <SingleSelectOption value="at-close">{t('branch.dineIn.atClose')}</SingleSelectOption>
              </SingleSelect>
            </Field.Root>
          </Grid.Item>
        </Grid.Root>
      </Flex>

      {/* ── Printing ─────────────────────────────────────────────────────── */}
      <Flex direction="column" alignItems="stretch" gap={3}>
        <Typography variant="delta">{t('branch.printing.title')}</Typography>
        <Grid.Root gap={4}>
          <Grid.Item col={4} s={12}>
            <Field.Root>
              <Field.Label>{t('branch.printing.width')}</Field.Label>
              <SingleSelect
                value={String(printingValue.width)}
                onChange={(value: string | number) =>
                  onPrinting({ ...printingValue, width: Number(value) === 58 ? 58 : 80 })
                }
              >
                <SingleSelectOption value="58">58mm</SingleSelectOption>
                <SingleSelectOption value="80">80mm</SingleSelectOption>
              </SingleSelect>
            </Field.Root>
          </Grid.Item>
          <Grid.Item col={4} s={12}>
            <Field.Root>
              <Field.Label>{t('branch.printing.header')}</Field.Label>
              <TextInput
                value={printingValue.header ?? ''}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                  onPrinting({ ...printingValue, header: event.target.value })
                }
              />
            </Field.Root>
          </Grid.Item>
          <Grid.Item col={4} s={12}>
            <Field.Root>
              <Field.Label>{t('branch.printing.footer')}</Field.Label>
              <TextInput
                value={printingValue.footer ?? ''}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                  onPrinting({ ...printingValue, footer: event.target.value })
                }
              />
            </Field.Root>
          </Grid.Item>
        </Grid.Root>
        <Flex gap={2}>
          <Switch
            checked={printingValue.autoKitchenTicket}
            onCheckedChange={(value: boolean) => onPrinting({ ...printingValue, autoKitchenTicket: value })}
          />
          <Typography>{t('branch.printing.autoKitchen')}</Typography>
        </Flex>
      </Flex>
    </Flex>
  );
};
