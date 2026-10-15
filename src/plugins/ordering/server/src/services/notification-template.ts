import type { Core } from '@strapi/strapi';

import { OrderingError } from '../domain/errors';
import { renderCustom, type RenderedMail } from '../domain/notifications/render-custom';
import {
  isTemplateCode,
  isTemplateLocale,
  sampleDataFor,
  TEMPLATE_CODES,
  TEMPLATE_LOCALES,
  TEMPLATE_NAMES,
  templateAudience,
  variablesFor,
  type TemplateLocale,
} from '../domain/notifications/template-vars';
import {
  defaultTemplateSource,
  renderCartReminder,
  renderGiftCardIssued,
  renderOpsAlert,
  renderPointsExpiring,
  renderTierUp,
  renderOtp,
  renderTemplate,
  type TemplateCode,
  type TemplateData,
} from '../domain/notifications/templates';
import type { AnyMailData } from '../domain/notifications/template-vars';
import type alertFactory from './alert';
import type changeLogFactory from './change-log';
import { actorRefOf, type ServiceContext } from './context';
import type { OrderingRegistry } from './registry';

type TemplateRow = {
  id: number;
  documentId: string;
  code: string;
  messageLocale: string;
  subject: string;
  body: string;
  updatedByRef: string | null;
  updatedAt: string;
};

const TEMPLATE = 'plugin::ordering.notification-template';

/**
 * O10 staff-edited email templates: one row per (code, messageLocale) overrides the built-in copy.
 * Rendering goes through `renderCustom` (allowlisted vars, escaped HTML, restricted markdown); any
 * render failure falls back to the built-in template and raises `notification-template-broken` so
 * a bad save can never silence order mail.
 */
const notificationTemplate = ({ strapi }: { strapi: Core.Strapi }) => {
  const query = () => strapi.db.query(TEMPLATE);
  const alerts = () => strapi.plugin('ordering').service('alert') as ReturnType<typeof alertFactory>;
  const changeLog = () =>
    strapi.plugin('ordering').service('change-log') as ReturnType<typeof changeLogFactory>;
  const registry = () => strapi.plugin('ordering').service('registry') as OrderingRegistry;

  const findRow = async (code: string, locale: string): Promise<TemplateRow | null> =>
    (await query().findOne({
      where: { code, messageLocale: locale },
    })) as TemplateRow | null;

  /** Narrows the path params or throws the API errors the contract promises. */
  const checked = (code: string, locale: string): { code: TemplateCode; locale: TemplateLocale } => {
    if (!isTemplateCode(code)) {
      throw new OrderingError('TEMPLATE_NOT_FOUND', `unknown email template "${code}"`, {
        details: { code },
      });
    }
    if (!isTemplateLocale(locale)) {
      throw new OrderingError('TEMPLATE_NOT_FOUND', `unknown template locale "${locale}"`, {
        details: { code, locale },
      });
    }
    return { code, locale };
  };

  /** The built-in renderer — the never-fail path when no override exists or one breaks. */
  const defaultRender = (
    code: TemplateCode,
    locale: string,
    data: AnyMailData,
  ): RenderedMail =>
    code === 'staff.ops-alert'
      ? renderOpsAlert(locale, data as Parameters<typeof renderOpsAlert>[1])
      : code === 'customer.otp'
        ? renderOtp(locale, data as Parameters<typeof renderOtp>[1])
        : code === 'customer.cart-reminder'
          ? renderCartReminder(locale, data as Parameters<typeof renderCartReminder>[1])
          : code === 'customer.gift-card-issued'
            ? renderGiftCardIssued(locale, data as Parameters<typeof renderGiftCardIssued>[1])
            : code === 'customer.points-expiring'
              ? renderPointsExpiring(locale, data as Parameters<typeof renderPointsExpiring>[1])
              : code === 'customer.tier-up'
                ? renderTierUp(locale, data as Parameters<typeof renderTierUp>[1])
                : renderTemplate(code, locale, data as TemplateData);

  const describe = async (code: TemplateCode, locale: TemplateLocale) => {
    const row = await findRow(code, locale);
    const defaults = defaultTemplateSource(code, locale);
    return {
      code,
      locale,
      name: TEMPLATE_NAMES[code],
      audience: templateAudience(code),
      subject: row?.subject ?? defaults.subject,
      body: row?.body ?? defaults.body,
      customized: row !== null,
      defaults,
      variables: variablesFor(code),
      updatedBy: row?.updatedByRef ?? null,
      updatedAt: row?.updatedAt ?? null,
    };
  };

  const service = {
    /** X4 list: every template with a per-locale "đã sửa" flag. */
    async list() {
      const rows = (await query().findMany({ select: ['code', 'messageLocale'] })) as Array<{
        code: string;
        messageLocale: string;
      }>;
      const customized = new Set(rows.map((row) => `${row.code}:${row.messageLocale}`));
      return TEMPLATE_CODES.map((code) => ({
        code,
        name: TEMPLATE_NAMES[code],
        audience: templateAudience(code),
        locales: Object.fromEntries(
          TEMPLATE_LOCALES.map((locale) => [
            locale,
            { customized: customized.has(`${code}:${locale}`) },
          ]),
        ),
      }));
    },

    get: (code: string, locale: string) => {
      const params = checked(code, locale);
      return describe(params.code, params.locale);
    },

    /** Validate by rendering sample data — an unknown `{{var}}` fails the save with 400. */
    async put(
      codeInput: string,
      localeInput: string,
      input: { subject?: unknown; body?: unknown },
      ctx: ServiceContext,
    ) {
      const { code, locale } = checked(codeInput, localeInput);
      const subject = typeof input?.subject === 'string' ? input.subject.trim() : '';
      const body = typeof input?.body === 'string' ? input.body.trim() : '';
      if (!subject || !body) {
        throw new OrderingError('VALIDATION_ERROR', 'subject and body are required', {
          details: { issues: [{ path: subject ? 'body' : 'subject', message: 'required' }] },
        });
      }
      // Dry-render proves the source renders; unknown vars fail as TEMPLATE_VARIABLE_UNKNOWN.
      renderCustom(code, locale, { subject, body }, sampleDataFor(code));
      const existing = await findRow(code, locale);
      const data = { code, messageLocale: locale, subject, body, updatedByRef: actorRefOf(ctx) };
      if (existing) {
        await query().update({ where: { id: existing.id }, data });
      } else {
        await query().create({ data });
      }
      await changeLog().record(
        {
          action: 'notification-template.save',
          entityType: 'notification-template',
          entityId: `${code}:${locale}`,
          entityLabel: TEMPLATE_NAMES[code][0],
          after: { code, locale },
        },
        ctx,
      );
      return describe(code, locale);
    },

    /** Render against sample data — the provided source wins, else the effective template. */
    async preview(
      codeInput: string,
      localeInput: string,
      input?: { subject?: unknown; body?: unknown },
    ) {
      const { code, locale } = checked(codeInput, localeInput);
      const current = await describe(code, locale);
      const source = {
        subject: typeof input?.subject === 'string' ? input.subject : current.subject,
        body: typeof input?.body === 'string' ? input.body : current.body,
      };
      return {
        rendered: renderCustom(code, locale, source, sampleDataFor(code)),
        variables: current.variables,
      };
    },

    /** POST …/test — send the effective template to the signed-in admin's mailbox. */
    async sendTest(codeInput: string, localeInput: string, ctx: ServiceContext) {
      const { code, locale } = checked(codeInput, localeInput);
      if (ctx.actor.kind !== 'staff') {
        throw new OrderingError('VALIDATION_ERROR', 'test mail needs a signed-in admin', {
          details: {},
        });
      }
      const admin = (await strapi.db
        .query('admin::user')
        .findOne({ where: { id: ctx.actor.adminUserId }, select: ['email'] })) as {
        email?: string;
      } | null;
      const email = admin?.email?.trim();
      if (!email) {
        throw new OrderingError('VALIDATION_ERROR', 'the signed-in admin has no email address', {
          details: {},
        });
      }
      const rendered = await service.renderFor(code, locale, sampleDataFor(code));
      await registry()
        .notificationProvider('email')
        .send({ recipient: { email }, template: code, data: rendered });
      return { sent: true };
    },

    /** DELETE — restore the built-in copy; a missing override is TEMPLATE_NOT_FOUND. */
    async remove(codeInput: string, localeInput: string, ctx: ServiceContext) {
      const { code, locale } = checked(codeInput, localeInput);
      const row = await findRow(code, locale);
      if (!row) {
        throw new OrderingError('TEMPLATE_NOT_FOUND', 'no custom template to restore', {
          details: { code, locale },
        });
      }
      await query().delete({ where: { id: row.id } });
      await changeLog().record(
        {
          action: 'notification-template.reset',
          entityType: 'notification-template',
          entityId: `${code}:${locale}`,
          entityLabel: TEMPLATE_NAMES[code][0],
          after: { code, locale },
        },
        ctx,
      );
      return { restored: true };
    },

    /**
     * Render for a real send: the override when one exists, else the default. A broken override
     * falls back to the default and raises `notification-template-broken` — mail always goes out.
     */
    async renderFor(
      code: TemplateCode,
      locale: string,
      data: AnyMailData,
    ): Promise<RenderedMail> {
      // A lookup failure (e.g. DB hiccup) degrades to the built-in copy — mail always goes out.
      const row = await findRow(code, locale === 'en' ? 'en' : 'vi').catch(() => null);
      if (!row) return defaultRender(code, locale, data);
      try {
        return renderCustom(code, locale, { subject: row.subject, body: row.body }, data);
      } catch {
        // The alert is best-effort — a reporting failure must not block the mail itself.
        try {
          await alerts().open(
            {
              alertCode: 'notification-template-broken',
              dedupeKey: `notification-template:${code}:${locale}`,
              severity: 'warning',
              aggregateRef: `notification-template:${code}:${locale}`,
            },
            { actor: { kind: 'system' } },
          );
        } catch {
          strapi.log.warn(
            `[ordering] notification-template ${code}:${locale} failed to render and could not raise an alert`,
          );
        }
        return defaultRender(code, locale, data);
      }
    },
  };
  return service;
};

export default notificationTemplate;
