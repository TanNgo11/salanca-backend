/**
 * Hermetic SePay settings used when `testing.builtins` is on. The webhook secret and API token
 * are fixtures, not credentials. Integration scripts sign with whatever the booted config holds
 * so this object stays the single source.
 */
export const SEPAY_TEST_SETTINGS = {
  enabled: true as const,
  webhookSecret: 'test-webhook-secret-value',
  apiToken: 'test-api-token-value-xx',
  memoTemplate: 'SLC{orderCode}',
  captureMode: 'auto' as const,
  amountTolerance: 0,
  accounts: {
    q1: {
      accountNumber: '0123456789',
      bankCode: 'MBBank',
      bankName: 'MB Bank',
      accountName: 'CONG TY SALANCA',
      locationRefs: ['Q1'],
    },
    shared: {
      accountNumber: '999000111222',
      bankCode: 'Vietcombank',
      bankName: 'Vietcombank',
      accountName: 'CONG TY SALANCA',
      locationRefs: 'all' as const,
    },
    q3: {
      accountNumber: '333000111222',
      bankCode: 'ACB',
      bankName: 'ACB',
      accountName: 'CONG TY SALANCA',
      locationRefs: ['Q3'],
    },
  },
};
