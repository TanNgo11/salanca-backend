import { o1CoreMigration } from './0001-o1-core';
import { o2CatalogMigration } from './0002-o2-catalog';
import { o3PickupMigration } from './0003-o3-pickup';
import { o6OpsMigration } from './0004-o6-ops';
import { o15AuditLogMigration } from './0005-o15-audit-log';
import { o10ExtensibilityMigration } from './0006-o10-extensibility';
import { o11CustomersMigration } from './0007-o11-customers';
import { o7OpsExtrasMigration } from './0005-o7-ops-extras';
import { o8PromotionsRatingMigration } from './0008-o8-promotions-rating';
import { o14PriceListsMigration } from './0009-o14-price-lists';
import { o11CustomerDocumentIdsMigration } from './0009b-o11-customer-document-ids';
import { o9GiftCardsMigration } from './0010-o9-gift-cards';
import { o12RestaurantMigration } from './0011-o12-restaurant';
import { o13ProvidersMigration } from './0012-o13-providers';
import type { OrderingMigration } from './runner';

/** Production migrations, in order. */
export const orderingMigrations: OrderingMigration[] = [
  o1CoreMigration,
  o2CatalogMigration,
  o3PickupMigration,
  o6OpsMigration,
  o15AuditLogMigration,
  o10ExtensibilityMigration,
  o11CustomersMigration,
  o7OpsExtrasMigration,
  o8PromotionsRatingMigration,
  o14PriceListsMigration,
  o11CustomerDocumentIdsMigration,
  o9GiftCardsMigration,
  o12RestaurantMigration,
  o13ProvidersMigration,
];
