import React, { useState, useEffect } from 'react';
import { Tag, Zap, CheckCircle2, AlertTriangle, X, Save } from 'lucide-react';
import { db, doc, onSnapshot, setDoc } from '../../firebase';
import { AppVersionInfo, User } from '../../types';
import { logAdminAction } from './adminAuditHelper';

interface AdminVersionControlProps {
  currentUser: User;
}

export const AdminVersionControl: React.FC<AdminVersionControlProps> = ({ currentUser }) => {
  const [versionInfo, setVersionInfo] = useState<AppVersionInfo>({
    currentVersion: '2.4.0',
    minRequiredVersion: '2.3.0',
    forceUpdateEnabled: false,
    updateMessage: 'A critical real-time auction performance update has been deployed. Please reload the page to apply the latest security patches.',
    lastUpdated: Date.now()
  });
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmBroadcast, setConfirmBroadcast] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'version_control'), (snap) => {
      if (snap.exists()) {
        setVersionInfo(snap.data() as AppVersionInfo);
      }
    });
    return () => unsub();
  }, []);

  const showNotice = (type: 'success' | 'error', text: string) => {
    setNotice({ type, text });
    setTimeout(() => setNotice(null), 4000);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await setDoc(doc(db, 'settings', 'version_control'), {
        ...versionInfo,
        lastUpdated: Date.now(),
        updatedBy: currentUser.email || currentUser.username
      });
      await logAdminAction(
        currentUser,
        'UPDATE_VERSION_POLICY',
        'settings',
        'version_control',
        `Current: ${versionInfo.currentVersion}, Min: ${versionInfo.minRequiredVersion}, ForceUpdate: ${versionInfo.forceUpdateEnabled}`
      );
      showNotice('success', 'Version policy updated.');
    } catch (err: any) {
      showNotice('error', 'Error updating version control: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleBroadcastReload = async () => {
    if (!confirmBroadcast) {
      setConfirmBroadcast(true);
      return;
    }
    setConfirmBroadcast(false);
    try {
      await setDoc(doc(db, 'settings', 'version_control'), {
        ...versionInfo,
        reloadTriggerTimestamp: Date.now(),
        lastUpdated: Date.now()
      });
      await logAdminAction(
        currentUser,
        'TRIGGER_CLIENT_RELOAD_PING',
        'settings',
        'version_control',
        'Triggered live client reload signal'
      );
      showNotice('success', 'Broadcast refresh signal sent to active client sessions.');
    } catch (err: any) {
      showNotice('error', 'Failed to broadcast refresh: ' + err.message);
    }
  };

  return (
    <div className="space-y-6">
      {notice && (
        <div className={`p-3.5 rounded-lg border text-xs font-medium flex items-center justify-between ${
          notice.type === 'success'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          <span className="flex items-center gap-2">
            {notice.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            )}
            <span>{notice.text}</span>
          </span>
          <button type="button" onClick={() => setNotice(null)} className="cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-5 rounded-lg border border-gray-200 shadow-xs">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Force-Update & App Version Control</h2>
          <p className="text-xs text-gray-500 mt-1">
            Enforce mandatory client app versions and prevent outdated browsers from interacting with live auctions.
          </p>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-xs space-y-4">
          <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
            <Tag className="w-4 h-4 text-gray-500" />
            <span>Semantic Version Parameters</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Current Production Version
              </label>
              <input
                type="text"
                required
                value={versionInfo.currentVersion}
                onChange={(e) => setVersionInfo(prev => ({ ...prev, currentVersion: e.target.value }))}
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-mono font-semibold outline-none focus:ring-2 focus:ring-gray-900"
                placeholder="2.4.0"
              />
              <p className="text-[11px] text-gray-500 mt-1">Latest stable release deployed to users.</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Minimum Required Version (Hard Floor)
              </label>
              <input
                type="text"
                required
                value={versionInfo.minRequiredVersion}
                onChange={(e) => setVersionInfo(prev => ({ ...prev, minRequiredVersion: e.target.value }))}
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-mono font-semibold outline-none focus:ring-2 focus:ring-gray-900"
                placeholder="2.3.0"
              />
              <p className="text-[11px] text-gray-500 mt-1">Clients below this version are prompted to refresh.</p>
            </div>
          </div>
        </div>

        <div className={`p-5 rounded-lg border transition-all ${versionInfo.forceUpdateEnabled ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200 shadow-xs'}`}>
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="font-semibold text-gray-900 text-sm">Force-Update Hard Gate</h3>
              <p className="text-xs text-gray-500">When enabled, clients below the minimum version are blocked from bidding until they reload.</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer ml-4 shrink-0">
              <input
                type="checkbox"
                checked={versionInfo.forceUpdateEnabled}
                onChange={(e) => setVersionInfo(prev => ({ ...prev, forceUpdateEnabled: e.target.checked }))}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-600"></div>
            </label>
          </div>

          <div className="mt-4 pt-4 border-t border-gray-200 space-y-2">
            <label className="block text-xs font-medium text-gray-700">Client Update Prompt Notice</label>
            <textarea
              rows={2}
              value={versionInfo.updateMessage}
              onChange={(e) => setVersionInfo(prev => ({ ...prev, updateMessage: e.target.value }))}
              className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-gray-900"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <button
            type="button"
            onClick={handleBroadcastReload}
            className={`px-4 py-2 text-xs font-medium rounded-lg inline-flex items-center gap-2 cursor-pointer border ${
              confirmBroadcast
                ? 'bg-red-600 text-white border-red-600'
                : 'bg-white hover:bg-gray-50 text-gray-700 border-gray-200'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>{confirmBroadcast ? 'Confirm Broadcast Refresh Signal' : 'Broadcast Live Client Refresh'}</span>
          </button>

          <button
            type="submit"
            disabled={isSaving}
            className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-lg inline-flex items-center gap-2 disabled:opacity-50 cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{isSaving ? 'Updating...' : 'Publish Version Policy'}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
