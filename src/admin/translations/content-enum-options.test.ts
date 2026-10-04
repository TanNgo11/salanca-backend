import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { contentEnumOptionVietnameseTranslations } from './content-enum-options';

interface SchemaFile {
  pluginOptions?: { 'content-manager'?: { visible?: boolean } };
  attributes?: Record<string, { type?: string; enum?: string[] }>;
}

const listSchemaFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return listSchemaFiles(path);
    }
    return entry.name.endsWith('.json') ? [path] : [];
  });

// Enumerations an admin can see: every component, and content types the
// Content Manager does not hide (the audit trail has its own screen).
const visibleEnumValues = (): Array<{ file: string; value: string }> =>
  ['src/api', 'src/components']
    .flatMap((root) => listSchemaFiles(join(process.cwd(), root)))
    .flatMap((file) => {
      const schema = JSON.parse(readFileSync(file, 'utf8')) as SchemaFile;
      if (schema.pluginOptions?.['content-manager']?.visible === false) {
        return [];
      }
      return Object.values(schema.attributes ?? {})
        .filter((attribute) => attribute.type === 'enumeration')
        .flatMap((attribute) => (attribute.enum ?? []).map((value) => ({ file, value })));
    });

describe('content enumeration option labels', () => {
  it('labels every enumeration value an admin can pick', () => {
    const values = visibleEnumValues();
    expect(values.length).toBeGreaterThan(0);

    const missing = values.filter(
      ({ value }) => !contentEnumOptionVietnameseTranslations[value]?.trim(),
    );
    expect(missing).toEqual([]);
  });
});
