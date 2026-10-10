import { describe, expect, it } from 'vitest';

import config from '../config';
import type { OutboxConsumer, OutboxEvent } from '../contracts';
import { OrderingError } from '../domain/errors';
import { testFoodProductType } from '../domain/product-types/test-food';
import { testServiceProductType } from '../domain/product-types/test-service';
import { pickupPayOnPickupWorkflow } from '../domain/workflow/definitions';
import { createOrderingCatalogStubAdapter } from '../providers/ordering-catalog-stub';
import { createTestCatalogAdapter } from '../providers/test-catalog';
import { createTestPaymentProvider } from '../providers/test-payment';
import createRegistry, { assertEnabledCodesRegistered } from './registry';

const validConfig = () => structuredClone(config.default);

describe('ordering registry', () => {
  it('rejects a duplicate product type code', () => {
    const registry = createRegistry();
    registry.registerProductType(testFoodProductType);
    expect(() => registry.registerProductType(testFoodProductType)).toThrow(
      /product type "test-food" is already registered/,
    );
    expect(() => registry.registerCatalogAdapter(createTestCatalogAdapter())).not.toThrow();
    expect(() => registry.registerCatalogAdapter(createTestCatalogAdapter())).toThrow(
      /catalog adapter "test-catalog" is already registered/,
    );
  });

  it('resolves unknown codes with a typed OrderingError', () => {
    const registry = createRegistry();
    expect(() => registry.productType('ghost')).toThrowError(
      expect.objectContaining({ code: 'PRODUCT_TYPE_NOT_REGISTERED' }),
    );
    expect(() => registry.paymentProvider('ghost')).toThrowError(
      expect.objectContaining({ code: 'PROVIDER_NOT_REGISTERED' }),
    );
    expect(() => registry.workflow('ghost', '1')).toThrowError(
      expect.objectContaining({ code: 'WORKFLOW_NOT_REGISTERED' }),
    );
    expect(() => registry.workflow('ghost', '1')).toThrowError(OrderingError);
  });

  it('registers and resolves workflows by name and version', () => {
    const registry = createRegistry();
    registry.registerWorkflow(pickupPayOnPickupWorkflow);
    expect(registry.workflow('pickup-pay-on-pickup', '1')).toBe(pickupPayOnPickupWorkflow);
    expect(registry.workflows()).toHaveLength(1);
    expect(() => registry.registerWorkflow(pickupPayOnPickupWorkflow)).toThrow(
      /workflow "pickup-pay-on-pickup@1" is already registered/,
    );
  });

  it('lists every enabled but unregistered code in one error', () => {
    const registry = createRegistry();
    const value = validConfig();
    value.catalog.adapter = 'ghost-catalog';
    value.productTypes = { food: { enabled: true } };
    value.providers.payment = { sepay: { enabled: true }, cash: { enabled: true } };
    value.providers.captcha = { turnstile: { enabled: true } };
    value.providers.voucher = { internal: { enabled: false } };

    let error: Error | undefined;
    try {
      assertEnabledCodesRegistered(value, registry);
    } catch (thrown) {
      error = thrown as Error;
    }
    expect(error?.message).toContain('catalog adapter "ghost-catalog"');
    expect(error?.message).toContain('product type "food"');
    expect(error?.message).toContain('payment provider "sepay"');
    expect(error?.message).toContain('payment provider "cash"');
    expect(error?.message).toContain('captcha provider "turnstile"');
    expect(error?.message).not.toContain('voucher provider');
  });

  it('passes when every enabled code is registered', () => {
    const registry = createRegistry();
    registry.registerCatalogAdapter(createOrderingCatalogStubAdapter());
    registry.registerCatalogAdapter(createTestCatalogAdapter());
    registry.registerProductType(testServiceProductType);
    registry.registerPaymentProvider(createTestPaymentProvider());

    const value = validConfig();
    value.catalog.adapter = 'test-catalog';
    value.productTypes = { 'test-service': { enabled: true } };
    value.providers.payment = { test: { enabled: true } };
    expect(() => assertEnabledCodesRegistered(value, registry)).not.toThrow();
  });

  it('fans outbox events to type consumers plus wildcard consumers', () => {
    const registry = createRegistry();
    const calls: string[] = [];
    const consumer = (tag: string): OutboxConsumer => async () => {
      calls.push(tag);
    };
    registry.registerOutboxConsumer('test.ping', consumer('ping'));
    registry.registerOutboxConsumer('*', consumer('wild'));
    const consumers = registry.outboxConsumers('test.ping');
    expect(consumers).toHaveLength(2);
    const event = {
      id: '1', type: 'test.ping', aggregateType: 'test', aggregateId: '1', payload: {},
      uniqueKey: 'k', occurredAt: '', availableAt: '', attempts: 0,
    } satisfies OutboxEvent;
    return Promise.all(consumers.map((handler) => handler(event, { strapi: undefined }))).then(() =>
      expect(calls.sort()).toEqual(['ping', 'wild']),
    );
  });
});
