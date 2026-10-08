/**
 * Receipt sent to the guest after a public reservation request. It confirms
 * receipt only: staff still call to confirm the table, so the copy must never
 * read as a booking confirmation.
 */
import { sanitizeSubjectFragment, type FormLeadEmailMessage } from './form-lead-notify';

export type ReservationConfirmationInput = {
  locale: 'vi' | 'en';
  fullName: string;
  phone: string;
  /** YYYY-MM-DD */
  preferredDate: string;
  /** HH:mm */
  preferredTime: string;
  guestCount: number;
  restaurant: { brandName: string; hotline?: string; address?: string };
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const formatDate = (isoDate: string): string => {
  const [year = '', month = '', day = ''] = isoDate.split('-');
  return `${day}/${month}/${year}`;
};

const copy = {
  vi: {
    subject: (brand: string) => `${brand} đã nhận yêu cầu đặt bàn của bạn`,
    greeting: (name: string) => `Xin chào ${name},`,
    received: (brand: string) => `${brand} đã nhận yêu cầu đặt bàn của bạn:`,
    visit: (date: string, time: string, guests: number) => `${date} lúc ${time} · ${guests} khách`,
    pending: (phone: string) =>
      `Đây chưa phải xác nhận giữ bàn. Nhân viên sẽ gọi số ${phone} để xác nhận với bạn.`,
    change: 'Cần đổi hoặc huỷ, bạn chỉ cần trả lời email này hoặc gọi cho nhà hàng.',
    hotline: 'Hotline',
    address: 'Địa chỉ',
    signOff: (brand: string) => `Hẹn gặp bạn tại ${brand}.`,
  },
  en: {
    subject: (brand: string) => `${brand} received your reservation request`,
    greeting: (name: string) => `Hello ${name},`,
    received: (brand: string) => `${brand} has received your reservation request:`,
    visit: (date: string, time: string, guests: number) =>
      `${date} at ${time} · ${guests} ${guests === 1 ? 'guest' : 'guests'}`,
    pending: (phone: string) =>
      `This is not yet a confirmed booking. Our team will call ${phone} to confirm.`,
    change: 'To change or cancel, reply to this email or call the restaurant.',
    hotline: 'Hotline',
    address: 'Address',
    signOff: (brand: string) => `We look forward to welcoming you at ${brand}.`,
  },
} as const;

export function buildReservationConfirmationEmail(
  input: ReservationConfirmationInput,
): FormLeadEmailMessage {
  const t = copy[input.locale];
  const brand = input.restaurant.brandName;
  const lines = [
    t.greeting(input.fullName),
    '',
    t.received(brand),
    t.visit(formatDate(input.preferredDate), input.preferredTime, input.guestCount),
    '',
    t.pending(input.phone),
    t.change,
    '',
    ...(input.restaurant.hotline ? [`${t.hotline}: ${input.restaurant.hotline}`] : []),
    ...(input.restaurant.address ? [`${t.address}: ${input.restaurant.address}`] : []),
    t.signOff(brand),
  ];

  const html = lines
    .map((line) => (line === '' ? '<br>' : `<p style="margin:0 0 4px">${escapeHtml(line)}</p>`))
    .join('');

  return {
    subject: sanitizeSubjectFragment(t.subject(brand)),
    text: `${lines.join('\n')}\n`,
    html,
  };
}
