import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from '../config';
import type {
  CaptchaProvider,
  CatalogAdapter,
  FulfillmentProvider,
  NotificationProvider,
  OutboxConsumer,
  PaymentProvider,
  ProductTypeDefinition,
  SchedulingProvider,
  VoucherProvider,
  WorkflowDefinition,
} from '../contracts';
import { OrderingError } from '../domain/errors';
import { createGuard } from '../domain/notifications/notify-guard';
import { assertWorkflowDefinition } from '../domain/workflow/definition';

/**
 * Typed in-memory registry of adapters, product types, providers, workflows and outbox consumers.
 * Apps register their own adapters in their `register()` lifecycle; the plugin checks every
 * enabled code against this registry in `bootstrap()` via `assertEnabledCodesRegistered`.
 * Duplicate registrations throw plain Errors because they are startup bugs, not API errors.
 */
const bucket = <T extends { code: string }>(kind: string) => {
  const items = new Map<string, T>();
  return {
    register(item: T) {
      if (items.has(item.code)) {
        throw new Error(`[ordering] ${kind} "${item.code}" is already registered`);
      }
      items.set(item.code, item);
    },
    resolve(code: string, errorCode: 'PROVIDER_NOT_REGISTERED' | 'PRODUCT_TYPE_NOT_REGISTERED'): T {
      const item = items.get(code);
      if (!item) {
        throw new OrderingError(errorCode, `[ordering] ${kind} "${code}" is not registered`, {
          details: { kind, code },
        });
      }
      return item;
    },
    has(code: string) {
      return items.has(code);
    },
    codes() {
      return [...items.keys()];
    },
    values() {
      return [...items.values()];
    },
  };
};

const registry = ({ strapi }: { strapi: Core.Strapi }) => {
  const catalogAdapters = bucket<CatalogAdapter>('catalog adapter');
  const productTypes = bucket<ProductTypeDefinition>('product type');
  const paymentProviders = bucket<PaymentProvider>('payment provider');
  const fulfillmentProviders = bucket<FulfillmentProvider>('fulfillment provider');
  const schedulingProviders = bucket<SchedulingProvider>('scheduling provider');
  const voucherProviders = bucket<VoucherProvider>('voucher provider');
  const captchaProviders = bucket<CaptchaProvider>('captcha provider');
  const notificationProviders = new Map<string, NotificationProvider>();
  const workflows = new Map<string, WorkflowDefinition>();
  const outboxConsumers = new Map<string, OutboxConsumer[]>();

  const workflowKey = (name: string, version: string) => `${name}@${version}`;

  const notifications = () => (strapi.config.get('plugin::ordering') as OrderingConfig).notifications;
  // R1a: the guard is rebuilt from the live config on every call so tests (and config reloads)
  // take effect immediately — nothing is cached at register() time.
  const guard = () => createGuard({ mode: notifications().mode, allowlist: notifications().allowlist });

  return {
    registerCatalogAdapter: (adapter: CatalogAdapter) => catalogAdapters.register(adapter),
    catalogAdapter: (code: string) => catalogAdapters.resolve(code, 'PROVIDER_NOT_REGISTERED'),
    hasCatalogAdapter: (code: string) => catalogAdapters.has(code),
    catalogAdapterCodes: () => catalogAdapters.codes(),

    registerProductType: (definition: ProductTypeDefinition) => productTypes.register(definition),
    productType: (code: string) => productTypes.resolve(code, 'PRODUCT_TYPE_NOT_REGISTERED'),
    hasProductType: (code: string) => productTypes.has(code),
    productTypeCodes: () => productTypes.codes(),

    registerPaymentProvider: (provider: PaymentProvider) => paymentProviders.register(provider),
    paymentProvider: (code: string) => paymentProviders.resolve(code, 'PROVIDER_NOT_REGISTERED'),
    hasPaymentProvider: (code: string) => paymentProviders.has(code),
    paymentProviderCodes: () => paymentProviders.codes(),
    paymentProviders: () => paymentProviders.values(),

    registerFulfillmentProvider: (provider: FulfillmentProvider) =>
      fulfillmentProviders.register(provider),
    fulfillmentProvider: (code: string) =>
      fulfillmentProviders.resolve(code, 'PROVIDER_NOT_REGISTERED'),
    hasFulfillmentProvider: (code: string) => fulfillmentProviders.has(code),
    fulfillmentProviderCodes: () => fulfillmentProviders.codes(),

    registerSchedulingProvider: (provider: SchedulingProvider) =>
      schedulingProviders.register(provider),
    schedulingProvider: (code: string) =>
      schedulingProviders.resolve(code, 'PROVIDER_NOT_REGISTERED'),
    hasSchedulingProvider: (code: string) => schedulingProviders.has(code),
    schedulingProviderCodes: () => schedulingProviders.codes(),

    registerVoucherProvider: (provider: VoucherProvider) => voucherProviders.register(provider),
    voucherProvider: (code: string) => voucherProviders.resolve(code, 'PROVIDER_NOT_REGISTERED'),
    hasVoucherProvider: (code: string) => voucherProviders.has(code),
    voucherProviderCodes: () => voucherProviders.codes(),

    registerCaptchaProvider: (provider: CaptchaProvider) => captchaProviders.register(provider),
    captchaProvider: (code: string) => captchaProviders.resolve(code, 'PROVIDER_NOT_REGISTERED'),
    hasCaptchaProvider: (code: string) => captchaProviders.has(code),
    captchaProviderCodes: () => captchaProviders.codes(),

    registerNotificationProvider(channel: string, provider: NotificationProvider) {
      if (notificationProviders.has(channel)) {
        throw new Error(`[ordering] notification provider "${channel}" is already registered`);
      }
      notificationProviders.set(channel, provider);
    },
    /**
     * R1a: the provider is handed back behind a Proxy so `send` is guard-checked while every other
     * property (the in-memory capture's `sent`/`failNext`, a real adapter's members) still passes
     * straight through — a plain wrapper object would hide them and break the capture-based tests.
     */
    notificationProvider(channel: string): NotificationProvider {
      const provider = notificationProviders.get(channel);
      if (!provider) {
        throw new OrderingError(
          'PROVIDER_NOT_REGISTERED',
          `[ordering] notification provider "${channel}" is not registered`,
          { details: { kind: 'notification provider', code: channel } },
        );
      }
      return new Proxy(provider, {
        get(target, property, receiver) {
          if (property === 'send') {
            // Resolve the real `send` now, not when the closure runs: a caller that wraps
            // `proxy.send = patched` (the OTP race test) lands on `target`, and a closure that
            // re-read `target.send` per call would re-enter itself through `patched`.
            const inner = Reflect.get(target, 'send', target) as NotificationProvider['send'];
            return async (input: Parameters<NotificationProvider['send']>[0]) => {
              const value = String(input?.recipient?.email ?? input?.recipient?.phone ?? '');
              if (!guard().allows(channel, value)) {
                throw new OrderingError(
                  'NOTIFICATION_BLOCKED',
                  'recipient is not on the allowlist',
                  { details: { channel } },
                );
              }
              return inner.call(target, input);
            };
          }
          return Reflect.get(target, property, receiver);
        },
        set(target, property, value, receiver) {
          return Reflect.set(target, property, value, receiver);
        },
      });
    },
    hasNotificationProvider: (channel: string) => notificationProviders.has(channel),
    notificationChannels: () => [...notificationProviders.keys()],
    /** R1a: pre-flight check for call sites that log `skipped` instead of catching the proxy error. */
    isNotificationAllowed: (channel: string, value: string) => guard().allows(channel, value),

    registerWorkflow(definition: WorkflowDefinition) {
      assertWorkflowDefinition(definition);
      const key = workflowKey(definition.name, definition.version);
      if (workflows.has(key)) {
        throw new Error(`[ordering] workflow "${key}" is already registered`);
      }
      workflows.set(key, definition);
    },
    workflow(name: string, version: string): WorkflowDefinition {
      const definition = workflows.get(workflowKey(name, version));
      if (!definition) {
        throw new OrderingError(
          'WORKFLOW_NOT_REGISTERED',
          `[ordering] workflow "${workflowKey(name, version)}" is not registered`,
          { details: { kind: 'workflow', code: workflowKey(name, version) } },
        );
      }
      return definition;
    },
    workflows: () => [...workflows.values()],

    registerOutboxConsumer(type: string, consumer: OutboxConsumer) {
      const consumers = outboxConsumers.get(type) ?? [];
      consumers.push(consumer);
      outboxConsumers.set(type, consumers);
    },
    outboxConsumers(type: string): OutboxConsumer[] {
      return [...(outboxConsumers.get(type) ?? []), ...(outboxConsumers.get('*') ?? [])];
    },
  };
};

export type OrderingRegistry = ReturnType<typeof registry>;

/**
 * Startup gate: every code the config marks enabled must have a registration. Runs in plugin
 * `bootstrap()` because app adapters register in the app's `register()`, after the validator.
 */
export const assertEnabledCodesRegistered = (
  config: OrderingConfig,
  registry: OrderingRegistry,
): void => {
  const missing: string[] = [];
  if (!registry.hasCatalogAdapter(config.catalog.adapter)) {
    missing.push(`catalog adapter "${config.catalog.adapter}"`);
  }
  for (const [code, settings] of Object.entries(config.productTypes)) {
    if (settings.enabled && !registry.hasProductType(code)) {
      missing.push(`product type "${code}"`);
    }
  }
  const providerChecks: Array<[string, Record<string, { enabled: boolean }>, (code: string) => boolean]> = [
    ['payment provider', config.providers.payment, (code) => registry.hasPaymentProvider(code)],
    ['fulfillment provider', config.providers.fulfillment, (code) => registry.hasFulfillmentProvider(code)],
    ['scheduling provider', config.providers.scheduling, (code) => registry.hasSchedulingProvider(code)],
    ['voucher provider', config.providers.voucher, (code) => registry.hasVoucherProvider(code)],
    ['captcha provider', config.providers.captcha, (code) => registry.hasCaptchaProvider(code)],
    // O13: keyed by channel ('zalo', 'sms'), matching registerNotificationProvider.
    [
      'notification provider',
      config.providers.notification,
      (code) => registry.hasNotificationProvider(code),
    ],
  ];
  for (const [kind, providers, has] of providerChecks) {
    for (const [code, settings] of Object.entries(providers)) {
      if (settings.enabled && !has(code)) {
        missing.push(`${kind} "${code}"`);
      }
    }
  }
  if (missing.length > 0) {
    throw new Error(`[ordering] enabled codes are not registered: ${missing.join('; ')}`);
  }
};

export default registry;
