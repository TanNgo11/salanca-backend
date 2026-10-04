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
  [InformationStatusChipTone.Info]: {
    background: '#DBEAFE',
    border: '#BFDBFE',
    text: '#1E40AF',
  },
  [InformationStatusChipTone.Neutral]: {
    background: '#F3F4F6',
    border: '#E5E7EB',
    text: '#374151',
  },
};

export const informationStatusChipColor = (
  tone: InformationStatusChipTone,
): InformationStatusChipColor => INFORMATION_STATUS_CHIP_COLORS[tone];
