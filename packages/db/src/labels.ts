// Display labels shared by the public site and the admin.
import type { CallupLevel, TransferKind } from './types';

export const TRANSFER_KIND_LABELS: Record<TransferKind, string> = {
  permanent: 'Permanent',
  loan: 'Loan',
  loan_return: 'Loan return',
  free: 'Free transfer',
  extension: 'Contract extension',
};

export const CALLUP_LEVEL_LABELS: Record<CallupLevel, string> = {
  senior: 'Senior',
  u23: 'U-23',
  u20: 'U-20',
  u17: 'U-17',
};

export const TRANSFER_KINDS = Object.keys(TRANSFER_KIND_LABELS) as TransferKind[];
export const CALLUP_LEVELS = Object.keys(CALLUP_LEVEL_LABELS) as CallupLevel[];
