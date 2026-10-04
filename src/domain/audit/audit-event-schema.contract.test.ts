import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  AuditAction,
  AuditEventSource,
  AuditTargetType,
} from './audit-event.types';

const schema = JSON.parse(
  readFileSync(
    path.resolve(
      process.cwd(),
      'src/api/audit-event/content-types/audit-event/schema.json',
    ),
    'utf8',
  ),
) as {
  attributes: Record<string, { type: string; enum?: string[] }>;
};

const schemaEnum = (attribute: string): string[] => {
  const values = schema.attributes[attribute]?.enum;
  if (!values) {
    throw new Error(`audit-event schema has no enum for "${attribute}"`);
  }
  return values;
};

describe('audit-event schema stays in sync with the domain enums', () => {
  it.each([
    ['action', Object.values(AuditAction)],
    ['targetType', Object.values(AuditTargetType)],
    ['eventSource', Object.values(AuditEventSource)],
  ])('%s enum matches the stored schema exactly', (attribute, domainValues) => {
    expect([...schemaEnum(attribute)].sort()).toEqual([...domainValues].sort());
  });
});
