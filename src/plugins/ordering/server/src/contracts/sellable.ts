import type { JsonObject, SelectedOptionInput } from './common';
import type { Money } from '../domain/money';

/** Sellable and option shapes a catalog adapter returns (contracts doc §4). */
export type SellableRef = {
  uid: string;
  sourceUid?: string;
  sourceDocumentId?: string;
};

export type OptionGroup = {
  uid: string;
  name: string;
  required: boolean;
  defaultOptionUids: string[];
  minQuantity: number;
  maxQuantity: number;
  stepQuantity: number;
  freeQuantity: number;
  visibleWhen?: JsonObject;
  options: Array<{
    uid: string;
    name: string;
    unitPriceDelta: Money;
    isActive: boolean;
    taxGroupRef?: string;
  }>;
};

export type AvailabilityRules = {
  locationRefs?: string[];
  fulfillmentKinds?: string[];
  activeFrom?: string;
  activeTo?: string;
  blackout?: JsonObject[];
};

export type Sellable = {
  ref: SellableRef;
  productType: string;
  title: string;
  description?: string;
  imageUrl?: string;
  variant?: {
    uid: string;
    sku?: string;
    title?: string;
    attributes: JsonObject;
    inventoryRef?: string;
  };
  listPrice: Money;
  compareAtListPrice?: Money;
  requiresShipping: boolean;
  isVirtual: boolean;
  isDownloadable: boolean;
  isGiftCard: boolean;
  fulfillmentKinds: string[];
  options: OptionGroup[];
  availability: AvailabilityRules;
  categories: { ref: string; title: string; path: string[] }[];
  minQuantity?: number;
  taxGroupRef?: string;
  isActive: boolean;
  purchasable: boolean;
  metadata?: JsonObject;
};

export type KitComponent = {
  sellableRef: SellableRef;
  requiredQuantity: number;
  variantUid?: string;
  selectedOptions?: SelectedOptionInput[];
};
