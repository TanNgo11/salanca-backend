import { forwardRef } from 'react';

import { ALLERGEN_CODES } from '../../../../shared/catalog/allergens';
import TagChecklist, { type ChecklistOption } from '../tag-checklist/TagChecklist';

/** EU FIC 14 groups — the same fixed table the server validates against. */
const OPTIONS: ChecklistOption[] = ALLERGEN_CODES.map((code) => ({
  code,
  i18nKey: `allergen.${code}`,
}));

/** `allergens` editor (O12 N5): checkbox grid plus free-form "Khác" entries. */
const AllergensInput = forwardRef<HTMLDivElement, Omit<Parameters<typeof TagChecklist>[0], 'options'>>(
  (props, _ref) => <TagChecklist {...props} options={OPTIONS} allowCustom />,
);
AllergensInput.displayName = 'AllergensInput';
export default AllergensInput;
