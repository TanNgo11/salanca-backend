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
import { giftSaleIssue, isGiftCardProduct, parseScannedCodes } from '../../lib/gift-sale';
import { useLocale, useT } from '../../lib/i18n';
import type { OrderDetail } from '../../lib/types';

type Product = {
  id: string;
  name: string;
  price: number;
  available: boolean;
  /** `['digital']` marks a gift card; food lists pickup/delivery. */
  fulfillment?: string[];
  /** Sellable variants (size, card denomination); the default one prices the product. */
  variants?: Array<{ id: string; name: string; price: number | null; default?: boolean; available?: boolean }>;
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
  /** Chosen variant when the product has several (e.g. the card denomination). */
  variant?: { id: string; name: string; price: number | null };
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

/** Variant + option picker for one product. */
const ProductModal = ({ product, onClose, onAdd }: { product: Product; onClose: () => void; onAdd: (line: Omit<CartLine, 'key'>) => void }) => {
  const t = useT();
  const variants = product.variants ?? [];
  const [variantId, setVariantId] = useState(() => (variants.find((item) => item.default) ?? variants[0])?.id ?? '');
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
            {variants.length > 1 ? (
              <Field.Root>
                <Field.Label>{t('create.variant')}</Field.Label>
                <SingleSelect value={variantId} onChange={(value: string | number) => setVariantId(String(value))}>
                  {variants.map((item) => (
                    <SingleSelectOption key={item.id} value={item.id} disabled={item.available === false}>
                      {`${item.name}${item.price !== null ? ` · ${formatMoney(item.price)}` : ''}${item.available === false ? ` · ${t('create.unavailable')}` : ''}`}
                    </SingleSelectOption>
                  ))}
                </SingleSelect>
              </Field.Root>
            ) : null}
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
            disabled={missing.length > 0 || (variants.length > 1 && variants.find((item) => item.id === variantId)?.available === false)}
            onClick={() =>
              onAdd({
                product,
                ...(variants.length > 1 && variantId
                  ? (() => {
                      const chosen = variants.find((item) => item.id === variantId);
                      return chosen ? { variant: { id: chosen.id, name: chosen.name, price: chosen.price } } : {};
                    })()
                  : {}),
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
  // Gift-card counter sale: cards are delivered by email or handed over as scanned printed stock.
  const [saleKind, setSaleKind] = useState<'pickup' | 'gift-card'>('pickup');
  const [gift, setGift] = useState({ recipientEmail: '', recipientName: '', message: '', codes: '' });
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

  const isGift = saleKind === 'gift-card';
  const scannedCodes = useMemo(() => parseScannedCodes(gift.codes), [gift.codes]);
  const cardUnits = cart.reduce((sum, line) => sum + line.quantity, 0);
  const giftIssue = isGift
    ? giftSaleIssue({ codes: scannedCodes, units: cardUnits, recipientEmail: gift.recipientEmail, contactEmail: contact.email })
    : null;

  // The quote body leaves out recipient details and scans so typing them does not re-quote.
  const body = useMemo(
    () => ({
      branch,
      locale,
      lines: cart.map((line) => ({
        sellableUid: line.product.id,
        ...(line.variant ? { variantUid: line.variant.id } : {}),
        quantity: line.quantity,
        selected: line.selected,
        ...(line.note ? { note: line.note } : {}),
      })),
      receiveMethod: isGift
        ? { kind: 'digital' }
        : { kind: 'pickup', ...(timingMode === 'slot' && slot ? { slot: { startsAt: slot } } : {}) },
      ...(promoCode && !isGift ? { promotionCode: promoCode } : {}),
    }),
    [branch, cart, isGift, locale, promoCode, slot, timingMode],
  );

  const requote = useCallback(async () => {
    if (!branch || cart.length === 0 || (!isGift && timingMode === 'slot' && !slot)) {
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
  }, [body, branch, cart.length, isGift, post, slot, t, timingMode]);

  useEffect(() => {
    void requote();
  }, [requote]);

  const phone = normalizeVietnamesePhone(contact.phone);
  const ready =
    cart.length > 0 && contact.name.trim() !== '' && phone.valid && consent && quote !== null && giftIssue === null;

  const save = async (confirm: boolean) => {
    setSaving(confirm ? 'confirm' : 'draft');
    try {
      const { data } = await post('/ordering/drafts', {
        ...body,
        ...(isGift
          ? {
              receiveMethod: {
                kind: 'digital',
                ...(gift.recipientEmail.trim() ? { recipientEmail: gift.recipientEmail.trim() } : {}),
                ...(gift.recipientName.trim() ? { recipientName: gift.recipientName.trim() } : {}),
                ...(gift.message.trim() ? { message: gift.message.trim() } : {}),
                ...(scannedCodes.length > 0 ? { physicalCodes: scannedCodes } : {}),
              },
              payment: { providerCode: 'cash' },
            }
          : {}),
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
                {products.filter((product) => isGiftCardProduct(product) === isGift).map((product) => (
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
                        {line.variant ? (
                          <Typography variant="pi" textColor="neutral600" tag="p">
                            {line.variant.name}
                          </Typography>
                        ) : null}
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
            {isGift ? null : (
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
            )}
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
              <Field.Label>{t('create.saleKind')}</Field.Label>
              <SingleSelect
                value={saleKind}
                onChange={(value: string | number) => {
                  setSaleKind(String(value) as 'pickup' | 'gift-card');
                  setCart([]);
                  setQuote(null);
                  setPromoCode('');
                  setPromoInput('');
                }}
              >
                <SingleSelectOption value="pickup">{t('create.saleKind.pickup')}</SingleSelectOption>
                <SingleSelectOption value="gift-card">{t('create.saleKind.giftCard')}</SingleSelectOption>
              </SingleSelect>
            </Field.Root>
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
            {isGift ? (
              <Flex direction="column" alignItems="stretch" gap={3} data-testid="gift-sale-fields">
                <Typography variant="delta" tag="h2">
                  {t('create.gift.title')}
                </Typography>
                <Field.Root error={giftIssue === 'bad-email' ? t('create.gift.badEmail') : undefined}>
                  <Field.Label>{t('create.gift.recipientEmail')}</Field.Label>
                  <TextInput
                    type="email"
                    value={gift.recipientEmail}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => setGift({ ...gift, recipientEmail: event.target.value })}
                  />
                  <Field.Error />
                </Field.Root>
                <Field.Root>
                  <Field.Label>{t('create.gift.recipientName')}</Field.Label>
                  <TextInput
                    value={gift.recipientName}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => setGift({ ...gift, recipientName: event.target.value.slice(0, 120) })}
                  />
                </Field.Root>
                <Field.Root hint={t('create.gift.messageHint')}>
                  <Field.Label>{t('create.gift.message')}</Field.Label>
                  <Textarea
                    value={gift.message}
                    onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setGift({ ...gift, message: event.target.value.slice(0, 300) })}
                  />
                  <Field.Hint />
                </Field.Root>
                <Field.Root
                  hint={t('create.gift.scanHint')}
                  error={
                    giftIssue === 'duplicate'
                      ? t('create.gift.duplicate')
                      : giftIssue === 'count-mismatch'
                        ? t('create.gift.countMismatch', { scanned: scannedCodes.length, units: cardUnits })
                        : undefined
                  }
                >
                  <Field.Label>{t('create.gift.scan')}</Field.Label>
                  <Textarea
                    value={gift.codes}
                    onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setGift({ ...gift, codes: event.target.value })}
                  />
                  <Field.Hint />
                  <Field.Error />
                </Field.Root>
                <Typography variant="pi" textColor="neutral600">
                  {t('create.gift.scanned', { scanned: scannedCodes.length, units: cardUnits })}
                </Typography>
                {giftIssue === 'no-delivery' && cart.length > 0 ? (
                  <Typography variant="pi" textColor="danger600">
                    {t('create.gift.noDelivery')}
                  </Typography>
                ) : null}
              </Flex>
            ) : (
            <Field.Root>
              <Field.Label>{t('create.pickup')}</Field.Label>
              <SingleSelect value={timingMode} onChange={(value: string | number) => setTimingMode(String(value) as 'asap' | 'slot')}>
                <SingleSelectOption value="asap">{t('summary.asap')}</SingleSelectOption>
                <SingleSelectOption value="slot">{t('create.pickSlot')}</SingleSelectOption>
              </SingleSelect>
            </Field.Root>
            )}
            {!isGift && timingMode === 'slot' ? (
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
            <Typography>{isGift ? t('create.gift.payment') : t('create.payment')}</Typography>
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
