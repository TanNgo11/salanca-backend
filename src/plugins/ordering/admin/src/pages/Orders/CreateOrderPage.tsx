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
  Modal,
  NumberInput,
  SingleSelect,
  SingleSelectOption,
  Table,
  Tbody,
  Td,
  Textarea,
  TextInput,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { ArrowLeft, Trash } from '@strapi/icons';
import { Layouts, useFetchClient, useNotification } from '@strapi/strapi/admin';
import { useNavigate } from 'react-router-dom';

import { normalizeVietnamesePhone } from '../../../../shared/contact/phone';
import { apiErrorOf, useErrorToast } from '../../lib/api';
import { formatMoney, formatTime, localized } from '../../lib/format';
import { useLocale, useT } from '../../lib/i18n';
import type { OrderDetail } from '../../lib/types';

type Product = {
  id: string;
  name: string;
  price: number;
  available: boolean;
  options: Array<{
    id: string;
    group: string;
    required: boolean;
    min: number;
    max: number | null;
    choices: Array<{ id: string; name: string; price: number; available?: boolean }>;
  }>;
};
type CartLine = {
  key: string;
  product: Product;
  quantity: number;
  selected: Array<{ groupUid: string; optionUid: string; quantity: number }>;
  note: string;
};
type StaffBranch = { code: string; name: Record<string, string>; timezone: string; businessDate: string };
type Slot = { startsAt: string; localStart: string; available: boolean };
type Quote = {
  totals: { subtotal: number; adjustmentTotal: number; grandTotal: number };
  lines: Array<{ lineTotalAmount: number }>;
  /** O8 */
  promotions?: Array<{ code: string; label: string; amount: number }>;
  rejectedPromotions?: Array<{ code: string; reason: string }>;
  pendingPromotions?: Array<{ code: string; label: string; condition: string }>;
};

/** Option picker for one product (variants come from the catalog's default variant in O3). */
const ProductModal = ({ product, onClose, onAdd }: { product: Product; onClose: () => void; onAdd: (line: Omit<CartLine, 'key'>) => void }) => {
  const t = useT();
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const missing = product.options.filter((group) => (group.required || group.min > 0) && (picked[group.id]?.length ?? 0) < Math.max(1, group.min));
  return (
    <Modal.Root open onOpenChange={(open: boolean) => (!open ? onClose() : undefined)}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{product.name}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={4}>
            {product.options.map((group) => (
              <Box key={group.id}>
                <Typography fontWeight="bold">
                  {group.group}
                  {group.required ? ' *' : ''}
                  {group.max ? ` · ${t('create.maxChoices', { max: group.max })}` : ''}
                </Typography>
                {group.choices.map((choice) => {
                  const chosen = picked[group.id] ?? [];
                  const checked = chosen.includes(choice.id);
                  return (
                    <Box key={choice.id} paddingTop={1}>
                      <Checkbox
                        checked={checked}
                        disabled={choice.available === false || (!checked && group.max !== null && chosen.length >= group.max)}
                        onCheckedChange={(value: boolean) =>
                          setPicked((current) => ({
                            ...current,
                            [group.id]: value
                              ? [...(current[group.id] ?? []), choice.id]
                              : (current[group.id] ?? []).filter((id) => id !== choice.id),
                          }))
                        }
                      >
                        {choice.name}
                        {choice.price ? ` (+${formatMoney(choice.price)})` : ''}
                      </Checkbox>
                    </Box>
                  );
                })}
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
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={missing.length > 0}
            onClick={() =>
              onAdd({
                product,
                quantity,
                note,
                selected: Object.entries(picked).flatMap(([groupUid, ids]) =>
                  ids.map((optionUid) => ({ groupUid, optionUid, quantity: 1 })),
                ),
              })
            }
          >
            {t('create.addToOrder')}
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

/**
 * "Tạo đơn hộ" (screens S6; Saleor OrderDraftPage + Vendure draft). The cart lives in this page;
 * the server prices it on every change, saves it as a draft holding its slot, and confirms it.
 */
export const CreateOrderPage = () => {
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();
  const { get, post } = useFetchClient();
  const { toggleNotification } = useNotification();
  const toastError = useErrorToast();

  const [branches, setBranches] = useState<StaffBranch[]>([]);
  const [branch, setBranch] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [picking, setPicking] = useState<Product | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [contact, setContact] = useState({ name: '', phone: '', email: '' });
  const [timingMode, setTimingMode] = useState<'asap' | 'slot'>('asap');
  const [slotDate, setSlotDate] = useState('');
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slot, setSlot] = useState('');
  const [consent, setConsent] = useState(false);
  const [customerNote, setCustomerNote] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  // O8: the code is applied with a button so typing does not re-quote on every key.
  const [promoInput, setPromoInput] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [quoteError, setQuoteError] = useState<{ message: string; lineIndex?: number } | null>(null);
  const [saving, setSaving] = useState<'draft' | 'confirm' | null>(null);
  const idempotencyKey = useRef(`draft-${crypto.randomUUID()}`);

  const timezone = branches.find((item) => item.code === branch)?.timezone ?? 'Asia/Ho_Chi_Minh';

  useEffect(() => {
    void get('/ordering/orders/branches')
      .then(({ data }) => {
        const items = ((data as { results?: StaffBranch[] })?.results ?? []) as StaffBranch[];
        setBranches(items);
        if (items[0]) {
          setBranch(items[0].code);
          setSlotDate(items[0].businessDate);
        }
      })
      .catch(toastError);
  }, [get, toastError]);

  useEffect(() => {
    if (!branch) return;
    void get(`/api/v1/ordering/catalog/products?location=${encodeURIComponent(branch)}&limit=50&locale=${locale}`)
      .then(({ data }) => setProducts(((data as { items?: Product[] })?.items ?? []) as Product[]))
      .catch(() => setProducts([]));
  }, [branch, get, locale]);

  useEffect(() => {
    if (!branch || timingMode !== 'slot' || !slotDate) return;
    void get(`/api/v1/ordering/slots?branch=${encodeURIComponent(branch)}&date=${slotDate}`)
      .then(({ data }) => setSlots(((data as { items?: Slot[] })?.items ?? []) as Slot[]))
      .catch(() => setSlots([]));
  }, [branch, get, slotDate, timingMode]);

  const body = useMemo(
    () => ({
      branch,
      locale,
      lines: cart.map((line) => ({
        sellableUid: line.product.id,
        quantity: line.quantity,
        selected: line.selected,
        ...(line.note ? { note: line.note } : {}),
      })),
      receiveMethod: { kind: 'pickup', ...(timingMode === 'slot' && slot ? { slot: { startsAt: slot } } : {}) },
      ...(promoCode ? { promotionCode: promoCode } : {}),
    }),
    [branch, cart, locale, promoCode, slot, timingMode],
  );

  const requote = useCallback(async () => {
    if (!branch || cart.length === 0 || (timingMode === 'slot' && !slot)) {
      setQuote(null);
      return;
    }
    try {
      const { data } = await post('/ordering/drafts/quote', body);
      setQuote(data as Quote);
      setQuoteError(null);
    } catch (error) {
      const api = apiErrorOf(error);
      setQuote(null);
      setQuoteError({
        message: t(`error.${api.code ?? ''}`, undefined, api.message ?? t('error.generic')),
        lineIndex: typeof api.details?.lineIndex === 'number' ? api.details.lineIndex : undefined,
      });
    }
  }, [body, branch, cart.length, post, slot, t, timingMode]);

  useEffect(() => {
    void requote();
  }, [requote]);

  const phone = normalizeVietnamesePhone(contact.phone);
  const ready = cart.length > 0 && contact.name.trim() !== '' && phone.valid && consent && quote !== null;

  const save = async (confirm: boolean) => {
    setSaving(confirm ? 'confirm' : 'draft');
    try {
      const { data } = await post('/ordering/drafts', {
        ...body,
        contact: { name: contact.name.trim(), phone: contact.phone, ...(contact.email.trim() ? { email: contact.email.trim() } : {}) },
        // The server stamps the policy version in force (Settings → Bán hàng); staff only attest consent.
        consent: { accepted: consent },
        ...(customerNote.trim() ? { customerNote: customerNote.trim() } : {}),
        idempotencyKey: idempotencyKey.current,
      });
      let detail = data as OrderDetail;
      if (confirm) detail = (await post(`/ordering/drafts/${detail.order.id}/confirm`)).data as OrderDetail;
      toggleNotification({ type: 'success', message: confirm ? t('draft.confirmed') : t('draft.saved') });
      navigate(`../${detail.order.id}`);
    } catch (error) {
      toastError(error);
      if (apiErrorOf(error).code === 'SLOT_FULL') setSlot('');
    } finally {
      setSaving(null);
    }
  };

  return (
    <>
      <Layouts.Header
        navigationAction={
          <IconButton label={t('common.back')} variant="ghost" onClick={() => navigate('..')}>
            <ArrowLeft />
          </IconButton>
        }
        title={t('create.title')}
        subtitle={t('create.subtitle')}
        primaryAction={
          <Flex gap={2}>
            <Button variant="secondary" disabled={!ready || saving !== null} loading={saving === 'draft'} onClick={() => void save(false)}>
              {t('create.saveDraft')}
            </Button>
            <Button disabled={!ready || saving !== null} loading={saving === 'confirm'} onClick={() => void save(true)}>
              {t('create.confirm')}
            </Button>
          </Flex>
        }
      />
      <Layouts.Content>
        <Grid.Root gap={4}>
          <Grid.Item col={7} s={12} direction="column" alignItems="stretch" gap={4}>
            <Field.Root>
              <Field.Label>{t('create.findItem')}</Field.Label>
              <Combobox
                placeholder={t('create.findItem.placeholder')}
                value=""
                onChange={(value?: string) => {
                  const product = products.find((item) => item.id === value);
                  if (product) setPicking(product);
                }}
              >
                {products.map((product) => (
                  <ComboboxOption key={product.id} value={product.id} disabled={!product.available}>
                    {`${product.name} · ${formatMoney(product.price)}${product.available ? '' : ` · ${t('create.unavailable')}`}`}
                  </ComboboxOption>
                ))}
              </Combobox>
            </Field.Root>
            {cart.length === 0 ? (
              <Typography textColor="neutral600">{t('create.emptyCart')}</Typography>
            ) : (
              <Table colCount={4} rowCount={cart.length + 1}>
                <Thead>
                  <Tr>
                    <Th>
                      <Typography variant="sigma">{t('detail.col.item')}</Typography>
                    </Th>
                    <Th>
                      <Typography variant="sigma">{t('detail.col.qty')}</Typography>
                    </Th>
                    <Th>
                      <Typography variant="sigma">{t('detail.col.amount')}</Typography>
                    </Th>
                    <Th>
                      <Typography variant="sigma">&nbsp;</Typography>
                    </Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {cart.map((line, index) => (
                    <Tr key={line.key}>
                      <Td>
                        <Typography fontWeight="semiBold">{line.product.name}</Typography>
                        {quoteError?.lineIndex === index ? (
                          <Typography variant="pi" textColor="danger600" tag="p">
                            {quoteError.message}
                          </Typography>
                        ) : null}
                      </Td>
                      <Td>
                        <NumberInput
                          value={line.quantity}
                          onValueChange={(value?: number) =>
                            setCart((items) =>
                              items.map((item) => (item.key === line.key ? { ...item, quantity: Math.max(1, Math.min(99, value ?? 1)) } : item)),
                            )
                          }
                        />
                      </Td>
                      <Td>
                        <Typography>{quote ? formatMoney(quote.lines[index]?.lineTotalAmount) : '—'}</Typography>
                      </Td>
                      <Td>
                        <IconButton label={t('create.remove')} variant="ghost" onClick={() => setCart((items) => items.filter((item) => item.key !== line.key))}>
                          <Trash />
                        </IconButton>
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
            {quoteError && quoteError.lineIndex === undefined ? (
              <Alert variant="danger" closeLabel={t('common.close')} title={t('create.quoteFailed')}>
                {quoteError.message}
              </Alert>
            ) : null}
            <Flex gap={2} alignItems="flex-end">
              <Field.Root>
                <Field.Label>{t('create.promoCode')}</Field.Label>
                <TextInput
                  value={promoInput}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => setPromoInput(event.target.value.toUpperCase())}
                />
              </Field.Root>
              <Button variant="secondary" onClick={() => setPromoCode(promoInput.trim())}>
                {t('create.promoApply')}
              </Button>
            </Flex>
            {quote?.rejectedPromotions?.map((row) => (
              <Typography key={`${row.code}:${row.reason}`} tag="p" textColor="danger600">
                {t(`promo.reason.${row.reason}`, { code: row.code }, row.reason)}
              </Typography>
            ))}
            {quote?.pendingPromotions?.map((row) => (
              <Typography key={row.code} tag="p" textColor="neutral600">
                {t('create.promoPending', { label: row.label })}
              </Typography>
            ))}
            {quote ? (
              <Box>
                <Typography>{t('detail.subtotal')}: {formatMoney(quote.totals.subtotal)}</Typography>
                {quote.promotions?.map((promo) => (
                  <Typography key={promo.code} tag="p">
                    {`${t('detail.promotion', { code: /^P\d+$/.test(promo.code) ? promo.label : promo.code })}: ${formatMoney(promo.amount)}`}
                  </Typography>
                ))}
                {quote.totals.adjustmentTotal ? <Typography tag="p">{formatMoney(quote.totals.adjustmentTotal)}</Typography> : null}
                <Typography variant="beta" tag="p">
                  {t('detail.total')}: {formatMoney(quote.totals.grandTotal)}
                </Typography>
                <Typography variant="pi" textColor="neutral600">
                  {t('create.noManualPrice')}
                </Typography>
              </Box>
            ) : null}
          </Grid.Item>
          <Grid.Item col={5} s={12} direction="column" alignItems="stretch" gap={4}>
            <Field.Root>
              <Field.Label>{t('orders.filter.branch')}</Field.Label>
              <SingleSelect
                value={branch}
                onChange={(value: string | number) => {
                  setBranch(String(value));
                  setCart([]);
                  setSlot('');
                }}
              >
                {branches.map((item) => (
                  <SingleSelectOption key={item.code} value={item.code}>
                    {localized(item.name, locale) || item.code}
                  </SingleSelectOption>
                ))}
              </SingleSelect>
            </Field.Root>
            <Field.Root required>
              <Field.Label>{t('create.customerName')}</Field.Label>
              <TextInput value={contact.name} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setContact({ ...contact, name: event.target.value })} />
            </Field.Root>
            <Field.Root required error={contact.phone && !phone.valid ? t('create.phoneInvalid') : undefined}>
              <Field.Label>{t('create.phone')}</Field.Label>
              <TextInput value={contact.phone} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setContact({ ...contact, phone: event.target.value })} />
              <Field.Error />
            </Field.Root>
            <Field.Root>
              <Field.Label>{t('create.email')}</Field.Label>
              <TextInput type="email" value={contact.email} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setContact({ ...contact, email: event.target.value })} />
            </Field.Root>
            <Field.Root>
              <Field.Label>{t('create.pickup')}</Field.Label>
              <SingleSelect value={timingMode} onChange={(value: string | number) => setTimingMode(String(value) as 'asap' | 'slot')}>
                <SingleSelectOption value="asap">{t('summary.asap')}</SingleSelectOption>
                <SingleSelectOption value="slot">{t('create.pickSlot')}</SingleSelectOption>
              </SingleSelect>
            </Field.Root>
            {timingMode === 'slot' ? (
              <Flex gap={2}>
                <TextInput type="date" value={slotDate} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setSlotDate(event.target.value)} />
                <SingleSelect value={slot} placeholder={t('create.pickSlot')} onChange={(value: string | number) => setSlot(String(value))}>
                  {slots.map((item) => (
                    <SingleSelectOption key={item.startsAt} value={item.startsAt} disabled={!item.available}>
                      {formatTime(item.startsAt, timezone)}
                    </SingleSelectOption>
                  ))}
                </SingleSelect>
              </Flex>
            ) : null}
            <Typography>{t('create.payment')}</Typography>
            <Checkbox checked={consent} onCheckedChange={(value: boolean) => setConsent(value)}>
              {t('create.consent')}
            </Checkbox>
            <Field.Root>
              <Field.Label>{t('create.customerNote')}</Field.Label>
              <Textarea
                value={customerNote}
                onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setCustomerNote(event.target.value.slice(0, 500))}
              />
            </Field.Root>
          </Grid.Item>
        </Grid.Root>
        {picking ? (
          <ProductModal
            product={picking}
            onClose={() => setPicking(null)}
            onAdd={(line) => {
              setCart((items) => [...items, { ...line, key: crypto.randomUUID() }]);
              setPicking(null);
            }}
          />
        ) : null}
      </Layouts.Content>
    </>
  );
};
