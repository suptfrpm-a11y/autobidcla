import fs from 'fs';
import path from 'path';
import {
  adminDb,
  checkAdminDbAvailable,
  isFirestoreNotFoundOrDeniedError,
  markAdminDbUnavailable
} from './firebaseAdmin';

export interface ServerStateSchema {
  sessions: Record<string, any>;
  revokedUserIds: Record<string, number>;
  content_banners: Record<string, any>;
  hasInitializedBanners: boolean;
  ai_brain_sessions: Record<string, any>;
  ai_chats: Record<string, any>;
  support_tickets: Record<string, any>;
  appeals: Record<string, any>;
  processed_payments: Record<string, any>;
}

const DATA_DIR = path.join(process.cwd(), 'data');
const STATE_PATH = path.join(DATA_DIR, 'server_state.json');

function loadLocalState(): ServerStateSchema {
  let parsed: Partial<ServerStateSchema> = {};
  try {
    if (fs.existsSync(STATE_PATH)) {
      parsed = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
    }
  } catch (err) {
    console.warn('[ServerState] Failed reading local server_state.json:', err);
  }
  return {
    sessions: parsed.sessions || {},
    revokedUserIds: parsed.revokedUserIds || {},
    content_banners: parsed.content_banners || {},
    hasInitializedBanners: parsed.hasInitializedBanners ?? false,
    ai_brain_sessions: parsed.ai_brain_sessions || {},
    ai_chats: parsed.ai_chats || {},
    support_tickets: parsed.support_tickets || {},
    appeals: parsed.appeals || {},
    processed_payments: parsed.processed_payments || {}
  };
}

export const serverState: ServerStateSchema = loadLocalState();

export function persistLocalState() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(STATE_PATH, JSON.stringify(serverState, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[ServerState] Could not write server_state.json:', err);
  }
}

export async function readCollectionMerged(
  collectionName: 'content_banners' | 'sessions' | 'ai_chats' | 'ai_brain_sessions' | 'tickets' | 'appeals' | 'users' | 'user_private' | 'vehicles' | 'transactions',
  localRecordMap?: Record<string, any>
): Promise<any[]> {
  try {
    if (await checkAdminDbAvailable()) {
      const snap = await adminDb.collection(collectionName).get();
      const items: any[] = [];
      snap.forEach(d => items.push({ id: d.id, ...d.data() }));
      if (items.length > 0) return items;
    }
  } catch (err) {
    if (isFirestoreNotFoundOrDeniedError(err)) {
      markAdminDbUnavailable(err);
    } else {
      console.warn(`[ServerState] Firestore read fallback for ${collectionName}:`, err);
    }
  }
  return Object.values(localRecordMap || {});
}

export async function upsertDocDual(
  collectionName: string,
  docId: string,
  data: Record<string, any>,
  localTarget?: Record<string, any>
) {
  if (localTarget) {
    localTarget[docId] = { ...(localTarget[docId] || {}), ...data, id: docId };
    persistLocalState();
  }
  try {
    if (await checkAdminDbAvailable()) {
      await adminDb.collection(collectionName).doc(docId).set({ ...data, id: docId }, { merge: true });
    }
  } catch (err) {
    if (isFirestoreNotFoundOrDeniedError(err)) {
      markAdminDbUnavailable(err);
    } else {
      console.warn(`[ServerState] Firestore upsert warning (${collectionName}/${docId}):`, err);
    }
  }
}

export async function deleteDocDual(
  collectionName: string,
  docId: string,
  localTarget?: Record<string, any>
) {
  if (localTarget && localTarget[docId]) {
    delete localTarget[docId];
    persistLocalState();
  }
  try {
    if (await checkAdminDbAvailable()) {
      await adminDb.collection(collectionName).doc(docId).delete();
    }
  } catch (err) {
    if (isFirestoreNotFoundOrDeniedError(err)) {
      markAdminDbUnavailable(err);
    } else {
      console.warn(`[ServerState] Firestore delete warning (${collectionName}/${docId}):`, err);
    }
  }
}
