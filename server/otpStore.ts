import crypto from 'crypto';
import { adminDb, checkAdminDbAvailable } from './firebaseAdmin';

export interface OtpRecord {
  key: string;
  email: string;
  uid: string;
  purpose: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
  meta?: Record<string, any>;
}

const memoryOtpStore = new Map<string, OtpRecord>();

export function hashOtpCode(code: string, email: string, purpose: string): string {
  return crypto
    .createHash('sha256')
    .update(`${code.trim()}:${email.toLowerCase().trim()}:${purpose}`)
    .digest('hex');
}

export function generateSecureSixDigitOtp(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

export async function saveOtpChallenge(params: {
  email: string;
  uid: string;
  purpose: string;
  code: string;
  ttlMs?: number;
  meta?: Record<string, any>;
}): Promise<number> {
  const cleanEmail = params.email.toLowerCase().trim();
  const key = `${params.purpose}:${params.uid}:${cleanEmail}`;
  const docId = crypto.createHash('sha256').update(key).digest('hex').slice(0, 32);
  const expiresAt = Date.now() + (params.ttlMs || 10 * 60 * 1000);

  const record: OtpRecord = {
    key,
    email: cleanEmail,
    uid: params.uid,
    purpose: params.purpose,
    codeHash: hashOtpCode(params.code, cleanEmail, params.purpose),
    expiresAt,
    attempts: 0,
    meta: params.meta || {}
  };

  memoryOtpStore.set(key, record);

  try {
    if (await checkAdminDbAvailable()) {
      await adminDb.collection('admin_otps').doc(docId).set(record);
    }
  } catch (err) {
    console.warn('[OtpStore] Could not persist OTP hash to Firestore:', err);
  }

  return expiresAt;
}

export async function verifyOtpChallenge(params: {
  email: string;
  uid: string;
  purpose: string;
  code: string;
}): Promise<{ valid: boolean; reason?: string; meta?: Record<string, any> }> {
  const cleanEmail = params.email.toLowerCase().trim();
  const cleanCode = params.code.trim();
  if (!cleanEmail || !/^\d{6}$/.test(cleanCode)) {
    return { valid: false, reason: 'A valid 6-digit numeric OTP code is required.' };
  }

  const key = `${params.purpose}:${params.uid}:${cleanEmail}`;
  const docId = crypto.createHash('sha256').update(key).digest('hex').slice(0, 32);

  let record: OtpRecord | null = memoryOtpStore.get(key) || null;
  let fromFirestore = false;

  try {
    if (!record && (await checkAdminDbAvailable())) {
      const snap = await adminDb.collection('admin_otps').doc(docId).get();
      if (snap.exists) {
        record = snap.data() as OtpRecord;
        fromFirestore = true;
      }
    }
  } catch {
    // Use memory store if Firestore unavailable
  }

  if (!record) {
    return { valid: false, reason: 'No active OTP challenge found. Please request a new verification code.' };
  }

  if (Date.now() > record.expiresAt) {
    memoryOtpStore.delete(key);
    if (await checkAdminDbAvailable()) {
      await adminDb.collection('admin_otps').doc(docId).delete().catch(() => {});
    }
    return { valid: false, reason: 'OTP has expired. Please request a new verification code.' };
  }

  if (record.attempts >= 5) {
    memoryOtpStore.delete(key);
    if (await checkAdminDbAvailable()) {
      await adminDb.collection('admin_otps').doc(docId).delete().catch(() => {});
    }
    return { valid: false, reason: 'Too many invalid attempts. Please request a new verification code.' };
  }

  const candidateHash = hashOtpCode(cleanCode, cleanEmail, params.purpose);
  const hashesMatch = crypto.timingSafeEqual(
    Buffer.from(candidateHash, 'hex'),
    Buffer.from(record.codeHash, 'hex')
  );

  if (!hashesMatch) {
    record.attempts += 1;
    memoryOtpStore.set(key, record);
    if (fromFirestore || (await checkAdminDbAvailable())) {
      await adminDb.collection('admin_otps').doc(docId).set(record).catch(() => {});
    }
    return {
      valid: false,
      reason: `Invalid verification code. ${Math.max(0, 5 - record.attempts)} attempts remaining.`
    };
  }

  // Consumed cleanly on success
  memoryOtpStore.delete(key);
  try {
    if (await checkAdminDbAvailable()) {
      await adminDb.collection('admin_otps').doc(docId).delete().catch(() => {});
    }
  } catch {}

  return { valid: true, meta: record.meta };
}
