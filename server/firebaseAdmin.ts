import fs from 'fs';
import path from 'path';
import type express from 'express';
import { initializeApp, getApps, cert, applicationDefault, App } from 'firebase-admin/app';
import { getAuth, DecodedIdToken } from 'firebase-admin/auth';
import { getFirestore, Firestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

interface FirebaseWebConfig {
  projectId: string;
  apiKey?: string;
  storageBucket?: string;
  firestoreDatabaseId?: string;
}

function loadFirebaseWebConfig(): FirebaseWebConfig {
  try {
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch (err) {
    console.warn('[FirebaseAdmin] Could not read firebase-applet-config.json:', err);
  }
  return {
    projectId: process.env.FIREBASE_PROJECT_ID || 'autobidone',
    apiKey: process.env.FIREBASE_API_KEY,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    firestoreDatabaseId: process.env.FIREBASE_DATABASE_ID || ''
  };
}

export const firebaseWebConfig = loadFirebaseWebConfig();

let adminApp: App;
let hasExplicitServiceAccount = false;

function initAdminApp(): App {
  if (getApps().length > 0) {
    return getApps()[0];
  }

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (serviceAccountJson) {
    try {
      const parsed = JSON.parse(serviceAccountJson);
      hasExplicitServiceAccount = true;
      return initializeApp({
        credential: cert(parsed),
        projectId: parsed.project_id || firebaseWebConfig.projectId,
        storageBucket: firebaseWebConfig.storageBucket
      });
    } catch (err) {
      console.error('[FirebaseAdmin] Invalid FIREBASE_SERVICE_ACCOUNT_JSON:', err);
    }
  }

  // Fallback to Application Default Credentials (works on Cloud Run / GCP when IAM is granted)
  // or projectId-only mode (supports verifyIdToken via Google public JWKS certificates)
  try {
    return initializeApp({
      credential: applicationDefault(),
      projectId: firebaseWebConfig.projectId,
      storageBucket: firebaseWebConfig.storageBucket
    });
  } catch {
    return initializeApp({
      projectId: firebaseWebConfig.projectId,
      storageBucket: firebaseWebConfig.storageBucket
    });
  }
}

adminApp = initAdminApp();

export const adminAuth = getAuth(adminApp);

const dbId =
  firebaseWebConfig.firestoreDatabaseId &&
  firebaseWebConfig.firestoreDatabaseId.trim() &&
  firebaseWebConfig.firestoreDatabaseId !== '(default)'
    ? firebaseWebConfig.firestoreDatabaseId.trim()
    : undefined;

export const adminDb: Firestore = dbId ? getFirestore(adminApp, dbId) : getFirestore(adminApp);
export const adminStorage = getStorage(adminApp);
export { FieldValue };

let adminDbStatusChecked = false;
let adminDbAvailable = false;
let adminDbCheckedAt = 0;
let adminDbCheckPromise: Promise<boolean> | null = null;
let loggedAdminDbUnavailable = false;
const ADMIN_DB_RECHECK_MS = 5 * 60 * 1000;

export function isFirestoreNotFoundOrDeniedError(err: any): boolean {
  const code = err?.code;
  if (code === 5 || code === 7 || code === 16) return true;
  const msg = String(err?.message || '').toLowerCase();
  return (
    msg.includes('not_found') ||
    msg.includes('not found') ||
    msg.includes('does not exist') ||
    msg.includes('permission_denied') ||
    msg.includes('permission denied') ||
    msg.includes('unauthenticated') ||
    msg.includes('could not load the default credentials')
  );
}

export function markAdminDbUnavailable(err?: any) {
  adminDbAvailable = false;
  adminDbStatusChecked = true;
  adminDbCheckedAt = Date.now();
  if (!loggedAdminDbUnavailable) {
    loggedAdminDbUnavailable = true;
    const reason = err?.message || err || 'Firestore Admin access unavailable';
    console.info(`[FirebaseAdmin] Admin Firestore inactive (using fallback/client rules): ${reason}`);
  }
}

export async function checkAdminDbAvailable(): Promise<boolean> {
  const now = Date.now();
  if (adminDbStatusChecked) {
    if (adminDbAvailable) return true;
    if (now - adminDbCheckedAt < ADMIN_DB_RECHECK_MS) return false;
  }

  if (adminDbCheckPromise) {
    return adminDbCheckPromise;
  }

  adminDbCheckPromise = (async () => {
    try {
      await adminDb.collection('settings').doc('app_config').get();
      adminDbAvailable = true;
      adminDbStatusChecked = true;
      adminDbCheckedAt = Date.now();
      return true;
    } catch (err: any) {
      markAdminDbUnavailable(err);
      return false;
    } finally {
      adminDbCheckPromise = null;
    }
  })();

  return adminDbCheckPromise;
}

export interface AuthenticatedContext {
  uid: string;
  email: string;
  name: string;
  role: string;
  claims: Record<string, any>;
  token: string;
  userDoc: Record<string, any> | null;
}

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthenticatedContext;
    }
  }
}

const BUILTIN_BOOTSTRAP_ADMIN_EMAILS = ['mmwajnnd@gmail.com'];

export function getBootstrapAdminEmails(): Set<string> {
  const raw = process.env.ADMIN_BOOTSTRAP_EMAILS || '';
  const combined = [...BUILTIN_BOOTSTRAP_ADMIN_EMAILS, ...raw.split(',')];
  return new Set(
    combined
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

/**
 * Fetches the authoritative user profile from Firestore using Admin SDK
 * or fallback to Firestore REST API using the caller's own verified ID token.
 */
export async function fetchUserDocAuthoritative(
  uid: string,
  callerIdToken?: string
): Promise<Record<string, any> | null> {
  try {
    const [pubSnap, privSnap] = await Promise.all([
      adminDb.collection('users').doc(uid).get(),
      adminDb.collection('user_private').doc(uid).get()
    ]);
    if (pubSnap.exists || privSnap.exists) {
      return {
        id: uid,
        ...(pubSnap.exists ? pubSnap.data() : {}),
        ...(privSnap.exists ? privSnap.data() : {})
      };
    }
  } catch {
    // Fallback to caller-scoped Firestore REST API when ADC/ServiceAccount is absent locally
  }

  if (callerIdToken) {
    try {
      const dbSegment = dbId || '(default)';
      const pubUrl = `https://firestore.googleapis.com/v1/projects/${firebaseWebConfig.projectId}/databases/${encodeURIComponent(dbSegment)}/documents/users/${encodeURIComponent(uid)}`;
      const privUrl = `https://firestore.googleapis.com/v1/projects/${firebaseWebConfig.projectId}/databases/${encodeURIComponent(dbSegment)}/documents/user_private/${encodeURIComponent(uid)}`;
      const [pubRes, privRes] = await Promise.all([
        fetch(pubUrl, { headers: { Authorization: `Bearer ${callerIdToken}` } }),
        fetch(privUrl, { headers: { Authorization: `Bearer ${callerIdToken}` } })
      ]);
      const pubData = pubRes.ok ? parseFirestoreRestDoc(uid, await pubRes.json()) : null;
      const privData = privRes.ok ? parseFirestoreRestDoc(uid, await privRes.json()) : null;
      if (pubData || privData) {
        return { id: uid, ...(pubData || {}), ...(privData || {}) };
      }
    } catch {
      // Ignore network fallback failures
    }
  }
  return null;
}

function parseFirestoreValue(val: any): any {
  if (!val || typeof val !== 'object') return undefined;
  if ('stringValue' in val) return val.stringValue;
  if ('booleanValue' in val) return val.booleanValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('nullValue' in val) return null;
  if ('arrayValue' in val) {
    return Array.isArray(val.arrayValue?.values)
      ? val.arrayValue.values.map(parseFirestoreValue)
      : [];
  }
  if ('mapValue' in val) {
    const obj: Record<string, any> = {};
    const fields = val.mapValue?.fields || {};
    for (const [k, v] of Object.entries(fields)) {
      obj[k] = parseFirestoreValue(v);
    }
    return obj;
  }
  return undefined;
}

function parseFirestoreRestDoc(id: string, docJson: any): Record<string, any> {
  const out: Record<string, any> = { id };
  const fields = docJson?.fields || {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = parseFirestoreValue(v);
  }
  return out;
}

export async function verifyIdTokenStrict(token: string, checkRevoked = false): Promise<DecodedIdToken> {
  try {
    return await adminAuth.verifyIdToken(token, checkRevoked);
  } catch (adminErr: any) {
    // Do not fall back to unrevoked lookup when explicit token revocation was detected
    if (adminErr?.code === 'auth/id-token-revoked' || adminErr?.code === 'auth/user-disabled') {
      throw adminErr;
    }
    // Fallback verification via Google Identity Toolkit accounts:lookup (only when Admin SDK ADC is absent)
    if (!hasExplicitServiceAccount && firebaseWebConfig.apiKey) {
      const res = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseWebConfig.apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken: token })
        }
      );
      if (res.ok) {
        const data: any = await res.json();
        const fbUser = data?.users?.[0];
        if (fbUser?.localId && !fbUser.disabled) {
          let customAttrs: Record<string, any> = {};
          try {
            if (fbUser.customAttributes) {
              customAttrs = JSON.parse(fbUser.customAttributes);
            }
          } catch {}
          let jwtPayload: Record<string, any> = {};
          try {
            const parts = token.split('.');
            if (parts.length === 3) {
              jwtPayload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
            }
          } catch {}
          const fallbackProvider =
            jwtPayload?.firebase?.sign_in_provider ||
            (Array.isArray(fbUser.providerUserInfo) && fbUser.providerUserInfo.length === 1
              ? fbUser.providerUserInfo[0]?.providerId
              : undefined);
          return {
            uid: fbUser.localId,
            sub: fbUser.localId,
            email: fbUser.email,
            email_verified: fbUser.emailVerified,
            phone_number: fbUser.phoneNumber,
            name: fbUser.displayName,
            firebase: jwtPayload.firebase || (fallbackProvider ? { sign_in_provider: fallbackProvider } : undefined),
            ...customAttrs
          } as unknown as DecodedIdToken;
        }
      }
    }
    throw adminErr;
  }
}

export function extractBearerToken(req: express.Request): string | null {
  const header = req.headers.authorization;
  if (!header || typeof header !== 'string') return null;
  if (header.startsWith('Bearer ')) {
    const t = header.slice(7).trim();
    return t || null;
  }
  return null;
}

export async function resolveAuthContext(req: express.Request, checkRevoked = false): Promise<AuthenticatedContext | null> {
  const token = extractBearerToken(req);
  if (!token) return null;

  const decoded = await verifyIdTokenStrict(token, checkRevoked);
  const uid = decoded.uid;
  const email = (decoded.email || '').toLowerCase().trim();
  const userDoc = await fetchUserDocAuthoritative(uid, token);

  let role = 'user';
  if (decoded.admin === true || decoded.role === 'admin') {
    role = 'admin';
  } else if (isClaimEmailVerified(decoded) && email && getBootstrapAdminEmails().has(email)) {
    role = 'admin';
  } else if (typeof decoded.role === 'string' && decoded.role.trim()) {
    role = decoded.role.trim();
  } else if (userDoc?.role) {
    role = String(userDoc.role);
  }

  return {
    uid,
    email,
    name: String(userDoc?.username || userDoc?.fullName || decoded.name || email.split('@')[0] || 'User'),
    role,
    claims: decoded,
    token,
    userDoc
  };
}

function isAccountDeletedOrRevoked(userDoc: Record<string, any> | null): boolean {
  if (!userDoc) return false;
  return Boolean(userDoc.isDeleted === true || userDoc.isRevoked === true);
}

export function isAccountSuspended(userDoc: Record<string, any> | null): boolean {
  if (!userDoc) return false;
  const status = String(userDoc.suspensionStatus || 'none');
  if (status === 'permanent') return true;
  if (status === 'temporary') {
    const until = Number(userDoc.suspensionUntil || 0);
    if (!until || until > Date.now()) return true;
  }
  return false;
}

export function isClaimEmailVerified(claims: Record<string, any> | null | undefined): boolean {
  if (!claims) return false;
  if (claims.email_verified === true) return true;
  return claims.firebase?.sign_in_provider === 'microsoft.com';
}

export const requireAuth: express.RequestHandler = async (req, res, next) => {
  try {
    const ctx = await resolveAuthContext(req, false);
    if (!ctx) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required. Please sign in again.'
      });
    }
    if (!isClaimEmailVerified(ctx.claims)) {
      return res.status(403).json({
        success: false,
        code: 'EMAIL_NOT_VERIFIED',
        error: 'Email verification required. Please verify your email address before continuing.'
      });
    }
    if (isAccountDeletedOrRevoked(ctx.userDoc)) {
      return res.status(403).json({
        success: false,
        error: 'Your account has been deleted or revoked. Access denied.'
      });
    }
    req.authUser = ctx;
    next();
  } catch (err: any) {
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired authentication token.'
    });
  }
};

export const requireMoneyAuth: express.RequestHandler = async (req, res, next) => {
  try {
    const ctx = await resolveAuthContext(req, true);
    if (!ctx) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required. Please sign in again.'
      });
    }
    if (!isClaimEmailVerified(ctx.claims)) {
      return res.status(403).json({
        success: false,
        code: 'EMAIL_NOT_VERIFIED',
        error: 'Email verification required. Please verify your email address before accessing wallet, bidding, or payment features.'
      });
    }
    if (isAccountDeletedOrRevoked(ctx.userDoc)) {
      return res.status(403).json({
        success: false,
        error: 'Your account has been deleted or revoked. Financial actions are blocked.'
      });
    }
    if (isAccountSuspended(ctx.userDoc)) {
      return res.status(403).json({
        success: false,
        error: 'Your account is currently suspended from financial transactions.'
      });
    }
    req.authUser = ctx;
    next();
  } catch {
    return res.status(401).json({
      success: false,
      error: 'Session revoked or expired. Please sign in again.'
    });
  }
};

export function requireRole(allowedRoles: string[]): express.RequestHandler {
  const normalized = new Set(allowedRoles.map(r => r.toLowerCase()));
  return async (req, res, next) => {
    try {
      const ctx = req.authUser || (await resolveAuthContext(req, true));
      if (!ctx) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required.'
        });
      }
      if (isAccountDeletedOrRevoked(ctx.userDoc)) {
        return res.status(403).json({
          success: false,
          error: 'Your account has been deleted or revoked.'
        });
      }
      req.authUser = ctx;
      const userRole = (ctx.role || 'user').toLowerCase();
      if (userRole === 'admin' || normalized.has(userRole)) {
        return next();
      }
      return res.status(403).json({
        success: false,
        error: `Forbidden. Requires one of roles: ${Array.from(normalized).join(', ')}`
      });
    } catch {
      return res.status(401).json({
        success: false,
        error: 'Invalid, revoked, or expired authentication token.'
      });
    }
  };
}

export const STAFF_ROLES = ['admin', 'finance', 'support', 'accountant', 'employee', 'staff', 'moderator', 'manager', 'supervisor'];
export const FINANCE_ROLES = ['admin', 'finance', 'accountant'];
export const ADMIN_ONLY = ['admin'];
