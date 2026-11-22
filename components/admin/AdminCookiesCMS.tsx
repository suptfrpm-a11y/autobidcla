import React, { useState, useEffect } from 'react';
import { db, doc, onSnapshot, setDoc } from '../../firebase';
import { User } from '../../types';
import { logAdminAction } from './adminAuditHelper';
import { getCookie, getCookieConsent } from '../../utils/cookieManager';

interface AdminCookiesCMSProps {
  currentUser: User;
}

interface PlatformCookieConfig {
  autoRestoreEnabled: boolean;
  draftRetentionDays: number;
  consentStrictness: 'strict' | 'balanced' | 'relaxed';
  policyVersion: string;
  requireReconsent: boolean;
  sessionTimeoutHours: number;
  lastUpdatedBy?: string;
  lastUpdatedAt?: number;
}

export const AdminCookiesCMS: React.FC<AdminCookiesCMSProps> = ({ currentUser }) => {
  const [config, setConfig] = useState<PlatformCookieConfig>({
    autoRestoreEnabled: true,
    draftRetentionDays: 14,
    consentStrictness: 'balanced',
    policyVersion: '1.2.0',
    requireReconsent: false,
    sessionTimeoutHours: 72,
  });

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Local Browser Diagnostics State
  const [localCookiesCount, setLocalCookiesCount] = useState<number>(0);
  const [localDrafts, setLocalDrafts] = useState<Record<string, boolean>>({});
  const [activeConsent, setActiveConsent] = useState<any>(null);

  // 1. Subscribe to Firestore settings for cookie_policy
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'cookie_policy'), (snap) => {
      if (snap.exists()) {
        const data = snap.data() as PlatformCookieConfig;
        setConfig({
          autoRestoreEnabled: data.autoRestoreEnabled ?? true,
          draftRetentionDays: data.draftRetentionDays || 14,
          consentStrictness: data.consentStrictness || 'balanced',
          policyVersion: data.policyVersion || '1.2.0',
          requireReconsent: Boolean(data.requireReconsent),
          sessionTimeoutHours: data.sessionTimeoutHours || 72,
          lastUpdatedBy: data.lastUpdatedBy,
          lastUpdatedAt: data.lastUpdatedAt,
        });
      }
      setIsLoading(false);
    }, (err) => {
      console.warn("Cookie config fetch error:", err);
      setIsLoading(false);
    });

    return () => unsub();
  }, []);

  // 2. Scan Local Browser Cookies & LocalStorage for Administrator Diagnostics
  const scanLocalState = () => {
    if (typeof document === 'undefined') return;
    const cookieList = document.cookie ? document.cookie.split(';').map(c => c.trim()) : [];
    setLocalCookiesCount(cookieList.length);

    if (typeof localStorage !== 'undefined') {
      setLocalDrafts({
        sell_draft: Boolean(localStorage.getItem('autobid_draft_sell')),
        verification_draft: Boolean(localStorage.getItem('autobid_draft_verification')),
        wallet_draft: Boolean(localStorage.getItem('autobid_draft_wallet')),
        active_session: Boolean(localStorage.getItem('autobid_active_session')),
      });
    }

    setActiveConsent(getCookieConsent());
  };

  useEffect(() => {
    scanLocalState();
  }, []);

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveSuccess(false);

    try {
      const payload: PlatformCookieConfig = {
        ...config,
        lastUpdatedBy: currentUser.username || currentUser.email || 'Admin',
        lastUpdatedAt: Date.now(),
      };

      await setDoc(doc(db, 'settings', 'cookie_policy'), payload, { merge: true });

      await logAdminAction(
        currentUser,
        'UPDATE_COOKIE_POLICY',
        'settings',
        'cookie_policy',
        `Updated platform cookie policy: AutoRestore=${config.autoRestoreEnabled}, Retention=${config.draftRetentionDays}d, Version=${config.policyVersion}`
      );

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 4000);
    } catch (err: any) {
      alert("Failed to save cookie policy configuration: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearTestDrafts = () => {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('autobid_draft_sell');
      localStorage.removeItem('autobid_draft_verification');
      localStorage.removeItem('autobid_draft_wallet');
      localStorage.removeItem('autobid_active_session');
    }
    scanLocalState();
    alert("Local diagnostic workflow drafts have been cleared from this device.");
  };

  const cookieInventory = [
    {
      name: 'autobid_active_session',
      category: 'Session Recovery',
      type: 'Cookie + LocalStorage',
      duration: '7 Days',
      purpose: 'Remembers which page, workflow, and vehicle step the user was viewing so they resume seamlessly when reopening the site.',
      status: 'Mandatory for Auto-Restore'
    },
    {
      name: 'autobid_draft_sell',
      category: 'Workflow Memory',
      type: 'LocalStorage',
      duration: `${config.draftRetentionDays} Days`,
      purpose: 'Preserves vehicle specifications, uploaded car photos, pricing mode, and schedule details across Steps 1 to 6.',
      status: 'Active'
    },
    {
      name: 'autobid_draft_verification',
      category: 'Identity KYC',
      type: 'LocalStorage',
      duration: `${config.draftRetentionDays} Days`,
      purpose: 'Saves user progress through Step 1 mobile phone OTP verification and Step 2 document uploads.',
      status: 'Active'
    },
    {
      name: 'autobid_draft_wallet',
      category: 'Financial Operations',
      type: 'LocalStorage',
      duration: '7 Days',
      purpose: 'Remembers active deposit amount inputs, platform payment selections, and wallet transfer notes.',
      status: 'Active'
    },
    {
      name: 'autobid_cookie_consent',
      category: 'Consent Management',
      type: 'Cookie + LocalStorage',
      duration: '365 Days',
      purpose: 'Stores user consent preferences (Accept All, Essential Only, Custom Preferences) according to privacy regulations.',
      status: 'System Essential'
    },
    {
      name: 'autobid_cookie_preferences',
      category: 'Granular Controls',
      type: 'LocalStorage',
      duration: '365 Days',
      purpose: 'Tracks granular consent switches for Session Recovery, Functional Localization, and Performance Analytics.',
      status: 'System Essential'
    }
  ];

  if (isLoading) {
    return (
      <div className="py-16 text-center text-gray-500">
        <div className="animate-spin w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full mx-auto mb-3"></div>
        <p className="text-xs font-semibold">Loading platform cookie management suite...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Module Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-5 rounded-3xl border border-gray-200/90 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-9 h-9 rounded-2xl bg-amber-500/20 text-amber-800 border border-amber-300 flex items-center justify-center font-bold text-lg">
              🍪
            </span>
            <div>
              <h2 className="text-lg sm:text-xl font-black text-gray-900 tracking-tight flex items-center gap-2">
                <span>Cookie Management & Session Recovery Governance</span>
                <span className="text-[10px] bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold px-2 py-0.5 rounded-full uppercase">
                  Active
                </span>
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Centralized operational control over user cookies, session recovery retention, draft persistence, and privacy consent.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {config.lastUpdatedAt && (
            <span className="text-[11px] text-gray-400">
              Last saved by <strong className="text-gray-700">@{config.lastUpdatedBy}</strong> on {new Date(config.lastUpdatedAt).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>

      {saveSuccess && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-4 py-3 rounded-2xl text-xs font-bold flex items-center gap-2 animate-fade-in">
          <span>✓</span>
          <span>Cookie management policy & auto-restore settings saved successfully to Firestore!</span>
        </div>
      )}

      {/* Main Governance Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left 2 Cols: Platform Policy Form */}
        <form onSubmit={handleSaveConfig} className="lg:col-span-2 bg-white rounded-3xl p-5 sm:p-6 border border-gray-200/90 shadow-xs space-y-5">
          <div className="border-b border-gray-100 pb-3 flex items-center justify-between">
            <h3 className="text-sm font-black text-gray-900 uppercase tracking-wider flex items-center gap-2">
              <span>⚙️</span>
              <span>Global Session & Draft Policy Settings</span>
            </h3>
            <span className="text-xs text-amber-600 font-bold">Applies Platform-Wide</span>
          </div>

          <div className="space-y-4 text-xs">
            {/* Auto-Restore Switch */}
            <div className="flex items-center justify-between p-3.5 bg-amber-50/60 rounded-2xl border border-amber-200">
              <div>
                <span className="font-bold text-gray-900 text-sm block">
                  Workflow Auto-Restore & Draft Continuity
                </span>
                <p className="text-gray-500 text-[11px] mt-0.5 max-w-md leading-relaxed">
                  When enabled, users who exit while selling a vehicle (Steps 1–6), completing verification, or managing wallet balance resume right where they left off upon reopening.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer ml-3 shrink-0">
                <input
                  type="checkbox"
                  checked={config.autoRestoreEnabled}
                  onChange={(e) => setConfig({ ...config, autoRestoreEnabled: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-600"></div>
              </label>
            </div>

            {/* Draft Retention Days */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-bold text-gray-700 mb-1">
                  Draft & Session Retention Window (Days)
                </label>
                <select
                  value={config.draftRetentionDays}
                  onChange={(e) => setConfig({ ...config, draftRetentionDays: parseInt(e.target.value, 10) })}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-2.5 text-xs text-gray-900 font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value={3}>3 Days</option>
                  <option value={7}>7 Days (Standard)</option>
                  <option value={14}>14 Days (Recommended for car listings)</option>
                  <option value={30}>30 Days (Extended)</option>
                </select>
                <span className="text-[10px] text-gray-400 mt-1 block">In-progress vehicle drafts auto-expire after this period.</span>
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">
                  Consent Enforcement Mode
                </label>
                <select
                  value={config.consentStrictness}
                  onChange={(e) => setConfig({ ...config, consentStrictness: e.target.value as any })}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-2.5 text-xs text-gray-900 font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value="balanced">Balanced (Auto-restore active; banner informs user)</option>
                  <option value="strict">Strict (Require explicit consent click before saving any draft)</option>
                  <option value="relaxed">Relaxed (Implicit consent on navigation)</option>
                </select>
                <span className="text-[10px] text-gray-400 mt-1 block">Controls how early drafts are captured.</span>
              </div>
            </div>

            {/* Policy Version & Re-consent */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-gray-100">
              <div>
                <label className="block font-bold text-gray-700 mb-1">
                  Cookie Policy Version Tag
                </label>
                <input
                  type="text"
                  value={config.policyVersion}
                  onChange={(e) => setConfig({ ...config, policyVersion: e.target.value })}
                  placeholder="e.g. 1.2.0"
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-2.5 text-xs text-gray-900 font-mono font-bold focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="flex flex-col justify-end">
                <label className="flex items-center gap-2 p-2.5 bg-gray-50 border border-gray-200 rounded-xl cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.requireReconsent}
                    onChange={(e) => setConfig({ ...config, requireReconsent: e.target.checked })}
                    className="w-4 h-4 text-amber-600 rounded border-gray-300 focus:ring-amber-500"
                  />
                  <span className="text-xs font-bold text-gray-800">
                    Prompt users to re-consent on next visit
                  </span>
                </label>
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-gray-100 flex items-center justify-end gap-3">
            <button
              type="submit"
              disabled={isSaving}
              className="px-6 py-2.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 text-white font-bold text-xs rounded-xl shadow-md transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isSaving ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  <span>Saving Configuration...</span>
                </>
              ) : (
                <span>Save Cookie Policy Settings</span>
              )}
            </button>
          </div>
        </form>

        {/* Right Col: Admin Diagnostic Terminal */}
        <div className="space-y-4">
          <div className="bg-slate-900 text-white rounded-3xl p-5 border border-slate-800 shadow-md">
            <div className="flex items-center justify-between mb-3 border-b border-slate-800 pb-2.5">
              <span className="text-xs font-mono font-bold text-amber-400 flex items-center gap-1.5">
                <span>💻</span> Local Storage & Cookie Inspector
              </span>
              <button
                type="button"
                onClick={scanLocalState}
                className="text-[10px] text-gray-400 hover:text-white font-mono underline"
              >
                Rescan
              </button>
            </div>

            <div className="space-y-2.5 text-xs font-mono">
              <div className="flex justify-between border-b border-slate-800/80 pb-1.5">
                <span className="text-gray-400">Cookies Detected:</span>
                <span className="text-white font-bold">{localCookiesCount} cookie(s)</span>
              </div>

              <div className="flex justify-between border-b border-slate-800/80 pb-1.5">
                <span className="text-gray-400">Consent Stored:</span>
                <span className={activeConsent?.hasAnswered ? "text-emerald-400 font-bold" : "text-amber-400"}>
                  {activeConsent?.consentType ? `Yes (${activeConsent.consentType})` : "Unset"}
                </span>
              </div>

              <div className="pt-1 text-[11px] text-gray-400">
                <span className="text-gray-300 font-bold block mb-1">Active Drafts on This Device:</span>
                <div className="space-y-1 pl-2">
                  <div className="flex justify-between">
                    <span>• Sell Vehicle Draft:</span>
                    <span className={localDrafts.sell_draft ? "text-emerald-400 font-bold" : "text-gray-500"}>
                      {localDrafts.sell_draft ? "Present" : "None"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>• Verification Draft:</span>
                    <span className={localDrafts.verification_draft ? "text-emerald-400 font-bold" : "text-gray-500"}>
                      {localDrafts.verification_draft ? "Present" : "None"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>• Wallet Draft:</span>
                    <span className={localDrafts.wallet_draft ? "text-emerald-400 font-bold" : "text-gray-500"}>
                      {localDrafts.wallet_draft ? "Present" : "None"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>• Last Active Session:</span>
                    <span className={localDrafts.active_session ? "text-emerald-400 font-bold" : "text-gray-500"}>
                      {localDrafts.active_session ? "Present" : "None"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={handleClearTestDrafts}
                  className="w-full py-2 bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/40 font-bold text-xs rounded-xl transition cursor-pointer"
                >
                  Clear Local Diagnostic Drafts
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Cookie & Token Inventory Table */}
      <div className="bg-white rounded-3xl p-5 sm:p-6 border border-gray-200/90 shadow-xs">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
          <div>
            <h3 className="text-sm font-black text-gray-900 uppercase tracking-wider flex items-center gap-2">
              <span>📋</span>
              <span>Platform Cookie & LocalStorage Token Inventory</span>
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Live specification of all persistence tokens used for workflow recovery and user preferences.
            </p>
          </div>
          <span className="text-xs font-mono font-bold bg-gray-100 text-gray-700 px-2.5 py-1 rounded-xl">
            {cookieInventory.length} Registered Tokens
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-gray-50 text-gray-500 uppercase text-[10px] tracking-wider border-b border-gray-100 font-black">
                <th className="py-2.5 px-3">Token Name</th>
                <th className="py-2.5 px-3">Category</th>
                <th className="py-2.5 px-3">Storage Layer</th>
                <th className="py-2.5 px-3">Default Duration</th>
                <th className="py-2.5 px-3">Functional Purpose</th>
                <th className="py-2.5 px-3">Governance Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 font-medium text-gray-700">
              {cookieInventory.map((item, idx) => (
                <tr key={idx} className="hover:bg-amber-50/40 transition">
                  <td className="py-2.5 px-3 font-mono font-bold text-gray-900">{item.name}</td>
                  <td className="py-2.5 px-3">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-200">
                      {item.category}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 font-mono text-[11px] text-gray-600">{item.type}</td>
                  <td className="py-2.5 px-3 font-semibold text-gray-800">{item.duration}</td>
                  <td className="py-2.5 px-3 text-gray-600 max-w-sm leading-relaxed">{item.purpose}</td>
                  <td className="py-2.5 px-3">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                      {item.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
