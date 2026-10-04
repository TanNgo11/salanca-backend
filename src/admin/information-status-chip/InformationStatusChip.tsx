import type { CSSProperties } from 'react';

import type { InformationStatusChipColor } from './information-status-chip.types';

export interface InformationStatusChipProps {
  color: InformationStatusChipColor;
  label: string;
}

export const InformationStatusChip = ({
  color,
  label,
}: InformationStatusChipProps) => {
  const style: CSSProperties = {
    backgroundColor: color.background,
    borderColor: color.border,
    color: color.text,
  };

  return (
    <span className="information-status-chip" style={style}>
      {label}
    </span>
  );
};
