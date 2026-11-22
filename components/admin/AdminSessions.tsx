import React, { useState, useEffect } from 'react';
import {
  Smartphone,
  RefreshCw,
  Zap,
  Users,
  CheckCircle2,
  Moon,
  AlertTriangle,
  Lock,
  Search,
  X,
  Globe,
  Laptop,
  Brain,
  History,
  Loader2
} from 'lucide-react';
import { User, DeviceSessionRecord, DeviceTimelineEntry } from '../../types';
import { logAdminAction } from './adminAuditHelper';
import { authFetch } from '../../utils/apiClient';

interface AdminSessionsProps {
  currentUser: User;
  users: User[];
  onOpenAiBrainWithQuery?: (query: string) => void;
}

export const AdminSessions: React.FC<AdminSessionsProps> = ({ currentUser, users, onOpenAiBrainWithQuery }) => {
  const [sessions, setSessions] = useState<DeviceSessionRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterMode, setFilterMode] = useState<'all' | 'online' | 'offline' | 'shared_ips' | 'terminated'>('all');
  const [selectedSessionDetails, setSelectedSessionDetails] = useState<DeviceSessionRecord | null>(null);
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);
  const [actionErrorMsg, setActionErrorMsg] = useState<string | null>(null);
  const [isRevoking, setIsRevoking] = useState<boolean>(false);
  const [confirmAction, setConfirmAction] = useState<{ type: 'single' | 'global'; userId?: string } | null>(null);

  const fetchSessions = async () => {
    try {
      const res = await authFetch('/api/sessions');
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.sessions) {
          setSessions(data.sessions);
        }
      }
    } catch (err) {
      console.error('[AdminSessions] Error fetching live sessions:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 6000);
    return () => clearInterval(interval);
  }, []);

  const totalAccounts = users.length > 0 ? users.length : sessions.length;
  const onlineAccounts = sessions.filter(s => s.isOnline && s.status !== 'revoked').length;
  const offlineAccounts = sessions.filter(s => !s.isOnline && s.status !== 'revoked').length;
  const ipCollisionAccounts = sessions.filter(s => s.ipCollisionWarning).length;
  const terminatedAccounts = sessions.filter(s => s.status === 'revoked').length;

  const filteredSessions = sessions.filter(s => {
    if (filterMode === 'online') {
      if (!s.isOnline || s.status === 'revoked') return false;
    } else if (filterMode === 'offline') {
      if (s.isOnline || s.status === 'revoked') return false;
    } else if (filterMode === 'shared_ips') {
      if (!s.ipCollisionWarning) return false;
    } else if (filterMode === 'terminated') {
      if (s.status !== 'revoked') return false;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchUser = (s.username || '').toLowerCase().includes(q);
      const matchEmail = (s.email || '').toLowerCase().includes(q);
      const matchIp = (s.currentIp || '').includes(q) || (s.previousIps || []).some(ip => ip.includes(q));
      const matchBrowser = (s.currentBrowser || '').toLowerCase().includes(q) || (s.previousBrowsers || []).some(b => b.toLowerCase().includes(q));
      const matchDevice = (s.device || '').toLowerCase().includes(q) || (s.os || '').toLowerCase().includes(q);
      return matchUser || matchEmail || matchIp || matchBrowser || matchDevice;
    }

    return true;
  });

  const handleForceLogout = async (session: DeviceSessionRecord) => {
    if (confirmAction?.type !== 'single' || confirmAction.userId !== session.userId) {
      setConfirmAction({ type: 'single', userId: session.userId });
      return;
    }
    setConfirmAction(null);
    setIsRevoking(true);
    setActionErrorMsg(null);

    const now = Date.now();
    const revocationEntry: DeviceTimelineEntry = {
      timestamp: now,
      event: 'revocation',
      ip: session.currentIp || '127.0.0.1',
      browser: session.currentBrowser || 'Active Browser',
      device: session.device || 'Desktop',
      os: session.os || 'OS',
      status: 'revoked',
      details: 'Active session force-terminated by platform administrator'
    };

    setSessions(prev => prev.map(s => {
      if (s.userId === session.userId) {
        return {
          ...s,
          status: 'revoked',
          isOnline: false,
          deviceTimeline: [...(s.deviceTimeline || []), revocationEntry]
        };
      }
      return s;
    }));

    if (selectedSessionDetails && selectedSessionDetails.userId === session.userId) {
      setSelectedSessionDetails(prev => prev ? {
        ...prev,
        status: 'revoked',
        isOnline: false,
        deviceTimeline: [...(prev.deviceTimeline || []), revocationEntry]
      } : null);
    }

    try {
      const res = await authFetch('/api/sessions/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: session.userId })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to revoke session');
      }

      await logAdminAction(
        currentUser,
        'FORCE_LOGOUT_USER',
        'users',
        session.userId,
        `Force-terminated active session for @${session.username} (${session.email || session.userId})`
      );

      setActionSuccessMsg(`Active session for @${session.username} force-terminated.`);
      setTimeout(() => setActionSuccessMsg(null), 3500);
      fetchSessions();
    } catch (err: any) {
      setActionErrorMsg('Failed to revoke session: ' + err.message);
    } finally {
      setIsRevoking(false);
    }
  };

  const handleReinstateSession = async (session: DeviceSessionRecord) => {
    setIsRevoking(true);
    setActionErrorMsg(null);
    setSessions(prev => prev.map(s => s.userId === session.userId ? { ...s, status: 'active', isOnline: true } : s));
    if (selectedSessionDetails && selectedSessionDetails.userId === session.userId) {
      setSelectedSessionDetails(prev => prev ? { ...prev, status: 'active', isOnline: true } : null);
    }
    try {
      const res = await authFetch('/api/sessions/reinstate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: session.userId })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to reinstate session');
      }

      setActionSuccessMsg(`Session reinstated for @${session.username}. User can now access the platform.`);
      setTimeout(() => setActionSuccessMsg(null), 3500);
      fetchSessions();
    } catch (err: any) {
      setActionErrorMsg('Failed to reinstate session: ' + err.message);
    } finally {
      setIsRevoking(false);
    }
  };

  const handleRevokeAllGlobal = async () => {
    if (confirmAction?.type !== 'global') {
      setConfirmAction({ type: 'global' });
      return;
    }
    setConfirmAction(null);
    setIsRevoking(true);
    setActionErrorMsg(null);
    try {
      const res = await authFetch('/api/sessions/revoke-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminId: currentUser.id })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed global revocation');
      }

      await logAdminAction(
        currentUser,
        'GLOBAL_REVOKE_SESSIONS',
        'system',
        'sessions',
        `Admin @${currentUser.username} initiated global session termination`
      );

      setActionSuccessMsg('Global session revocation executed. All non-admin devices logged out.');
      setTimeout(() => setActionSuccessMsg(null), 4000);
      fetchSessions();
    } catch (err: any) {
      setActionErrorMsg('Failed global revocation: ' + err.message);
    } finally {
      setIsRevoking(false);
    }
  };

  const getFullTimeline = (s: DeviceSessionRecord): DeviceTimelineEntry[] => {
    if (s.deviceTimeline && s.deviceTimeline.length > 0) {
      return [...s.deviceTimeline].sort((a, b) => a.timestamp - b.timestamp);
    }

    const signup = s.loginTime || (Date.now() - 86400000);
    const timeline: DeviceTimelineEntry[] = [
      {
        timestamp: signup,
        event: 'signup',
        ip: s.previousIps?.[0] || s.currentIp,
        browser: s.previousBrowsers?.[0] || s.currentBrowser,
        device: s.device,
        os: s.os,
        status: 'active',
        details: 'Initial account signup & primary browser registered'
      }
    ];

    if (s.previousBrowsers && s.previousBrowsers.length > 0) {
      s.previousBrowsers.forEach((pb, idx) => {
        timeline.push({
          timestamp: signup + 3600000 * (idx + 1),
          event: 'browser_switch',
          ip: s.currentIp,
          browser: pb,
          device: pb.includes('Mobile') ? 'Mobile Device' : 'Desktop PC',
          os: s.os,
          status: 'active',
          details: `Account logged into secondary browser: ${pb}`
        });
      });
    }

    if (s.previousIps && s.previousIps.length > 0) {
      timeline.push({
        timestamp: signup + 3600000 * 4,
        event: 'ip_switch',
        ip: s.currentIp,
        browser: s.currentBrowser,
        device: s.device,
        os: s.os,
        status: 'active',
        details: `IP network switch to ${s.currentIp}`
      });
    }

    timeline.push({
      timestamp: s.lastActiveAt || Date.now(),
      event: s.isOnline ? 'heartbeat' : 'login',
      ip: s.currentIp,
      browser: s.currentBrowser,
      device: s.device,
      os: s.os,
      status: s.status,
      details: s.isOnline ? 'Active session heartbeat live' : 'Session last observed active'
    });

    if (s.status === 'revoked') {
      timeline.push({
        timestamp: Date.now(),
        event: 'revocation',
        ip: s.currentIp,
        browser: s.currentBrowser,
        device: s.device,
        os: s.os,
        status: 'revoked',
        details: 'Session force-terminated by administrator'
      });
    }

    return timeline.sort((a, b) => a.timestamp - b.timestamp);
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-700 shrink-0">
            <Smartphone className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold text-gray-900">Session & Device Security Center</h2>
              <span className="px-2 py-0.5 rounded-lg text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                Live Telemetry Active
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-1 max-w-2xl">
              Track registered accounts, multi-browser logins, IP histories from signup, and terminate sessions.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto flex-wrap">
          <button
            type="button"
            onClick={fetchSessions}
            className="px-3.5 py-2 rounded-lg bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 font-medium text-xs transition inline-flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh Telemetry
          </button>
          <button
            type="button"
            onClick={handleRevokeAllGlobal}
            disabled={isRevoking}
            className="px-3.5 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium text-xs transition inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <Zap className="w-3.5 h-3.5" />
            <span>{confirmAction?.type === 'global' ? 'Confirm Terminate All' : 'Terminate All Sessions'}</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div
          onClick={() => setFilterMode('all')}
          className={`p-4 rounded-lg border shadow-xs flex flex-col justify-between cursor-pointer transition ${
            filterMode === 'all' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 hover:border-gray-300'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-medium">
            <span className={filterMode === 'all' ? 'text-gray-300' : 'text-gray-500'}>All Users</span>
            <Users className="w-4 h-4 opacity-70" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className={`text-2xl font-semibold tabular-nums ${filterMode === 'all' ? 'text-white' : 'text-gray-900'}`}>{totalAccounts}</span>
            <span className={`text-xs ${filterMode === 'all' ? 'text-gray-300' : 'text-gray-500'}`}>accounts</span>
          </div>
        </div>

        <div
          onClick={() => setFilterMode('online')}
          className={`p-4 rounded-lg border shadow-xs flex flex-col justify-between cursor-pointer transition ${
            filterMode === 'online' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 hover:border-gray-300'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-medium">
            <span className={filterMode === 'online' ? 'text-gray-300' : 'text-gray-500'}>Online Users</span>
            <CheckCircle2 className={`w-4 h-4 ${filterMode === 'online' ? 'text-emerald-400' : 'text-emerald-600'}`} />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className={`text-2xl font-semibold tabular-nums ${filterMode === 'online' ? 'text-white' : 'text-emerald-700'}`}>{onlineAccounts}</span>
            <span className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-lg font-medium">Live</span>
          </div>
        </div>

        <div
          onClick={() => setFilterMode('offline')}
          className={`p-4 rounded-lg border shadow-xs flex flex-col justify-between cursor-pointer transition ${
            filterMode === 'offline' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 hover:border-gray-300'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-medium">
            <span className={filterMode === 'offline' ? 'text-gray-300' : 'text-gray-500'}>Offline Users</span>
            <Moon className="w-4 h-4 opacity-70" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className={`text-2xl font-semibold tabular-nums ${filterMode === 'offline' ? 'text-white' : 'text-gray-900'}`}>{offlineAccounts}</span>
            <span className={`text-[11px] px-1.5 py-0.5 rounded-lg font-medium ${filterMode === 'offline' ? 'bg-gray-800 text-gray-200' : 'bg-gray-100 text-gray-600'}`}>Idle</span>
          </div>
        </div>

        <div
          onClick={() => setFilterMode('shared_ips')}
          className={`p-4 rounded-lg border shadow-xs flex flex-col justify-between cursor-pointer transition ${
            filterMode === 'shared_ips' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 hover:border-gray-300'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-medium">
            <span className={filterMode === 'shared_ips' ? 'text-gray-300' : 'text-gray-500'}>Shared IPs</span>
            <AlertTriangle className={`w-4 h-4 ${filterMode === 'shared_ips' ? 'text-red-400' : 'text-red-600'}`} />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className={`text-2xl font-semibold tabular-nums ${filterMode === 'shared_ips' ? 'text-white' : 'text-red-600'}`}>{ipCollisionAccounts}</span>
            <span className="text-[11px] text-red-700 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-lg font-medium">Collision</span>
          </div>
        </div>

        <div
          onClick={() => setFilterMode('terminated')}
          className={`p-4 rounded-lg border shadow-xs flex flex-col justify-between cursor-pointer transition ${
            filterMode === 'terminated' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 hover:border-gray-300'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-medium">
            <span className={filterMode === 'terminated' ? 'text-gray-300' : 'text-gray-500'}>Terminated</span>
            <Lock className={`w-4 h-4 ${filterMode === 'terminated' ? 'text-red-400' : 'text-red-600'}`} />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className={`text-2xl font-semibold tabular-nums ${filterMode === 'terminated' ? 'text-white' : 'text-red-600'}`}>{terminatedAccounts}</span>
            <span className="text-[11px] text-red-700 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-lg font-medium">Revoked</span>
          </div>
        </div>
      </div>

      {/* Search & Tabs */}
      <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by username, email, IP address, browser, or OS..."
              className="w-full pl-9 pr-8 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-700 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { id: 'all', label: 'All Users', count: totalAccounts },
              { id: 'online', label: 'Online', count: onlineAccounts },
              { id: 'offline', label: 'Offline', count: offlineAccounts },
              { id: 'shared_ips', label: 'Shared IPs', count: ipCollisionAccounts },
              { id: 'terminated', label: 'Terminated', count: terminatedAccounts }
            ].map(tab => (
              <button
                type="button"
                key={tab.id}
                onClick={() => setFilterMode(tab.id as any)}
                className={`px-3 py-1.5 rounded-lg font-medium text-xs transition cursor-pointer flex items-center gap-1.5 border ${
                  filterMode === tab.id
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}
              >
                <span>{tab.label}</span>
                <span className={`text-[11px] px-1.5 py-0.5 rounded-lg tabular-nums ${
                  filterMode === tab.id ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-700'
                }`}>
                  {tab.count}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {actionSuccessMsg && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-xs font-medium flex items-center justify-between">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{actionSuccessMsg}</span>
          </span>
          <button type="button" onClick={() => setActionSuccessMsg(null)} className="cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {actionErrorMsg && (
        <div className="p-3.5 bg-red-50 border border-red-200 rounded-lg text-red-800 text-xs font-medium flex items-center justify-between">
          <span className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{actionErrorMsg}</span>
          </span>
          <button type="button" onClick={() => setActionErrorMsg(null)} className="cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="bg-white p-12 rounded-lg border border-gray-200 shadow-xs text-center">
          <Loader2 className="w-8 h-8 text-gray-400 animate-spin mx-auto mb-3" />
          <p className="text-sm font-semibold text-gray-900">Tracking Connected Devices & IP Telemetry...</p>
        </div>
      ) : filteredSessions.length === 0 ? (
        <div className="bg-white p-12 rounded-lg border border-gray-200 shadow-xs text-center">
          <Smartphone className="w-8 h-8 text-gray-400 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-gray-900">No Account Sessions Found</h3>
          <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
            {searchQuery ? 'No accounts matched your search criteria.' : `No accounts found under '${filterMode.replace('_', ' ')}'.`}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 uppercase tracking-wider font-semibold text-[11px]">
                <tr>
                  <th className="py-3 px-4">Account & User</th>
                  <th className="py-3 px-4">Browsers Used</th>
                  <th className="py-3 px-4">Current IP</th>
                  <th className="py-3 px-4">Previous IPs</th>
                  <th className="py-3 px-4">Device & OS</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredSessions.map((session) => {
                  const browserCount = session.distinctBrowsersCount || (session.previousBrowsers?.length ? session.previousBrowsers.length + 1 : 1);
                  const isConfirmingRevoke = confirmAction?.type === 'single' && confirmAction.userId === session.userId;

                  return (
                    <tr
                      key={session.id || session.userId}
                      onClick={() => setSelectedSessionDetails(session)}
                      className="hover:bg-gray-50 transition cursor-pointer"
                    >
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-gray-100 border border-gray-200 text-gray-700 flex items-center justify-center font-semibold text-xs shrink-0">
                            {session.username?.[0]?.toUpperCase() || 'U'}
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-semibold text-gray-900 truncate max-w-[140px]">
                                @{session.username}
                              </span>
                              <span className="px-1.5 py-0.5 rounded-lg text-[10px] font-medium bg-gray-100 text-gray-700 border border-gray-200 uppercase">
                                {session.role || 'user'}
                              </span>
                            </div>
                            <span className="text-[11px] text-gray-500 block truncate max-w-[160px]">
                              {session.email || 'No email'}
                            </span>
                          </div>
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="space-y-1">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg font-medium text-[11px] bg-gray-100 text-gray-800 border border-gray-200 tabular-nums">
                            <Globe className="w-3 h-3" />
                            <span>{browserCount} Browser{browserCount > 1 ? 's' : ''}</span>
                          </span>
                          <div className="text-[11px] text-gray-600 truncate max-w-[170px]" title={session.currentBrowser}>
                            Active: {session.currentBrowser || 'Chrome'}
                          </div>
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="space-y-1">
                          <span className="font-mono font-medium text-gray-900 text-xs bg-gray-100 px-2 py-0.5 rounded-lg border border-gray-200">
                            {session.currentIp || '127.0.0.1'}
                          </span>
                          {session.ipCollisionWarning && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-red-50 text-red-700 border border-red-200 rounded-lg font-medium text-[10px] block w-fit">
                              <AlertTriangle className="w-3 h-3" /> Shared IP
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        {session.previousIps && session.previousIps.length > 0 ? (
                          <div className="space-y-1">
                            <span className="text-[11px] font-medium text-gray-700 bg-gray-100 border border-gray-200 px-2 py-0.5 rounded-lg inline-block tabular-nums">
                              {session.previousIps.length} Changed IP{session.previousIps.length > 1 ? 's' : ''}
                            </span>
                            <div className="text-[11px] font-mono text-gray-500 truncate max-w-[140px]">
                              {session.previousIps.slice(0, 2).join(', ')}
                            </div>
                          </div>
                        ) : (
                          <span className="text-gray-400 text-xs">None</span>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="font-medium text-gray-900 text-xs flex items-center gap-1.5">
                          <Laptop className="w-3.5 h-3.5 text-gray-400" />
                          <span>{session.device || 'Desktop PC'}</span>
                        </div>
                        <div className="text-[11px] text-gray-500">
                          {session.os || 'Windows 11'}
                        </div>
                      </td>

                      <td className="py-3.5 px-4 text-center">
                        {session.status === 'revoked' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium bg-red-50 text-red-700 border border-red-200">
                            <Lock className="w-3 h-3" /> Terminated
                          </span>
                        ) : session.isOnline ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                            Online
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-medium bg-gray-100 text-gray-600 border border-gray-200">
                            Offline
                          </span>
                        )}
                        <div className="text-[11px] text-gray-400 font-mono mt-0.5 tabular-nums">
                          {new Date(session.lastActiveAt || session.loginTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </td>

                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          {onOpenAiBrainWithQuery && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenAiBrainWithQuery(`Perform a device, browser, and security audit on @${session.username} (IP: ${session.currentIp}, active browser: ${session.currentBrowser}, total distinct browsers: ${browserCount}).`);
                              }}
                              className="px-2.5 py-1.5 bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 font-medium rounded-lg text-xs transition cursor-pointer inline-flex items-center gap-1"
                            >
                              <Brain className="w-3.5 h-3.5" />
                              <span>AI Audit</span>
                            </button>
                          )}

                          {session.status === 'revoked' ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleReinstateSession(session);
                              }}
                              disabled={isRevoking}
                              className="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-medium rounded-lg text-xs transition cursor-pointer border border-emerald-200"
                            >
                              Reinstate
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleForceLogout(session);
                              }}
                              disabled={isRevoking}
                              className={`px-2.5 py-1.5 font-medium rounded-lg text-xs transition cursor-pointer border ${
                                isConfirmingRevoke
                                  ? 'bg-red-600 text-white border-red-600'
                                  : 'bg-red-50 hover:bg-red-100 text-red-700 border-red-200'
                              }`}
                            >
                              {isConfirmingRevoke ? 'Confirm Terminate' : 'Terminate'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Session Inspector Modal */}
      {selectedSessionDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-lg max-w-2xl w-full shadow-lg overflow-hidden border border-gray-200 flex flex-col max-h-[90vh]">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-white">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-700">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-base text-gray-900">@{selectedSessionDetails.username}</h3>
                    <span className="px-2 py-0.5 rounded-lg text-[11px] font-medium bg-gray-100 text-gray-700 border border-gray-200">
                      {selectedSessionDetails.role || 'user'}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-500 font-mono">
                    UID: {selectedSessionDetails.userId} · {selectedSessionDetails.email}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSessionDetails(null)}
                className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-5 text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                  <span className="text-[11px] font-medium text-gray-500 block">Current IP</span>
                  <span className="font-mono font-semibold text-gray-900 text-xs">{selectedSessionDetails.currentIp}</span>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                  <span className="text-[11px] font-medium text-gray-500 block">Distinct Browsers</span>
                  <span className="font-semibold text-gray-900 text-xs tabular-nums">
                    {selectedSessionDetails.distinctBrowsersCount || (selectedSessionDetails.previousBrowsers?.length ? selectedSessionDetails.previousBrowsers.length + 1 : 1)} Browsers
                  </span>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                  <span className="text-[11px] font-medium text-gray-500 block">Session State</span>
                  <span className={`font-semibold text-xs ${
                    selectedSessionDetails.status === 'revoked' ? 'text-red-600' : selectedSessionDetails.isOnline ? 'text-emerald-700' : 'text-gray-600'
                  }`}>
                    {selectedSessionDetails.status === 'revoked' ? 'Terminated' : selectedSessionDetails.isOnline ? 'Online' : 'Offline'}
                  </span>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                  <span className="text-[11px] font-medium text-gray-500 block">IP Collisions</span>
                  <span className={`font-semibold text-xs ${selectedSessionDetails.ipCollisionWarning ? 'text-red-600' : 'text-emerald-700'}`}>
                    {selectedSessionDetails.ipCollisionWarning ? 'Shared IP' : 'Isolated'}
                  </span>
                </div>
              </div>

              {selectedSessionDetails.ipCollisionWarning && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-900 text-xs flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <div>
                    <strong>Multi-Account IP Collision Alert:</strong> Multiple accounts share IP ({selectedSessionDetails.currentIp}).
                    {selectedSessionDetails.collidingAccounts && selectedSessionDetails.collidingAccounts.length > 0 && (
                      <span className="block mt-0.5 text-[11px] text-red-800">
                        Colliding accounts: {selectedSessionDetails.collidingAccounts.map(u => `@${u}`).join(', ')}
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-gray-900 text-xs flex items-center gap-1.5">
                    <History className="w-4 h-4 text-gray-500" />
                    <span>IP & Browser Activity Timeline</span>
                  </h4>
                  <span className="text-[11px] text-gray-500 font-mono tabular-nums">
                    {getFullTimeline(selectedSessionDetails).length} Events
                  </span>
                </div>

                <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 divide-y divide-gray-200 max-h-60 overflow-y-auto space-y-2.5">
                  {getFullTimeline(selectedSessionDetails).map((entry, idx) => {
                    const badgeLabels: Record<string, string> = {
                      signup: 'Registration',
                      login: 'Session Login',
                      browser_switch: 'Browser Switch',
                      ip_switch: 'IP Network Change',
                      heartbeat: 'Live Telemetry',
                      revocation: 'Force Terminated'
                    };

                    return (
                      <div key={idx} className="pt-2.5 first:pt-0 flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                          <span className="px-2 py-0.5 rounded-lg font-medium text-[11px] border bg-white text-gray-800 border-gray-200">
                            {badgeLabels[entry.event] || entry.event}
                          </span>
                          <span className="text-[11px] text-gray-500 font-mono tabular-nums">
                            {new Date(entry.timestamp).toLocaleString([], { dateStyle: 'short', timeStyle: 'medium' })}
                          </span>
                        </div>
                        <p className="text-xs font-medium text-gray-800">{entry.details}</p>
                        <div className="flex items-center gap-3 text-[11px] text-gray-500 font-mono flex-wrap">
                          <span>IP: <strong className="text-gray-700">{entry.ip}</strong></span>
                          <span>Browser: <strong className="text-gray-700">{entry.browser}</strong></span>
                          {entry.device && <span>Device: <strong className="text-gray-700">{entry.device}</strong></span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="text-xs font-medium text-gray-500 block">
                  Distinct Browsers ({selectedSessionDetails.distinctBrowsers?.length || 1})
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(selectedSessionDetails.distinctBrowsers && selectedSessionDetails.distinctBrowsers.length > 0
                    ? selectedSessionDetails.distinctBrowsers
                    : [selectedSessionDetails.currentBrowser]
                  ).map((b, bIdx) => (
                    <div key={bIdx} className="p-2.5 bg-gray-50 rounded-lg border border-gray-200 flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <Globe className="w-4 h-4 text-gray-400 shrink-0" />
                        <div className="min-w-0">
                          <span className="font-medium text-gray-900 block truncate max-w-[170px]">{b}</span>
                          <span className="text-[11px] text-gray-500">
                            {b === selectedSessionDetails.currentBrowser ? 'Current Active Browser' : 'Previous Login'}
                          </span>
                        </div>
                      </div>
                      {b === selectedSessionDetails.currentBrowser && (
                        <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg font-medium text-[10px]">Active</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-4 bg-gray-50 border-t border-gray-200 flex items-center justify-between gap-2 flex-wrap">
              {onOpenAiBrainWithQuery && (
                <button
                  type="button"
                  onClick={() => {
                    const queryText = `Analyze user @${selectedSessionDetails.username} (UID: ${selectedSessionDetails.userId}). What is their full IP & browser timeline, wallet balance, and transaction status?`;
                    setSelectedSessionDetails(null);
                    onOpenAiBrainWithQuery(queryText);
                  }}
                  className="px-3.5 py-2 bg-gray-900 hover:bg-black text-white font-medium rounded-lg text-xs inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Brain className="w-3.5 h-3.5" />
                  <span>Ask AI Brain About User</span>
                </button>
              )}

              <div className="flex items-center gap-2 ml-auto">
                {selectedSessionDetails.status === 'revoked' ? (
                  <button
                    type="button"
                    onClick={() => handleReinstateSession(selectedSessionDetails)}
                    disabled={isRevoking}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg text-xs cursor-pointer transition"
                  >
                    Reinstate Session Access
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleForceLogout(selectedSessionDetails)}
                    disabled={isRevoking}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg text-xs cursor-pointer transition"
                  >
                    {confirmAction?.type === 'single' && confirmAction.userId === selectedSessionDetails.userId
                      ? 'Confirm Force Terminate'
                      : 'Force Terminate Session'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
