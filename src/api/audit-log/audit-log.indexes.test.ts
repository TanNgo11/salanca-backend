import { describe, expect, it, vi } from 'vitest';

import { AUDIT_LOG_SELECT_COLUMNS } from './audit-log.service';
import {
  AUDIT_LOG_INDEX_STATEMENTS,
  ensureAuditLogIndexes,
} from './audit-log.indexes';

describe('Admin audit-log indexes', () => {
  it('indexes the same lower(label) expression the list query uses', () => {
    const combined = AUDIT_LOG_INDEX_STATEMENTS.join('\n');
    expect(combined).toContain('lower(actor_label) text_pattern_ops');
    expect(combined).toContain('lower(target_label) text_pattern_ops');
    expect(combined).not.toContain('lower(coalesce(actor_label');
    expect(combined).not.toContain('lower(coalesce(target_label');
  });

  it('indexes every read-path filter and search lookup', () => {
    const combined = AUDIT_LOG_INDEX_STATEMENTS.join('\n');
    expect(combined).toMatch(/audit_events_occurred_at_idx ON audit_events \(occurred_at DESC\)/);
    expect(combined).toMatch(/audit_events_action_occurred_at_idx/);
    expect(combined).toMatch(/audit_events_actor_occurred_at_idx/);
    expect(combined).toMatch(/audit_events_success_occurred_at_idx/);
    expect(combined).toMatch(/audit_events_target_occurred_at_idx/);
    expect(combined).toMatch(/audit_events_request_id_idx ON audit_events \(request_id\)/);
    // No inferred source index: event_source is filtered directly.
    expect(combined).not.toContain('scope_document_id');
  });

  it('creates every index idempotently for PostgreSQL', () => {
    for (const statement of AUDIT_LOG_INDEX_STATEMENTS) {
      expect(statement).toContain('CREATE INDEX IF NOT EXISTS');
    }
  });

  it('recreates every index after schema sync for a fresh database', async () => {
    const raw = vi.fn(async () => undefined);

    await ensureAuditLogIndexes({ db: { connection: { raw } } } as never);

    expect(raw.mock.calls.map(([statement]) => statement)).toEqual([
      ...AUDIT_LOG_INDEX_STATEMENTS,
    ]);
  });

  it('selects event_source and actor columns directly (no inferred source)', () => {
    expect(AUDIT_LOG_SELECT_COLUMNS).toContain(
      'actor_document_id as actorDocumentId',
    );
    expect(AUDIT_LOG_SELECT_COLUMNS).toContain('event_source as eventSource');
    expect(AUDIT_LOG_SELECT_COLUMNS.join(' ')).not.toContain('CASE');
  });
});
