export interface DepositUserContext {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  username?: string;
}

export interface DepositRequestInput {
  amountInr: number;
  user: DepositUserContext;
  onStatusChange?: (statusMessage: string) => void;
}

export interface DepositResult {
  success: boolean;
  cancelled?: boolean;
  alreadyCredited?: boolean;
  amountInr: number;
  newBalance?: number;
  transactionId?: string;
  paymentMethod?: string;
  message: string;
}

export interface DepositProvider {
  id: string;
  name: string;
  badgeText: string;
  description: string;
  supportedMethodsLabel: string;
  minAmountInr: number;
  maxAmountInr: number;
  initiateDeposit: (input: DepositRequestInput) => Promise<DepositResult>;
}
