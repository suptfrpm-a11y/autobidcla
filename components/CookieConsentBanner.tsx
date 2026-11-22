import React, { useState, useEffect } from 'react';
import { Cookie, ShieldCheck, RefreshCw, Globe, BarChart3, X, ArrowRight } from 'lucide-react';
import { getCookieConsent, saveCookieConsent, CookiePreferences } from '../utils/cookieManager';

interface CookieConsentBannerProps {
  onOpenPolicy?: () => void;
  isOpenExternal?: boolean;
  onCloseExternal?: () => void;
}

export const CookieConsentBanner: React.FC<CookieConsentBannerProps> = ({
  onOpenPolicy,
  isOpenExternal,
  onCloseExternal,
}) => {
  const [showBanner, setShowBanner] = useState(false);
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [preferences, setPreferences] = useState<CookiePreferences>({
    essential: true,
    sessionRecovery: true,
    functional: true,
    analytics: true,
  });

  useEffect(() => {
    const consent = getCookieConsent();
    if (!consent.hasAnswered) {
      const timer = setTimeout(() => setShowBanner(true), 1200);
      return () => clearTimeout(timer);
    } else {
      setPreferences(consent.preferences);
    }
  }, []);

  useEffect(() => {
    if (isOpenExternal) {
      setShowCustomModal(true);
    }
  }, [isOpenExternal]);

  const handleAcceptAll = () => {
    saveCookieConsent('all');
    setShowBanner(false);
    setShowCustomModal(false);
    if (onCloseExternal) onCloseExternal();
  };

  const handleEssentialOnly = () => {
    saveCookieConsent('essential');
    setShowBanner(false);
    setShowCustomModal(false);
    if (onCloseExternal) onCloseExternal();
  };

  const handleSaveCustom = () => {
    saveCookieConsent('custom', preferences);
    setShowBanner(false);
    setShowCustomModal(false);
    if (onCloseExternal) onCloseExternal();
  };

  if (!showBanner && !showCustomModal && !isOpenExternal) {
    return null;
  }

  return (
    <>
      {/* FLOATING COOKIE CONSENT BANNER (positioned bottom-left on desktop so it never overlaps bottom-right AI Help icon) */}
      {showBanner && !showCustomModal && (
        <aside
          role="region"
          aria-label="Cookie and session recovery consent"
          className="fixed bottom-24 left-4 right-4 sm:right-auto sm:max-w-md z-40 bg-white text-gray-900 rounded-lg p-4 shadow-md border border-gray-200"
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-gray-100 text-gray-700 border border-gray-200 flex items-center justify-center shrink-0">
              <Cookie className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2 mb-1">
                <h3 className="text-sm font-semibold text-gray-900">
                  Cookies &amp; Auto-Restore
                </h3>
                <span className="text-[11px] bg-gray-100 text-gray-600 border border-gray-200 px-2 py-0.5 rounded-lg font-medium">
                  Session Memory
                </span>
              </div>
              <p className="text-xs text-gray-600 leading-relaxed mb-3">
                AutoBid uses cookies and local storage to save your in-progress vehicle listings, identity verification, and wallet drafts so you can resume where you left off.
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleAcceptAll}
                  className="px-3.5 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold text-xs rounded-lg transition-colors cursor-pointer"
                >
                  Accept All
                </button>
                <button
                  type="button"
                  onClick={handleEssentialOnly}
                  className="px-3 py-2 bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-700 font-medium text-xs rounded-lg transition-colors cursor-pointer"
                >
                  Essential Only
                </button>
                <button
                  type="button"
                  onClick={() => setShowCustomModal(true)}
                  className="px-2 py-2 text-xs font-medium text-gray-600 hover:text-gray-900 underline cursor-pointer"
                >
                  Preferences
                </button>
              </div>

              {onOpenPolicy && (
                <div className="mt-3 pt-2 border-t border-gray-200 flex items-center justify-between text-xs text-gray-500">
                  <span>Draft state retained on device.</span>
                  <button
                    type="button"
                    onClick={onOpenPolicy}
                    className="text-red-600 hover:text-red-700 font-medium inline-flex items-center gap-1 cursor-pointer"
                  >
                    <span>Cookie Policy</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </aside>
      )}

      {/* CUSTOMIZE COOKIE PREFERENCES MODAL */}
      {showCustomModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-lg max-w-lg w-full max-h-[90vh] flex flex-col shadow-md overflow-hidden border border-gray-200">
            <div className="p-4 sm:p-5 border-b border-gray-200 bg-white flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-gray-100 text-gray-700 border border-gray-200 flex items-center justify-center shrink-0">
                  <Cookie className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 text-base">
                    Cookie &amp; Storage Preferences
                  </h3>
                  <p className="text-xs text-gray-500">
                    Configure how AutoBid remembers your work across sessions
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowCustomModal(false);
                  if (onCloseExternal) onCloseExternal();
                }}
                className="w-8 h-8 rounded-lg bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-600 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-3 text-xs">
              <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2 font-semibold text-gray-900 text-sm">
                    <ShieldCheck className="w-4 h-4 text-green-600" />
                    <span>Strictly Necessary Cookies</span>
                  </div>
                  <span className="text-[11px] bg-white border border-gray-200 text-gray-700 font-medium px-2 py-0.5 rounded-lg">
                    Always Active
                  </span>
                </div>
                <p className="text-gray-600 leading-relaxed">
                  Required for user authentication, security verification, fraud protection, and core auction mechanics.
                </p>
              </div>

              <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2 font-semibold text-gray-900 text-sm">
                    <RefreshCw className="w-4 h-4 text-gray-700" />
                    <span>Workflow Draft &amp; Session Recovery</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={preferences.sessionRecovery}
                      onChange={(e) =>
                        setPreferences({ ...preferences, sessionRecovery: e.target.checked })
                      }
                      className="sr-only peer"
                    />
                    <div className="w-10 h-5 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-red-600" />
                  </label>
                </div>
                <p className="text-gray-600 leading-relaxed">
                  Automatically remembers your vehicle selling progress (steps 1 to 6), uploaded car images, KYC steps, and wallet drafts.
                </p>
              </div>

              <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2 font-semibold text-gray-900 text-sm">
                    <Globe className="w-4 h-4 text-gray-700" />
                    <span>Functional &amp; Language Preferences</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={preferences.functional}
                      onChange={(e) =>
                        setPreferences({ ...preferences, functional: e.target.checked })
                      }
                      className="sr-only peer"
                    />
                    <div className="w-10 h-5 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-red-600" />
                  </label>
                </div>
                <p className="text-gray-600 leading-relaxed">
                  Stores your chosen display language and sound settings.
                </p>
              </div>

              <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2 font-semibold text-gray-900 text-sm">
                    <BarChart3 className="w-4 h-4 text-gray-700" />
                    <span>Performance &amp; Experience Optimization</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={preferences.analytics}
                      onChange={(e) =>
                        setPreferences({ ...preferences, analytics: e.target.checked })
                      }
                      className="sr-only peer"
                    />
                    <div className="w-10 h-5 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-red-600" />
                  </label>
                </div>
                <p className="text-gray-600 leading-relaxed">
                  Helps diagnose network latency for real-time live auctions.
                </p>
              </div>
            </div>

            <div className="p-4 border-t border-gray-200 bg-gray-50 flex flex-wrap items-center justify-between gap-2">
              {onOpenPolicy && (
                <button
                  type="button"
                  onClick={() => {
                    setShowCustomModal(false);
                    onOpenPolicy();
                  }}
                  className="text-xs text-red-600 hover:underline font-medium"
                >
                  View Full Cookie Policy
                </button>
              )}

              <div className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={handleEssentialOnly}
                  className="px-3.5 py-2 bg-white hover:bg-gray-100 border border-gray-200 text-gray-800 text-xs font-medium rounded-lg transition-colors"
                >
                  Essential Only
                </button>
                <button
                  type="button"
                  onClick={handleSaveCustom}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg transition-colors"
                >
                  Save Preferences
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
