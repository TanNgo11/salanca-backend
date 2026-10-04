import { Typography } from '@strapi/design-system';
import { useIntl } from 'react-intl';

import { contentEnumOptionVietnameseTranslations } from '../translations/content-enum-options';

/** Same lookup the edit form uses: the stored value is the message id. */
export const EnumListCell = ({ value }: { value: unknown }) => {
  const { formatMessage } = useIntl();
  if (typeof value !== 'string' || value === '') {
    return <Typography textColor="neutral800">-</Typography>;
  }
  return (
    <Typography ellipsis maxWidth="30rem" textColor="neutral800">
      {formatMessage({
        id: value,
        defaultMessage: contentEnumOptionVietnameseTranslations[value] ?? value,
      })}
    </Typography>
  );
};
