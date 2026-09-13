import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CONTENT_MANAGER_FIELD_LABELS_VI } from './content-manager-labels.vi';

type Schema = {
  attributes?: Record<string, unknown>;
  config?: { metadatas?: Record<string, unknown> };
};

const schemaFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? schemaFiles(path)
      : entry.name.endsWith('.json')
        ? [path]
        : [];
  });

describe('Vietnamese Content Manager labels', () => {
  it('covers every field in Salanca API schemas and components', () => {
    const roots = [join(process.cwd(), 'src', 'api'), join(process.cwd(), 'src', 'components')];
    const missing: string[] = [];

    for (const file of roots.flatMap(schemaFiles)) {
      const schema = JSON.parse(readFileSync(file, 'utf8')) as Schema;
      const localOverrides = schema.config?.metadatas ?? {};
      for (const fieldName of Object.keys(schema.attributes ?? {})) {
        if (!CONTENT_MANAGER_FIELD_LABELS_VI[fieldName] && !localOverrides[fieldName]) {
          missing.push(`${file}:${fieldName}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });
});

