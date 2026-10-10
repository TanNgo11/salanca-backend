import type { JsonObject, Locale, ReceiveMethod, SelectedOptionInput, ValidationResult } from './common';
import type { Sellable } from './sellable';

/** Per-line product-type contract (contracts doc §4). */
export type LineConfiguration = {
  sellable: Sellable;
  selected: SelectedOptionInput[];
  quantity: number;
  context: { locale: Locale; locationRef?: string; at: string };
};

export type LinePriceResult = {
  unitAmount: number;
  optionAmount: number;
  currency: string;
  taxGroupRef?: string;
  metadata?: JsonObject;
};

export type ProductTypeDefinition = {
  code: string;
  version: string;
  capabilities: string[];
  validateLine(input: LineConfiguration): ValidationResult;
  quoteLine(input: LineConfiguration): Promise<LinePriceResult>;
  selectWorkflow(input: {
    lines: Sellable[];
    receiveMethod: ReceiveMethod;
    paymentTiming?: string;
  }): { name: string; version: string };
};
