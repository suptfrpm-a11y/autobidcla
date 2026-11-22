/**
 * AutoBid Cookie & Session State Recovery Engine
 * Manages document.cookie, localStorage mirroring for rich drafts (images/specs),
 * and cookie consent preferences.
 */

export interface CookiePreferences {
  essential: boolean;        // Always true (auth, security, tokens)
  sessionRecovery: boolean;  // Resumes vehicle selling, wallet, verification where user left off
  functional: boolean;       // Language, currency, UI settings
  analytics: boolean;        // Experience insights
}

export interface CookieConsentState {
  hasAnswered: boolean;
  consentType: 'all' | 'essential' | 'custom' | null;
  preferences: CookiePreferences;
  timestamp: number;
}

export interface ActiveSessionState {
  view: string;
  vehicleId?: string;
  settingsSection?: string;
  isVerificationOpen?: boolean;
  lastUpdated: number;
}

export interface WorkflowDraft<T = any> {
  step?: number;
  data: T;
  savedAt: number;
}

// Cookie helper functions
export const setCookie = (name: string, value: string, days = 30): void => {
  if (typeof document === 'undefined') return;
  const date = new Date();
  date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
  const expires = `expires=${date.toUTCString()}`;
  const encodedValue = encodeURIComponent(value);
  document.cookie = `${name}=${encodedValue};${expires};path=/;SameSite=Lax`;
};

export const getCookie = (name: string): string | null => {
  if (typeof document === 'undefined') return null;
  const nameEQ = `${name}=`;
  const ca = document.cookie.split(';');
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) === ' ') c = c.substring(1, c.length);
    if (c.indexOf(nameEQ) === 0) {
      try {
        return decodeURIComponent(c.substring(nameEQ.length, c.length));
      } catch {
        return c.substring(nameEQ.length, c.length);
      }
    }
  }
  return null;
};

export const deleteCookie = (name: string): void => {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;SameSite=Lax`;
};

// Cookie Consent storage
const CONSENT_COOKIE_KEY = 'autobid_cookie_consent';
const CONSENT_STORAGE_KEY = 'autobid_cookie_preferences';

export const getCookieConsent = (): CookieConsentState => {
  try {
    const rawCookie = getCookie(CONSENT_COOKIE_KEY);
    const rawStorage = typeof localStorage !== 'undefined' ? localStorage.getItem(CONSENT_STORAGE_KEY) : null;
    const raw = rawCookie || rawStorage;

    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        hasAnswered: true,
        consentType: parsed.consentType || 'all',
        preferences: parsed.preferences || {
          essential: true,
          sessionRecovery: true,
          functional: true,
          analytics: true,
        },
        timestamp: parsed.timestamp || Date.now(),
      };
    }
  } catch (err) {
    console.warn('[CookieManager] Error reading cookie consent:', err);
  }

  return {
    hasAnswered: false,
    consentType: null,
    preferences: {
      essential: true,
      sessionRecovery: true,
      functional: true,
      analytics: false,
    },
    timestamp: 0,
  };
};

export const saveCookieConsent = (
  consentType: 'all' | 'essential' | 'custom',
  customPreferences?: Partial<CookiePreferences>
): void => {
  const preferences: CookiePreferences = {
    essential: true,
    sessionRecovery: consentType === 'essential' ? false : (customPreferences?.sessionRecovery ?? true),
    functional: consentType === 'essential' ? false : (customPreferences?.functional ?? true),
    analytics: consentType === 'essential' ? false : (customPreferences?.analytics ?? true),
  };

  const payload: CookieConsentState = {
    hasAnswered: true,
    consentType,
    preferences,
    timestamp: Date.now(),
  };

  const str = JSON.stringify(payload);
  setCookie(CONSENT_COOKIE_KEY, str, 365);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(CONSENT_STORAGE_KEY, str);
  }
};

// WORKFLOW & DRAFT PERSISTENCE (Vehicle Selling, Verification, Wallet)
const DRAFT_PREFIX = 'autobid_draft_';

export const saveWorkflowDraft = <T = any>(
  workflowKey: string,
  dataOrStep: T | number,
  dataIfStep?: T
): void => {
  let step: number | undefined;
  let data: T;
  if (typeof dataOrStep === 'number' && dataIfStep !== undefined) {
    step = dataOrStep;
    data = dataIfStep;
  } else {
    data = dataOrStep as T;
  }

  try {
    const serialized = JSON.stringify({
      step,
      data,
      savedAt: Date.now(),
    });
    // Set lightweight cookie pointer to indicate active draft exists
    setCookie(`${DRAFT_PREFIX}${workflowKey}_active`, 'true', 14);

    // Store in localStorage for complete object / image payloads
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`${DRAFT_PREFIX}${workflowKey}`, serialized);
    }
  } catch (err) {
    console.warn(`[CookieManager] Error saving draft for ${workflowKey}:`, err);
  }
};

export const getWorkflowDraft = <T = any>(workflowKey: string): WorkflowDraft<T> | null => {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(`${DRAFT_PREFIX}${workflowKey}`);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (parsed && (parsed.data !== undefined || parsed.step !== undefined)) {
      return parsed as WorkflowDraft<T>;
    }
  } catch (err) {
    console.warn(`[CookieManager] Error loading draft for ${workflowKey}:`, err);
  }
  return null;
};

export const clearWorkflowDraft = (workflowKey: string): void => {
  try {
    deleteCookie(`${DRAFT_PREFIX}${workflowKey}_active`);
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(`${DRAFT_PREFIX}${workflowKey}`);
    }
  } catch (err) {
    console.warn(`[CookieManager] Error clearing draft for ${workflowKey}:`, err);
  }
};

// ACTIVE SESSION RESTORATION (Where user left off on browser close / refresh)
const SESSION_COOKIE_KEY = 'autobid_active_session';

export const saveActiveSession = (
  viewOrSession: string | Partial<ActiveSessionState>,
  extra?: Partial<ActiveSessionState>
): void => {
  try {
    let payload: ActiveSessionState;
    if (typeof viewOrSession === 'string') {
      payload = {
        view: viewOrSession,
        vehicleId: extra?.vehicleId,
        settingsSection: extra?.settingsSection,
        isVerificationOpen: Boolean(extra?.isVerificationOpen),
        lastUpdated: Date.now(),
      };
    } else {
      payload = {
        view: viewOrSession.view || 'home',
        vehicleId: viewOrSession.vehicleId,
        settingsSection: viewOrSession.settingsSection,
        isVerificationOpen: Boolean(viewOrSession.isVerificationOpen),
        lastUpdated: Date.now(),
      };
    }

    const str = JSON.stringify(payload);
    setCookie(SESSION_COOKIE_KEY, str, 7);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SESSION_COOKIE_KEY, str);
    }
  } catch (err) {
    console.warn('[CookieManager] Error saving active session:', err);
  }
};

export const getActiveSession = (): ActiveSessionState | null => {
  try {
    const rawCookie = getCookie(SESSION_COOKIE_KEY);
    const rawStorage = typeof localStorage !== 'undefined' ? localStorage.getItem(SESSION_COOKIE_KEY) : null;
    const raw = rawCookie || rawStorage;

    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Discard stale sessions older than 7 days
    if (parsed && parsed.lastUpdated && Date.now() - parsed.lastUpdated < 7 * 24 * 60 * 60 * 1000) {
      return parsed as ActiveSessionState;
    }
  } catch (err) {
    console.warn('[CookieManager] Error loading active session:', err);
  }
  return null;
};

export const clearActiveSession = (): void => {
  try {
    deleteCookie(SESSION_COOKIE_KEY);
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(SESSION_COOKIE_KEY);
    }
  } catch (err) {
    console.warn('[CookieManager] Error clearing active session:', err);
  }
};
