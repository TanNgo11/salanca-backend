import {
  InformationStatusChipTone,
  type InformationStatusChipColor,
} from './information-status-chip.types';

export const INFORMATION_STATUS_CHIP_COLORS: Readonly<
  Record<InformationStatusChipTone, InformationStatusChipColor>
> = {
  [InformationStatusChipTone.Published]: {
    background: '#DCFCE7',
    border: '#BBF7D0',
    text: '#166534',
  },
  [InformationStatusChipTone.Warning]: {
    background: '#FEE2E2',
    border: '#FECACA',
    text: '#991B1B',
  },
};

export const informationStatusChipColor = (
  tone: InformationStatusChipTone,
): InformationStatusChipColor => INFORMATION_STATUS_CHIP_COLORS[tone];
