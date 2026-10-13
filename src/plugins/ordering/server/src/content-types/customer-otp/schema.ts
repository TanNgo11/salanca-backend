import { collection } from '../internal';

/**
 * One-time-passcode challenge (O11). The 6-digit code lives only in `codeHash`
 * (HMAC(encryptionKey, code + challengeId)) — never plaintext. `targetHash` is the HMAC of the
 * login target (email, or phone once O13 adds channels) so the target is never stored either.
 * `purpose` distinguishes sign-in challenges from in-profile email changes; `customer` binds the
 * challenge to the account it acts on (null for a target that matched no profile at request
 * time — the response is identical either way).
 */
export default collection(
  'customer-otp',
  {
    challengeId: { type: 'string', required: true },
    channel: { type: 'string', required: true, default: 'email' },
    targetHash: { type: 'string', required: true },
    // AES-GCM sealed plaintext target (token-cipher) — lets `verify` recover the email to
    // create/bind the profile without storing it in the clear. `raw:` prefix only in dev
    // when no encryption key is configured.
    targetSealed: { type: 'string' },
    codeHash: { type: 'string', required: true },
    purpose: { type: 'string', required: true, default: 'login' },
    customer: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'plugin::ordering.customer',
    },
    attempts: { type: 'integer', required: true, default: 0 },
    expiresAt: { type: 'datetime', required: true },
    consumedAt: { type: 'datetime' },
  },
  { displayName: 'Mã OTP khách' },
);
