import { forwardRef } from 'react';

import { validateBundleSlots } from '../../../../server/src/domain/catalog/bundle-slots';
import SchemaJsonInput, { type JsonValidation } from '../SchemaJsonInput';

const validate = (raw: unknown): JsonValidation => {
  const result = validateBundleSlots(raw);
  return result.valid ? { valid: true, value: result.value } : { valid: false, message: result.message };
};

/**
 * `bundleSlots` editor — schema-aware JSON (plan step 4 fallback). `variantRef` is a
 * catalog-variant documentId; existence is enforced on save by the Document Service
 * middleware.
 */
const BundleSlotsInput = forwardRef<HTMLTextAreaElement, Parameters<typeof SchemaJsonInput>[0]>(
  (props, ref) => <SchemaJsonInput {...props} ref={ref} validate={validate} />,
);
BundleSlotsInput.displayName = 'BundleSlotsInput';
export default BundleSlotsInput;
