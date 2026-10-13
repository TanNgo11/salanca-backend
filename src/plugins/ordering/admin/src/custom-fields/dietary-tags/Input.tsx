import { forwardRef } from 'react';

import { DIETARY_TAGS } from '../../../../shared/catalog/allergens';
import TagChecklist, { type ChecklistOption } from '../tag-checklist/TagChecklist';

/** Closed dietary-tag list — the same codes the server validates against. */
const OPTIONS: ChecklistOption[] = DIETARY_TAGS.map((code) => ({
  code,
  i18nKey: `dietary.${code}`,
}));

/** `dietaryTags` editor (O12 N5): checkbox grid of the fixed dietary labels. */
const DietaryTagsInput = forwardRef<
  HTMLDivElement,
  Omit<Parameters<typeof TagChecklist>[0], 'options'>
>((props, _ref) => <TagChecklist {...props} options={OPTIONS} />);
DietaryTagsInput.displayName = 'DietaryTagsInput';
export default DietaryTagsInput;
