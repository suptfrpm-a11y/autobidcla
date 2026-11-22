import crypto from 'crypto';
import { adminDb } from './firebaseAdmin';

const RAZORPAY_API_BASE = 'https://api.razorpay.com/v1';

export function getRazorpayKeyCredentials(): { keyId: string; keySecret: string } | null {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim() || '';
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim() || '';
  if (!keyId || !keySecret) return null;
  return { keyId, keySecret };
}

export function getRazorpayWebhookSecret(): string | null {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim() || '';
  return secret || null;
}

export function verifyHmacSha256Signature(
  payload: string | Buffer,
  secret: string,
  providedSignature: string
): boolean {
  if (!secret || !providedSignature) return false;
  const expectedHex = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const expectedBuf = Buffer.from(expectedHex.toLowerCase(), 'utf8');
  const providedBuf = Buffer.from(providedSignature.trim().toLowerCase(), 'utf8');
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

export async function callRazorpayApi<T = any>(
  method: 'GET' | 'POST',
  endpoint: string,
  body?: Record<string, any>
): Promise<T> {
  const creds = getRazorpayKeyCredentials();
  if (!creds) {
    throw new Error('RAZORPAY_NOT_CONFIGURED');
  }

  const authHeader = Buffer.from(`${creds.keyId}:${creds.keySecret}`, 'utf8').toString('base64');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(`${RAZORPAY_API_BASE}${endpoint}`, {
      method,
      headers: {
        Authorization: `Basic ${authHeader}`,
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal
    });

    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const apiErrMsg =
        json?.error?.description ||
        json?.error?.reason ||
        json?.message ||
        `Razorpay API HTTP ${res.status}`;
      throw new Error(apiErrMsg);
    }
    return json as T;
  } finally {
    clearTimeout(timeout);
  }
}

export function normalizeRazorpayMethod(rawMethod?: string): 'upi' | 'card' | 'netbanking' | 'wallet' | 'other' {
  const m = String(rawMethod || '').trim().toLowerCase();
  if (m === 'upi') return 'upi';
  if (m === 'card') return 'card';
  if (m === 'netbanking') return 'netbanking';
  if (m === 'wallet') return 'wallet';
  return 'other';
}

export function formatRazorpayMethodDetails(payment: Record<string, any>): string {
  const method = normalizeRazorpayMethod(payment?.method);
  if (method === 'upi') {
    return payment?.vpa ? `UPI (${payment.vpa})` : 'UPI (Unified Payments Interface)';
  }
  if (method === 'card') {
    const network = payment?.card?.network || 'Card';
    const last4 = payment?.card?.last4 ? ` •••• ${payment.card.last4}` : '';
    return `${network}${last4}`;
  }
  if (method === 'netbanking') {
    return payment?.bank ? `NetBanking (${payment.bank})` : 'NetBanking';
  }
  if (method === 'wallet') {
    return payment?.wallet ? `Wallet (${payment.wallet})` : 'Digital Wallet';
  }
  return 'Razorpay Checkout';
}

export async function creditRazorpayOrderOnce(params: {
  orderId: string;
  paymentId: string;
  paymentEntity: Record<string, any>;
  source: 'verify' | 'webhook';
  expectedUserId?: string;
}): Promise<{
  alreadyCredited: boolean;
  amountInr: number;
  newBalance?: number;
  transactionId: string;
  paymentMethod: string;
}> {
  const { orderId, paymentId, paymentEntity, source, expectedUserId } = params;

  if (String(paymentEntity?.status || '').toLowerCase() !== 'captured') {
    throw new Error('PAYMENT_NOT_CAPTURED');
  }
  if (String(paymentEntity?.currency || '').toUpperCase() !== 'INR') {
    throw new Error('CURRENCY_MISMATCH');
  }
  if (paymentEntity?.order_id && String(paymentEntity.order_id) !== orderId) {
    throw new Error('ORDER_PAYMENT_MISMATCH');
  }

  const now = Date.now();
  const normalizedMethod = normalizeRazorpayMethod(paymentEntity?.method);
  const methodDetails = formatRazorpayMethodDetails(paymentEntity);
  const utr =
    paymentEntity?.acquirer_data?.rrn ||
    paymentEntity?.acquirer_data?.upi_transaction_id ||
    paymentEntity?.acquirer_data?.bank_transaction_id ||
    undefined;

  return adminDb.runTransaction(async (tx) => {
    const orderRef = adminDb.collection('razorpay_orders').doc(orderId);
    const idempotencyRef = adminDb.collection('processed_payments').doc(orderId);
    const companyWalletRef = adminDb.collection('settings').doc('company_wallet');

    const [orderSnap, idempotencySnap, cwSnap] = await Promise.all([
      tx.get(orderRef),
      tx.get(idempotencyRef),
      tx.get(companyWalletRef)
    ]);

    if (!orderSnap.exists) {
      throw new Error('ORDER_NOT_FOUND');
    }

    const orderData = orderSnap.data()!;
    const orderUserId = String(orderData.userId || '');
    if (!orderUserId) {
      throw new Error('ORDER_USER_MISSING');
    }
    if (expectedUserId && orderUserId !== expectedUserId) {
      throw new Error('FORBIDDEN_ORDER_OWNER');
    }

    const expectedAmountPaise = Number(orderData.amountPaise);
    const paidAmountPaise = Number(paymentEntity.amount);
    if (!Number.isInteger(expectedAmountPaise) || expectedAmountPaise <= 0 || paidAmountPaise !== expectedAmountPaise) {
      throw new Error('AMOUNT_MISMATCH');
    }

    const amountInr = Math.round(expectedAmountPaise / 100);

    // Idempotency guard keyed by Razorpay order id
    if (orderData.status === 'credited' || orderData.credited === true) {
      return {
        alreadyCredited: true,
        amountInr,
        transactionId: String(orderData.transactionId || `TXN_RZP_${orderId}`),
        paymentMethod: String(orderData.paymentMethod || normalizedMethod)
      };
    }
    if (idempotencySnap.exists && idempotencySnap.data()?.status === 'credited') {
      const existingData = idempotencySnap.data()!;
      return {
        alreadyCredited: true,
        amountInr,
        transactionId: String(existingData.transactionId || `TXN_RZP_${orderId}`),
        paymentMethod: String(existingData.method || normalizedMethod)
      };
    }

    const pubRef = adminDb.collection('users').doc(orderUserId);
    const privRef = adminDb.collection('user_private').doc(orderUserId);
    const [pubSnap, privSnap] = await Promise.all([tx.get(pubRef), tx.get(privRef)]);
    if (!pubSnap.exists && !privSnap.exists) {
      throw new Error('USER_NOT_FOUND');
    }

    const pubData = pubSnap.exists ? (pubSnap.data() || {}) : {};
    const privData = privSnap.exists ? (privSnap.data() || {}) : {};
    const curDeposits =
      privData.deposits !== undefined ? Number(privData.deposits) : Number(pubData.deposits || 0);
    const safeCurDeposits = Number.isFinite(curDeposits) ? curDeposits : 0;
    const newBalance = safeCurDeposits + amountInr;

    const curCompanyBal = cwSnap.exists ? (Number(cwSnap.data()?.balance) || 0) : 0;
    const newCompanyBal = curCompanyBal + amountInr;

    const txRef = adminDb.collection('transactions').doc();
    const transactionId = `TXN_RZP_${now}_${txRef.id.slice(0, 6).toUpperCase()}`;

    tx.set(privRef, { deposits: newBalance }, { merge: true });
    tx.set(
      companyWalletRef,
      { balance: newCompanyBal, updatedAt: now },
      { merge: true }
    );
    tx.set(
      orderRef,
      {
        status: 'credited',
        credited: true,
        paymentId,
        paymentMethod: normalizedMethod,
        paymentMethodDetails: methodDetails,
        creditedVia: source,
        creditedAt: now,
        updatedAt: now,
        transactionId
      },
      { merge: true }
    );
    tx.set(idempotencyRef, {
      orderId,
      paymentId,
      userId: orderUserId,
      amountInr,
      amountPaise: expectedAmountPaise,
      status: 'credited',
      method: normalizedMethod,
      source,
      creditedAt: now,
      transactionId
    });
    tx.set(txRef, {
      id: txRef.id,
      transactionId,
      userId: orderUserId,
      username: String(pubData.username || orderData.username || 'User'),
      userEmail: String(privData.email || pubData.email || paymentEntity.email || ''),
      phoneNumber: String(privData.phoneNumber || pubData.phoneNumber || paymentEntity.contact || ''),
      type: 'deposit',
      channel: 'ct_account',
      provider: 'razorpay',
      amount: amountInr,
      description: `Wallet Deposit via Razorpay (${normalizedMethod.toUpperCase()})`,
      timestamp: now,
      status: 'success',
      paymentMethod: normalizedMethod,
      paymentMethodDetails: methodDetails,
      paymentId,
      orderId,
      gatewayOrderNumber: orderId,
      ...(utr ? { utr } : {}),
      balanceAfter: newBalance
    });

    return {
      alreadyCredited: false,
      amountInr,
      newBalance,
      transactionId,
      paymentMethod: normalizedMethod
    };
  });
}

export async function markRazorpayOrderFailed(params: {
  orderId: string;
  paymentId: string;
  paymentEntity: Record<string, any>;
}): Promise<{ updated: boolean; reason?: string }> {
  const { orderId, paymentId, paymentEntity } = params;
  const now = Date.now();
  const normalizedMethod = normalizeRazorpayMethod(paymentEntity?.method);
  const methodDetails = formatRazorpayMethodDetails(paymentEntity);
  const failureReason = String(
    paymentEntity?.error_description ||
    paymentEntity?.error_reason ||
    'Payment failed via Razorpay'
  ).slice(0, 300);

  return adminDb.runTransaction(async (tx) => {
    const orderRef = adminDb.collection('razorpay_orders').doc(orderId);
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) {
      return { updated: false, reason: 'order_not_found' };
    }

    const orderData = orderSnap.data()!;
    if (orderData.status === 'credited' || orderData.credited === true) {
      return { updated: false, reason: 'already_credited' };
    }

    const alreadyFailed = orderData.status === 'failed';
    tx.set(
      orderRef,
      {
        status: 'failed',
        failedAt: orderData.failedAt || now,
        updatedAt: now,
        paymentId: paymentId || orderData.paymentId || '',
        paymentMethod: normalizedMethod,
        paymentMethodDetails: methodDetails,
        failureReason
      },
      { merge: true }
    );

    if (!alreadyFailed && orderData.userId) {
      const txRef = adminDb.collection('transactions').doc();
      const transactionId = `TXN_RZPF_${now}_${txRef.id.slice(0, 6).toUpperCase()}`;
      tx.set(txRef, {
        id: txRef.id,
        transactionId,
        userId: String(orderData.userId),
        username: String(orderData.username || 'User'),
        userEmail: String(paymentEntity?.email || ''),
        phoneNumber: String(paymentEntity?.contact || ''),
        type: 'deposit',
        channel: 'ct_account',
        provider: 'razorpay',
        amount: Number(orderData.amountInr || 0),
        description: `Failed Wallet Deposit via Razorpay (${normalizedMethod.toUpperCase()})`,
        timestamp: now,
        status: 'failed',
        paymentMethod: normalizedMethod,
        paymentMethodDetails: methodDetails,
        paymentId: paymentId || `pay_failed_${orderId.slice(-8)}`,
        orderId,
        gatewayOrderNumber: orderId,
        failureReason
      });
    }

    return { updated: true };
  });
}
