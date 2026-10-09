import {
  MAX_RECIPIENTS_PER_KIND,
  NOTIFICATION_KINDS,
  type NotificationKind,
} from '../../domain/notification-settings/notification-settings';
import { isValidEmailAddress } from '../../shared/email/email';

export {
  MAX_RECIPIENTS_PER_KIND,
  NOTIFICATION_KIND_LABELS_VI,
  NOTIFICATION_KINDS,
  type NotificationKind,
} from '../../domain/notification-settings/notification-settings';

export const notificationSettingsPermissions = [
  { action: 'admin::notification-settings.manage', subject: null },
];

export const NOTIFICATION_SETTINGS_PATH = '/notification-settings';

export const notificationTestPath = (kind: NotificationKind): string =>
  `${NOTIFICATION_SETTINGS_PATH}/test/${kind}`;

export const splitRecipientInput = (text: string): string[] =>
  text
    .split(/[\s,;]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');

/**
 * Turns typed or pasted text into chips. Same rule as the server
 * (isValidEmailAddress); the server still re-validates on save.
 */
export const addRecipients = (
  current: readonly string[],
  raw: string,
): { list: string[]; invalid: string[] } => {
  const list = [...current];
  const invalid: string[] = [];
  for (const entry of splitRecipientInput(raw)) {
    const address = entry.toLowerCase();
    if (!isValidEmailAddress(address)) {
      invalid.push(entry);
    } else if (!list.includes(address)) {
      list.push(address);
    }
  }
  return { list, invalid };
};

export const sameRecipients = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

export type NotificationSettingsView = {
  recipients: Record<NotificationKind, string[]>;
  saved: boolean;
  smtpConfigured: boolean;
};

export type RecipientDrafts = Record<NotificationKind, string[]>;
/** Text typed in a chip field but not yet turned into a chip, per kind. */
export type PendingRecipientText = Partial<Record<NotificationKind, string>>;

const mapKinds = <T>(build: (kind: NotificationKind) => T): Record<NotificationKind, T> =>
  Object.fromEntries(NOTIFICATION_KINDS.map((kind) => [kind, build(kind)])) as Record<
    NotificationKind,
    T
  >;

/** Server lists as chips. An env fallback longer than the limit keeps its first entries. */
export const initialDrafts = (view: NotificationSettingsView): RecipientDrafts =>
  mapKinds((kind) => view.recipients[kind].slice(0, MAX_RECIPIENTS_PER_KIND));

export const hasOverLimitFallback = (view: NotificationSettingsView): boolean =>
  !view.saved &&
  NOTIFICATION_KINDS.some((kind) => view.recipients[kind].length > MAX_RECIPIENTS_PER_KIND);

/**
 * Never saved: always savable, so the env default can be taken over as is.
 * Saved: only when a list changed or text is waiting to become a chip.
 */
export const canSaveSettings = (
  view: NotificationSettingsView | null,
  drafts: RecipientDrafts,
  pending: PendingRecipientText,
): boolean => {
  if (view === null) return false;
  if (!view.saved) return true;
  return NOTIFICATION_KINDS.some(
    (kind) =>
      !sameRecipients(drafts[kind], view.recipients[kind]) ||
      (pending[kind] ?? '').trim() !== '',
  );
};

/** Folds typed-but-uncommitted text into the lists right before a save. */
export const mergePendingRecipients = (
  drafts: RecipientDrafts,
  pending: PendingRecipientText,
): { lists: RecipientDrafts; invalid: Partial<Record<NotificationKind, string[]>> } => {
  const invalid: Partial<Record<NotificationKind, string[]>> = {};
  const lists = mapKinds((kind) => {
    const result = addRecipients(drafts[kind], pending[kind] ?? '');
    if (result.invalid.length > 0) invalid[kind] = result.invalid;
    return result.list;
  });
  return { lists, invalid };
};
