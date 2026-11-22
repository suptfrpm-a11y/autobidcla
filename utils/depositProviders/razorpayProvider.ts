import { authFetch } from '../apiClient';
import { DepositProvider, DepositRequestInput, DepositResult } from './types';

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, any>) => {
      open: () => void;
      on: (event: string, handler: (response: any) => void) => void;
    };
  }
}

const RAZORPAY_CHECKOUT_URL = 'https://checkout.razorpay.com/v1/checkout.js';
let checkoutScriptPromise: Promise<void> | null = null;

function loadRazorpayCheckoutScript(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Razorpay Checkout requires a browser environment.'));
  }
  if (window.Razorpay) {
    return Promise.resolve();
  }
  if (checkoutScriptPromise) {
    return checkoutScriptPromise;
  }

  checkoutScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[src="${RAZORPAY_CHECKOUT_URL}"]`) as HTMLScriptElement | null;
    if (existing) {
      if (window.Razorpay) {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener(
        'error',
        () => {
          checkoutScriptPromise = null;
          reject(new Error('Failed to load Razorpay Checkout script. Please check your connection.'));
        },
        { once: true }
      );
      return;
    }

    const script = document.createElement('script');
    script.src = RAZORPAY_CHECKOUT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      checkoutScriptPromise = null;
      reject(new Error('Unable to load Razorpay Checkout (checkout.razorpay.com/v1).'));
    };
    document.head.appendChild(script);
  });

  return checkoutScriptPromise;
}

export const razorpayDepositProvider: DepositProvider = {
  id: 'razorpay',
  name: 'Razorpay Instant Deposit',
  badgeText: 'UPI · Cards · NetBanking',
  description: 'Instant wallet top-up secured by Razorpay with automatic verification.',
  supportedMethodsLabel: 'Supports UPI, Google Pay, PhonePe, Paytm, Credit/Debit Cards & NetBanking.',
  minAmountInr: 10,
  maxAmountInr: 50000,

  async initiateDeposit(input: DepositRequestInput): Promise<DepositResult> {
    const amountInr = Math.trunc(Number(input.amountInr));
    if (!Number.isInteger(amountInr) || amountInr < 10 || amountInr > 50000) {
      throw new Error('Deposit amount must be a whole number between ₹10 and ₹50,000.');
    }

    input.onStatusChange?.('Loading Razorpay Checkout...');
    await loadRazorpayCheckoutScript();

    if (!window.Razorpay) {
      throw new Error('Razorpay Checkout SDK failed to initialize.');
    }

    input.onStatusChange?.('Creating secure deposit order...');
    const orderRes = await authFetch('/api/razorpay/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: amountInr })
    });
    const orderData = await orderRes.json().catch(() => ({}));
    if (!orderRes.ok || !orderData?.success || !orderData?.orderId || !orderData?.keyId) {
      throw new Error(orderData?.error || 'Could not create Razorpay deposit order.');
    }

    input.onStatusChange?.('Waiting for Razorpay Checkout completion...');
    const paymentResponse = await new Promise<{
      razorpay_order_id: string;
      razorpay_payment_id: string;
      razorpay_signature: string;
    } | null>((resolve, reject) => {
      let settled = false;
      const safeResolve = (val: {
        razorpay_order_id: string;
        razorpay_payment_id: string;
        razorpay_signature: string;
      } | null) => {
        if (settled) return;
        settled = true;
        resolve(val);
      };
      const safeReject = (err: Error) => {
        if (settled) return;
        settled = true;
        reject(err);
      };

      const RazorpayCtor = window.Razorpay!;
      const rzp = new RazorpayCtor({
        key: orderData.keyId,
        amount: orderData.amountPaise,
        currency: orderData.currency || 'INR',
        name: 'AutoBid',
        description: `Wallet Deposit (₹${amountInr.toLocaleString()})`,
        order_id: orderData.orderId,
        prefill: {
          name: input.user.name || input.user.username || 'AutoBid Member',
          email: input.user.email || undefined,
          contact: input.user.phone || undefined
        },
        theme: {
          color: '#059669'
        },
        handler: (response: any) => {
          safeResolve({
            razorpay_order_id: String(response?.razorpay_order_id || orderData.orderId),
            razorpay_payment_id: String(response?.razorpay_payment_id || ''),
            razorpay_signature: String(response?.razorpay_signature || '')
          });
        },
        modal: {
          ondismiss: () => {
            safeResolve(null);
          }
        }
      });

      rzp.on('payment.failed', (failure: any) => {
        const reason =
          failure?.error?.description ||
          failure?.error?.reason ||
          'Payment failed in Razorpay Checkout.';
        safeReject(new Error(reason));
      });

      rzp.open();
    });

    if (!paymentResponse) {
      return {
        success: false,
        cancelled: true,
        amountInr,
        message: 'Payment checkout was closed before completing the deposit.'
      };
    }

    input.onStatusChange?.('Verifying payment & crediting wallet...');
    const verifyRes = await authFetch('/api/razorpay/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(paymentResponse)
    });
    const verifyData = await verifyRes.json().catch(() => ({}));
    if (!verifyRes.ok || !verifyData?.success) {
      throw new Error(verifyData?.error || 'Payment verification failed. Contact support if money was debited.');
    }

    const creditedAmount = Number(verifyData.amountInr ?? amountInr);
    return {
      success: true,
      alreadyCredited: Boolean(verifyData.alreadyCredited),
      amountInr: creditedAmount,
      newBalance: typeof verifyData.newBalance === 'number' ? verifyData.newBalance : undefined,
      transactionId: verifyData.transactionId,
      paymentMethod: verifyData.paymentMethod,
      message: verifyData.alreadyCredited
        ? `Deposit of ₹${creditedAmount.toLocaleString()} was already verified and credited to your wallet.`
        : `Deposit of ₹${creditedAmount.toLocaleString()} verified and credited to your wallet!`
    };
  }
};
