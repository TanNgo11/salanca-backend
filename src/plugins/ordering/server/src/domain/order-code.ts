import { OrderingError } from './errors';

/**
 * Renders an order code from `config.orderCode.template`. Tokens: `{prefix}`, `{seq}`,
 * `{seq:N}` (zero-padded to N, never truncated), `{yyyy}`, `{yy}`, `{mm}`, `{dd}` from `at`
 * rendered in `timezone` (Intl, default Asia/Ho_Chi_Minh). Unknown tokens throw.
 */
export function formatOrderCode(
  template: string,
  input: { prefix: string; seq: number; at?: Date; timezone?: string },
): string {
  if (!Number.isSafeInteger(input.seq) || input.seq < 0) {
    throw new OrderingError('VALIDATION_ERROR', 'order code sequence must be a safe integer >= 0');
  }
  let dateParts: Map<string, string> | null = null;
  const parts = (): Map<string, string> => {
    if (dateParts === null) {
      const entries = new Intl.DateTimeFormat('en-CA', {
        timeZone: input.timezone ?? 'Asia/Ho_Chi_Minh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(input.at ?? new Date());
      dateParts = new Map(entries.map((part) => [part.type, part.value]));
    }
    return dateParts;
  };

  return template.replace(/\{([^{}]+)\}/g, (match, token: string) => {
    if (token === 'prefix') return input.prefix;
    if (token === 'seq') return String(input.seq);
    const padded = /^seq:(\d+)$/.exec(token);
    if (padded) return String(input.seq).padStart(Number(padded[1]), '0');
    if (token === 'yyyy') return parts().get('year') as string;
    if (token === 'yy') return (parts().get('year') as string).slice(-2);
    if (token === 'mm') return parts().get('month') as string;
    if (token === 'dd') return parts().get('day') as string;
    throw new OrderingError('VALIDATION_ERROR', `unknown order-code token "${token}"`, {
      details: { token },
    });
  });
}
