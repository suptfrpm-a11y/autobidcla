import React, { useState, useEffect } from 'react';
import {
  Bot,
  MessageSquare,
  CheckCircle2,
  AlertTriangle,
  Ticket,
  Users,
  Search,
  X,
  Clock,
  Copy,
  Car,
  Trash2,
  Loader2
} from 'lucide-react';
import { db, collection, onSnapshot, doc, updateDoc, addDoc } from '../../firebase';
import { User, AiChatSession } from '../../types';
import { logAdminAction } from './adminAuditHelper';
import { authFetch } from '../../utils/apiClient';

interface AdminAiMonitorProps {
  currentUser: User;
}

export const AdminAiMonitor: React.FC<AdminAiMonitorProps> = ({ currentUser }) => {
  const [sessions, setSessions] = useState<AiChatSession[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'resolved' | 'escalated' | 'ticket_created' | 'in_progress'>('all');
  const [userFilter, setUserFilter] = useState<'all' | 'guest' | 'registered'>('all');
  const [selectedSession, setSelectedSession] = useState<AiChatSession | null>(null);
  const [adminNoteInput, setAdminNoteInput] = useState<string>('');
  const [isProcessingAction, setIsProcessingAction] = useState<boolean>(false);
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);
  const [actionErrorMsg, setActionErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    let isMounted = true;

    const fetchSessionsFromServer = async () => {
      try {
        const res = await authFetch('/api/ai/sessions');
        if (res.ok) {
          const data = await res.json();
          if (data.success && isMounted) {
            setSessions(data.sessions || []);
          }
        }
      } catch (err) {
        console.error('[AdminAiMonitor] Failed to fetch sessions from server:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    let unsubFirestore: (() => void) | null = null;
    try {
      const colRef = collection(db, 'ai_chats');
      unsubFirestore = onSnapshot(colRef, (snap) => {
        if (!isMounted) return;
        const list: AiChatSession[] = [];
        snap.forEach((d) => {
          list.push({ id: d.id, ...d.data() } as AiChatSession);
        });
        list.sort((a, b) => b.updatedAt - a.updatedAt);
        setSessions(list);
        setIsLoading(false);
      }, (err) => {
        console.warn('[AdminAiMonitor] Firestore snapshot warning, falling back to server API:', err);
        fetchSessionsFromServer();
      });
    } catch {
      fetchSessionsFromServer();
    }

    return () => {
      isMounted = false;
      if (unsubFirestore) unsubFirestore();
    };
  }, []);

  useEffect(() => {
    if (selectedSession) {
      const updated = sessions.find(s => s.id === selectedSession.id);
      if (updated) setSelectedSession(updated);
    }
  }, [sessions]);

  const totalCount = sessions.length;
  const resolvedCount = sessions.filter(s => s.resolutionStatus === 'resolved').length;
  const escalatedCount = sessions.filter(s => s.resolutionStatus === 'escalated' || s.isEscalated).length;
  const guestCount = sessions.filter(s => s.isGuest).length;
  const registeredCount = sessions.filter(s => !s.isGuest).length;
  const ticketCreatedCount = sessions.filter(s => s.ticketId || s.resolutionStatus === 'ticket_created').length;
  const resolutionRate = totalCount > 0 ? Math.round((resolvedCount / totalCount) * 100) : 100;

  const filteredSessions = sessions.filter(s => {
    if (statusFilter === 'resolved' && s.resolutionStatus !== 'resolved') return false;
    if (statusFilter === 'escalated' && s.resolutionStatus !== 'escalated' && !s.isEscalated) return false;
    if (statusFilter === 'ticket_created' && !s.ticketId && s.resolutionStatus !== 'ticket_created') return false;
    if (statusFilter === 'in_progress' && (s.resolutionStatus === 'resolved' || s.resolutionStatus === 'escalated')) return false;

    if (userFilter === 'guest' && !s.isGuest) return false;
    if (userFilter === 'registered' && s.isGuest) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const email = (s.userEmail || '').toLowerCase();
      const username = (s.username || '').toLowerCase();
      const summary = (s.problemSummary || s.summary || '').toLowerCase();
      const msgs = (s.messages || []).map(m => (m.content || m.text || '').toLowerCase()).join(' ');
      const id = (s.id || s.sessionId || '').toLowerCase();
      return email.includes(q) || username.includes(q) || id.includes(q) || summary.includes(q) || msgs.includes(q);
    }

    return true;
  });

  const handleUpdateStatus = async (sessionId: string, newStatus: 'resolved' | 'escalated' | 'in_progress') => {
    setIsProcessingAction(true);
    setActionErrorMsg(null);
    try {
      try {
        await updateDoc(doc(db, 'ai_chats', sessionId), {
          resolutionStatus: newStatus,
          isEscalated: newStatus === 'escalated',
          adminNotes: adminNoteInput || undefined,
          updatedAt: Date.now()
        });
      } catch {
        await authFetch('/api/ai/update-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, resolutionStatus: newStatus, adminNotes: adminNoteInput })
        });
      }

      await logAdminAction(
        currentUser,
        'UPDATE_AI_SESSION_STATUS',
        'ai_chats',
        sessionId,
        `Marked AI session ${sessionId} as ${newStatus}`
      );

      setActionSuccessMsg(`Session status updated to "${newStatus}".`);
      setTimeout(() => setActionSuccessMsg(null), 3000);
    } catch (err: any) {
      setActionErrorMsg('Failed to update status: ' + err.message);
    } finally {
      setIsProcessingAction(false);
    }
  };

  const handleCreateTicketFromSession = async (session: AiChatSession) => {
    setIsProcessingAction(true);
    setActionErrorMsg(null);
    try {
      const transcript = (session.messages || [])
        .map(m => `[${new Date(m.timestamp).toLocaleTimeString()}] ${m.role === 'user' ? (session.username ? '@' + session.username : 'User') : 'AI Agent'}: ${m.content || m.text || ''}`)
        .join('\n');

      const ticketData = {
        userId: session.userId || 'guest_' + session.id.slice(0, 8),
        username: session.username || session.userEmail?.split('@')[0] || 'GuestUser',
        userEmail: session.userEmail || 'unknown@autobid.com',
        isGuest: session.isGuest,
        category: 'ai_escalated_support',
        subject: `AI Escalation: ${session.problemSummary || session.summary || 'User Assistance Request'}`,
        description: `Transferred directly from Groq AI Agent Monitor.\n\nAI Diagnosis / Problem Summary:\n${session.problemSummary || session.summary || 'User requested human staff intervention.'}\n\nFull Chat Transcript:\n${transcript}`,
        status: 'open',
        priority: 'high',
        source: 'ai_monitor',
        aiSessionId: session.id,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      const docRef = await addDoc(collection(db, 'tickets'), ticketData);

      try {
        await updateDoc(doc(db, 'ai_chats', session.id), {
          ticketId: docRef.id,
          resolutionStatus: 'ticket_created',
          isEscalated: true,
          updatedAt: Date.now()
        });
      } catch {
        await authFetch('/api/ai/update-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: session.id, resolutionStatus: 'ticket_created', ticketId: docRef.id })
        });
      }

      await logAdminAction(
        currentUser,
        'ESCALATE_AI_TO_TICKET',
        'tickets',
        docRef.id,
        `Created high-priority ticket #${docRef.id.slice(0, 8)} from AI session ${session.id}`
      );

      setActionSuccessMsg(`Support Ticket #${docRef.id.slice(0, 6)} generated successfully.`);
      setTimeout(() => setActionSuccessMsg(null), 4000);
    } catch (err: any) {
      setActionErrorMsg('Failed to escalate ticket: ' + err.message);
    } finally {
      setIsProcessingAction(false);
    }
  };

  const copyTranscript = (session: AiChatSession) => {
    const text = (session.messages || [])
      .map(m => `[${new Date(m.timestamp).toLocaleTimeString()}] ${m.role === 'user' ? 'User' : 'AutoBid AI'}: ${m.content || m.text || ''}`)
      .join('\n\n');
    navigator.clipboard.writeText(text);
    setActionSuccessMsg('Chat transcript copied to clipboard.');
    setTimeout(() => setActionSuccessMsg(null), 2500);
  };

  return (
    <div className="space-y-4">
      {/* Header Card */}
      <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-700 shrink-0">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base sm:text-lg font-semibold text-gray-900">AI Monitor & Support Queue</h2>
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                LLM Engine Online
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-1 max-w-2xl">
              Monitor user and guest AI support conversations, review automated resolutions, and escalate complex issues to human support tickets.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-200 text-xs">
          <span className="text-gray-500">Model:</span>
          <span className="font-mono font-medium text-gray-900">openai/gpt-oss-120b</span>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-gray-500 text-xs font-medium">
            <span>Total AI Sessions</span>
            <MessageSquare className="w-4 h-4 text-gray-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-gray-900 tabular-nums">{totalCount}</span>
            <span className="text-xs text-gray-500">recorded</span>
          </div>
          <div className="mt-1 text-[11px] text-gray-500">Registered & guest visitors</div>
        </div>

        <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-gray-500 text-xs font-medium">
            <span>Solved by AI</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-emerald-700 tabular-nums">{resolvedCount}</span>
            <span className="text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-lg tabular-nums">
              {resolutionRate}% rate
            </span>
          </div>
          <div className="mt-1 text-[11px] text-gray-500">Autonomously closed</div>
        </div>

        <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-gray-500 text-xs font-medium">
            <span>Escalated to Staff</span>
            <AlertTriangle className="w-4 h-4 text-red-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-red-600 tabular-nums">{escalatedCount}</span>
            <span className="text-xs text-gray-500">needs review</span>
          </div>
          <div className="mt-1 text-[11px] text-gray-500">Flagged or user requested</div>
        </div>

        <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-gray-500 text-xs font-medium">
            <span>Tickets Created</span>
            <Ticket className="w-4 h-4 text-gray-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-gray-900 tabular-nums">{ticketCreatedCount}</span>
            <span className="text-xs text-gray-500">formal</span>
          </div>
          <div className="mt-1 text-[11px] text-gray-500">Synced to Support queue</div>
        </div>

        <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-xs flex flex-col justify-between col-span-2 lg:col-span-1">
          <div className="flex items-center justify-between text-gray-500 text-xs font-medium">
            <span>Audience</span>
            <Users className="w-4 h-4 text-gray-400" />
          </div>
          <div className="mt-2 space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500">Registered:</span>
              <strong className="text-gray-900 font-semibold tabular-nums">{registeredCount}</strong>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500">Guests:</span>
              <strong className="text-gray-900 font-semibold tabular-nums">{guestCount}</strong>
            </div>
          </div>
          <div className="mt-1 text-[11px] text-gray-500">Verified visitor emails</div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by email, username, session ID, or summary..."
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
              { id: 'all', label: 'All Sessions', count: totalCount },
              { id: 'resolved', label: 'AI Resolved', count: resolvedCount },
              { id: 'escalated', label: 'Escalated', count: escalatedCount },
              { id: 'ticket_created', label: 'Ticket Created', count: ticketCreatedCount },
              { id: 'in_progress', label: 'In Progress', count: sessions.filter(s => s.resolutionStatus === 'in_progress').length }
            ].map(tab => (
              <button
                type="button"
                key={tab.id}
                onClick={() => setStatusFilter(tab.id as any)}
                className={`px-3 py-1.5 rounded-lg font-medium text-xs transition cursor-pointer flex items-center gap-1.5 border ${
                  statusFilter === tab.id
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}
              >
                <span>{tab.label}</span>
                <span className={`text-[11px] px-1.5 py-0.5 rounded-lg tabular-nums ${
                  statusFilter === tab.id ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-700'
                }`}>
                  {tab.count}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 pt-2 border-t border-gray-100 text-xs flex-wrap">
          <span className="text-gray-500 font-medium">Audience:</span>
          <button
            type="button"
            onClick={() => setUserFilter('all')}
            className={`px-2.5 py-1 rounded-lg font-medium text-xs cursor-pointer ${userFilter === 'all' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            All ({totalCount})
          </button>
          <button
            type="button"
            onClick={() => setUserFilter('registered')}
            className={`px-2.5 py-1 rounded-lg font-medium text-xs cursor-pointer ${userFilter === 'registered' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            Registered ({registeredCount})
          </button>
          <button
            type="button"
            onClick={() => setUserFilter('guest')}
            className={`px-2.5 py-1 rounded-lg font-medium text-xs cursor-pointer ${userFilter === 'guest' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            Guests ({guestCount})
          </button>
        </div>
      </div>

      {actionSuccessMsg && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-xs font-medium flex items-center justify-between">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{actionSuccessMsg}</span>
          </span>
          <button type="button" onClick={() => setActionSuccessMsg(null)} className="text-emerald-700 hover:text-emerald-900 cursor-pointer">
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
          <button type="button" onClick={() => setActionErrorMsg(null)} className="text-red-700 hover:text-red-900 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Sessions Table */}
      {isLoading ? (
        <div className="bg-white p-12 rounded-lg border border-gray-200 shadow-xs text-center">
          <Loader2 className="w-8 h-8 text-gray-500 animate-spin mx-auto mb-3" />
          <p className="text-sm font-semibold text-gray-900">Synchronizing AI Chat Sessions...</p>
          <p className="text-xs text-gray-500 mt-1">Connecting to live agent store and Firestore</p>
        </div>
      ) : filteredSessions.length === 0 ? (
        <div className="bg-white p-12 rounded-lg border border-gray-200 shadow-xs text-center">
          <Bot className="w-8 h-8 text-gray-400 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-gray-900">No AI Conversations Found</h3>
          <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
            {searchQuery
              ? 'No sessions matched your search terms. Try clearing filters.'
              : 'As visitors and users chat with the AI assistant, sessions and diagnoses will appear here.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 uppercase tracking-wider font-semibold text-[11px]">
                <tr>
                  <th className="py-3 px-4">User / Contact Email</th>
                  <th className="py-3 px-4">Status & Diagnosis</th>
                  <th className="py-3 px-4">Last Message</th>
                  <th className="py-3 px-4 text-center">Messages</th>
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredSessions.map((session) => {
                  const lastMsg = session.messages && session.messages.length > 0
                    ? session.messages[session.messages.length - 1]
                    : null;

                  return (
                    <tr
                      key={session.id}
                      onClick={() => setSelectedSession(session)}
                      className="hover:bg-gray-50 transition cursor-pointer"
                    >
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-gray-100 border border-gray-200 text-gray-700 flex items-center justify-center font-semibold text-xs shrink-0">
                            {session.isGuest ? 'G' : (session.username?.[0]?.toUpperCase() || 'U')}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-semibold text-gray-900 block truncate max-w-[160px]">
                                {session.userEmail || (session.username ? `@${session.username}` : 'Anonymous Visitor')}
                              </span>
                              <span className="px-1.5 py-0.5 bg-gray-100 text-gray-700 border border-gray-200 rounded-lg font-medium text-[10px]">
                                {session.isGuest ? 'Guest' : 'Member'}
                              </span>
                            </div>
                            {session.username && (
                              <span className="text-[11px] text-gray-500 block truncate">@{session.username}</span>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="space-y-1">
                          {session.resolutionStatus === 'resolved' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-medium">
                              <CheckCircle2 className="w-3 h-3" /> AI Solved
                            </span>
                          )}
                          {session.resolutionStatus === 'escalated' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-red-50 text-red-700 border border-red-200 text-[11px] font-medium">
                              <AlertTriangle className="w-3 h-3" /> Escalated
                            </span>
                          )}
                          {session.resolutionStatus === 'ticket_created' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-gray-100 text-gray-800 border border-gray-200 text-[11px] font-medium">
                              <Ticket className="w-3 h-3" /> Ticket #{session.ticketId?.slice(0, 6) || 'Created'}
                            </span>
                          )}
                          {(session.status === 'appeal_submitted' || session.resolutionStatus === 'appeal_submitted' || (session as any).deletionAppeal) && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-red-50 text-red-700 border border-red-200 text-[11px] font-medium">
                              <Trash2 className="w-3 h-3" /> Deletion Appeal
                            </span>
                          )}
                          {session.resolutionStatus === 'in_progress' && !((session as any).deletionAppeal) && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-gray-100 text-gray-700 border border-gray-200 text-[11px] font-medium">
                              <Clock className="w-3 h-3" /> In Progress
                            </span>
                          )}

                          {session.problemSummary && (
                            <p className="text-[11px] text-gray-600 line-clamp-1 max-w-xs">
                              {session.problemSummary}
                            </p>
                          )}
                        </div>
                      </td>

                      <td className="py-3.5 px-4 max-w-xs sm:max-w-sm">
                        {lastMsg ? (
                          <div>
                            <span className="text-[10px] text-gray-400 font-medium uppercase">
                              {lastMsg.role === 'user' ? 'User' : 'AI'}:
                            </span>
                            <p className="text-gray-700 truncate line-clamp-1 text-xs">
                              {lastMsg.content || lastMsg.text || ''}
                            </p>
                          </div>
                        ) : (
                          <span className="text-gray-400">No messages</span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 text-center">
                        <span className="font-mono font-medium bg-gray-100 text-gray-700 px-2 py-0.5 rounded-lg text-xs tabular-nums">
                          {session.messages?.length || 0}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 text-gray-500 whitespace-nowrap tabular-nums">
                        <div className="text-xs text-gray-700">
                          {new Date(session.updatedAt || session.createdAt).toLocaleDateString([], {
                            month: 'short',
                            day: 'numeric'
                          })}
                        </div>
                        <div className="text-[11px] text-gray-400">
                          {new Date(session.updatedAt || session.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </div>
                      </td>

                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedSession(session);
                          }}
                          className="px-3 py-1.5 bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 font-medium rounded-lg text-xs transition cursor-pointer"
                        >
                          Inspect
                        </button>
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
      {selectedSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-lg max-w-2xl w-full shadow-lg overflow-hidden border border-gray-200 flex flex-col max-h-[90vh]">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-white">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-700 shrink-0">
                  <Bot className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-sm text-gray-900 truncate">
                      {selectedSession.userEmail || (selectedSession.username ? `@${selectedSession.username}` : 'Guest Visitor')}
                    </h3>
                    <span className="px-2 py-0.5 rounded-lg text-[11px] font-medium bg-gray-100 text-gray-700 border border-gray-200">
                      {selectedSession.isGuest ? 'Guest' : 'Registered User'}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-500 font-mono truncate">
                    ID: {selectedSession.id} · {new Date(selectedSession.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => copyTranscript(selectedSession)}
                  className="px-2.5 py-1.5 rounded-lg bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 font-medium text-xs transition cursor-pointer inline-flex items-center gap-1"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedSession(null)}
                  className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-4 bg-gray-50 border-b border-gray-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
              <div className="space-y-1">
                <div>
                  <span className="font-semibold text-gray-700">AI Diagnosis: </span>
                  <span className="text-gray-900">
                    {selectedSession.problemSummary || 'Platform guidance & troubleshooting session'}
                  </span>
                </div>
                <div className="text-[11px] text-gray-500 flex items-center gap-3 flex-wrap">
                  <span>Email: <strong className="text-gray-800">{selectedSession.userEmail || 'Not specified'}</strong></span>
                  <span className="tabular-nums">Messages: <strong className="text-gray-800">{selectedSession.messages?.length || 0}</strong></span>
                </div>
                {(selectedSession as any).vehicleListing && (
                  <div className="mt-1.5 p-2 bg-white border border-gray-200 rounded-lg text-gray-900 flex items-center gap-2 text-xs">
                    <Car className="w-4 h-4 text-gray-500" />
                    <span className="font-medium">AI Vehicle Listing:</span>
                    <span>{(selectedSession as any).vehicleListing.year} {(selectedSession as any).vehicleListing.make} {(selectedSession as any).vehicleListing.model}</span>
                    {(selectedSession as any).vehicleListing.stockNumber && (
                      <span className="font-mono text-[11px] bg-gray-100 text-gray-800 px-1.5 py-0.5 rounded-lg border border-gray-200">
                        Stock #{(selectedSession as any).vehicleListing.stockNumber}
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1.5 self-end sm:self-auto shrink-0">
                <button
                  type="button"
                  onClick={() => handleUpdateStatus(selectedSession.id, 'resolved')}
                  disabled={isProcessingAction}
                  className={`px-2.5 py-1.5 rounded-lg font-medium text-xs transition cursor-pointer inline-flex items-center gap-1 border ${
                    selectedSession.resolutionStatus === 'resolved'
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Solved</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleUpdateStatus(selectedSession.id, 'escalated')}
                  disabled={isProcessingAction}
                  className={`px-2.5 py-1.5 rounded-lg font-medium text-xs transition cursor-pointer inline-flex items-center gap-1 border ${
                    selectedSession.resolutionStatus === 'escalated'
                      ? 'bg-red-600 text-white border-red-600'
                      : 'bg-white text-red-700 border-red-200 hover:bg-red-50'
                  }`}
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Escalate</span>
                </button>
              </div>
            </div>

            <div className="p-4 sm:p-5 overflow-y-auto space-y-3 flex-1 max-h-[45vh] bg-gray-50">
              {(selectedSession.messages || []).map((msg, idx) => {
                const isUser = msg.role === 'user';
                return (
                  <div
                    key={msg.id || idx}
                    className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                  >
                    <div className="flex items-center gap-1.5 mb-1 px-1 text-[11px] text-gray-500">
                      <span>{isUser ? (selectedSession.username ? '@' + selectedSession.username : 'User') : 'AI Assistant'}</span>
                      <span>·</span>
                      <span className="tabular-nums">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>

                    <div
                      className={`max-w-[85%] rounded-lg p-3 text-xs leading-relaxed whitespace-pre-wrap border ${
                        isUser
                          ? 'bg-gray-900 border-gray-900 text-white'
                          : 'bg-white text-gray-800 border-gray-200'
                      }`}
                    >
                      {msg.content || msg.text || ''}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="p-4 bg-white border-t border-gray-200">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <div className="flex-1">
                  <input
                    type="text"
                    value={adminNoteInput}
                    onChange={e => setAdminNoteInput(e.target.value)}
                    placeholder="Optional internal admin note on this conversation..."
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
                  />
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {!selectedSession.ticketId && selectedSession.resolutionStatus !== 'ticket_created' ? (
                    <button
                      type="button"
                      disabled={isProcessingAction}
                      onClick={() => handleCreateTicketFromSession(selectedSession)}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium text-xs rounded-lg transition cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <Ticket className="w-3.5 h-3.5" />
                      <span>Create Support Ticket</span>
                    </button>
                  ) : (
                    <span className="px-3 py-2 bg-gray-100 text-gray-800 font-medium text-xs rounded-lg border border-gray-200 inline-flex items-center gap-1.5">
                      <Ticket className="w-3.5 h-3.5" />
                      <span>Ticket Active: #{selectedSession.ticketId?.slice(0, 8)}</span>
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => setSelectedSession(null)}
                    className="px-4 py-2 bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 font-medium text-xs rounded-lg transition cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
