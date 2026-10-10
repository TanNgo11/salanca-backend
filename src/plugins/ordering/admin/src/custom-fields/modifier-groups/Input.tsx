import { forwardRef } from 'react';

import { validateModifierGroups } from '../../../../shared/catalog/modifier-groups';
import SchemaJsonInput, { type JsonValidation } from '../SchemaJsonInput';

const validate = (raw: unknown): JsonValidation => {
  const result = validateModifierGroups(raw);
  return result.valid ? { valid: true, value: result.value } : { valid: false, message: result.message };
};

/**
 * `modifierGroups` editor — schema-aware JSON (plan step 4 fallback). `groupRef` and override
 * keys are documentIds of the modifier library rows; membership/existence is enforced on save
 * by the Document Service middleware.
 */
const ModifierGroupsInput = forwardRef<HTMLTextAreaElement, Parameters<typeof SchemaJsonInput>[0]>(
  (props, ref) => <SchemaJsonInput {...props} ref={ref} validate={validate} />,
);
ModifierGroupsInput.displayName = 'ModifierGroupsInput';
export default ModifierGroupsInput;
