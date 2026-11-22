import { razorpayDepositProvider } from './razorpayProvider';
import { DepositProvider } from './types';

export type { DepositProvider, DepositRequestInput, DepositResult, DepositUserContext } from './types';

export const DEPOSIT_PROVIDERS: DepositProvider[] = [razorpayDepositProvider];

export const DEFAULT_DEPOSIT_PROVIDER_ID = DEPOSIT_PROVIDERS[0].id;

export function getDepositProvider(providerId?: string): DepositProvider {
  if (providerId) {
    const found = DEPOSIT_PROVIDERS.find((p) => p.id === providerId);
    if (found) return found;
  }
  return DEPOSIT_PROVIDERS[0];
}
