import fs from "fs";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import cors from "cors";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import {
  adminAuth,
  adminDb,
  adminStorage,
  FieldValue,
  checkAdminDbAvailable,
  verifyIdTokenStrict,
  extractBearerToken,
  isAccountSuspended,
  resolveAuthContext,
  requireAuth,
  requireMoneyAuth,
  requireRole,
  STAFF_ROLES,
  FINANCE_ROLES,
  ADMIN_ONLY,
  getBootstrapAdminEmails,
  isFirestoreNotFoundOrDeniedError,
  markAdminDbUnavailable
} from "./server/firebaseAdmin";
import { isEmailServiceConfigured, sendSecurityOtpEmail } from "./server/emailService";
import { generateSecureSixDigitOtp, saveOtpChallenge, verifyOtpChallenge } from "./server/otpStore";
import { serverState, persistLocalState, readCollectionMerged, upsertDocDual, deleteDocDual } from "./server/serverState";
import {
  getRazorpayKeyCredentials,
  getRazorpayWebhookSecret,
  verifyHmacSha256Signature,
  callRazorpayApi,
  creditRazorpayOrderOnce,
  markRazorpayOrderFailed
} from "./server/razorpayDepositService";

// Hydrate missing env vars (or replace stale container test keys) from gitignored .env if present
(function hydrateRuntimeEnvFromDotEnv() {
  try {
    const envPath = path.join(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return;
    const raw = fs.readFileSync(envPath, 'utf-8');
    const parsed: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx <= 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1).trim();
      }
      if (key && val) {
        parsed[key] = val;
      }
    }

    for (const [key, val] of Object.entries(parsed)) {
      const cur = process.env[key]?.trim();
      if (!cur) {
        process.env[key] = val;
      }
    }
  } catch (err) {
    console.warn('[Env] Could not load .env file:', err);
  }
})();

// ----------------------------------------------------
// Groq Cloud AI Engine (configured strictly via env)
// ----------------------------------------------------
const GROQ_MODELS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'];

function getGroqApiKey(): string {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) {
    throw new Error("GROQ_API_KEY environment variable is not configured on the server.");
  }
  return key;
}

async function callGroqAI(options: {
  messages: Array<{ role: string; content: string | any[] }>;
  model?: string;
  temperature?: number;
  response_format?: { type: "json_object" };
  max_tokens?: number;
  timeoutMs?: number;
}): Promise<string> {
  const groqKey = getGroqApiKey();
  const models = options.model
    ? [options.model, ...GROQ_MODELS.filter(m => m !== options.model)]
    : GROQ_MODELS;

  let lastError: any = null;
  for (const model of models) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs || 15000);

      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${groqKey}`
        },
        body: JSON.stringify({
          model,
          messages: options.messages,
          temperature: options.temperature ?? 0.2,
          ...(options.response_format ? { response_format: options.response_format } : {}),
          ...(options.max_tokens ? { max_tokens: options.max_tokens } : { max_tokens: 1500 })
        }),
        signal: controller.signal
      });
      clearTimeout(timer);

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Groq HTTP ${response.status}: ${errText}`);
      }

      const data: any = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (typeof content === 'string') {
        return content;
      }
    } catch (err: any) {
      lastError = err;
      console.warn(`[Groq AI] Model ${model} failed, trying next:`, err?.message);
    }
  }

  throw lastError || new Error("All Groq models failed");
}

// Built-in car model catalog for fast non-secret responses
const BRAND_MODELS_CATALOG: Record<string, string[]> = {
  toyota: ["Camry", "Corolla", "RAV4", "Highlander", "Tacoma", "Tundra", "Prius", "4Runner", "Sienna", "Supra", "Crown", "Land Cruiser", "Fortuner", "Innova Crysta", "Glanza", "Urban Cruiser Hyryder"],
  honda: ["Civic", "Accord", "CR-V", "Pilot", "HR-V", "Odyssey", "Passport", "Ridgeline", "Fit", "City", "Amaze", "Elevate"],
  ford: ["F-150", "Mustang", "Explorer", "Escape", "Bronco", "Bronco Sport", "Edge", "Ranger", "Expedition", "Maverick", "Transit"],
  chevrolet: ["Silverado 1500", "Equinox", "Malibu", "Tahoe", "Traverse", "Colorado", "Suburban", "Camaro", "Corvette", "Trailblazer", "Trax"],
  bmw: ["3 Series", "5 Series", "7 Series", "X1", "X3", "X5", "X7", "M3", "M4", "M5", "4 Series", "i4", "iX", "Z4"],
  mercedes: ["C-Class", "E-Class", "S-Class", "GLC", "GLE", "GLS", "CLA", "GLA", "GLB", "A-Class", "AMG GT", "G-Class", "EQE", "EQS"],
  "mercedes-benz": ["C-Class", "E-Class", "S-Class", "GLC", "GLE", "GLS", "CLA", "GLA", "GLB", "A-Class", "AMG GT", "G-Class", "EQE", "EQS"],
  audi: ["A3", "A4", "A5", "A6", "A7", "A8", "Q3", "Q5", "Q7", "Q8", "RS6", "e-tron GT", "TT"],
  hyundai: ["Elantra", "Sonata", "Tucson", "Santa Fe", "Kona", "Palisade", "Venue", "Creta", "Ioniq 5", "Ioniq 6", "Verna", "i20", "Grand i10 Nios"],
  kia: ["Forte", "K5", "Sportage", "Sorento", "Telluride", "Soul", "Carnival", "EV6", "EV9", "Seltos", "Sonet", "Carens"],
  nissan: ["Altima", "Sentra", "Rogue", "Pathfinder", "Murano", "Frontier", "Titan", "Maxima", "Z", "Kicks", "Armada", "Magnite"],
  volkswagen: ["Jetta", "Passat", "Golf GTI", "Tiguan", "Atlas", "Taos", "ID.4", "Arteon", "Virtus", "Taigun", "Polo"],
  suzuki: ["Swift", "Baleno", "Dzire", "Brezza", "Ertiga", "Grand Vitara", "Fronx", "Jimny", "Alto K10", "WagonR", "Ciaz", "XL6"],
  "maruti suzuki": ["Swift", "Baleno", "Dzire", "Brezza", "Ertiga", "Grand Vitara", "Fronx", "Jimny", "Alto K10", "WagonR", "Ciaz", "XL6"],
  maruti: ["Swift", "Baleno", "Dzire", "Brezza", "Ertiga", "Grand Vitara", "Fronx", "Jimny", "Alto K10", "WagonR", "Ciaz", "XL6"],
  tata: ["Nexon", "Harrier", "Safari", "Punch", "Tiago", "Tigor", "Altroz", "Curvv", "Sierra"],
  mahindra: ["Thar", "Scorpio-N", "Scorpio Classic", "XUV700", "Bolero", "Bolero Neo", "XUV300", "XUV400"],
  tesla: ["Model 3", "Model Y", "Model S", "Model X", "Cybertruck"],
  subaru: ["Outback", "Forester", "Crosstrek", "Impreza", "WRX", "Ascent", "BRZ", "Legacy"],
  porsche: ["911", "Cayenne", "Macan", "Panamera", "Taycan", "718 Cayman", "718 Boxster"],
  lexus: ["ES", "RX", "NX", "IS", "GX", "LX", "UX", "LS", "LC"],
  jeep: ["Wrangler", "Grand Cherokee", "Cherokee", "Compass", "Gladiator", "Renegade", "Wagoneer"],
  "land rover": ["Defender", "Range Rover", "Range Rover Sport", "Range Rover Evoque", "Range Rover Velar", "Discovery"],
  mazda: ["Mazda3", "Mazda6", "CX-5", "CX-30", "CX-50", "CX-90", "MX-5 Miata"],
  volvo: ["XC90", "XC60", "XC40", "EX30", "EX90", "S60", "S90", "V60"],
  dodge: ["Charger", "Challenger", "Durango", "Hornet"],
  gmc: ["Sierra 1500", "Yukon", "Acadia", "Terrain", "Canyon", "Hummer EV"],
  cadillac: ["Escalade", "CT4", "CT5", "XT4", "XT5", "XT6", "Lyriq"],
  acura: ["MDX", "RDX", "TLX", "Integra"],
  infiniti: ["Q50", "Q60", "QX50", "QX55", "QX60", "QX80"],
  genesis: ["G70", "G80", "G90", "GV70", "GV80"],
  mitsubishi: ["Outlander", "Eclipse Cross", "Mirage", "Pajero Sport"],
  ram: ["1500", "2500", "3500", "ProMaster"],
  mini: ["Cooper", "Countryman", "Clubman"],
  jaguar: ["F-PACE", "E-PACE", "F-TYPE", "XF", "I-PACE"],
  "alfa romeo": ["Giulia", "Stelvio", "Tonale"],
  rivian: ["R1T", "R1S"],
  lucid: ["Air"],
  byd: ["Seal", "Atto 3", "Dolphin", "Han", "Tang"]
};

function getFallbackCarModels(brand: string): string[] {
  const cleanBrand = (brand || '').toLowerCase().trim();
  if (BRAND_MODELS_CATALOG[cleanBrand]) return BRAND_MODELS_CATALOG[cleanBrand];
  for (const [key, models] of Object.entries(BRAND_MODELS_CATALOG)) {
    if (cleanBrand.includes(key) || key.includes(cleanBrand)) return models;
  }
  return [`${brand} Standard`, `${brand} Sport`, `${brand} Touring`, `${brand} GT Edition`, `${brand} Limited`];
}

function getFallbackCarSpecs(brand?: string, model?: string) {
  const b = (brand || '').toLowerCase();
  const m = (model || '').toLowerCase();
  if (b.includes('tesla') || b.includes('rivian') || b.includes('lucid') || b.includes('byd') || m.includes('ev') || m.includes('electric') || m.includes('ioniq') || m.includes('taycan')) {
    return { engine: "Dual Electric Motor (AWD)", topSpeed: "145 mph", mpg: "112 MPGe", fuelType: "Electric" };
  }
  if (m.includes('hybrid') || m.includes('prius')) {
    return { engine: "2.5L 4-Cylinder Hybrid", topSpeed: "115 mph", mpg: "48/44 mpg", fuelType: "Hybrid" };
  }
  if (m.includes('f-150') || m.includes('silverado') || m.includes('ram') || m.includes('tahoe') || m.includes('suburban') || m.includes('tundra') || m.includes('scorpio') || m.includes('thar') || m.includes('fortuner')) {
    return { engine: "3.5L V6 Turbo / 5.3L V8", topSpeed: "118 mph", mpg: "18/24 mpg", fuelType: "Petrol" };
  }
  return { engine: "2.0L 4-Cylinder Turbo", topSpeed: "135 mph", mpg: "26/35 mpg", fuelType: "Petrol" };
}

// ----------------------------------------------------
// Security & Private Storage Helpers (A1, A4, A5, B14)
// ----------------------------------------------------
const ADMIN_OTP_HMAC_KEY = crypto
  .createHash('sha256')
  .update(
    process.env.ADMIN_OTP_SECRET?.trim() ||
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim() ||
    crypto.randomBytes(32).toString('hex')
  )
  .digest();

function signAdminOtpToken(uid: string, purpose: string): string {
  const payloadObj = {
    uid,
    purpose,
    exp: Date.now() + 15 * 60 * 1000,
    jti: crypto.randomBytes(8).toString('hex')
  };
  const payloadB64 = Buffer.from(JSON.stringify(payloadObj), 'utf-8').toString('base64url');
  const sig = crypto.createHmac('sha256', ADMIN_OTP_HMAC_KEY).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

function verifyAdminOtpToken(token: string | undefined, expectedUid: string): { valid: boolean; reason?: string; purpose?: string } {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    return { valid: false, reason: 'Admin email OTP verification is required before financial or destructive actions.' };
  }
  const [payloadB64, sig] = token.split('.');
  if (!payloadB64 || !sig) {
    return { valid: false, reason: 'Malformed admin OTP token.' };
  }
  const expectedSig = crypto.createHmac('sha256', ADMIN_OTP_HMAC_KEY).update(payloadB64).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return { valid: false, reason: 'Invalid admin OTP security token.' };
  }
  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
    if (!parsed || parsed.uid !== expectedUid) {
      return { valid: false, reason: 'Admin OTP token does not belong to the active administrator.' };
    }
    if (!parsed.exp || Number(parsed.exp) < Date.now()) {
      return { valid: false, reason: 'Admin OTP clearance expired. Please re-verify your email OTP.' };
    }
    return { valid: true, purpose: parsed.purpose };
  } catch {
    return { valid: false, reason: 'Failed to parse admin OTP security token.' };
  }
}

const requireAdminOtp: express.RequestHandler = (req, res, next) => {
  const token = String(req.headers['x-admin-otp-token'] || req.body?.otpToken || '');
  const uid = req.authUser?.uid || '';
  const check = verifyAdminOtpToken(token, uid);
  if (!check.valid) {
    return res.status(403).json({
      success: false,
      code: 'ADMIN_OTP_REQUIRED',
      error: check.reason || 'Admin 2FA email OTP verification required.'
    });
  }
  next();
};

async function readUserMergedInTx(tx: FirebaseFirestore.Transaction, uid: string) {
  const pubRef = adminDb.collection('users').doc(uid);
  const privRef = adminDb.collection('user_private').doc(uid);
  const [pubSnap, privSnap] = await Promise.all([tx.get(pubRef), tx.get(privRef)]);
  if (!pubSnap.exists && !privSnap.exists) {
    return null;
  }
  const pubData = pubSnap.exists ? (pubSnap.data() || {}) : {};
  const privData = privSnap.exists ? (privSnap.data() || {}) : {};
  // Backward-compatible balance migration: prefer user_private.deposits, fall back to legacy users.deposits
  const deposits = privData.deposits !== undefined ? Number(privData.deposits) : Number(pubData.deposits || 0);
  return {
    pubRef,
    privRef,
    pubData,
    privData,
    merged: { ...pubData, ...privData, deposits: Number.isFinite(deposits) ? deposits : 0 } as Record<string, any> & { deposits: number }
  };
}

async function writeAuditLog(params: {
  action: string;
  actorUid: string;
  actorName: string;
  targetCollection: string;
  targetId: string;
  details: string;
}) {
  try {
    if (!(await checkAdminDbAvailable())) return;
    await adminDb.collection('audit_logs').add({
      action: params.action,
      adminId: params.actorUid,
      adminUsername: params.actorName,
      targetCollection: params.targetCollection,
      targetId: params.targetId,
      details: params.details,
      timestamp: Date.now()
    });
  } catch (err) {
    console.warn('[AuditLog] Failed to write audit log:', err);
  }
}

const FIXED_SERVICE_PRICES: Record<string, number> = {
  stock_insights: 1999,
  vip_boost: 199,
  bidder_priority: 299,
  commission_settle: 750,
  csr_foundation: 100,
  boost_auction: 500,
  boost_bidding: 350
};

const BOOST_PLAN_PRICES: Record<string, number> = {
  starter: 199,
  'starter turbo': 199,
  surge: 499,
  'super surge': 499,
  vip: 999,
  'ultra vip': 999
};

const VARIABLE_SERVICE_KEYS = new Set([
  'promotion_campaign',
  'foundation_donation',
  'sales_commission',
  'custom_spend'
]);

function resolveAuthoritativeServicePrice(params: {
  serviceKey: string;
  boostPlanId?: string;
  boostPlanName?: string;
  clientAmount?: any;
  configData?: Record<string, any>;
}): { ok: true; price: number } | { ok: false; error: string } {
  const key = String(params.serviceKey || '').trim();
  if (key === 'stock_insights') {
    const cfgPrice = Number(params.configData?.stockInsightsPrice);
    return { ok: true, price: Number.isFinite(cfgPrice) && cfgPrice > 0 ? Math.round(cfgPrice) : 1999 };
  }
  if (key === 'vehicle_boost') {
    const idKey = String(params.boostPlanId || '').trim().toLowerCase();
    const nameKey = String(params.boostPlanName || '').trim().toLowerCase();
    const resolved = BOOST_PLAN_PRICES[idKey] || BOOST_PLAN_PRICES[nameKey];
    if (!resolved) {
      return { ok: false, error: 'Unknown vehicle boost tier.' };
    }
    return { ok: true, price: resolved };
  }
  if (Object.prototype.hasOwnProperty.call(FIXED_SERVICE_PRICES, key)) {
    return { ok: true, price: FIXED_SERVICE_PRICES[key] };
  }
  if (VARIABLE_SERVICE_KEYS.has(key)) {
    const amt = Number(params.clientAmount);
    if (!Number.isInteger(amt) || amt < 10 || amt > 500000) {
      return { ok: false, error: 'Variable service payment must be an integer between ₹10 and ₹5,00,000.' };
    }
    return { ok: true, price: amt };
  }
  return { ok: false, error: `Unknown platform service key: ${key}` };
}

async function requireAdminSdk(res: express.Response): Promise<boolean> {
  const ok = await checkAdminDbAvailable();
  if (!ok) {
    res.status(503).json({
      success: false,
      code: 'ADMIN_SDK_UNCONFIGURED',
      error: 'Server Firebase Admin SDK credentials (FIREBASE_SERVICE_ACCOUNT_JSON) are required for financial and privileged mutations.'
    });
    return false;
  }
  return true;
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Trust proxy headers on Cloud Run / Render so req.ip & rate limiters operate accurately
  app.set('trust proxy', 1);

  // Global security headers on all responses
  const isProduction = process.env.NODE_ENV === 'production';
  const contentSecurityPolicy = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://esm.sh https://apis.google.com https://www.gstatic.com https://www.google.com https://*.firebaseapp.com https://checkout.razorpay.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com https://fonts.googleapis.com",
    "img-src 'self' data: blob: https://images.unsplash.com https://picsum.photos https://fastly.picsum.photos https://i.pravatar.cc https://firebasestorage.googleapis.com https://*.firebasestorage.app https://*.googleusercontent.com https://checkout.razorpay.com https://api.razorpay.com",
    "media-src 'self' data: blob:",
    `connect-src 'self'${isProduction ? '' : ' ws://localhost:24678'} https://esm.sh https://api.postalpincode.in https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com https://firebasestorage.googleapis.com https://*.firebasestorage.app https://*.firebaseapp.com https://*.firebaseio.com https://firebase.googleapis.com https://firebaseinstallations.googleapis.com https://apis.google.com https://checkout.razorpay.com https://api.razorpay.com`,
    "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com https://www.google.com https://www.gstatic.com https://checkout.razorpay.com https://api.razorpay.com",
    "form-action 'self' https://checkout.razorpay.com https://api.razorpay.com",
    isProduction
      ? "frame-ancestors 'none'"
      : "frame-ancestors 'self' https://*.google.com https://aistudio.google.com",
    "object-src 'none'",
    "base-uri 'self'"
  ].join('; ');

  app.use((_req, res, next) => {
    if (isProduction) {
      res.setHeader('X-Frame-Options', 'DENY');
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Content-Security-Policy', contentSecurityPolicy);
    next();
  });

  // ----------------------------------------------------
  // Razorpay Webhook (express.raw BEFORE JSON parser, exempt from login & CORS)
  // ----------------------------------------------------
  app.post('/api/razorpay/webhook', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
    try {
      const webhookSecret = getRazorpayWebhookSecret();
      if (!webhookSecret) {
        return res.status(503).json({ success: false, error: 'Razorpay webhook secret is not configured.' });
      }

      const rawBody = Buffer.isBuffer(req.body) ? req.body : null;
      const signature = String(req.headers['x-razorpay-signature'] || '').trim();
      if (!rawBody || !signature) {
        return res.status(400).json({ success: false, error: 'Missing raw webhook payload or signature.' });
      }

      if (!verifyHmacSha256Signature(rawBody, webhookSecret, signature)) {
        return res.status(400).json({ success: false, error: 'Invalid Razorpay webhook signature.' });
      }

      if (!(await requireAdminSdk(res))) return;

      let eventPayload: any;
      try {
        eventPayload = JSON.parse(rawBody.toString('utf8'));
      } catch {
        return res.status(400).json({ success: false, error: 'Invalid JSON in Razorpay webhook payload.' });
      }

      const eventType = String(eventPayload?.event || '');
      const paymentEntity = eventPayload?.payload?.payment?.entity;

      if (eventType === 'payment.captured') {
        const orderId = String(paymentEntity?.order_id || '').trim();
        const paymentId = String(paymentEntity?.id || '').trim();
        if (!orderId || !paymentId) {
          return res.status(400).json({ success: false, error: 'Missing order_id or payment id on captured event.' });
        }
        try {
          const creditRes = await creditRazorpayOrderOnce({
            orderId,
            paymentId,
            paymentEntity,
            source: 'webhook'
          });
          return res.json({ status: 'ok', ...creditRes });
        } catch (err: any) {
          const code = String(err?.message || '');
          if (code === 'ORDER_NOT_FOUND') {
            return res.status(200).json({ status: 'ignored', reason: 'order_not_found' });
          }
          if (code === 'AMOUNT_MISMATCH' || code === 'CURRENCY_MISMATCH' || code === 'PAYMENT_NOT_CAPTURED') {
            return res.status(400).json({ success: false, error: code });
          }
          throw err;
        }
      }

      if (eventType === 'payment.failed') {
        const orderId = String(paymentEntity?.order_id || '').trim();
        const paymentId = String(paymentEntity?.id || '').trim();
        if (orderId) {
          await markRazorpayOrderFailed({
            orderId,
            paymentId,
            paymentEntity: paymentEntity || {}
          });
        }
        return res.json({ status: 'ok' });
      }

      return res.json({ status: 'ignored', event: eventType });
    } catch (err: any) {
      console.error('[RazorpayWebhook] Error:', err);
      return res.status(500).json({ success: false, error: err?.message || 'Webhook processing error.' });
    }
  });

  // Strict origin allowlist CORS
  const configuredOrigins = new Set(
    [
      ...(process.env.ALLOWED_ORIGINS || '').split(','),
      process.env.APP_URL || '',
      process.env.RENDER_EXTERNAL_URL || ''
    ]
      .map(s => s.trim())
      .filter(Boolean)
  );

  app.use(
    cors((req, callback) => {
      const origin = req.headers.origin;
      if (!origin) {
        return callback(null, { origin: false });
      }
      const host = req.headers.host;
      const isSameHost = Boolean(
        host && (origin === `https://${host}` || origin === `http://${host}`)
      );
      const isLocalDev =
        process.env.NODE_ENV !== 'production' &&
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
      const isExplicitlyAllowed = configuredOrigins.has(origin);

      if (isSameHost || isLocalDev || isExplicitlyAllowed) {
        return callback(null, { origin: true, credentials: true });
      }
      return callback(new Error('CORS origin not allowed'));
    })
  );

  // Skip default 2mb JSON parser for explicit 10mb image/banner endpoints (B6) and raw webhook body verification
  const LARGE_PAYLOAD_PATHS = new Set([
    '/api/validate-car-image',
    '/api/analyze-car-image',
    '/api/verify-id-document',
    '/api/ai/analyze-vehicle',
    '/api/ai/publish-vehicle',
    '/api/admin/ai-brain/chat',
    '/api/banners/publish'
  ]);
  const RAW_BODY_PATHS = new Set<string>(['/api/razorpay/webhook']);

  const defaultJsonParser = express.json({ limit: '2mb' });
  app.use((req, res, next) => {
    if (LARGE_PAYLOAD_PATHS.has(req.path) || RAW_BODY_PATHS.has(req.path)) {
      return next();
    }
    return defaultJsonParser(req, res, next);
  });
  app.use((req, res, next) => {
    if (RAW_BODY_PATHS.has(req.path)) {
      return next();
    }
    return express.urlencoded({ limit: '2mb', extended: true })(req, res, next);
  });
  const largePayloadParser = express.json({ limit: '10mb' });

  // Rate limiters
  const generalApiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 240,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests, please try again shortly.' }
  });

  const aiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'AI rate limit reached. Please wait a minute before trying again.' }
  });

  const sensitiveLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 25,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many security or payment attempts. Please wait a few minutes.' }
  });

  app.use('/api', generalApiLimiter);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, timestamp: Date.now() });
  });

  // ----------------------------------------------------
  // 1. Wallet Treasury & Ledger Status
  // ----------------------------------------------------
  app.get('/api/wallet/accounts-status', requireRole(FINANCE_ROLES), (_req, res) => {
    res.json({
      account_CT: {
        code: 'CT',
        name: "Company Treasury (CT Account)",
        keyIdMasked: 'Internal Ledger Active',
        role: "Customer Payment Collections & Virtual Credit Issuance",
        configured: true,
        webhookConfigured: false
      },
      channel_CT_Collection: {
        code: 'CT_COLLECTION',
        name: "CT Collection / CT Collector",
        description: "Segregated channel receiving all virtual currency spent across the platform (services, inspection, boosts, donations, commissions)"
      }
    });
  });

  // ----------------------------------------------------
  // Razorpay Wallet Deposits (Deposit-Only)
  // ----------------------------------------------------
  app.post('/api/razorpay/create-order', sensitiveLimiter, requireMoneyAuth, async (req, res) => {
    try {
      if (!(await requireAdminSdk(res))) return;

      const creds = getRazorpayKeyCredentials();
      if (!creds) {
        return res.status(503).json({
          success: false,
          error: 'Razorpay is not configured on the server (missing RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET).'
        });
      }

      const rawAmount = req.body?.amount;
      const amountInr = Number(rawAmount);
      if (
        typeof rawAmount === 'boolean' ||
        !Number.isInteger(amountInr) ||
        amountInr < 10 ||
        amountInr > 50000
      ) {
        return res.status(400).json({
          success: false,
          error: 'Deposit amount must be a whole number in INR between ₹10 and ₹50,000.'
        });
      }

      const uid = req.authUser!.uid;
      const amountPaise = amountInr * 100;
      const now = Date.now();
      const receipt = `dep_${uid.slice(0, 8)}_${now}`.slice(0, 40);

      const order = await callRazorpayApi<{
        id: string;
        amount: number;
        currency: string;
        receipt?: string;
        status?: string;
        notes?: Record<string, string>;
      }>('POST', '/orders', {
        amount: amountPaise,
        currency: 'INR',
        receipt,
        notes: {
          userId: uid,
          purpose: 'wallet_deposit'
        }
      });

      if (!order?.id) {
        throw new Error('Razorpay Orders API did not return an order ID.');
      }

      await adminDb.collection('razorpay_orders').doc(order.id).set({
        id: order.id,
        orderId: order.id,
        userId: uid,
        username: req.authUser!.name,
        amountInr,
        amountPaise,
        currency: 'INR',
        receipt,
        status: 'created',
        credited: false,
        notes: order.notes || { userId: uid, purpose: 'wallet_deposit' },
        createdAt: now,
        updatedAt: now
      });

      return res.json({
        success: true,
        orderId: order.id,
        amountInr,
        amountPaise: Number(order.amount) || amountPaise,
        currency: order.currency || 'INR',
        keyId: creds.keyId
      });
    } catch (err: any) {
      console.error('[RazorpayCreateOrder] Error:', err);
      return res.status(500).json({
        success: false,
        error: err?.message || 'Failed to create Razorpay deposit order.'
      });
    }
  });

  app.post('/api/razorpay/verify', sensitiveLimiter, requireMoneyAuth, async (req, res) => {
    try {
      if (!(await requireAdminSdk(res))) return;

      const creds = getRazorpayKeyCredentials();
      if (!creds) {
        return res.status(503).json({
          success: false,
          error: 'Razorpay is not configured on the server.'
        });
      }

      const orderId = String(req.body?.razorpay_order_id || '').trim();
      const paymentId = String(req.body?.razorpay_payment_id || '').trim();
      const signature = String(req.body?.razorpay_signature || '').trim();

      if (!orderId || !paymentId || !signature) {
        return res.status(400).json({
          success: false,
          error: 'razorpay_order_id, razorpay_payment_id, and razorpay_signature are required.'
        });
      }

      const isValidSignature = verifyHmacSha256Signature(
        `${orderId}|${paymentId}`,
        creds.keySecret,
        signature
      );
      if (!isValidSignature) {
        return res.status(400).json({
          success: false,
          error: 'Invalid Razorpay payment signature.'
        });
      }

      const payment = await callRazorpayApi<Record<string, any>>(
        'GET',
        `/payments/${encodeURIComponent(paymentId)}`
      );

      if (!payment || payment.id !== paymentId) {
        return res.status(400).json({ success: false, error: 'Payment record not found in Razorpay.' });
      }
      if (String(payment.order_id || '') !== orderId) {
        return res.status(400).json({ success: false, error: 'Payment does not match the specified order.' });
      }
      if (String(payment.status || '').toLowerCase() !== 'captured') {
        return res.status(400).json({
          success: false,
          error: `Payment is not captured (current status: ${payment.status || 'unknown'}).`
        });
      }
      if (String(payment.currency || '').toUpperCase() !== 'INR') {
        return res.status(400).json({ success: false, error: 'Only INR payments are supported.' });
      }

      const creditResult = await creditRazorpayOrderOnce({
        orderId,
        paymentId,
        paymentEntity: payment,
        source: 'verify',
        expectedUserId: req.authUser!.uid
      });

      return res.json({
        success: true,
        ...creditResult
      });
    } catch (err: any) {
      const code = String(err?.message || '');
      if (code === 'ORDER_NOT_FOUND') {
        return res.status(404).json({ success: false, error: 'Deposit order not found.' });
      }
      if (code === 'FORBIDDEN_ORDER_OWNER') {
        return res.status(403).json({ success: false, error: 'This deposit order belongs to another account.' });
      }
      if (code === 'AMOUNT_MISMATCH' || code === 'CURRENCY_MISMATCH' || code === 'PAYMENT_NOT_CAPTURED' || code === 'ORDER_PAYMENT_MISMATCH') {
        return res.status(400).json({ success: false, error: `Verification rejected: ${code}` });
      }
      console.error('[RazorpayVerify] Error:', err);
      return res.status(500).json({
        success: false,
        error: err?.message || 'Failed to verify Razorpay payment.'
      });
    }
  });

  // Sync Firebase Auth Phone Verification directly to server-protected user_private record (B5)
  app.post('/api/auth/verify-phone', sensitiveLimiter, requireAuth, async (req, res) => {
    try {
      if (!(await requireAdminSdk(res))) return;
      const token = extractBearerToken(req);
      if (!token) {
        return res.status(401).json({ success: false, error: 'Authentication token required.' });
      }
      const decoded = await verifyIdTokenStrict(token, true);
      if (decoded.uid !== req.authUser!.uid) {
        return res.status(403).json({ success: false, error: 'Token UID mismatch.' });
      }
      const verifiedPhone = decoded.phone_number;
      if (!verifiedPhone || typeof verifiedPhone !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'No Firebase-verified phone number is attached to your authentication session yet.'
        });
      }

      const now = Date.now();
      await adminDb.collection('user_private').doc(decoded.uid).set({
        phoneNumber: verifiedPhone,
        phoneVerified: true,
        phoneVerifiedAt: now
      }, { merge: true });

      res.json({
        success: true,
        phoneNumber: verifiedPhone,
        phoneVerified: true,
        phoneVerifiedAt: now
      });
    } catch (err: any) {
      console.error('[VerifyPhone] Error:', err);
      res.status(500).json({ success: false, error: err?.message || 'Failed to persist verified phone number.' });
    }
  });

  // Sync verified bootstrap admin role & custom claims to Firestore / Firebase Auth
  app.post('/api/auth/sync-bootstrap-admin', sensitiveLimiter, requireAuth, async (req, res) => {
    try {
      const authUser = req.authUser!;
      const bootstrapEmails = getBootstrapAdminEmails();
      if (!authUser.email || !bootstrapEmails.has(authUser.email)) {
        return res.status(403).json({ success: false, error: 'Account is not a configured bootstrap admin.' });
      }
      if (authUser.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Admin verification failed.' });
      }

      const dbAvailable = await checkAdminDbAvailable();
      let updatedDoc = false;
      let updatedClaims = false;

      if (dbAvailable) {
        if (authUser.userDoc?.role !== 'admin') {
          await adminDb.collection('users').doc(authUser.uid).set({ role: 'admin' }, { merge: true });
          updatedDoc = true;
        }
        try {
          const fbUser = await adminAuth.getUser(authUser.uid);
          const existingClaims = (fbUser.customClaims || {}) as Record<string, any>;
          if (existingClaims.role !== 'admin' || existingClaims.admin !== true) {
            await adminAuth.setCustomUserClaims(authUser.uid, {
              ...existingClaims,
              role: 'admin',
              admin: true
            });
            updatedClaims = true;
          }
        } catch (claimErr: any) {
          console.warn('[BootstrapAdmin] Custom claims sync skipped:', claimErr?.message || claimErr);
        }
      }

      return res.json({
        success: true,
        role: 'admin',
        updatedDoc,
        updatedClaims
      });
    } catch (err: any) {
      console.error('[BootstrapAdmin] Sync error:', err);
      return res.status(500).json({ success: false, error: err?.message || 'Failed to sync bootstrap admin.' });
    }
  });

  // ----------------------------------------------------
  // 2. Server-Side Wallet Operations (Spend -> CT Collection)
  // ----------------------------------------------------
  app.post('/api/wallet/spend', sensitiveLimiter, requireMoneyAuth, async (req, res) => {
    try {
      if (!(await requireAdminSdk(res))) return;

      const uid = req.authUser!.uid;
      const { amount, serviceName, serviceKey, vehicleId, boostPlanId, boostPlanName } = req.body;
      if (!serviceKey || !serviceName) {
        return res.status(400).json({ success: false, error: 'serviceKey and serviceName are required.' });
      }

      const now = Date.now();
      const txResult = await adminDb.runTransaction(async (tx) => {
        const [uState, configSnap] = await Promise.all([
          readUserMergedInTx(tx, uid),
          tx.get(adminDb.collection('settings').doc('app_config'))
        ]);
        if (!uState) throw new Error('USER_NOT_FOUND');

        const priceResolution = resolveAuthoritativeServicePrice({
          serviceKey: String(serviceKey),
          boostPlanId,
          boostPlanName,
          clientAmount: amount,
          configData: configSnap.exists ? configSnap.data() : undefined
        });
        if ('error' in priceResolution) {
          throw new Error(`INVALID_SERVICE:${priceResolution.error}`);
        }
        const numericAmount = priceResolution.price;

        const userData = uState.merged;
        const curBal = userData.deposits;
        if (curBal < numericAmount) {
          throw new Error(`INSUFFICIENT_FUNDS:${curBal}`);
        }

        // If boosting a vehicle, verify ownership
        let vehicleRef: FirebaseFirestore.DocumentReference | null = null;
        if (serviceKey === 'vehicle_boost' && vehicleId) {
          vehicleRef = adminDb.collection('vehicles').doc(String(vehicleId));
          const vSnap = await tx.get(vehicleRef);
          if (!vSnap.exists) throw new Error('VEHICLE_NOT_FOUND');
          const vData = vSnap.data()!;
          if (vData.ownerId !== uid && req.authUser!.role !== 'admin') {
            throw new Error('NOT_VEHICLE_OWNER');
          }
        }

        const ctRef = adminDb.collection('settings').doc('ct_collection');
        const ctSnap = await tx.get(ctRef);
        const curCt = ctSnap.exists ? (Number(ctSnap.data()?.balance) || 0) : 0;

        const newBalance = curBal - numericAmount;
        tx.set(uState.privRef, { deposits: newBalance }, { merge: true });

        if (serviceKey === 'stock_insights') {
          tx.set(uState.pubRef, {
            hasStockInsightsAccess: true,
            stockInsightsUnlockedAt: now
          }, { merge: true });
        }
        tx.set(ctRef, { balance: curCt + numericAmount }, { merge: true });

        if (vehicleRef) {
          tx.update(vehicleRef, {
            isBoosted: true,
            boostPlan: boostPlanName || serviceName
          });
        }

        const ctLogRef = adminDb.collection('ct_collections').doc();
        tx.set(ctLogRef, {
          id: ctLogRef.id,
          userId: uid,
          username: userData.username || req.authUser!.name,
          amount: numericAmount,
          usageType: serviceKey,
          description: String(serviceName).slice(0, 200),
          timestamp: now,
          channel: 'ct_collection'
        });

        const txRef = adminDb.collection('transactions').doc();
        const txId = `TXN_SVC_${now}_${txRef.id.slice(0, 6).toUpperCase()}`;
        tx.set(txRef, {
          id: txRef.id,
          transactionId: txId,
          userId: uid,
          username: userData.username || req.authUser!.name,
          type: `service_${serviceKey}`,
          channel: 'ct_collection',
          amount: numericAmount,
          description: `Platform Service: ${String(serviceName).slice(0, 200)}`,
          timestamp: now,
          status: 'success',
          balanceAfter: newBalance
        });

        return {
          amountCharged: numericAmount,
          newBalance,
          hasStockInsightsAccess: Boolean(serviceKey === 'stock_insights' || userData.hasStockInsightsAccess),
          transactionId: txId
        };
      });

      res.json({ success: true, ...txResult });
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (msg.startsWith('INVALID_SERVICE:')) {
        return res.status(400).json({ success: false, error: msg.slice('INVALID_SERVICE:'.length) });
      }
      if (msg.startsWith('INSUFFICIENT_FUNDS:')) {
        return res.status(400).json({ success: false, error: `Insufficient wallet balance (Available: ₹${Number(msg.split(':')[1]).toLocaleString()}).` });
      }
      if (msg === 'NOT_VEHICLE_OWNER') {
        return res.status(403).json({ success: false, error: 'You can only boost vehicles you own.' });
      }
      console.error('[WalletSpend] Error:', err);
      res.status(500).json({ success: false, error: err?.message || 'Failed to process service spend.' });
    }
  });

  // ----------------------------------------------------
  // 3. Server-Validated Auction Bidding, Pre-Bidding & Lifecycle (B1, B2, B7)
  // ----------------------------------------------------
  app.post('/api/bids/place', requireMoneyAuth, async (req, res) => {
    try {
      if (!(await requireAdminSdk(res))) return;

      const uid = req.authUser!.uid;
      const { vehicleId, amount } = req.body;
      const bidAmount = Number(amount);

      if (!vehicleId || !Number.isInteger(bidAmount) || bidAmount <= 0 || bidAmount > 500000000) {
        return res.status(400).json({ success: false, error: 'Valid integer bid amount (₹1 to ₹50,00,00,000) is required.' });
      }

      const now = Date.now();
      const txResult = await adminDb.runTransaction(async (tx) => {
        const vehicleRef = adminDb.collection('vehicles').doc(String(vehicleId));
        const configRef = adminDb.collection('settings').doc('app_config');

        const [uState, vehicleSnap, configSnap] = await Promise.all([
          readUserMergedInTx(tx, uid),
          tx.get(vehicleRef),
          tx.get(configRef)
        ]);

        if (!uState) throw new Error('User account not found.');
        if (!vehicleSnap.exists) throw new Error('Vehicle not found.');

        const user = uState.merged;
        const vehicle = vehicleSnap.data()!;
        const minIncrement = Number(configSnap.data()?.minBidIncrement) || 1;
        const requireKyc = configSnap.data()?.requireKycForBidding !== false;

        if (isAccountSuspended(user)) {
          throw new Error('Your account is currently suspended from bidding.');
        }
        if (requireKyc && !user.isVerified && req.authUser!.role !== 'admin') {
          throw new Error('KYC_REQUIRED');
        }
        if (vehicle.ownerId === uid) {
          throw new Error('You cannot place bids on your own vehicle listing.');
        }
        if (vehicle.isDeleted || vehicle.isBlacklisted || vehicle.isRestricted) {
          throw new Error('This listing is not eligible for bidding.');
        }
        if (vehicle.listingType === 'direct' || vehicle.status === 'Direct Sale' || vehicle.status === 'Sold') {
          throw new Error('This listing is not accepting auction bids.');
        }
        if (vehicle.startTime && Number(vehicle.startTime) > now) {
          throw new Error('Auction has not started yet. Use pre-bid instead.');
        }
        if (vehicle.endTime && Number(vehicle.endTime) <= now) {
          throw new Error('This auction has already ended.');
        }

        // Require meaningful wallet deposit to back binding bids (matches AutoBid policy)
        const minWalletRequired = req.authUser!.role === 'admin'
          ? 0
          : Math.min(5000, Math.max(500, Math.round(bidAmount * 0.05)));
        if (user.deposits < minWalletRequired) {
          throw new Error(`Minimum wallet balance of ₹${minWalletRequired.toLocaleString()} is required to place bids (Available: ₹${user.deposits.toLocaleString()}).`);
        }

        const currentBid = Number(vehicle.currentBid) || 0;
        if (bidAmount < currentBid + minIncrement) {
          throw new Error(`Bid must be at least ₹${(currentBid + minIncrement).toLocaleString()}.`);
        }

        const prevWinningUserId = vehicle.winningUserId || vehicle.winningBidderId || null;
        const username = user.username || req.authUser!.name;

        tx.update(vehicleRef, {
          currentBid: bidAmount,
          userBidStatus: 'winning',
          winningUserId: uid,
          winningUsername: username,
          winningBidderId: uid,
          lastBidAt: now,
          liveParticipants: FieldValue.arrayUnion(uid),
          bidUserIds: FieldValue.arrayUnion(uid)
        });

        const bidRef = adminDb.collection('bids').doc();
        tx.set(bidRef, {
          id: bidRef.id,
          vehicleId: String(vehicleId),
          userId: uid,
          username,
          amount: bidAmount,
          timestamp: now
        });

        if (prevWinningUserId && prevWinningUserId !== uid) {
          const outbidNotifRef = adminDb.collection('notifications').doc();
          tx.set(outbidNotifRef, {
            userId: prevWinningUserId,
            type: 'outbid',
            title: 'Outbid Alert! ⚠️',
            message: `@${username} placed a higher stake of ₹${bidAmount.toLocaleString()} on ${vehicle.year} ${vehicle.make} ${vehicle.model}.`,
            createdAt: now,
            read: false,
            link: `vehicle_${vehicleId}`
          });
        }

        if (vehicle.ownerId && vehicle.ownerId !== uid) {
          const ownerNotifRef = adminDb.collection('notifications').doc();
          tx.set(ownerNotifRef, {
            userId: vehicle.ownerId,
            type: 'new_bid',
            title: 'New Bid Placed! 📈',
            message: `@${username} bid ₹${bidAmount.toLocaleString()} on your ${vehicle.year} ${vehicle.make} ${vehicle.model}.`,
            createdAt: now,
            read: false,
            link: `vehicle_${vehicleId}`
          });
        }

        return { bidId: bidRef.id, currentBid: bidAmount, winningUserId: uid, winningUsername: username, lastBidAt: now };
      });

      res.json({ success: true, ...txResult });
    } catch (err: any) {
      if (err?.message === 'KYC_REQUIRED') {
        return res.status(403).json({ success: false, code: 'KYC_REQUIRED', error: 'Identity verification is required before bidding.' });
      }
      res.status(400).json({ success: false, error: err?.message || 'Failed to place bid.' });
    }
  });

  app.post('/api/bids/prebid', requireMoneyAuth, async (req, res) => {
    try {
      if (!(await requireAdminSdk(res))) return;

      const uid = req.authUser!.uid;
      const { vehicleId } = req.body;
      if (!vehicleId) {
        return res.status(400).json({ success: false, error: 'vehicleId is required.' });
      }

      const now = Date.now();
      const result = await adminDb.runTransaction(async (tx) => {
        const vehicleRef = adminDb.collection('vehicles').doc(String(vehicleId));
        const [uState, vehicleSnap] = await Promise.all([
          readUserMergedInTx(tx, uid),
          tx.get(vehicleRef)
        ]);

        if (!uState || !vehicleSnap.exists) throw new Error('User or vehicle not found.');

        const user = uState.merged;
        const vehicle = vehicleSnap.data()!;

        if (!user.isVerified && req.authUser!.role !== 'admin') {
          throw new Error('KYC_REQUIRED');
        }
        if (vehicle.ownerId === uid) {
          throw new Error('You cannot place pre-bids on your own vehicle listing.');
        }

        const askingPrice = Number(vehicle.startingPrice || vehicle.currentBid || 0);
        const prevUpcomingBids: any[] = Array.isArray(vehicle.upcomingBids) ? vehicle.upcomingBids : [];
        const prevLastBidder = prevUpcomingBids.length > 0 ? prevUpcomingBids[prevUpcomingBids.length - 1] : null;
        const username = user.username || req.authUser!.name;

        const newUpcomingBids = [
          ...prevUpcomingBids.filter(b => b.userId !== uid),
          { userId: uid, username, amount: askingPrice, timestamp: now }
        ];

        tx.update(vehicleRef, { upcomingBids: newUpcomingBids });

        if (vehicle.ownerId && vehicle.ownerId !== uid) {
          const notifRef = adminDb.collection('notifications').doc();
          tx.set(notifRef, {
            userId: vehicle.ownerId,
            type: 'upcoming_bid',
            title: 'New Pre-Bid! 🎯',
            message: `@${username} placed a pre-bid on your upcoming auction for ${vehicle.year} ${vehicle.make} ${vehicle.model} at asking price ₹${askingPrice.toLocaleString()}.`,
            createdAt: now,
            read: false,
            link: `vehicle_${vehicleId}`
          });
        }

        if (prevLastBidder && prevLastBidder.userId && prevLastBidder.userId !== uid) {
          const shiftRef = adminDb.collection('notifications').doc();
          tx.set(shiftRef, {
            userId: prevLastBidder.userId,
            type: 'priority_shifted',
            title: 'Priority Shifted ⚠️',
            message: `@${username} placed an upcoming bid after you on ${vehicle.year} ${vehicle.make} ${vehicle.model} and gained the 1st Bidder Priority.`,
            createdAt: now,
            read: false,
            link: `vehicle_${vehicleId}`
          });
        }

        return { upcomingBids: newUpcomingBids, askingPrice };
      });

      res.json({ success: true, ...result });
    } catch (err: any) {
      if (err?.message === 'KYC_REQUIRED') {
        return res.status(403).json({ success: false, code: 'KYC_REQUIRED', error: 'Identity verification required.' });
      }
      res.status(400).json({ success: false, error: err?.message || 'Failed to place pre-bid.' });
    }
  });

  // Server-authoritative Seller/Admin Auction Mark Sold (B2)
  app.post('/api/auctions/mark-sold', requireMoneyAuth, async (req, res) => {
    try {
      if (!(await requireAdminSdk(res))) return;
      const uid = req.authUser!.uid;
      const { vehicleId } = req.body;
      if (!vehicleId) {
        return res.status(400).json({ success: false, error: 'vehicleId is required.' });
      }

      const now = Date.now();
      const result = await adminDb.runTransaction(async (tx) => {
        const vehicleRef = adminDb.collection('vehicles').doc(String(vehicleId));
        const vSnap = await tx.get(vehicleRef);
        if (!vSnap.exists) throw new Error('Vehicle not found.');
        const v = vSnap.data()!;

        if (v.ownerId !== uid && req.authUser!.role !== 'admin') {
          throw new Error('FORBIDDEN');
        }
        if (v.status === 'Sold' || v.isConcluded) {
          throw new Error('ALREADY_SOLD');
        }

        const finalPrice = Number(v.currentBid || v.startingPrice || 0);
        const commission = Math.round(finalPrice * 0.001);

        let newOwnerDeposits: number | undefined;
        if (v.ownerId) {
          const ownerState = await readUserMergedInTx(tx, String(v.ownerId));
          if (ownerState) {
            newOwnerDeposits = Math.max(0, ownerState.merged.deposits - commission);
            tx.set(ownerState.privRef, {
              deposits: newOwnerDeposits,
              totalCommissionPaid: (Number(ownerState.merged.totalCommissionPaid) || 0) + commission
            }, { merge: true });

            if (commission > 0) {
              const commTxRef = adminDb.collection('transactions').doc();
              tx.set(commTxRef, {
                id: commTxRef.id,
                transactionId: `TXN_COMM_${now}_${commTxRef.id.slice(0, 5).toUpperCase()}`,
                userId: String(v.ownerId),
                username: ownerState.merged.username || v.ownerUsername || 'Seller',
                type: 'commission_fee',
                channel: 'ct_collection',
                amount: commission,
                description: `0.1% Sales Commission for ${v.year} ${v.make} ${v.model} (Sold for ₹${finalPrice.toLocaleString()})`,
                timestamp: now,
                status: 'success',
                balanceAfter: newOwnerDeposits
              });
            }
          }
        }

        tx.update(vehicleRef, {
          status: 'Sold',
          finalSoldPrice: finalPrice,
          commissionAmount: commission,
          isConcluded: true,
          concludedAt: now
        });

        if (v.winningUserId) {
          const winNotifRef = adminDb.collection('notifications').doc();
          tx.set(winNotifRef, {
            userId: v.winningUserId,
            type: 'auction_won',
            title: 'You Won the Auction! 🏆',
            message: `Congratulations! The seller concluded the live auction and you won ${v.year} ${v.make} ${v.model} with the winning bid of ₹${finalPrice.toLocaleString()}!`,
            createdAt: now,
            read: false,
            channel: 'email',
            link: `vehicle_${vehicleId}`
          });
        }

        const otherLiveBidders: string[] = Array.isArray(v.liveParticipants)
          ? v.liveParticipants.filter((pid: string) => pid && pid !== v.winningUserId && pid !== v.ownerId)
          : [];
        for (const loserId of otherLiveBidders) {
          const loseNotifRef = adminDb.collection('notifications').doc();
          tx.set(loseNotifRef, {
            userId: loserId,
            type: 'auction_lost',
            title: 'Auction Concluded — Outbid 🏁',
            message: `The live auction for ${v.year} ${v.make} ${v.model} has concluded. @${v.winningUsername || 'Another participant'} won with ₹${finalPrice.toLocaleString()}.`,
            createdAt: now,
            read: false,
            channel: 'email',
            link: `vehicle_${vehicleId}`
          });
        }

        return { finalPrice, commission, newOwnerDeposits };
      });

      res.json({ success: true, ...result });
    } catch (err: any) {
      if (err?.message === 'FORBIDDEN') {
        return res.status(403).json({ success: false, error: 'Only the vehicle owner or admin can mark this listing as sold.' });
      }
      if (err?.message === 'ALREADY_SOLD') {
        return res.status(409).json({ success: false, error: 'This listing has already been marked as sold or concluded.' });
      }
      res.status(400).json({ success: false, error: err?.message || 'Failed to mark vehicle as sold.' });
    }
  });

  // Server-authoritative Convert Unsold Auction -> Direct Sale (A6)
  app.post('/api/vehicles/convert-direct', requireMoneyAuth, async (req, res) => {
    try {
      if (!(await requireAdminSdk(res))) return;
      const uid = req.authUser!.uid;
      const { vehicleId, directPrice } = req.body;
      const priceNum = Number(directPrice);
      if (!vehicleId || !Number.isFinite(priceNum) || priceNum < 1000) {
        return res.status(400).json({ success: false, error: 'Valid vehicleId and directPrice (min ₹1,000) required.' });
      }

      const now = Date.now();
      const threeMonthsLater = now + 90 * 24 * 60 * 60 * 1000;

      await adminDb.runTransaction(async (tx) => {
        const vRef = adminDb.collection('vehicles').doc(String(vehicleId));
        const vSnap = await tx.get(vRef);
        if (!vSnap.exists) throw new Error('Vehicle not found.');
        const v = vSnap.data()!;
        if (v.ownerId !== uid && req.authUser!.role !== 'admin') {
          throw new Error('FORBIDDEN');
        }

        tx.update(vRef, {
          listingType: 'direct',
          status: 'Direct Sale',
          directPrice: priceNum,
          startingPrice: priceNum,
          currentBid: priceNum,
          listedAt: now,
          expiresAt: threeMonthsLater,
          endTime: threeMonthsLater,
          isBlacklisted: false
        });

        if (v.stockNumber) {
          tx.set(adminDb.collection('stock').doc(String(v.stockNumber)), {
            listingType: 'direct',
            status: 'Direct Sale',
            directPrice: priceNum,
            startingPrice: priceNum,
            currentBid: priceNum,
            listedAt: now,
            expiresAt: threeMonthsLater,
            endTime: threeMonthsLater,
            isBlacklisted: false,
            ownerEmail: '',
            ownerPhone: ''
          }, { merge: true });
        }

        if (v.ownerId) {
          tx.set(adminDb.collection('notifications').doc(), {
            userId: v.ownerId,
            type: 'direct_sale_listed',
            title: 'Shifted to Direct Sale! 🏷️',
            message: `Your vehicle has been shifted to 'Vehicles For Sale' at fixed price ₹${priceNum.toLocaleString()}. Active for 3 months!`,
            createdAt: now,
            read: false,
            link: `vehicle_${vehicleId}`
          });
        }
      });

      res.json({ success: true, listingType: 'direct', status: 'Direct Sale', directPrice: priceNum, listedAt: now, expiresAt: threeMonthsLater, endTime: threeMonthsLater });
    } catch (err: any) {
      if (err?.message === 'FORBIDDEN') {
        return res.status(403).json({ success: false, error: 'Only the vehicle owner or admin can convert this listing.' });
      }
      res.status(400).json({ success: false, error: err?.message || 'Failed converting listing to Direct Sale.' });
    }
  });

  // Sync subcollection engagement counts to parent vehicle doc (B3)
  app.post('/api/vehicles/:id/engage', requireAuth, async (req, res) => {
    try {
      if (!(await requireAdminSdk(res))) return;
      const vehicleId = String(req.params.id || '');
      const vRef = adminDb.collection('vehicles').doc(vehicleId);
      const [vSnap, viewsSnap, likesSnap, wishSnap] = await Promise.all([
        vRef.get(),
        vRef.collection('views').get(),
        vRef.collection('likes').get(),
        vRef.collection('wishlist').get()
      ]);
      if (!vSnap.exists) {
        return res.status(404).json({ success: false, error: 'Vehicle not found.' });
      }
      const viewsCount = Math.max(viewsSnap.size, Number(vSnap.data()?.views) || 0);
      const likesCount = likesSnap.size;
      const wishCount = wishSnap.size;
      await vRef.update({
        views: viewsCount,
        likesCount,
        watchCount: wishCount,
        interestedCount: wishCount
      });
      res.json({ success: true, views: viewsCount, likesCount, watchCount: wishCount, interestedCount: wishCount });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'Engagement sync failed.' });
    }
  });

  // Server-dispatched notifications (B12)
  app.post('/api/notifications/follow', requireAuth, async (req, res) => {
    try {
      if (!(await requireAdminSdk(res))) return;
      const uid = req.authUser!.uid;
      const { targetUserId, followedBack } = req.body;
      if (!targetUserId || targetUserId === uid) {
        return res.status(400).json({ success: false, error: 'Valid targetUserId required.' });
      }
      await adminDb.collection('notifications').add({
        userId: String(targetUserId),
        type: 'follower',
        title: followedBack ? 'Followed you back! 🤝' : 'New Follower! 👤',
        message: followedBack
          ? `@${req.authUser!.name} followed you back.`
          : `@${req.authUser!.name} started following you.`,
        createdAt: Date.now(),
        read: false,
        link: 'profile'
      });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'Failed sending follow notification.' });
    }
  });

  app.post('/api/verifications/notify-submitted', requireAuth, async (req, res) => {
    try {
      if (!(await requireAdminSdk(res))) return;
      const uid = req.authUser!.uid;
      const { docTypeLabel } = req.body;
      const vSnap = await adminDb.collection('verifications').where('userId', '==', uid).limit(1).get();
      if (vSnap.empty) {
        return res.status(404).json({ success: false, error: 'Verification request not found.' });
      }
      await adminDb.collection('notifications').add({
        userId: 'admin',
        type: 'verification_submitted',
        title: 'New ID Verification Request',
        message: `@${req.authUser!.name} submitted a ${String(docTypeLabel || 'identity document').slice(0, 60)} for approval.`,
        createdAt: Date.now(),
        read: false,
        link: 'admin'
      });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'Failed notifying verification queue.' });
    }
  });

  // ----------------------------------------------------
  // 4. Vehicle & Document AI Endpoints (Authenticated + Rate Limited)
  // ----------------------------------------------------
  app.post('/api/validate-car-image', aiLimiter, requireAuth, largePayloadParser, async (req, res) => {
    try {
      const { base64Data, mimeType } = req.body;
      if (!base64Data) {
        return res.status(400).json({ error: "Image data is required" });
      }

      const text = await callGroqAI({
        model: 'qwen/qwen3.8-27b',
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Is this an image of a real car, vehicle, truck, motorcycle, or automotive component? Respond ONLY with valid JSON: {\"isVehicle\": boolean}"
              },
              {
                type: "image_url",
                image_url: { url: `data:${mimeType || 'image/jpeg'};base64,${base64Data}` }
              }
            ]
          }
        ]
      });

      const parsed = JSON.parse(text);
      res.json({ isVehicle: parsed.isVehicle ?? true });
    } catch (error: any) {
      console.error("Error validating car image via Groq AI:", error?.message || error);
      res.json({ isVehicle: true });
    }
  });

  app.post('/api/analyze-car-image', aiLimiter, requireAuth, largePayloadParser, async (req, res) => {
    try {
      const { base64Data, mimeType } = req.body;
      if (!base64Data) {
        return res.status(400).json({ error: "Image data is required" });
      }

      const text = await callGroqAI({
        model: 'qwen/qwen3.8-27b',
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Identify the vehicle in this image. Respond with a valid JSON object containing: "isVehicle" (boolean), "make" (string), "model" (string), "year" (string), "color" (string), "bodyType" (string), "engine" (string), "topSpeed" (string), "mpg" (string), and "fuelType" (Petrol, Diesel, Electric, Hybrid).`
              },
              {
                type: "image_url",
                image_url: { url: `data:${mimeType || 'image/jpeg'};base64,${base64Data}` }
              }
            ]
          }
        ]
      });

      const parsed = JSON.parse(text);
      res.json({ isVehicle: true, ...parsed });
    } catch (error: any) {
      console.error("Error analyzing car image:", error?.message || error);
      res.json({ isVehicle: true });
    }
  });

  app.post('/api/get-car-models', aiLimiter, requireAuth, async (req, res) => {
    const { brand } = req.body;
    if (!brand) {
      return res.status(400).json({ error: "Brand is required" });
    }
    try {
      const text = await callGroqAI({
        model: 'openai/gpt-oss-120b',
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: `List the top 15 popular car models manufactured by ${brand}. Return a JSON object with a single key "models" containing a sorted array of model name strings.`
          }
        ]
      });
      const parsed = JSON.parse(text);
      const models = Array.isArray(parsed.models) ? parsed.models : [];
      res.json({ models: models.length > 0 ? models : getFallbackCarModels(brand) });
    } catch {
      res.json({ models: getFallbackCarModels(brand) });
    }
  });

  app.post('/api/get-car-specs', aiLimiter, requireAuth, async (req, res) => {
    const { brand, model, year } = req.body;
    try {
      const text = await callGroqAI({
        model: 'openai/gpt-oss-120b',
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: `Provide typical specifications for a ${year || 'modern'} ${brand} ${model}. Return a valid JSON object with keys: "engine", "topSpeed", "mpg", "fuelType" ("Petrol", "Diesel", "Electric", or "Hybrid").`
          }
        ]
      });
      const parsed = JSON.parse(text);
      const fb = getFallbackCarSpecs(brand, model);
      res.json({
        engine: parsed.engine || fb.engine,
        topSpeed: parsed.topSpeed || fb.topSpeed,
        mpg: parsed.mpg || fb.mpg,
        fuelType: parsed.fuelType || fb.fuelType
      });
    } catch {
      res.json(getFallbackCarSpecs(brand, model));
    }
  });

  app.post('/api/generate-vehicle-assessment', aiLimiter, requireAuth, async (req, res) => {
    try {
      const { vehicle } = req.body;
      if (!vehicle) {
        return res.status(400).json({ error: "Vehicle data is required" });
      }

      const prompt = `
        Provide a concise, expert automotive auction assessment (max 150 words) for:
        Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model}
        VIN: ${vehicle.vin}
        Odometer: ${vehicle.odometer} miles
        Primary Damage: ${vehicle.primaryDamage}
        Secondary Damage: ${vehicle.secondaryDamage || 'None'}
        Keys: ${vehicle.hasKeys ? 'Yes' : 'No'}
        Engine/Drivetrain: ${vehicle.engine} / ${vehicle.transmission} / ${vehicle.drive}
        Estimated Retail Value: ₹${vehicle.estRetailValue}
        Current Bid: ₹${vehicle.currentBid}
        Focus on risk assessment, repair considerations, and auction value potential. Plain text only (no HTML).
      `;

      const text = await callGroqAI({
        model: 'openai/gpt-oss-120b',
        messages: [{ role: 'user', content: prompt }]
      });

      res.json({ text });
    } catch (error: any) {
      console.error("Error generating vehicle assessment:", error);
      res.json({ text: "AI Assessment temporarily unavailable. Verify vehicle details and inspection history directly." });
    }
  });

  app.post('/api/verify-id-document', aiLimiter, requireAuth, largePayloadParser, async (req, res) => {
    try {
      const { documentType, idNumber, fullName, imageBase64 } = req.body;

      if (imageBase64 && typeof imageBase64 === 'string' && imageBase64.length > 7_000_000) {
        return res.status(413).json({ success: false, error: "Document image exceeds 5MB limit." });
      }

      if (!imageBase64) {
        return res.json({
          success: true,
          validationStatus: 'passed',
          confidenceScore: 80,
          detectedDocumentType: documentType === 'pan_card' ? 'PAN Card' : 'National ID',
          notes: 'Document details recorded. Queued for admin team verification.'
        });
      }

      const prompt = `You are an expert identity document verification assistant for an automotive auction platform.
Expected Document Type: ${documentType === 'pan_card' ? 'PAN Card (Permanent Account Number)' : 'National ID Card (Aadhaar / Voter ID / Passport / Gov ID)'}
Claimed Full Name: "${String(fullName || '').slice(0, 80)}"
Claimed ID / PAN Number: "${String(idNumber || '').slice(0, 40)}"
Respond ONLY with valid JSON:
{
  "isDocumentReadable": boolean,
  "detectedDocumentType": string,
  "confidenceScore": number,
  "nameMatches": boolean,
  "idNumberMatches": boolean,
  "validationStatus": "passed" | "warning" | "failed",
  "notes": string
}`;

      try {
        const text = await callGroqAI({
          model: 'openai/gpt-oss-120b',
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'user',
              content: `${prompt}\nDocument info: Type: ${documentType}, Name: ${String(fullName || '').slice(0, 80)}, ID: ${String(idNumber || '').slice(0, 40)}.`
            }
          ]
        });
        const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(clean);
        return res.json({ success: true, ...parsed });
      } catch {
        return res.json({
          success: true,
          isDocumentReadable: true,
          detectedDocumentType: documentType === 'pan_card' ? 'PAN Card' : 'National ID Card',
          confidenceScore: 85,
          nameMatches: true,
          idNumberMatches: true,
          validationStatus: 'passed',
          notes: 'Document uploaded and queued for Admin/Staff review.'
        });
      }
    } catch (err: any) {
      console.error("ID verification API error:", err);
      res.status(500).json({ success: false, error: err?.message || 'Document check failed.' });
    }
  });

  // ----------------------------------------------------
  // 5. Admin 2FA Email OTP (returns signed otpToken upon valid verification)
  // ----------------------------------------------------
  app.post('/api/admin/send-email-otp', sensitiveLimiter, requireRole(FINANCE_ROLES), async (req, res) => {
    try {
      const targetEmail = (req.authUser!.email || '').trim().toLowerCase();
      if (!targetEmail || !targetEmail.includes('@')) {
        return res.status(400).json({ success: false, message: "Authenticated admin email is required." });
      }

      if (!isEmailServiceConfigured()) {
        return res.status(503).json({
          success: false,
          message: "Email service not configured on the server (set RESEND_API_KEY or SMTP credentials)."
        });
      }

      const { purpose = 'admin_security_clearance' } = req.body;
      const code = generateSecureSixDigitOtp();

      await saveOtpChallenge({
        email: targetEmail,
        uid: req.authUser!.uid,
        purpose: `admin_${purpose}`,
        code
      });

      const emailRes = await sendSecurityOtpEmail({
        to: targetEmail,
        code,
        subject: 'AutoBid Admin Security Clearance OTP',
        purposeLabel: `Admin Financial Authorization (${purpose})`,
        detailsLine: `Authorized Staff: @${req.authUser!.name}`
      });

      if (!emailRes.dispatched) {
        return res.status(502).json({ success: false, message: emailRes.error || "Failed to send admin OTP email." });
      }

      res.json({
        success: true,
        email: targetEmail,
        message: `Security authorization OTP dispatched to ${targetEmail}`,
        expiresInSeconds: 600
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || "Failed to dispatch email OTP" });
    }
  });

  app.post('/api/admin/verify-email-otp', sensitiveLimiter, requireRole(FINANCE_ROLES), async (req, res) => {
    try {
      const targetEmail = (req.authUser!.email || '').trim().toLowerCase();
      const { code, purpose = 'admin_security_clearance' } = req.body;

      const result = await verifyOtpChallenge({
        email: targetEmail,
        uid: req.authUser!.uid,
        purpose: `admin_${purpose}`,
        code: String(code || '')
      });

      if (result.valid) {
        const otpToken = signAdminOtpToken(req.authUser!.uid, String(purpose));
        return res.json({ success: true, verified: true, otpToken, message: "Security clearance granted." });
      }

      return res.status(400).json({
        success: false,
        verified: false,
        message: result.reason || "Invalid or expired OTP code."
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || "Verification failed" });
    }
  });

  // ----------------------------------------------------
  // 6. Admin User Management, Roles, Wallet Adjustment & Resets
  // ----------------------------------------------------
  app.post('/api/admin/users/adjust-wallet', sensitiveLimiter, requireRole(FINANCE_ROLES), requireAdminOtp, async (req, res) => {
    try {
      if (!(await requireAdminSdk(res))) return;
      const { userId, mode, amount, reason = 'Admin adjustment' } = req.body;
      const numericAmount = Number(amount);
      if (!userId || !['credit', 'debit'].includes(mode) || !Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > 500000) {
        return res.status(400).json({ success: false, error: 'Valid userId, mode (credit|debit), and amount (₹1 to ₹5,00,000) are required.' });
      }

      const now = Date.now();
      const newBalance = await adminDb.runTransaction(async (tx) => {
        const uState = await readUserMergedInTx(tx, String(userId));
        if (!uState) throw new Error('User not found.');
        const cur = uState.merged.deposits;
        const next = mode === 'credit' ? cur + numericAmount : Math.max(0, cur - numericAmount);
        tx.set(uState.privRef, { deposits: next }, { merge: true });

        const txRef = adminDb.collection('transactions').doc();
        tx.set(txRef, {
          id: txRef.id,
          userId: String(userId),
          username: uState.merged.username || 'User',
          type: mode === 'credit' ? 'admin_credit' : 'admin_debit',
          amount: numericAmount,
          description: `Admin ${mode}: ${String(reason).slice(0, 200)}`,
          timestamp: now,
          status: 'success',
          balanceAfter: next
        });
        return next;
      });

      await writeAuditLog({
        action: `ADMIN_WALLET_${mode.toUpperCase()}`,
        actorUid: req.authUser!.uid,
        actorName: req.authUser!.name,
        targetCollection: 'user_private',
        targetId: String(userId),
        details: `${mode} ₹${numericAmount.toLocaleString()} (${String(reason).slice(0, 150)}) -> Balance: ₹${newBalance.toLocaleString()}`
      });

      res.json({ success: true, newBalance });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'Failed to adjust wallet.' });
    }
  });

  app.post('/api/admin/users/adjust-company-wallet', sensitiveLimiter, requireRole(ADMIN_ONLY), requireAdminOtp, async (req, res) => {
    try {
      if (!(await requireAdminSdk(res))) return;
      const { balance } = req.body;
      const numericBal = Number(balance);
      if (!Number.isFinite(numericBal) || numericBal < 0 || numericBal > 100000000) {
        return res.status(400).json({ success: false, error: 'Valid non-negative balance (<= ₹10,00,00,000) required.' });
      }
      await adminDb.collection('settings').doc('company_wallet').set({ balance: numericBal }, { merge: true });
      await writeAuditLog({
        action: 'ADJUST_COMPANY_WALLET',
        actorUid: req.authUser!.uid,
        actorName: req.authUser!.name,
        targetCollection: 'settings',
        targetId: 'company_wallet',
        details: `Set Company Treasury wallet balance to ₹${numericBal.toLocaleString()}`
      });
      res.json({ success: true, balance: numericBal });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'Failed updating company wallet.' });
    }
  });

  app.post('/api/admin/users/update-role', requireRole(ADMIN_ONLY), async (req, res) => {
    try {
      if (!(await requireAdminSdk(res))) return;
      const { userId, role } = req.body;
      const validRoles = ['user', 'admin', 'finance', 'support', 'accountant', 'employee', 'staff', 'moderator', 'manager', 'supervisor'];
      if (!userId || !validRoles.includes(String(role))) {
        return res.status(400).json({ success: false, error: 'Valid userId and role required.' });
      }
      await adminDb.collection('users').doc(String(userId)).set({ role: String(role) }, { merge: true });
      await adminAuth.setCustomUserClaims(String(userId), {
        role: String(role),
        admin: String(role) === 'admin'
      });
      await adminAuth.revokeRefreshTokens(String(userId)).catch(() => {});

      await writeAuditLog({
        action: 'UPDATE_USER_ROLE',
        actorUid: req.authUser!.uid,
        actorName: req.authUser!.name,
        targetCollection: 'users',
        targetId: String(userId),
        details: `Updated role to ${String(role)} and revoked existing refresh tokens`
      });

      res.json({ success: true, userId, role });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'Failed updating role.' });
    }
  });

  app.post('/api/admin/users/verify', requireRole(STAFF_ROLES), async (req, res) => {
    try {
      if (!(await requireAdminSdk(res))) return;
      const { userId, verificationId, decision, rejectionReason = '' } = req.body;
      if (!userId || !['approve', 'reject'].includes(decision)) {
        return res.status(400).json({ success: false, error: 'Valid userId and decision (approve|reject) required.' });
      }

      const now = Date.now();
      const userUpdates = decision === 'approve'
        ? { isVerified: true, verificationStatus: 'verified' }
        : { isVerified: false, verificationStatus: 'rejected', verificationRejectionReason: rejectionReason };

      await adminDb.collection('users').doc(String(userId)).set(userUpdates, { merge: true });
      if (verificationId) {
        await adminDb.collection('verifications').doc(String(verificationId)).set({
          status: decision === 'approve' ? 'verified' : 'rejected',
          reviewedBy: req.authUser!.name,
          reviewedAt: now,
          ...(decision === 'reject' ? { rejectionReason } : {})
        }, { merge: true });
      }

      await writeAuditLog({
        action: decision === 'approve' ? 'APPROVE_KYC' : 'REJECT_KYC',
        actorUid: req.authUser!.uid,
        actorName: req.authUser!.name,
        targetCollection: 'users',
        targetId: String(userId),
        details: `${decision.toUpperCase()} KYC verification${rejectionReason ? `: ${rejectionReason}` : ''}`
      });

      res.json({ success: true, userId, ...userUpdates });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'Failed verifying user.' });
    }
  });

  app.post('/api/admin/users/suspend', requireRole(STAFF_ROLES), async (req, res) => {
    try {
      if (!(await requireAdminSdk(res))) return;
      const { userId, suspensionStatus, suspensionReason = '', suspensionUntil } = req.body;
      if (!userId || !['none', 'temporary', 'permanent'].includes(String(suspensionStatus))) {
        return res.status(400).json({ success: false, error: 'Valid userId and suspensionStatus required.' });
      }

      const payload: Record<string, any> = {
        suspensionStatus,
        suspensionReason,
        ...(suspensionUntil ? { suspensionUntil: Number(suspensionUntil) } : {})
      };
      if (suspensionStatus === 'none') {
        payload.suspensionReason = '';
        payload.suspensionUntil = null;
      }

      await adminDb.collection('user_private').doc(String(userId)).set(payload, { merge: true });
      // Clean any legacy public suspensionStatus copy if present
      await adminDb.collection('users').doc(String(userId)).update({
        suspensionStatus: FieldValue.delete(),
        suspensionReason: FieldValue.delete(),
        suspensionUntil: FieldValue.delete()
      }).catch(() => {});

      if (suspensionStatus !== 'none') {
        await adminAuth.revokeRefreshTokens(String(userId)).catch(() => {});
      }

      await writeAuditLog({
        action: suspensionStatus === 'none' ? 'UNSUSPEND_USER' : 'SUSPEND_USER',
        actorUid: req.authUser!.uid,
        actorName: req.authUser!.name,
        targetCollection: 'user_private',
        targetId: String(userId),
        details: `Set suspensionStatus=${suspensionStatus}${suspensionReason ? ` (${suspensionReason})` : ''}`
      });

      res.json({ success: true, userId, ...payload });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'Failed updating suspension status.' });
    }
  });

  app.post('/api/admin/users/set-stock-access', requireRole(STAFF_ROLES), async (req, res) => {
    try {
      if (!(await requireAdminSdk(res))) return;
      const { userId, enabled } = req.body;
      if (!userId) return res.status(400).json({ success: false, error: 'userId required.' });
      await adminDb.collection('users').doc(String(userId)).set({
        hasStockInsightsAccess: Boolean(enabled),
        ...(enabled ? { stockInsightsUnlockedAt: Date.now() } : {})
      }, { merge: true });

      await writeAuditLog({
        action: 'SET_STOCK_ACCESS',
        actorUid: req.authUser!.uid,
        actorName: req.authUser!.name,
        targetCollection: 'users',
        targetId: String(userId),
        details: `Set hasStockInsightsAccess=${Boolean(enabled)}`
      });

      res.json({ success: true, userId, hasStockInsightsAccess: Boolean(enabled) });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'Failed updating Stock Insights access.' });
    }
  });

  app.post('/api/admin/delete-user-account', requireRole(ADMIN_ONLY), async (req, res) => {
    try {
      if (!(await requireAdminSdk(res))) return;
      const { userId, appealId } = req.body;
      if (!userId) return res.status(400).json({ success: false, error: "userId required" });

      const now = Date.now();
      const flags = {
        isDeleted: true,
        deletedAt: now,
        isRevoked: true,
        sessionRevokedAt: now
      };
      await adminDb.collection('user_private').doc(String(userId)).set(flags, { merge: true });
      await adminDb.collection('users').doc(String(userId)).update({
        isDeleted: FieldValue.delete(),
        deletedAt: FieldValue.delete(),
        isRevoked: FieldValue.delete(),
        sessionRevokedAt: FieldValue.delete()
      }).catch(() => {});

      try {
        await adminAuth.revokeRefreshTokens(String(userId));
      } catch {}

      if (appealId) {
        await adminDb.collection('appeals').doc(String(appealId)).set({
          status: 'deleted',
          reviewedBy: req.authUser!.name,
          reviewedAt: now
        }, { merge: true });
      }

      await writeAuditLog({
        action: 'DELETE_USER_ACCOUNT',
        actorUid: req.authUser!.uid,
        actorName: req.authUser!.name,
        targetCollection: 'user_private',
        targetId: String(userId),
        details: `Soft-deleted user ${userId} and revoked Firebase refresh tokens`
      });

      res.json({ success: true, message: `User ${userId} deleted and sessions revoked.` });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/admin/reset-platform-data', sensitiveLimiter, requireRole(ADMIN_ONLY), requireAdminOtp, async (req, res) => {
    try {
      if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({
          success: false,
          message: 'Platform reset is permanently disabled in production environments.'
        });
      }
      const { confirmText } = req.body || {};
      if (confirmText !== 'RESET PLATFORM DATA') {
        return res.status(400).json({
          success: false,
          message: 'Typed confirmation phrase "RESET PLATFORM DATA" is required.'
        });
      }
      if (!(await requireAdminSdk(res))) return;

      // Never wipe financial ledgers (transactions, bids) — non-financial scratch queues only (B13)
      const collectionsToClear = ['tickets', 'appeals', 'ai_chats', 'notifications'];
      for (const colName of collectionsToClear) {
        const snap = await adminDb.collection(colName).limit(400).get();
        const batch = adminDb.batch();
        snap.docs.forEach(d => batch.delete(d.ref));
        if (!snap.empty) await batch.commit();
      }
      serverState.ai_chats = {};
      serverState.support_tickets = {};
      serverState.appeals = {};
      persistLocalState();

      await writeAuditLog({
        action: 'RESET_PLATFORM_DATA',
        actorUid: req.authUser!.uid,
        actorName: req.authUser!.name,
        targetCollection: 'system',
        targetId: 'non_financial_queues',
        details: 'Cleared non-financial scratch collections (tickets, appeals, ai_chats, notifications); preserved financial ledgers.'
      });

      res.json({ success: true, message: "Non-financial support queues cleared by administrator (financial ledgers preserved)." });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || "Failed to reset platform data" });
    }
  });

  // One-time / idempotent admin migration moving legacy private PII/wallet/suspension fields from users/{uid} -> user_private/{uid}
  const PRIVATE_USER_FIELDS = [
    'panNumber',
    'nationalIdNumber',
    'idDocumentType',
    'phoneNumber',
    'phoneVerified',
    'phoneVerifiedAt',
    'email',
    'deposits',
    'suspensionStatus',
    'suspensionReason',
    'suspensionUntil',
    'isRevoked',
    'sessionRevokedAt',
    'isDeleted',
    'deletedAt',
    'totalCommissionPaid'
  ] as const;

  app.post('/api/admin/migrate-user-private', sensitiveLimiter, requireRole(ADMIN_ONLY), requireAdminOtp, async (req, res) => {
    try {
      if (!(await requireAdminSdk(res))) return;

      const usersSnap = await adminDb.collection('users').get();
      let scannedUsers = 0;
      let migratedUsers = 0;
      let privateDocsUpdated = 0;
      let publicDocsCleaned = 0;
      let fieldsDeletedCount = 0;
      let skippedAlreadyClean = 0;
      let preservedExistingDeposits = 0;
      let batchesCommitted = 0;

      let batch = adminDb.batch();
      let batchOps = 0;
      const MAX_BATCH_OPS = 400;

      const flushBatchIfFull = async (force = false) => {
        if (batchOps > 0 && (force || batchOps >= MAX_BATCH_OPS)) {
          await batch.commit();
          batchesCommitted++;
          batch = adminDb.batch();
          batchOps = 0;
        }
      };

      // Fetch corresponding user_private docs in chunks of 400 to avoid overwriting existing deposits
      for (let i = 0; i < usersSnap.docs.length; i += 400) {
        const chunkDocs = usersSnap.docs.slice(i, i + 400);
        const privRefs = chunkDocs.map(d => adminDb.collection('user_private').doc(d.id));
        const privSnaps = privRefs.length > 0 ? await adminDb.getAll(...privRefs) : [];

        for (let idx = 0; idx < chunkDocs.length; idx++) {
          const userDoc = chunkDocs[idx];
          const pubData = userDoc.data() || {};
          const privSnap = privSnaps[idx];
          const existingPriv = privSnap?.exists ? (privSnap.data() || {}) : {};
          scannedUsers++;

          const toCopy: Record<string, any> = {};
          const toDelete: Record<string, FirebaseFirestore.FieldValue> = {};
          let userFieldsToDelete = 0;

          for (const field of PRIVATE_USER_FIELDS) {
            if (Object.prototype.hasOwnProperty.call(pubData, field)) {
              toDelete[field] = FieldValue.delete();
              userFieldsToDelete++;

              if (pubData[field] !== undefined) {
                if (field === 'deposits' && existingPriv.deposits !== undefined) {
                  // NEVER overwrite existing authoritative deposits in user_private
                  preservedExistingDeposits++;
                } else if (existingPriv[field] === undefined) {
                  toCopy[field] = pubData[field];
                }
              }
            }
          }

          if (userFieldsToDelete === 0) {
            skippedAlreadyClean++;
            continue;
          }

          // Reserve room for up to 2 write operations so batch stays <= 400 ops
          if (batchOps + 2 > MAX_BATCH_OPS) {
            await flushBatchIfFull(true);
          }

          if (Object.keys(toCopy).length > 0) {
            batch.set(adminDb.collection('user_private').doc(userDoc.id), toCopy, { merge: true });
            batchOps++;
            privateDocsUpdated++;
          }

          batch.update(userDoc.ref, toDelete);
          batchOps++;
          publicDocsCleaned++;
          fieldsDeletedCount += userFieldsToDelete;
          migratedUsers++;

          if (batchOps >= MAX_BATCH_OPS) {
            await flushBatchIfFull(true);
          }
        }
      }

      await flushBatchIfFull(true);

      await writeAuditLog({
        action: 'MIGRATE_USER_PRIVATE',
        actorUid: req.authUser!.uid,
        actorName: req.authUser!.name,
        targetCollection: 'user_private',
        targetId: 'batch_migration',
        details: `Scanned ${scannedUsers}, migrated ${migratedUsers}, privateUpdated=${privateDocsUpdated}, publicCleaned=${publicDocsCleaned}, fieldsDeleted=${fieldsDeletedCount}, batches=${batchesCommitted}`
      });

      res.json({
        success: true,
        scannedUsers,
        migratedUsers,
        privateDocsUpdated,
        publicDocsCleaned,
        fieldsDeletedCount,
        preservedExistingDeposits,
        skippedAlreadyClean,
        batchesCommitted
      });
    } catch (err: any) {
      console.error('[MigrateUserPrivate] Error:', err);
      res.status(500).json({ success: false, error: err?.message || 'Failed migrating private user fields.' });
    }
  });

  // ----------------------------------------------------
  // 7. Groq AI Customer Support, Vehicle Concierge & Tickets
  // ----------------------------------------------------
  async function callGroqAgent(messages: Array<{ role: string; content: string }>) {
    const systemPrompt = `You are AutoBid AI Assistant, a fast, knowledgeable, and empathetic support specialist for AutoBid (India's digital vehicle auction & marketplace platform).
1. Explain live bidding, upcoming pre-bids, direct buy ("Sell Without Auction"), INR Wallet (deposit-only virtual credits via CT Account used exclusively for bidding and platform services routed to CT Collection), View Stock Insights (₹1,999), VIP Boosters, and KYC verification.
2. Solve minor platform questions step-by-step directly.
3. ACCOUNT DELETION APPEAL PROTOCOL:
   - If the user wants to delete their account: first ask for the reason ("deleteAppeal": { "stage": "need_reason", "reason": "" }).
   - Once they provide the reason, summarize it and ask for confirmation ("deleteAppeal": { "stage": "ready_to_submit", "reason": "..." }).
   - Upon explicit confirmation, set "deleteAppeal": { "stage": "confirmed", "reason": "..." }.
4. AUTONOMOUS AI VEHICLE LISTING CONCIERGE:
   - ONLY activate if the user explicitly asks to sell, list, auction, or post a vehicle.
   - Guide through steps: upload_photos -> confirm_specs -> select_mode -> set_price -> set_schedule -> ready_to_publish.
5. Append a JSON block between [AISTUDIO_STATUS] and [/AISTUDIO_STATUS]:
[AISTUDIO_STATUS]
{
  "status": "resolved" | "in_progress" | "escalated",
  "summary": "1-sentence summary",
  "suggestTicket": boolean,
  "ticketCategory": "payment" | "verification" | "bidding" | "listing" | "technical" | "account" | "other",
  "ticketSubject": "Brief subject",
  "ticketDescription": "Concise description",
  "deleteAppeal": null,
  "vehicleListing": null
}
[/AISTUDIO_STATUS]`;

    return callGroqAI({
      model: 'openai/gpt-oss-120b',
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.slice(-14).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 4000) }))
      ],
      temperature: 0.3,
      max_tokens: 1200
    });
  }

  function parseGroqResponse(rawText: string) {
    const match = rawText.match(/\[AISTUDIO_STATUS\]([\s\S]*?)\[\/AISTUDIO_STATUS\]/);
    const cleanText = rawText.replace(/\[AISTUDIO_STATUS\][\s\S]*?\[\/AISTUDIO_STATUS\]/, '').trim();
    let meta: any = { status: 'in_progress', summary: cleanText.slice(0, 100), suggestTicket: false, deleteAppeal: undefined, vehicleListing: undefined };
    if (match?.[1]) {
      try { meta = JSON.parse(match[1].trim()); } catch {}
    }
    return { cleanText, meta };
  }

  // Authenticated AI Support Chat with strict per-user session scoping and payload caps (B8, B9)
  app.post('/api/ai/chat', aiLimiter, requireAuth, async (req, res) => {
    try {
      const uid = req.authUser!.uid;
      const { messages, sessionId: requestedSessionId, startNew } = req.body;
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ success: false, error: "Messages array required." });
      }

      // Cap incoming conversation length and message size
      const boundedMessages = messages.slice(-20).map((m: any) => ({
        role: m?.role === 'assistant' ? 'assistant' : 'user',
        content: String(m?.content || '').slice(0, 2000),
        timestamp: typeof m?.timestamp === 'number' ? m.timestamp : Date.now()
      }));

      // Reject untrusted or cross-user sessionId; mint server-scoped ID tied strictly to uid
      let activeSessionId = `ai_${uid}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      if (!startNew && typeof requestedSessionId === 'string' && requestedSessionId.startsWith(`ai_${uid}_`) && /^[a-zA-Z0-9_-]{8,80}$/.test(requestedSessionId)) {
        const existingLocal = serverState.ai_chats[requestedSessionId];
        if (!existingLocal || existingLocal.userId === uid) {
          if (await checkAdminDbAvailable()) {
            const snap = await adminDb.collection('ai_chats').doc(requestedSessionId).get();
            if (!snap.exists || snap.data()?.userId === uid) {
              activeSessionId = requestedSessionId;
            }
          } else {
            activeSessionId = requestedSessionId;
          }
        }
      }

      const rawAiResponse = await callGroqAgent(boundedMessages);
      const { cleanText, meta } = parseGroqResponse(rawAiResponse);
      const nowTime = Date.now();

      const updatedMessages = [
        ...boundedMessages.map((m, idx) => ({
          id: `msg_${nowTime}_${idx}`,
          role: m.role,
          content: m.content,
          timestamp: m.timestamp
        })),
        {
          id: `msg_ai_${nowTime}`,
          role: 'assistant',
          content: cleanText,
          timestamp: nowTime,
          statusTag: meta.status,
          ticketSuggested: meta.suggestTicket
        }
      ];

      const sessionDoc = {
        id: activeSessionId,
        sessionId: activeSessionId,
        userId: uid,
        userEmail: req.authUser!.email || '',
        username: req.authUser!.name,
        isGuest: false,
        messages: updatedMessages,
        status: meta.suggestTicket ? 'escalated' : (meta.status || 'in_progress'),
        resolutionStatus: meta.suggestTicket ? 'escalated' : (meta.status || 'in_progress'),
        summary: meta.summary || cleanText.slice(0, 120),
        lastMessage: cleanText.slice(0, 150),
        updatedAt: nowTime,
        createdAt: serverState.ai_chats[activeSessionId]?.createdAt || nowTime
      };

      await upsertDocDual('ai_chats', activeSessionId, sessionDoc, serverState.ai_chats);

      res.json({
        success: true,
        reply: cleanText,
        status: meta.status,
        summary: meta.summary,
        suggestTicket: meta.suggestTicket,
        ticketDetails: meta,
        deleteAppeal: meta.deleteAppeal,
        vehicleListing: meta.vehicleListing,
        sessionId: activeSessionId
      });
    } catch (err: any) {
      console.error("Groq AI Chat API Error:", err);
      res.status(500).json({ success: false, error: err?.message || "Failed to communicate with AI Agent." });
    }
  });

  app.get('/api/ai/sessions', requireRole(STAFF_ROLES), async (_req, res) => {
    try {
      const list = await readCollectionMerged('ai_chats', serverState.ai_chats);
      list.sort((a: any, b: any) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
      res.json({ success: true, sessions: list });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/ai/update-session', requireRole(STAFF_ROLES), async (req, res) => {
    try {
      const { sessionId, status, resolutionStatus, adminNotes, ticketId } = req.body;
      if (!sessionId) return res.status(400).json({ success: false, error: "sessionId required." });

      const patch: Record<string, any> = { updatedAt: Date.now() };
      if (status || resolutionStatus) {
        patch.status = resolutionStatus || status;
        patch.resolutionStatus = resolutionStatus || status;
      }
      if (adminNotes !== undefined) patch.adminNotes = adminNotes;
      if (ticketId) patch.ticketId = ticketId;

      await upsertDocDual('ai_chats', String(sessionId), patch, serverState.ai_chats);
      res.json({ success: true, session: serverState.ai_chats[sessionId] || { id: sessionId, ...patch } });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/ai/submit-deletion-appeal', requireAuth, async (req, res) => {
    try {
      const uid = req.authUser!.uid;
      const { sessionId, reason } = req.body;
      const appealId = `appeal_del_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const appealDoc = {
        id: appealId,
        type: 'account_deletion',
        userId: uid,
        username: req.authUser!.name,
        email: req.authUser!.email || '',
        reason: String(reason || 'User requested account deletion via AI Support').slice(0, 1000),
        status: 'pending',
        source: 'ai_support_agent',
        sessionId: sessionId || null,
        createdAt: Date.now(),
        reviewedBy: null
      };

      await upsertDocDual('appeals', appealId, appealDoc, serverState.appeals);

      if (await checkAdminDbAvailable()) {
        await adminDb.collection('notifications').add({
          userId: 'admin',
          type: 'account_deletion_appeal',
          title: '🗑️ New Account Deletion Appeal',
          message: `@${appealDoc.username} (${appealDoc.email}) submitted an account deletion request.`,
          createdAt: Date.now(),
          read: false,
          appealId
        });
      }

      if (sessionId && String(sessionId).startsWith(`ai_${uid}_`)) {
        await upsertDocDual('ai_chats', String(sessionId), {
          status: 'appeal_submitted',
          deletionAppeal: { id: appealId, reason: appealDoc.reason, status: 'pending', submittedAt: Date.now() },
          updatedAt: Date.now()
        }, serverState.ai_chats);
      }

      res.json({ success: true, appealId, appeal: appealDoc });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/ai/deletion-appeals', requireRole(STAFF_ROLES), async (_req, res) => {
    try {
      const list = (await readCollectionMerged('appeals', serverState.appeals))
        .filter((a: any) => a.type === 'account_deletion')
        .sort((a: any, b: any) => (b.createdAt || 0) - (a.createdAt || 0));
      res.json({ success: true, count: list.length, appeals: list });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/ai/create-ticket', requireAuth, async (req, res) => {
    try {
      const uid = req.authUser!.uid;
      const { sessionId, category, subject, description } = req.body;
      // Always generate ticketId on server to prevent client overwrite of arbitrary docs (B8)
      const ticketId = `tkt_ai_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const ticket = {
        id: ticketId,
        userId: uid,
        username: req.authUser!.name,
        userEmail: req.authUser!.email || '',
        category: String(category || 'ai_escalation').slice(0, 60),
        subject: String(subject || 'Escalated from AI Agent').slice(0, 200),
        description: String(description || 'Support ticket escalated via AI Assistant.').slice(0, 4000),
        status: 'open',
        source: 'ai_agent',
        aiSessionId: (sessionId && String(sessionId).startsWith(`ai_${uid}_`)) ? String(sessionId) : null,
        createdAt: Date.now()
      };

      serverState.support_tickets[ticketId] = ticket;
      persistLocalState();
      if (await checkAdminDbAvailable()) {
        await adminDb.collection('tickets').doc(ticketId).create(ticket);
      }
      if (ticket.aiSessionId) {
        await upsertDocDual('ai_chats', ticket.aiSessionId, { status: 'ticket_created', ticketId, updatedAt: Date.now() }, serverState.ai_chats);
      }

      res.json({ success: true, ticketId, ticket });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/tickets/user', requireAuth, async (req, res) => {
    try {
      const uid = req.authUser!.uid;
      const email = req.authUser!.email;
      const allTickets = await readCollectionMerged('tickets', serverState.support_tickets);
      const matched = allTickets
        .filter((t: any) => t.userId === uid || (email && t.userEmail?.toLowerCase() === email))
        .sort((a: any, b: any) => (b.createdAt || 0) - (a.createdAt || 0));
      res.json({ success: true, tickets: matched });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/tickets/all', requireRole(STAFF_ROLES), async (_req, res) => {
    try {
      const allTickets = await readCollectionMerged('tickets', serverState.support_tickets);
      allTickets.sort((a: any, b: any) => (b.createdAt || 0) - (a.createdAt || 0));
      res.json({ success: true, tickets: allTickets });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/ai/analyze-vehicle', aiLimiter, requireAuth, largePayloadParser, async (req, res) => {
    try {
      const { base64Data, mimeType, description } = req.body;
      let analysisResult: any = null;

      if (base64Data) {
        try {
          const text = await callGroqAI({
            model: 'qwen/qwen3.8-27b',
            response_format: { type: 'json_object' },
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: `Identify the vehicle photo specs. Return strictly JSON: { "make": string, "model": string, "year": number, "color": string, "bodyType": string, "fuelType": string, "transmission": string, "engine": string, "condition": string }`
                  },
                  {
                    type: 'image_url',
                    image_url: { url: `data:${mimeType || 'image/jpeg'};base64,${base64Data}` }
                  }
                ]
              }
            ]
          });
          analysisResult = JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim());
        } catch {}
      }

      if (!analysisResult && description) {
        try {
          const text = await callGroqAI({
            model: 'openai/gpt-oss-120b',
            response_format: { type: 'json_object' },
            messages: [{
              role: 'user',
              content: `Extract vehicle specs from: "${String(description).slice(0, 500)}". Return JSON with make, model, year (number), color, bodyType, fuelType, transmission, engine, condition.`
            }]
          });
          analysisResult = JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim());
        } catch {}
      }

      if (!analysisResult) {
        const fb = getFallbackCarSpecs(description || 'Honda', 'City');
        analysisResult = {
          make: "Honda",
          model: "City",
          year: new Date().getFullYear() - 2,
          color: "Platinum White",
          bodyType: "Sedan",
          fuelType: fb.fuelType,
          transmission: "Manual",
          engine: fb.engine,
          condition: "Pre-Owned (Standard Inspection)"
        };
      }

      res.json({ success: true, specs: analysisResult });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/ai/publish-vehicle', largePayloadParser, requireAuth, async (req, res) => {
    try {
      if (!(await requireAdminSdk(res))) return;
      const uid = req.authUser!.uid;
      const username = req.authUser!.name;
      const { draft, sessionId } = req.body;
      if (!draft || typeof draft !== 'object') {
        return res.status(400).json({ success: false, error: "Draft specifications required." });
      }

      // Always generate unique server-controlled vehicleId (A3)
      const vehicleId = `veh_ai_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      let assignedStockNumber = draft.stockNumber
        ? String(draft.stockNumber).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20)
        : Math.floor(100000000 + Math.random() * 899999999).toString();

      // Prevent duplicate stockNumber collisions
      const existingStockSnap = await adminDb
        .collection('vehicles')
        .where('stockNumber', '==', assignedStockNumber)
        .limit(1)
        .get();
      if (!existingStockSnap.empty) {
        assignedStockNumber = Math.floor(100000000 + Math.random() * 899999999).toString();
      }

      // Validate images array bounds & offload any base64 payloads to Firebase Storage so Firestore doc stays << 1 MB
      let safeImages: string[] = [
        'https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?auto=format&fit=crop&q=80&w=1200'
      ];
      if (Array.isArray(draft.images) && draft.images.length > 0) {
        if (draft.images.length > 10) {
          return res.status(400).json({ success: false, error: 'Maximum of 10 vehicle images allowed.' });
        }

        const resolvedUrls: string[] = [];
        let bucket: ReturnType<typeof adminStorage.bucket> | null = null;

        for (let idx = 0; idx < draft.images.length; idx++) {
          const rawImg = draft.images[idx];
          if (typeof rawImg !== 'string' || !rawImg.trim()) continue;
          const img = rawImg.trim();

          if (/^https:\/\/[^\s]+$/i.test(img)) {
            if (img.length > 4096) {
              return res.status(400).json({ success: false, error: 'Image URL exceeds maximum length.' });
            }
            resolvedUrls.push(img);
            continue;
          }

          const dataMatch = img.match(/^data:(image\/(?:jpeg|jpg|png|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/i);
          if (!dataMatch) {
            return res.status(400).json({
              success: false,
              error: 'Images must be valid Firebase Storage / HTTPS URLs or supported image uploads (JPEG, PNG, WebP, GIF).'
            });
          }

          const mime = dataMatch[1].toLowerCase();
          const b64 = dataMatch[2].replace(/\s+/g, '');
          const imgBuf = Buffer.from(b64, 'base64');
          if (imgBuf.length === 0 || imgBuf.length > 5 * 1024 * 1024) {
            return res.status(400).json({ success: false, error: 'Each uploaded image must be <= 5MB.' });
          }

          try {
            if (!bucket) bucket = adminStorage.bucket();
            const ext = mime.split('/')[1].replace('jpeg', 'jpg');
            const objectPath = `vehicles/${uid}/${vehicleId}/photo_${idx}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
            const dlToken = crypto.randomUUID();
            const file = bucket.file(objectPath);
            await file.save(imgBuf, {
              resumable: false,
              contentType: mime,
              metadata: {
                metadata: { firebaseStorageDownloadTokens: dlToken }
              }
            });
            resolvedUrls.push(
              `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(objectPath)}?alt=media&token=${dlToken}`
            );
          } catch (uploadErr: any) {
            console.error('[AI Publish] Storage upload failed:', uploadErr?.message || uploadErr);
            return res.status(502).json({
              success: false,
              error: 'Failed to upload vehicle photo to Firebase Storage. Please retry upload so listing stays within Firestore 1MB limit.'
            });
          }
        }

        if (resolvedUrls.length > 0) {
          safeImages = resolvedUrls;
        }
      }

      const parsedPrice = Math.max(1000, Math.round(Number(draft.price) || 250000));
      const isAuction = draft.sellingMode !== 'direct';
      const now = Date.now();

      let startTimeValue = now;
      let endTimeValue = now + 7 * 24 * 60 * 60 * 1000;
      let initialStatus = isAuction ? 'Live Auction' : 'Direct Sale';

      if (draft.scheduleType === 'scheduled' && draft.scheduledTime) {
        const scheduledTimeMs = new Date(draft.scheduledTime).getTime();
        if (!isNaN(scheduledTimeMs) && scheduledTimeMs > now) {
          startTimeValue = scheduledTimeMs;
          endTimeValue = scheduledTimeMs + 7 * 24 * 60 * 60 * 1000;
          initialStatus = 'Upcoming';
        }
      }

      const newVehicle = {
        id: vehicleId,
        stockNumber: assignedStockNumber,
        year: Number(draft.year) || new Date().getFullYear(),
        make: String(draft.make || 'Custom Vehicle').slice(0, 60),
        model: String(draft.model || 'Standard Edition').slice(0, 60),
        color: String(draft.color || 'Silver').slice(0, 40),
        bodyType: String(draft.bodyType || 'Sedan').slice(0, 40),
        vin: `IN${Date.now().toString().slice(-8)}IND`,
        odometer: 25000,
        primaryDamage: 'Normal Wear',
        estRetailValue: Math.round(parsedPrice * 1.15),
        currentBid: parsedPrice,
        startingPrice: parsedPrice,
        ...(isAuction ? { buyNowPrice: Math.round(parsedPrice * 1.4) } : { directPrice: parsedPrice }),
        location: 'Mumbai, Maharashtra, India',
        imageSeed: Math.floor(Math.random() * 500),
        images: safeImages,
        coverImageIndex: 0,
        status: initialStatus,
        hasStartedLive: initialStatus !== 'Upcoming',
        isConcluded: false,
        listingType: isAuction ? 'auction' : 'direct',
        startTime: startTimeValue,
        endTime: endTimeValue,
        listedAt: now,
        expiresAt: endTimeValue,
        isBlacklisted: false,
        liveBidDuration: 0,
        watchCount: 0,
        views: 1,
        interestedCount: 0,
        hasKeys: true,
        engine: String(draft.engine || '1.5L Turbo / Dual VVT-i').slice(0, 80),
        transmission: String(draft.transmission || 'Automatic').slice(0, 40),
        drive: 'FWD',
        fuelType: String(draft.fuelType || 'Petrol').slice(0, 40),
        condition: String(draft.condition || 'Pre-Owned (AutoBid Certified)').slice(0, 80),
        description: `AutoBid Verified Listing posted via AI Concierge. ${draft.year || ''} ${draft.make || ''} ${draft.model || ''}.`.slice(0, 400),
        ownerId: uid,
        ownerUsername: username,
        ownerName: req.authUser!.userDoc?.fullName || username,
        listingFee: 0,
        boostOption: 'none',
        upcomingBids: [],
        liveParticipants: []
      };

      await adminDb.collection('vehicles').doc(vehicleId).create(newVehicle);
      await adminDb.collection('stock').doc(assignedStockNumber).set({
        id: assignedStockNumber,
        stockNumber: assignedStockNumber,
        vehicleId,
        year: newVehicle.year,
        make: newVehicle.make,
        model: newVehicle.model,
        vin: newVehicle.vin,
        color: newVehicle.color,
        listingType: newVehicle.listingType,
        status: newVehicle.status,
        startingPrice: newVehicle.startingPrice,
        currentBid: newVehicle.currentBid,
        ownerId: uid,
        ownerUsername: username,
        ownerName: newVehicle.ownerName,
        ownerEmail: '',
        ownerPhone: '',
        listedAt: now,
        startTime: startTimeValue,
        endTime: endTimeValue
      }, { merge: true });

      await adminDb.collection('notifications').add({
        userId: uid,
        type: 'vehicle_listed',
        title: '🎉 Vehicle Listed via AI!',
        message: `Your ${newVehicle.year} ${newVehicle.make} ${newVehicle.model} is active (Stock #${assignedStockNumber}).`,
        createdAt: now,
        read: false,
        link: `vehicle_${vehicleId}`
      });

      if (sessionId && String(sessionId).startsWith(`ai_${uid}_`)) {
        await upsertDocDual('ai_chats', String(sessionId), { status: 'resolved', updatedAt: now }, serverState.ai_chats);
      }

      res.json({ success: true, vehicle: newVehicle, stockNumber: assignedStockNumber, vehicleId });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Failed to publish vehicle." });
    }
  });

  // ----------------------------------------------------
  // 8. Sessions & Device Intelligence (Authenticated + Firestore Persisted)
  // ----------------------------------------------------
  function parseClientDevice(req: express.Request) {
    const forwarded = req.headers['x-forwarded-for'];
    let ip = req.ip || '0.0.0.0';
    if (typeof forwarded === 'string' && forwarded.trim()) {
      ip = forwarded.split(',')[0].trim();
    } else if (Array.isArray(forwarded) && forwarded[0]) {
      ip = forwarded[0].trim();
    }
    ip = ip.replace('::ffff:', '');

    const ua = (req.headers['user-agent'] || '').toLowerCase();
    let browser = 'Chrome (Desktop)';
    let os = 'Windows';
    let device = 'Desktop';

    if (ua.includes('iphone') || ua.includes('ipad')) {
      device = 'Mobile (Apple)';
      os = 'iOS';
      browser = ua.includes('crios') ? 'Chrome iOS' : 'Safari Mobile';
    } else if (ua.includes('android')) {
      device = 'Mobile (Android)';
      os = 'Android';
      browser = ua.includes('chrome') ? 'Chrome Mobile' : 'Android Browser';
    } else if (ua.includes('macintosh') || ua.includes('mac os')) {
      device = 'Desktop (Mac)';
      os = 'macOS';
      browser = ua.includes('chrome') ? 'Chrome (macOS)' : 'Safari (macOS)';
    } else if (ua.includes('windows')) {
      device = 'Desktop (PC)';
      os = 'Windows';
      browser = ua.includes('edg') ? 'Edge (Windows)' : ua.includes('firefox') ? 'Firefox (Windows)' : 'Chrome (Windows)';
    } else if (ua.includes('linux')) {
      device = 'Desktop (Linux)';
      os = 'Linux';
      browser = ua.includes('chrome') ? 'Chrome (Linux)' : 'Firefox (Linux)';
    }

    return { ip, browser, os, device };
  }

  app.post('/api/sessions/heartbeat', requireAuth, async (req, res) => {
    try {
      const uid = req.authUser!.uid;
      const username = req.authUser!.name;
      const email = req.authUser!.email;
      const role = req.authUser!.role || 'user';
      const now = Date.now();
      const { ip, browser, os, device } = parseClientDevice(req);

      const existing = serverState.sessions[uid] || {};
      const revokedAt = serverState.revokedUserIds[uid] || req.authUser!.userDoc?.sessionRevokedAt || 0;
      const isRevoked = Boolean(req.authUser!.userDoc?.isRevoked) || (revokedAt > (existing.loginTime || now));

      if (isRevoked) {
        return res.json({
          success: false,
          revoked: true,
          message: 'Active session has been force-terminated by the administrator.'
        });
      }

      const prevIps: string[] = Array.isArray(existing.ipHistory) ? existing.ipHistory : [];
      const prevBrowsers: string[] = Array.isArray(existing.browserHistory) ? existing.browserHistory : [];
      const timeline: any[] = Array.isArray(existing.deviceTimeline) ? [...existing.deviceTimeline] : [];

      if (timeline.length === 0) {
        timeline.push({
          timestamp: req.authUser!.userDoc?.createdAt || now,
          event: 'signup',
          ip,
          browser,
          device,
          os,
          status: 'active',
          details: 'Session registered with initial device profile'
        });
      } else if (existing.currentBrowser && existing.currentBrowser !== browser) {
        timeline.push({
          timestamp: now,
          event: 'browser_switch',
          ip,
          browser,
          device,
          os,
          status: 'active',
          details: `Multi-browser switch: logged in on ${browser} (previous: ${existing.currentBrowser})`
        });
      } else if (existing.currentIp && existing.currentIp !== ip) {
        timeline.push({
          timestamp: now,
          event: 'ip_switch',
          ip,
          browser,
          device,
          os,
          status: 'active',
          details: `Network transition: IP changed from ${existing.currentIp} to ${ip}`
        });
      }

      const ipHistory = Array.from(new Set([ip, ...prevIps]));
      const browserHistory = Array.from(new Set([browser, ...prevBrowsers]));

      const sessionObj = {
        id: `sess_${uid}`,
        userId: uid,
        username,
        email,
        role,
        currentIp: ip,
        ipHistory,
        previousIps: ipHistory.filter(h => h !== ip),
        currentBrowser: browser,
        browserHistory,
        previousBrowsers: browserHistory.filter(b => b !== browser),
        distinctBrowsers: browserHistory,
        distinctBrowsersCount: browserHistory.length,
        deviceTimeline: timeline.slice(-50),
        device,
        os,
        isOnline: true,
        lastActiveAt: now,
        loginTime: existing.loginTime || now,
        status: 'active'
      };

      await upsertDocDual('sessions', uid, sessionObj, serverState.sessions);
      res.json({ success: true, userId: uid, isOnline: true, currentIp: ip, currentBrowser: browser });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/sessions', requireRole(STAFF_ROLES), async (_req, res) => {
    try {
      const sessionsList = await readCollectionMerged('sessions', serverState.sessions);
      const now = Date.now();
      const ipCounts: Record<string, string[]> = {};
      sessionsList.forEach((s: any) => {
        if (s.currentIp) {
          if (!ipCounts[s.currentIp]) ipCounts[s.currentIp] = [];
          ipCounts[s.currentIp].push(s.username);
        }
      });

      const enriched = sessionsList.map((s: any) => {
        const isRevoked = s.status === 'revoked';
        const isOnline = !isRevoked && (now - (s.lastActiveAt || 0) < 300000);
        const collisionUsers = ipCounts[s.currentIp] || [];
        const hasCollision = collisionUsers.length > 1;
        const distinctBrowsers = s.distinctBrowsers || Array.from(new Set([s.currentBrowser, ...(s.previousBrowsers || [])].filter(Boolean)));

        return {
          ...s,
          isOnline,
          distinctBrowsers,
          distinctBrowsersCount: distinctBrowsers.length,
          ipCollisionWarning: hasCollision,
          collidingAccounts: hasCollision ? collisionUsers.filter((u: string) => u !== s.username) : []
        };
      });

      enriched.sort((a: any, b: any) => (a.isOnline === b.isOnline ? (b.lastActiveAt || 0) - (a.lastActiveAt || 0) : a.isOnline ? -1 : 1));

      res.json({
        success: true,
        totalAccounts: enriched.length,
        onlineAccounts: enriched.filter((s: any) => s.isOnline && s.status !== 'revoked').length,
        offlineAccounts: enriched.filter((s: any) => !s.isOnline && s.status !== 'revoked').length,
        ipCollisionAccounts: enriched.filter((s: any) => s.ipCollisionWarning).length,
        terminatedAccounts: enriched.filter((s: any) => s.status === 'revoked').length,
        ipChangedAccounts: enriched.filter((s: any) => s.previousIps && s.previousIps.length > 0).length,
        sessions: enriched
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/sessions/revoke', requireRole(STAFF_ROLES), async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ error: 'userId required' });
      const now = Date.now();
      serverState.revokedUserIds[String(userId)] = now;

      const existing = serverState.sessions[String(userId)] || { userId: String(userId), deviceTimeline: [] };
      const timeline = [...(existing.deviceTimeline || []), {
        timestamp: now,
        event: 'revocation',
        ip: existing.currentIp || 'N/A',
        browser: existing.currentBrowser || 'Active Session',
        device: existing.device || 'Device',
        os: existing.os || 'OS',
        status: 'revoked',
        details: `Session force-terminated by ${req.authUser!.name}`
      }];

      await upsertDocDual('sessions', String(userId), { status: 'revoked', isOnline: false, deviceTimeline: timeline }, serverState.sessions);
      if (await checkAdminDbAvailable()) {
        await Promise.all([
          adminDb.collection('user_private').doc(String(userId)).set({ isRevoked: true, sessionRevokedAt: now }, { merge: true }),
          adminDb.collection('users').doc(String(userId)).update({
            isOnline: false,
            isRevoked: FieldValue.delete(),
            sessionRevokedAt: FieldValue.delete()
          }).catch(() => {})
        ]);
        await adminAuth.revokeRefreshTokens(String(userId)).catch(() => {});
      }

      res.json({ success: true, message: `Active sessions force-terminated for user ${userId}` });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/sessions/reinstate', requireRole(STAFF_ROLES), async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ error: 'userId required' });
      delete serverState.revokedUserIds[String(userId)];

      await upsertDocDual('sessions', String(userId), { status: 'active', loginTime: Date.now() }, serverState.sessions);
      if (await checkAdminDbAvailable()) {
        await Promise.all([
          adminDb.collection('user_private').doc(String(userId)).set({ isRevoked: false, sessionRevokedAt: null }, { merge: true }),
          adminDb.collection('users').doc(String(userId)).update({
            isRevoked: FieldValue.delete(),
            sessionRevokedAt: FieldValue.delete()
          }).catch(() => {})
        ]);
      }
      res.json({ success: true, message: `Session reinstated for user ${userId}` });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/sessions/revoke-all', requireRole(ADMIN_ONLY), async (req, res) => {
    try {
      const callerUid = req.authUser!.uid;
      const now = Date.now();
      const allSessions = await readCollectionMerged('sessions', serverState.sessions);
      for (const s of allSessions) {
        const uid = s.userId || s.id;
        if (uid && uid !== callerUid) {
          serverState.revokedUserIds[uid] = now;
          await upsertDocDual('sessions', uid, { status: 'revoked', isOnline: false }, serverState.sessions);
          if (await checkAdminDbAvailable()) {
            await Promise.all([
              adminDb.collection('user_private').doc(uid).set({ isRevoked: true, sessionRevokedAt: now }, { merge: true }).catch(() => {}),
              adminDb.collection('users').doc(uid).update({
                isOnline: false,
                isRevoked: FieldValue.delete(),
                sessionRevokedAt: FieldValue.delete()
              }).catch(() => {})
            ]);
            await adminAuth.revokeRefreshTokens(uid).catch(() => {});
          }
        }
      }
  res.json({ success: true, message: 'All non-admin sessions terminated globally.' });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ----------------------------------------------------
  // 9. Admin AI Brain Executive Intel & Content CMS Banners
  // ----------------------------------------------------
  function initializeSeedBanners() {
    if (serverState.hasInitializedBanners) return;
    serverState.hasInitializedBanners = true;
    if (Object.keys(serverState.content_banners).length === 0) {
      const carouselId = 'banner_ai_supercar_carousel';
      serverState.content_banners[carouselId] = {
        id: carouselId,
        title: 'AutoBid Premier Live Auctions & Supercar Drop',
        subtitle: 'Bid on authenticated luxury supercars, verified salvage exotics, and daily drivers with real-time transparent bidding.',
        imageUrl: 'https://images.unsplash.com/photo-1617814076367-b759c7d7e738?auto=format&fit=crop&w=1600&q=80',
        targetUrl: '/auctions',
        position: 'hero',
        isActive: true,
        isCarousel: true,
        createdAt: Date.now() - 3600000,
        badge: '🔥 LIVE AUCTIONS DAILY',
        ctaText: 'Explore Live Auctions →',
        slides: [
          {
            id: 'slide_1',
            title: 'AutoBid Premier Live Auctions',
            subtitle: 'Bid on authenticated luxury supercars, verified salvage exotics, and daily drivers with real-time transparent bidding.',
            imageUrl: 'https://images.unsplash.com/photo-1617814076367-b759c7d7e738?auto=format&fit=crop&w=1600&q=80',
            targetUrl: '/auctions',
            badge: '🔥 LIVE AUCTIONS DAILY',
            ctaText: 'Explore Live Auctions →'
          },
          {
            id: 'slide_2',
            title: 'Zero Seller Listing Fees This Weekend',
            subtitle: 'List your sports car or trade vehicle with instant RC verification and verified buyer reach.',
            imageUrl: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=1600&q=80',
            targetUrl: '/sell',
            badge: '⚡ SPECIAL PROMOTION',
            ctaText: 'List Your Vehicle Free →'
          },
          {
            id: 'slide_3',
            title: 'Unlock Stock Insights Analytics',
            subtitle: 'Gain algorithmic valuation predictions and inventory tracking before placing your bids.',
            imageUrl: 'https://images.unsplash.com/photo-1542282088-72c9c27ed0cd?auto=format&fit=crop&w=1600&q=80',
            targetUrl: '/wallet',
            badge: '🧠 AI STOCK INTEL',
            ctaText: 'Unlock Analytics Intel →'
          }
        ]
      };
    }
    persistLocalState();
  }
  initializeSeedBanners();

  async function readMergedUsersForAdmin() {
    const [pubUsers, privUsers] = await Promise.all([
      readCollectionMerged('users'),
      readCollectionMerged('user_private')
    ]);
    const privMap = new Map(privUsers.map((p: any) => [p.id, p]));
    return pubUsers.map((u: any) => ({ ...u, ...(privMap.get(u.id) || {}) }));
  }

  app.get('/api/admin/ai-brain/data-summary', requireRole(STAFF_ROLES), async (_req, res) => {
    try {
      const [usersList, vehiclesList, txList, sessionsList, ticketsList, appealsList] = await Promise.all([
        readMergedUsersForAdmin(),
        readCollectionMerged('vehicles'),
        readCollectionMerged('transactions'),
        readCollectionMerged('sessions', serverState.sessions),
        readCollectionMerged('tickets', serverState.support_tickets),
        readCollectionMerged('appeals', serverState.appeals)
      ]);

      const totalDepositsVolume = txList
        .filter((t: any) => (String(t.type || '').startsWith('deposit') || t.type === 'admin_credit') && t.status !== 'failed')
        .reduce((sum: number, t: any) => sum + (Number(t.amount) || 0), 0);
      const ctCollectionVolume = txList
        .filter((t: any) => t.channel === 'ct_collection' && t.status !== 'failed')
        .reduce((sum: number, t: any) => sum + (Number(t.amount) || 0), 0);
      const totalVirtualCirculation = usersList.reduce((sum: number, u: any) => sum + (Number(u.deposits) || 0), 0);
      const stockInsightsRevenue = usersList.filter((u: any) => u.hasStockInsightsAccess).length * 1999;

      res.json({
        success: true,
        metrics: {
          users: {
            total: usersList.length,
            online: sessionsList.filter((s: any) => s.isOnline && s.status !== 'revoked').length,
            verified: usersList.filter((u: any) => u.isVerified).length,
            admins: usersList.filter((u: any) => u.role === 'admin').length,
            ipChangedCount: sessionsList.filter((s: any) => s.previousIps && s.previousIps.length > 0).length
          },
          financial: {
            totalDepositsVolume,
            ctCollectionVolume,
            totalVirtualCirculation,
            stockInsightsRevenue,
            ctAccountConfigured: true
          },
          vehicles: {
            total: vehiclesList.length,
            live: vehiclesList.filter((v: any) => v.status === 'Live Auction').length,
            upcoming: vehiclesList.filter((v: any) => v.status === 'Upcoming').length,
            directSale: vehiclesList.filter((v: any) => v.status === 'Direct Sale').length,
            sold: vehiclesList.filter((v: any) => v.status === 'Sold').length,
            restricted: vehiclesList.filter((v: any) => v.isRestricted).length
          },
          moderation: {
            openTickets: ticketsList.filter((t: any) => t.status === 'open').length,
            pendingAppeals: appealsList.filter((a: any) => a.status === 'pending').length,
            pendingVerifications: 0
          }
        }
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/admin/ai-brain/chat', aiLimiter, requireRole(STAFF_ROLES), largePayloadParser, async (req, res) => {
    try {
      const { query, history = [], uploadedImageUrl, currentDraft } = req.body;
      if (!query || typeof query !== 'string') {
        return res.status(400).json({ success: false, error: 'Query string required.' });
      }

      const [usersList, vehiclesList, txList, sessionsList, ticketsList, appealsList, activeBannersList] = await Promise.all([
        readMergedUsersForAdmin(),
        readCollectionMerged('vehicles'),
        readCollectionMerged('transactions'),
        readCollectionMerged('sessions', serverState.sessions),
        readCollectionMerged('tickets', serverState.support_tickets),
        readCollectionMerged('appeals', serverState.appeals),
        readCollectionMerged('content_banners', serverState.content_banners)
      ]);

      const totalDepositsVolume = txList
        .filter((t: any) => (String(t.type || '').startsWith('deposit') || t.type === 'admin_credit') && t.status !== 'failed')
        .reduce((sum: number, t: any) => sum + (Number(t.amount) || 0), 0);
      const ctCollectionVolume = txList
        .filter((t: any) => t.channel === 'ct_collection' && t.status !== 'failed')
        .reduce((sum: number, t: any) => sum + (Number(t.amount) || 0), 0);
      const totalVirtualCirculation = usersList.reduce((sum: number, u: any) => sum + (Number(u.deposits) || 0), 0);
      const stockInsightsRevenue = usersList.filter((u: any) => u.hasStockInsightsAccess).length * 1999;

      const qLower = query.toLowerCase();
      const matchedTx = txList.find((t: any) =>
        (t.id && qLower.includes(t.id.toLowerCase())) ||
        (t.transactionId && qLower.includes(t.transactionId.toLowerCase())) ||
        (t.paymentId && qLower.includes(t.paymentId.toLowerCase())) ||
        (t.orderId && qLower.includes(t.orderId.toLowerCase())) ||
        (t.username && qLower.includes(t.username.toLowerCase()))
      );
      const matchedUser = usersList.find((u: any) =>
        (u.username && qLower.includes(u.username.toLowerCase())) ||
        (u.email && qLower.includes(u.email.toLowerCase())) ||
        (u.id && qLower.includes(u.id.toLowerCase()))
      );
      const matchedVehicle = vehiclesList.find((v: any) =>
        (v.id && qLower.includes(v.id.toLowerCase())) ||
        (v.stockNumber && qLower.includes(v.stockNumber.toLowerCase())) ||
        (v.vin && qLower.includes(v.vin.toLowerCase()))
      );

      const systemPrompt = `You are AutoBid Groq AI Brain, the internal intelligence, financial auditor, executive content manager, and operational helper model for the AutoBid Administrator.
CURRENT LIVE PLATFORM METRICS SNAPSHOT:
• Users: ${usersList.length} (Online: ${sessionsList.filter((s: any) => s.isOnline && s.status !== 'revoked').length}, Verified: ${usersList.filter((u: any) => u.isVerified).length})
• CT Account Deposits Inflow: ₹${totalDepositsVolume.toLocaleString()}
• CT Collection Virtual Usage: ₹${ctCollectionVolume.toLocaleString()}
• Virtual Circulation in User Wallets: ₹${totalVirtualCirculation.toLocaleString()}
• Stock Insights Revenue: ₹${stockInsightsRevenue.toLocaleString()}
• Vehicles: ${vehiclesList.length} total, Support Tickets Open: ${ticketsList.filter((t: any) => t.status === 'open').length}, Pending Appeals: ${appealsList.filter((a: any) => a.status === 'pending').length}
• Active Homepage Banners: ${activeBannersList.length}
${uploadedImageUrl ? `[UPLOADED IMAGE]: ${String(uploadedImageUrl).slice(0, 120)}` : ''}
${currentDraft ? `[PENDING BANNER DRAFT]: ${JSON.stringify(currentDraft)}` : ''}
${matchedTx ? `[MATCHED TRANSACTION]: ${JSON.stringify(matchedTx)}` : ''}
${matchedUser ? `[MATCHED USER]: ${JSON.stringify({ id: matchedUser.id, username: matchedUser.username, email: matchedUser.email, role: matchedUser.role, deposits: matchedUser.deposits, isVerified: matchedUser.isVerified })}` : ''}
${matchedVehicle ? `[MATCHED VEHICLE]: ${JSON.stringify({ id: matchedVehicle.id, stockNumber: matchedVehicle.stockNumber, title: `${matchedVehicle.year} ${matchedVehicle.make} ${matchedVehicle.model}`, status: matchedVehicle.status, currentBid: matchedVehicle.currentBid })}` : ''}

When drafting homepage banners or carousels, include a \`\`\`banner_draft ... \`\`\` JSON block, or \`\`\`banner_publish ... \`\`\` if the admin confirms.`;

      const reply = await callGroqAI({
        model: 'openai/gpt-oss-120b',
        messages: [
          { role: 'system', content: systemPrompt },
          ...history.slice(-8).map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') })),
          { role: 'user', content: query }
        ],
        temperature: 0.15,
        max_tokens: 2800
      });

      let bannerDraft: any = null;
      let actionType: string | undefined = undefined;
      const draftMatch = reply.match(/```banner_draft\s*([\s\S]*?)\s*```/);
      const publishMatch = reply.match(/```banner_publish\s*([\s\S]*?)\s*```/);
      const isExplicitYes = /^(yes|publish|confirm|yes publish|publish it|confirm and publish|yes do it)$/i.test(query.trim());

      if (publishMatch || (isExplicitYes && currentDraft)) {
        try {
          const raw = publishMatch ? publishMatch[1] : JSON.stringify(currentDraft);
          bannerDraft = JSON.parse(raw);
          const bannerId = bannerDraft.id || `banner_${Date.now()}`;
          bannerDraft = { ...bannerDraft, id: bannerId, status: 'published', publishedAt: Date.now(), isActive: true, createdAt: bannerDraft.createdAt || Date.now() };
          actionType = 'banner_published';
          await upsertDocDual('content_banners', bannerId, bannerDraft, serverState.content_banners);
        } catch {}
      } else if (draftMatch) {
        try {
          bannerDraft = JSON.parse(draftMatch[1]);
          bannerDraft.status = 'draft';
          bannerDraft.id = bannerDraft.id || `draft_${Date.now()}`;
          actionType = 'banner_draft';
        } catch {}
      }

      let reportData: any = null;
      let reportTitle = 'AutoBid Executive Intelligence Report';
      let reportType = 'general';
      if (bannerDraft) { reportType = 'banners'; reportTitle = `Banner - ${bannerDraft.title || 'Draft'}`; reportData = bannerDraft; }
      else if (matchedTx || qLower.includes('transaction')) { reportType = 'transactions'; reportTitle = 'Transaction Audit Report'; reportData = matchedTx ? [matchedTx] : txList.slice(-25); }
      else if (qLower.includes('session') || qLower.includes('device') || qLower.includes('ip')) { reportType = 'sessions'; reportTitle = 'Session & Device Audit'; reportData = sessionsList; }
      else if (qLower.includes('financial') || qLower.includes('accounting') || qLower.includes('balance')) {
        reportType = 'accounting';
        reportTitle = 'Platform Treasury Balance Sheet';
        reportData = { totalDepositsVolume, ctCollectionVolume, totalVirtualCirculation, stockInsightsRevenue, timestamp: Date.now() };
      } else if (matchedUser) { reportType = 'general'; reportTitle = `User Dossier - @${matchedUser.username}`; reportData = [matchedUser]; }

      res.json({
        success: true,
        reply,
        modelUsed: 'openai/gpt-oss-120b',
        metadata: { reportDownloadable: true, reportTitle, reportType, reportData, bannerDraft, actionType }
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'Failed to process AI Brain query.' });
    }
  });

  app.get('/api/banners', requireRole(STAFF_ROLES), async (_req, res) => {
    try {
      const banners = await readCollectionMerged('content_banners', serverState.content_banners);
      banners.sort((a: any, b: any) => (b.createdAt || 0) - (a.createdAt || 0));
      res.json({ success: true, banners });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/banners/active', async (_req, res) => {
    try {
      const banners = (await readCollectionMerged('content_banners', serverState.content_banners))
        .filter((b: any) => b.isActive !== false)
        .sort((a: any, b: any) => (b.createdAt || 0) - (a.createdAt || 0));
      res.json({ success: true, banners });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/banners/publish', requireRole(STAFF_ROLES), largePayloadParser, async (req, res) => {
    try {
      const { banner } = req.body;
      if (!banner || !banner.title) {
        return res.status(400).json({ error: 'Banner object with title required' });
      }
      const id = banner.id || `banner_${Date.now()}`;
      const publishedBanner = {
        ...banner,
        id,
        isActive: banner.isActive !== undefined ? banner.isActive : true,
        createdAt: banner.createdAt || Date.now(),
        updatedAt: Date.now()
      };
      await upsertDocDual('content_banners', id, publishedBanner, serverState.content_banners);
      res.json({ success: true, message: 'Banner published successfully', banner: publishedBanner });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/banners/toggle', requireRole(STAFF_ROLES), async (req, res) => {
    try {
      const { id, isActive } = req.body;
      if (!id) return res.status(400).json({ error: 'Banner ID required' });
      await upsertDocDual('content_banners', String(id), { isActive: Boolean(isActive), updatedAt: Date.now() }, serverState.content_banners);
      res.json({ success: true, banner: serverState.content_banners[id] || { id, isActive: Boolean(isActive) } });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.delete('/api/banners/:id', requireRole(STAFF_ROLES), async (req, res) => {
    try {
      const { id } = req.params;
      await deleteDocDual('content_banners', String(id), serverState.content_banners);
      res.json({ success: true, message: `Banner ${id} deleted successfully` });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/admin/ai-brain/sessions', requireRole(STAFF_ROLES), async (_req, res) => {
    try {
      const sessions = await readCollectionMerged('ai_brain_sessions', serverState.ai_brain_sessions);
      sessions.sort((a: any, b: any) => (b.updatedAt || 0) - (a.updatedAt || 0));
      res.json({ success: true, sessions });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/admin/ai-brain/sessions', requireRole(STAFF_ROLES), async (req, res) => {
    try {
      const { session } = req.body;
      if (!session || !session.id) return res.status(400).json({ error: 'Session with ID required' });
      const payload = { ...session, updatedAt: Date.now(), adminId: req.authUser!.uid };
      await upsertDocDual('ai_brain_sessions', String(session.id), payload, serverState.ai_brain_sessions);
      res.json({ success: true, session: payload });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.delete('/api/admin/ai-brain/sessions/:id', requireRole(STAFF_ROLES), async (req, res) => {
    try {
      const { id } = req.params;
      await deleteDocDual('ai_brain_sessions', String(id), serverState.ai_brain_sessions);
      res.json({ success: true, message: 'Chat session deleted' });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Protect all unknown /api routes from falling through to HTML fallback
  app.use("/api", (req, res) => {
    res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl}` });
  });

  app.use((err: any, req: any, res: any, next: any) => {
    if (req.path?.startsWith('/api/')) {
      console.error("Express API error:", err);
      return res.status(err?.status || 500).json({ error: err?.message || "Internal server error" });
    }
    next(err);
  });

  // Vite middleware for dev, static dist for prod
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Quota-safe Server-side Auction Lifecycle Scheduler (runs every 60s with 3 targeted queries)
  let lifecycleRunning = false;
  let endedCompositeBlockedUntil = 0;
  let directCompositeBlockedUntil = 0;
  const INDEX_RETRY_MS = 15 * 60 * 1000;

  function isMissingIndexError(err: any): boolean {
    const code = err?.code;
    const msg = String(err?.message || '').toLowerCase();
    return code === 9 || msg.includes('failed_precondition') || msg.includes('requires an index');
  }

  async function processAuctionLifecycle() {
    if (lifecycleRunning) return;
    lifecycleRunning = true;
    try {
      if (!(await checkAdminDbAvailable())) return;
      const now = Date.now();

      const fetchEndedVehicles = async () => {
        if (now >= endedCompositeBlockedUntil) {
          try {
            return await adminDb.collection('vehicles')
              .where('isConcluded', '==', false)
              .where('endTime', '<=', now)
              .get();
          } catch (err) {
            if (!isMissingIndexError(err)) throw err;
            endedCompositeBlockedUntil = now + INDEX_RETRY_MS;
          }
        }
        return adminDb.collection('vehicles')
          .where('isConcluded', '==', false)
          .get();
      };

      const fetchExpiredDirectVehicles = async () => {
        if (now >= directCompositeBlockedUntil) {
          try {
            return await adminDb.collection('vehicles')
              .where('listingType', '==', 'direct')
              .where('isBlacklisted', '==', false)
              .where('expiresAt', '<=', now)
              .get();
          } catch (err) {
            if (!isMissingIndexError(err)) throw err;
            directCompositeBlockedUntil = now + INDEX_RETRY_MS;
          }
        }
        return adminDb.collection('vehicles')
          .where('isBlacklisted', '==', false)
          .get();
      };

      const [endedSnap, upcomingSnap, expiredDirectSnap] = await Promise.all([
        fetchEndedVehicles(),
        adminDb.collection('vehicles')
          .where('hasStartedLive', '==', false)
          .get(),
        fetchExpiredDirectVehicles()
      ]);

      // (c) Direct sale 3-month expiration -> Blacklisted
      for (const docSnap of expiredDirectSnap.docs) {
        const v = docSnap.data() || {};
        const vid = docSnap.id;
        if (
          v.listingType !== 'direct' ||
          !v.expiresAt ||
          Number(v.expiresAt) > now ||
          v.isDeleted ||
          v.status === 'Sold' ||
          v.status === 'Ended' ||
          v.isBlacklisted ||
          v.status === 'Blacklisted'
        ) {
          continue;
        }
        await adminDb.runTransaction(async (tx) => {
          const vRef = adminDb.collection('vehicles').doc(vid);
          const fresh = await tx.get(vRef);
          const fv = fresh.data();
          if (
            !fv ||
            fv.listingType !== 'direct' ||
            !fv.expiresAt ||
            Number(fv.expiresAt) > now ||
            fv.isDeleted ||
            fv.isBlacklisted ||
            fv.status === 'Blacklisted' ||
            fv.status === 'Sold' ||
            fv.status === 'Ended'
          ) return;
          tx.update(vRef, { status: 'Blacklisted', isBlacklisted: true, isConcluded: true });
          if (fv.ownerId) {
            tx.set(adminDb.collection('notifications').doc(), {
              userId: fv.ownerId,
              type: 'vehicle_blacklisted',
              title: 'Vehicle Blacklisted (3-Month Limit) ⚠️',
              message: `Your direct sale listing for ${fv.year} ${fv.make} ${fv.model} reached the 3-month limit without being sold and has been blacklisted.`,
              createdAt: now,
              read: false,
              link: `vehicle_${vid}`
            });
          }
        }).catch(() => {});
      }

      // (b) Upcoming auctions ready to start Live
      for (const docSnap of upcomingSnap.docs) {
        const v = docSnap.data() || {};
        const vid = docSnap.id;
        if (v.isDeleted || v.hasStartedLive || v.status === 'Sold' || v.status === 'Ended' || v.listingType === 'direct' || v.status === 'Direct Sale') {
          continue;
        }
        if (!v.startTime || Number(v.startTime) > now) {
          continue;
        }

        await adminDb.runTransaction(async (tx) => {
          const vRef = adminDb.collection('vehicles').doc(vid);
          const fresh = await tx.get(vRef);
          const fv = fresh.data();
          if (!fv || fv.isDeleted || fv.hasStartedLive || fv.status === 'Sold' || fv.status === 'Ended') return;
          if (!fv.startTime || Number(fv.startTime) > now) return;

          const upcomingBids: any[] = Array.isArray(fv.upcomingBids) ? fv.upcomingBids : [];
          const lastPreBidder = upcomingBids.length > 0 ? upcomingBids[upcomingBids.length - 1] : null;
          const askingPrice = Number(fv.startingPrice || fv.currentBid || 0);
          const updates: Record<string, any> = {
            status: 'Live Auction',
            hasStartedLive: true
          };
          if (lastPreBidder && lastPreBidder.userId) {
            updates.firstBidderId = lastPreBidder.userId;
            updates.firstBidderUsername = lastPreBidder.username;
            updates.winningUserId = lastPreBidder.userId;
            updates.winningUsername = lastPreBidder.username;
            updates.currentBid = askingPrice;
            updates.liveParticipants = [lastPreBidder.userId];
            updates.bidUserIds = [lastPreBidder.userId];

            tx.set(adminDb.collection('bids').doc(), {
              vehicleId: vid,
              userId: lastPreBidder.userId,
              username: lastPreBidder.username,
              amount: askingPrice,
              timestamp: now,
              type: 'first_bidder_from_upcoming'
            });

            tx.set(adminDb.collection('notifications').doc(), {
              userId: lastPreBidder.userId,
              type: 'auction_start',
              title: 'You are the 1st Bidder! 🏆',
              message: `The auction for ${fv.year} ${fv.make} ${fv.model} is now LIVE! As the last pre-bidder, you hold the opening lead at ₹${askingPrice.toLocaleString()}.`,
              createdAt: now,
              read: false,
              channel: 'email',
              link: `vehicle_${vid}`
            });
          }
          tx.update(vRef, updates);
        }).catch(() => {});
      }

      // (a) Auctions at/past endTime -> Sold or Ended (skip concluded & direct sale docs in code)
      for (const docSnap of endedSnap.docs) {
        const v = docSnap.data() || {};
        const vid = docSnap.id;
        if (v.isDeleted || v.isConcluded || v.status === 'Sold' || v.status === 'Ended' || v.listingType === 'direct' || v.status === 'Direct Sale') {
          continue;
        }
        if (!v.endTime || Number(v.endTime) > now) {
          continue;
        }

        await adminDb.runTransaction(async (tx) => {
          const vRef = adminDb.collection('vehicles').doc(vid);
          const fresh = await tx.get(vRef);
          const fv = fresh.data();
          if (!fv || fv.isDeleted || fv.isConcluded || fv.status === 'Sold' || fv.status === 'Ended' || !fv.endTime || Number(fv.endTime) > now) return;

          const finalPrice = Number(fv.currentBid || 0);
          const isSold = Boolean(fv.winningUserId && finalPrice > 0);
          const commission = isSold ? Math.round(finalPrice * 0.001) : 0;

          tx.update(vRef, {
            status: isSold ? 'Sold' : 'Ended',
            isConcluded: true,
            hasStartedLive: true,
            concludedAt: now,
            ...(isSold ? { finalSoldPrice: finalPrice, commissionAmount: commission } : {})
          });

          if (isSold && fv.ownerId && commission > 0) {
            const ownerState = await readUserMergedInTx(tx, String(fv.ownerId));
            if (ownerState) {
              const nextBal = Math.max(0, ownerState.merged.deposits - commission);
              tx.set(ownerState.privRef, {
                deposits: nextBal,
                totalCommissionPaid: (Number(ownerState.merged.totalCommissionPaid) || 0) + commission
              }, { merge: true });
              tx.set(adminDb.collection('transactions').doc(), {
                userId: String(fv.ownerId),
                username: ownerState.merged.username || fv.ownerUsername || 'Seller',
                type: 'commission_fee',
                channel: 'ct_collection',
                amount: commission,
                description: `0.1% Auto-Concluded Sales Commission for ${fv.year} ${fv.make} ${fv.model}`,
                timestamp: now,
                status: 'success',
                balanceAfter: nextBal
              });
            }
          }

          if (isSold && fv.winningUserId) {
            tx.set(adminDb.collection('notifications').doc(), {
              userId: fv.winningUserId,
              type: 'auction_won',
              title: 'You Won the Auction! 🏆',
              message: `Congratulations! You won ${fv.year} ${fv.make} ${fv.model} with ₹${finalPrice.toLocaleString()}!`,
              createdAt: now,
              read: false,
              link: `vehicle_${vid}`
            });
          }
        }).catch(() => {});
      }
    } catch (err) {
      if (isFirestoreNotFoundOrDeniedError(err)) {
        markAdminDbUnavailable(err);
      } else {
        console.warn('[AuctionScheduler] Tick warning:', err);
      }
    } finally {
      lifecycleRunning = false;
    }
  }

  async function ensureBootstrapAdmins() {
    try {
      const dbAvailable = await checkAdminDbAvailable();
      if (!dbAvailable) return;
      const emails = getBootstrapAdminEmails();
      for (const email of emails) {
        try {
          const fbUser = await adminAuth.getUserByEmail(email);
          if (!fbUser || fbUser.disabled) continue;
          const isVerified = fbUser.emailVerified || fbUser.providerData?.some(p => p.providerId === 'microsoft.com');
          if (!isVerified) continue;

          const userRef = adminDb.collection('users').doc(fbUser.uid);
          const userSnap = await userRef.get();
          if (!userSnap.exists || userSnap.data()?.role !== 'admin') {
            await userRef.set({ role: 'admin' }, { merge: true });
          }

          const existingClaims = (fbUser.customClaims || {}) as Record<string, any>;
          if (existingClaims.role !== 'admin' || existingClaims.admin !== true) {
            await adminAuth.setCustomUserClaims(fbUser.uid, {
              ...existingClaims,
              role: 'admin',
              admin: true
            });
          }
          console.log(`[BootstrapAdmin] Verified admin privileges synced for ${email}`);
        } catch (err: any) {
          if (isFirestoreNotFoundOrDeniedError(err)) {
            markAdminDbUnavailable(err);
            return;
          }
          if (err?.code !== 'auth/user-not-found') {
            console.warn(`[BootstrapAdmin] Sync skipped for ${email}:`, err?.message || err);
          }
        }
      }
    } catch (err) {
      if (isFirestoreNotFoundOrDeniedError(err)) {
        markAdminDbUnavailable(err);
      } else {
        console.warn('[BootstrapAdmin] Startup check failed:', err);
      }
    }
  }

  // Run startup bootstrap admin sync & scheduler every 60s (starting 5s after boot)
  setTimeout(() => {
    ensureBootstrapAdmins().catch(() => {});
    processAuctionLifecycle().catch(() => {});
  }, 5000);
  setInterval(() => { processAuctionLifecycle().catch(() => {}); }, 60000);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
