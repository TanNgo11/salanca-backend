import { randomBytes } from 'node:crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * A Strapi-shaped documentId (24 lowercase alphanumerics, letter first — the cuid2 format
 * Strapi assigns on create) for rows a migration inserts with raw SQL. Raw inserts bypass
 * Strapi's default, and a row without documentId cannot be opened by id in the API/Admin.
 */
export const newDocumentId = (): string => {
  const bytes = randomBytes(24);
  let id = ALPHABET[bytes[0] % 26];
  for (let index = 1; index < 24; index += 1) id += ALPHABET[bytes[index] % ALPHABET.length];
  return id;
};
