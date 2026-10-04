import type { Core } from '@strapi/strapi';

/**
 * audit_events is created by Strapi schema sync, so the read-path indexes are
 * created idempotently during bootstrap (a fresh database receives them on
 * its first successful startup as well).
 */
export const AUDIT_LOG_INDEX_STATEMENTS = [
  'CREATE INDEX IF NOT EXISTS audit_events_occurred_at_idx ON audit_events (occurred_at DESC)',
  'CREATE INDEX IF NOT EXISTS audit_events_action_occurred_at_idx ON audit_events (action, occurred_at DESC)',
  'CREATE INDEX IF NOT EXISTS audit_events_actor_occurred_at_idx ON audit_events (actor_document_id, occurred_at DESC)',
  'CREATE INDEX IF NOT EXISTS audit_events_success_occurred_at_idx ON audit_events (success, occurred_at DESC)',
  'CREATE INDEX IF NOT EXISTS audit_events_target_occurred_at_idx ON audit_events (target_document_id, occurred_at DESC)',
  'CREATE INDEX IF NOT EXISTS audit_events_actor_label_prefix_idx ON audit_events (lower(actor_label) text_pattern_ops)',
  'CREATE INDEX IF NOT EXISTS audit_events_target_label_prefix_idx ON audit_events (lower(target_label) text_pattern_ops)',
  'CREATE INDEX IF NOT EXISTS audit_events_request_id_idx ON audit_events (request_id)',
] as const;

export const ensureAuditLogIndexes = async (strapi: Core.Strapi): Promise<void> => {
  for (const statement of AUDIT_LOG_INDEX_STATEMENTS) {
    await strapi.db.connection.raw(statement);
  }
};
