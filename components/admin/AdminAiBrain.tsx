import React, { useState, useEffect, useRef } from 'react';
import { db, collection, addDoc, doc, setDoc } from '../../firebase';
import { User, Vehicle, BannerDraft, AiBrainMessage, AiBrainSession, ContentBanner, CarouselSlide } from '../../types';
import { logAdminAction } from './adminAuditHelper';
import { authFetch } from '../../utils/apiClient';
import { uploadDataUrlToStorage } from '../../utils/storageUpload';

interface AdminAiBrainProps {
  currentUser: User;
  allVehicles: Vehicle[];
  users: User[];
  initialQuery?: string;
}

export const AdminAiBrain: React.FC<AdminAiBrainProps> = ({
  currentUser,
  allVehicles,
  users,
  initialQuery
}) => {
  // Chat Sessions (like Anthropic Claude / ChatGPT)
  const [sessions, setSessions] = useState<AiBrainSession[]>(() => {
    try {
      const saved = localStorage.getItem('autobid_ai_brain_sessions');
      if (saved) return JSON.parse(saved);
    } catch {}
    return [
      {
        id: 'session_default',
        title: 'Executive Intelligence & Banner Ops',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [
          {
            id: 'msg_welcome',
            role: 'assistant',
            content: `### 🧠 AutoBid Groq AI Brain Online  \n**Model Active:** \`openai/gpt-oss-120b\` on Groq Cloud  \n\nI am your internal operational intelligence model with real-time access to the complete AutoBid platform state, including:  \n- **🖼️ Content Management & Marketing Banners:** Draft single hero banners or multi-slide carousels for the homepage, attach links, analyze uploaded banner graphics, and publish directly with confirmation.  \n- **💳 Treasury Ledger:** Real-time reconciliation of **CT Account** (customer collections & wallet deposits) and **CT Collection** (channel where all virtual funds spent in the app go).  \n- **🔍 Complete Transaction Process Analysis:** Tracing any user transaction or ID to verify ledger capture, wallet balance impact, and CT Collection flows.  \n- **📱 Session & Device Intelligence:** Account IP addresses, history of changed IPs, previous browsers, and multi-account collision detection.  \n\n*Command me to draft a homepage banner, analyze a transaction, or audit account sessions below.*`,
            timestamp: Date.now()
          }
        ]
      }
    ];
  });

  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    return sessions[0]?.id || 'session_default';
  });

  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);
  const [inputQuery, setInputQuery] = useState<string>('');
  const [selectedScope, setSelectedScope] = useState<'all' | 'transactions' | 'accounting' | 'marketing' | 'moderation' | 'sessions' | 'banners'>('all');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [platformMetrics, setPlatformMetrics] = useState<any>(null);
  
  // Image Upload in Chat
  const [uploadedImage, setUploadedImage] = useState<{ name: string; url: string } | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState<boolean>(false);

  // Editable drafts in chat
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [editedLink, setEditedLink] = useState<string>('');
  const [activeSlideIdx, setActiveSlideIdx] = useState<Record<string, number>>({});
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Active session helper
  const currentSession = sessions.find(s => s.id === activeSessionId) || sessions[0];
  const messages = currentSession?.messages || [];

  // Persist sessions to localStorage and backend
  useEffect(() => {
    try {
      localStorage.setItem('autobid_ai_brain_sessions', JSON.stringify(sessions));
      if (currentSession) {
        authFetch('/api/admin/ai-brain/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session: currentSession })
        }).catch(() => {});
      }
    } catch {}
  }, [sessions]);

  // Load summary metrics
  const fetchSummary = async () => {
    try {
      const res = await authFetch('/api/admin/ai-brain/data-summary');
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.metrics) {
          setPlatformMetrics(data.metrics);
        }
      }
    } catch (err) {
      console.error('[AdminAiBrain] Failed to fetch data summary:', err);
    }
  };

  useEffect(() => {
    fetchSummary();
  }, []);

  // Handle initial query from another tab
  useEffect(() => {
    if (initialQuery && initialQuery.trim()) {
      handleSendMessage(initialQuery.trim());
    }
  }, [initialQuery]);

  // Scroll to bottom
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Create New Chat Session
  const handleCreateNewSession = () => {
    const newSessionId = `session_${Date.now()}`;
    const newSession: AiBrainSession = {
      id: newSessionId,
      title: 'New Conversation',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [
        {
          id: `msg_w_${Date.now()}`,
          role: 'assistant',
          content: `### 🧠 AutoBid Groq AI Brain Ready\nAsk me anything or command: *"Draft a luxury supercar carousel for the homepage"* or *"Check transaction status of user"*.`,
          timestamp: Date.now()
        }
      ]
    };
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newSessionId);
  };

  // Delete Session
  const handleDeleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (sessions.length <= 1) {
      alert('Cannot delete the last remaining chat session.');
      return;
    }
    if (!window.confirm('Delete this conversation session?')) return;
    setSessions(prev => prev.filter(s => s.id !== id));
    authFetch(`/api/admin/ai-brain/sessions/${id}`, { method: 'DELETE' }).catch(() => {});
    if (activeSessionId === id) {
      const remaining = sessions.filter(s => s.id !== id);
      setActiveSessionId(remaining[0]?.id || '');
    }
  };

  // Handle Image Upload from File Picker
  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Please select an image file (PNG, JPG, WebP).');
      return;
    }

    setIsUploadingImage(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const result = reader.result as string;
      try {
        const storageUrl = await uploadDataUrlToStorage(result, 'banners', `banner_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
        setUploadedImage({
          name: file.name,
          url: storageUrl
        });
      } catch {
        setUploadedImage({
          name: file.name,
          url: result
        });
      } finally {
        setIsUploadingImage(false);
      }
    };
    reader.onerror = () => {
      alert('Failed to read image file.');
      setIsUploadingImage(false);
    };
    reader.readAsDataURL(file);
  };

  // Send Message
  const handleSendMessage = async (queryText?: string) => {
    const textToSend = queryText || inputQuery;
    if ((!textToSend || !textToSend.trim()) && !uploadedImage) return;
    if (isLoading) return;

    const userMsgContent = textToSend.trim() || (uploadedImage ? `[Uploaded Banner Image: ${uploadedImage.name}]` : '');

    const userMsg: AiBrainMessage = {
      id: `msg_u_${Date.now()}`,
      role: 'user',
      content: userMsgContent,
      timestamp: Date.now(),
      metadata: {
        scope: selectedScope,
        uploadedImageUrl: uploadedImage?.url
      }
    };

    // Find any pending banner draft in current session to support conversational confirmations
    const pendingDraft = messages.slice().reverse().find(m => m.metadata?.bannerDraft)?.metadata?.bannerDraft;

    // Update active session messages
    const updatedMessages = [...messages, userMsg];
    setSessions(prev => prev.map(s => {
      if (s.id === activeSessionId) {
        // Auto-generate title from first user query if still default
        const newTitle = s.title === 'New Conversation' ? userMsgContent.slice(0, 32) + '...' : s.title;
        return {
          ...s,
          title: newTitle,
          updatedAt: Date.now(),
          messages: updatedMessages
        };
      }
      return s;
    }));

    setInputQuery('');
    const imagePayload = uploadedImage?.url;
    setUploadedImage(null);
    setIsLoading(true);

    try {
      const historyForApi = messages
        .filter(m => m.id !== 'msg_welcome')
        .map(m => ({ role: m.role, content: m.content }));

      const res = await authFetch('/api/admin/ai-brain/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: userMsgContent,
          history: historyForApi,
          scope: selectedScope,
          uploadedImageUrl: imagePayload,
          currentDraft: pendingDraft
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Groq AI Brain communication error.');
      }

      // Check if banner was published automatically via confirmation
      if (data.metadata?.actionType === 'banner_published' && data.metadata?.bannerDraft) {
        // Also persist to Firestore collection
        try {
          await addDoc(collection(db, 'content_banners'), {
            ...data.metadata.bannerDraft,
            createdAt: Date.now(),
            publishedBy: currentUser.email
          });
        } catch {}
        setActionSuccessMsg(`✓ Banner "${data.metadata.bannerDraft.title}" published live to homepage!`);
        setTimeout(() => setActionSuccessMsg(null), 4000);
      }

      const aiMsg: AiBrainMessage = {
        id: `msg_a_${Date.now()}`,
        role: 'assistant',
        content: data.reply || 'Analysis completed.',
        timestamp: Date.now(),
        metadata: {
          scope: selectedScope,
          modelUsed: data.modelUsed || 'openai/gpt-oss-120b',
          reportDownloadable: data.metadata?.reportDownloadable ?? true,
          reportTitle: data.metadata?.reportTitle || 'AutoBid Executive Intelligence Report',
          reportData: data.metadata?.reportData,
          reportType: data.metadata?.reportType || 'general',
          bannerDraft: data.metadata?.bannerDraft,
          actionType: data.metadata?.actionType
        }
      };

      setSessions(prev => prev.map(s => {
        if (s.id === activeSessionId) {
          return {
            ...s,
            updatedAt: Date.now(),
            messages: [...s.messages, aiMsg]
          };
        }
        return s;
      }));

      fetchSummary();
    } catch (err: any) {
      const errorMsg: AiBrainMessage = {
        id: `msg_err_${Date.now()}`,
        role: 'assistant',
        content: `⚠️ **AI Brain Error:** ${err.message}\n\nPlease check that the Groq model service is connected.`,
        timestamp: Date.now()
      };
      setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, messages: [...s.messages, errorMsg] } : s));
    } finally {
      setIsLoading(false);
    }
  };

  // Direct 1-Click Banner Publication from Action Card
  const handlePublishBannerDraft = async (draft: BannerDraft, msgId: string) => {
    setIsLoading(true);
    try {
      const bannerToPublish: ContentBanner = {
        id: draft.id || `banner_${Date.now()}`,
        title: draft.title,
        subtitle: draft.subtitle,
        imageUrl: draft.imageUrl,
        targetUrl: draft.targetUrl || '/auctions',
        position: draft.position || 'hero',
        isActive: true,
        createdAt: Date.now(),
        isCarousel: draft.isCarousel ?? Boolean(draft.slides && draft.slides.length > 0),
        slides: draft.slides,
        badge: draft.badge || '🔥 LIVE ANNOUNCEMENT',
        ctaText: draft.ctaText || 'Explore Now →',
        publishedBy: currentUser.email
      };

      // 1. Publish to Node.js backend
      await authFetch('/api/banners/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ banner: bannerToPublish })
      });

      // 2. Publish to Firestore collection for realtime client sync
      try {
        await setDoc(doc(db, 'content_banners', bannerToPublish.id), bannerToPublish);
      } catch (err) {
        console.warn('Firestore banner write fallback:', err);
      }

      await logAdminAction(
        currentUser,
        'PUBLISH_MARKETING_BANNER',
        'content_banners',
        bannerToPublish.id,
        `AI Brain published ${bannerToPublish.isCarousel ? 'carousel' : 'hero'} banner: "${bannerToPublish.title}"`
      );

      // 3. Update message metadata to status: published
      setSessions(prev => prev.map(s => {
        if (s.id === activeSessionId) {
          const newMsgs = s.messages.map(m => {
            if (m.id === msgId && m.metadata?.bannerDraft) {
              return {
                ...m,
                metadata: {
                  ...m.metadata,
                  bannerDraft: {
                    ...m.metadata.bannerDraft,
                    status: 'published' as const,
                    publishedAt: Date.now()
                  }
                }
              };
            }
            return m;
          });
          return { ...s, messages: newMsgs };
        }
        return s;
      }));

      setActionSuccessMsg(`✓ Banner "${draft.title}" published successfully to the homepage!`);
      setTimeout(() => setActionSuccessMsg(null), 4000);
    } catch (err: any) {
      alert('Failed to publish banner: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Download Systematic Report
  const handleDownloadReport = (msg: AiBrainMessage, format: 'md' | 'csv' = 'md') => {
    const dateStr = new Date(msg.timestamp).toISOString().split('T')[0];
    const title = msg.metadata?.reportTitle || 'AutoBid-Audit-Report';
    const filename = `${title.replace(/[^a-zA-Z0-9_-]/g, '_')}_${dateStr}.${format}`;

    let fileContent = '';
    let mimeType = 'text/plain';

    if (format === 'md') {
      fileContent = `# ${title}\n` +
        `**Generated by:** AutoBid Groq AI Brain (${msg.metadata?.modelUsed || 'openai/gpt-oss-120b'})\n` +
        `**Date:** ${new Date(msg.timestamp).toLocaleString()}\n` +
        `**Auditor Account:** @${currentUser.username} (${currentUser.email || 'Admin'})\n` +
        `---\n\n` +
        `${msg.content}\n\n` +
        `---\n` +
        `*AutoBid Platform Internal Ledger & Telemetry Security Report*\n`;
      mimeType = 'text/markdown';
    } else {
      const data = msg.metadata?.reportData;
      if (Array.isArray(data) && data.length > 0) {
        const headers = Object.keys(data[0]);
        const rows = data.map(row => headers.map(h => JSON.stringify(row[h] ?? '')).join(','));
        fileContent = [headers.join(','), ...rows].join('\n');
      } else if (typeof data === 'object' && data !== null) {
        fileContent = Object.entries(data).map(([k, v]) => `"${k}","${v}"`).join('\n');
      } else {
        fileContent = `Report,Content\n"${title}","${msg.content.replace(/"/g, '""')}"`;
      }
      mimeType = 'text/csv';
    }

    const blob = new Blob([fileContent], { type: `${mimeType};charset=utf-8;` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Executive Header Banner */}
      <div className="bg-gradient-to-r from-purple-950 via-indigo-950 to-gray-950 p-5 sm:p-6 rounded-3xl text-white shadow-xl relative overflow-hidden border border-purple-800/40">
        <div className="absolute right-0 top-0 translate-x-12 -translate-y-12 w-80 h-80 bg-purple-500/15 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center text-2xl shadow-lg border border-white/20">
              🧠
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg sm:text-xl font-black tracking-tight">
                  AutoBid Groq AI Brain • Executive Intelligence & Content Ops
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  Groq 120B Connected
                </span>
              </div>
              <p className="text-xs text-purple-200 mt-0.5 max-w-2xl leading-relaxed">
                Full-stack internal AI operator: Draft and publish homepage marketing banners & carousels, analyze CT Account/Collection treasury ledgers, trace transactions, and audit multi-browser device sessions.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start md:self-auto flex-wrap">
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs transition flex items-center gap-1.5 cursor-pointer"
            >
              <span>{isSidebarOpen ? '◀ Hide Chats' : '▶ Chat History'}</span>
            </button>
            <button
              onClick={handleCreateNewSession}
              className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-black text-xs shadow-md transition flex items-center gap-1.5 cursor-pointer"
            >
              <span>+ New Chat</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Container: Chat History Sidebar + Active Chat Session */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-start">
        {/* Left Sidebar: Recent Conversation Sessions (Like Anthropic Claude / ChatGPT) */}
        {isSidebarOpen && (
          <div className="lg:col-span-1 bg-white rounded-3xl border border-gray-200/80 shadow-xs p-4 space-y-3 flex flex-col max-h-[750px]">
            <div className="flex items-center justify-between border-b border-gray-100 pb-2.5">
              <span className="text-xs font-black uppercase text-gray-500 tracking-wider flex items-center gap-1.5">
                <span>💬</span>
                <span>Recent Conversations</span>
              </span>
              <button
                onClick={handleCreateNewSession}
                className="w-7 h-7 rounded-lg bg-purple-50 hover:bg-purple-100 text-purple-700 flex items-center justify-center font-bold text-sm cursor-pointer"
                title="Start new conversation"
              >
                +
              </button>
            </div>

            {/* Session List */}
            <div className="space-y-1.5 overflow-y-auto flex-1 pr-1">
              {sessions.map(s => {
                const isActive = s.id === activeSessionId;
                return (
                  <div
                    key={s.id}
                    onClick={() => setActiveSessionId(s.id)}
                    className={`p-3 rounded-2xl cursor-pointer transition flex items-center justify-between group border text-xs ${
                      isActive 
                        ? 'bg-gradient-to-r from-purple-50 to-indigo-50 border-purple-200 text-purple-950 font-bold shadow-xs' 
                        : 'bg-gray-50/60 hover:bg-gray-100/80 border-gray-100 text-gray-700'
                    }`}
                  >
                    <div className="truncate pr-2 flex-1">
                      <div className="truncate font-bold">{s.title}</div>
                      <div className="text-[10px] text-gray-400 mt-0.5 font-normal">
                        {s.messages.length} msg{s.messages.length === 1 ? '' : 's'} • {new Date(s.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    {sessions.length > 1 && (
                      <button
                        type="button"
                        onClick={(e) => handleDeleteSession(s.id, e)}
                        className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-600 transition p-1 rounded-md cursor-pointer"
                        title="Delete conversation"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Right Chat Panel: Active Conversation */}
        <div className={`${isSidebarOpen ? 'lg:col-span-3' : 'lg:col-span-4'} bg-white rounded-3xl border border-gray-200/80 shadow-xs flex flex-col h-[750px] overflow-hidden`}>
          {/* Action Success Toast */}
          {actionSuccessMsg && (
            <div className="p-3 bg-emerald-50 border-b border-emerald-200 text-emerald-900 text-xs font-bold flex items-center justify-between animate-fade-in">
              <span className="flex items-center gap-2">
                <span>🎉</span>
                <span>{actionSuccessMsg}</span>
              </span>
              <button onClick={() => setActionSuccessMsg(null)} className="text-emerald-700 hover:text-emerald-900">✕</button>
            </div>
          )}

          {/* Quick Scope Selector */}
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between gap-2 overflow-x-auto scrollbar-hide bg-gray-50/70">
            <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider whitespace-nowrap">
              Focus Scope:
            </span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {[
                { id: 'all', label: 'All Operations' },
                { id: 'banners', label: '🖼️ Marketing Banners' },
                { id: 'transactions', label: '💳 CT Treasury' },
                { id: 'accounting', label: '📊 Financial Ledgers' },
                { id: 'sessions', label: '📱 Devices & IPs' },
                { id: 'marketing', label: '🏎️ Bidding Velocity' }
              ].map(scope => (
                <button
                  key={scope.id}
                  onClick={() => setSelectedScope(scope.id as any)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer whitespace-nowrap ${
                    selectedScope === scope.id 
                      ? 'bg-purple-900 text-white shadow-xs' 
                      : 'bg-white text-gray-600 hover:bg-gray-200 border border-gray-200/60'
                  }`}
                >
                  {scope.label}
                </button>
              ))}
            </div>
          </div>

          {/* Messages Stream */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {messages.map((msg) => {
              const isAssistant = msg.role === 'assistant';
              const draft = msg.metadata?.bannerDraft;

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isAssistant ? 'items-start' : 'items-end'} animate-fade-in`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                      {isAssistant ? '🧠 AutoBid AI Brain' : `@${currentUser.username}`}
                    </span>
                    <span className="text-[10px] text-gray-400 font-mono">
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  {/* Bubble */}
                  <div className={`p-4 sm:p-5 rounded-2xl max-w-2xl text-xs sm:text-sm leading-relaxed space-y-3 ${
                    isAssistant 
                      ? 'bg-gray-50 border border-gray-200/90 text-gray-900 shadow-xs' 
                      : 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md'
                  }`}>
                    {/* Render User Uploaded Thumbnail if present */}
                    {msg.metadata?.uploadedImageUrl && (
                      <div className="mb-2 rounded-xl overflow-hidden border border-white/20 max-w-xs shadow-xs">
                        <img src={msg.metadata.uploadedImageUrl} alt="Uploaded Banner" className="w-full h-32 object-cover" />
                      </div>
                    )}

                    {/* Content formatted */}
                    <div className="prose prose-xs max-w-none whitespace-pre-wrap font-sans">
                      {/* Strip raw JSON blocks from rendered text since we render the visual card */}
                      {msg.content
                        .replace(/```banner_draft[\s\S]*?```/g, '')
                        .replace(/```banner_publish[\s\S]*?```/g, '')
                        .trim()}
                    </div>

                    {/* Interactive Homepage Banner & Carousel Action Card */}
                    {draft && (
                      <div className="mt-4 p-4 rounded-2xl bg-white border border-purple-200 shadow-md space-y-3">
                        <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                          <span className="font-extrabold text-xs text-purple-900 flex items-center gap-1.5 uppercase tracking-wider">
                            <span>🖼️</span>
                            <span>{draft.isCarousel ? 'Interactive Homepage Carousel Draft' : 'Homepage Hero Banner Draft'}</span>
                          </span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                            draft.status === 'published' 
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' 
                              : 'bg-amber-100 text-amber-800 border border-amber-300'
                          }`}>
                            {draft.status === 'published' ? '✅ Live On Homepage' : 'Draft • Pending Confirmation'}
                          </span>
                        </div>

                        {/* Visual Preview */}
                        <div className="relative rounded-2xl overflow-hidden h-40 bg-gray-950 group">
                          {draft.isCarousel && draft.slides && draft.slides.length > 0 ? (
                            <>
                              <img
                                src={draft.slides[activeSlideIdx[msg.id] || 0]?.imageUrl || draft.imageUrl}
                                alt={draft.title}
                                className="w-full h-full object-cover"
                              />
                              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-4 flex flex-col justify-end text-white">
                                {draft.slides[activeSlideIdx[msg.id] || 0]?.badge && (
                                  <span className="text-[9px] font-black uppercase tracking-wider text-red-400 mb-1">
                                    {draft.slides[activeSlideIdx[msg.id] || 0]?.badge}
                                  </span>
                                )}
                                <h4 className="font-black text-sm text-white line-clamp-1">
                                  {draft.slides[activeSlideIdx[msg.id] || 0]?.title || draft.title}
                                </h4>
                                <p className="text-[11px] text-gray-200 line-clamp-1">
                                  {draft.slides[activeSlideIdx[msg.id] || 0]?.subtitle || draft.subtitle}
                                </p>
                              </div>
                            </>
                          ) : (
                            <>
                              <img src={draft.imageUrl} alt={draft.title} className="w-full h-full object-cover" />
                              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-4 flex flex-col justify-end text-white">
                                {draft.badge && (
                                  <span className="text-[9px] font-black uppercase tracking-wider text-red-400 mb-1">
                                    {draft.badge}
                                  </span>
                                )}
                                <h4 className="font-black text-sm text-white line-clamp-1">{draft.title}</h4>
                                <p className="text-[11px] text-gray-200 line-clamp-1">{draft.subtitle}</p>
                              </div>
                            </>
                          )}
                        </div>

                        {/* Carousel Slides Tabs if Multi-Slide */}
                        {draft.isCarousel && draft.slides && draft.slides.length > 0 && (
                          <div className="space-y-1.5 pt-1">
                            <span className="text-[10px] font-bold text-gray-400 uppercase">
                              Carousel Slides ({draft.slides.length} Pages):
                            </span>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {draft.slides.map((slide, sIdx) => (
                                <button
                                  key={slide.id || sIdx}
                                  onClick={() => setActiveSlideIdx(prev => ({ ...prev, [msg.id]: sIdx }))}
                                  className={`px-2 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                                    (activeSlideIdx[msg.id] || 0) === sIdx 
                                      ? 'bg-purple-900 text-white' 
                                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                  }`}
                                >
                                  Slide {sIdx + 1}: {slide.targetUrl || '/auctions'}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Destination Link Info & Direct Edit */}
                        <div className="p-2.5 bg-gray-50 rounded-xl border border-gray-200 space-y-1.5 text-xs">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-gray-500 font-medium">Attached Destination URL:</span>
                            <span className="font-mono font-bold text-purple-700">
                              {draft.isCarousel && draft.slides?.[activeSlideIdx[msg.id] || 0] 
                                ? draft.slides[activeSlideIdx[msg.id] || 0].targetUrl 
                                : draft.targetUrl || '/auctions'}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              value={editingDraftId === msg.id ? editedLink : ''}
                              onChange={(e) => setEditedLink(e.target.value)}
                              placeholder="Change attached URL (e.g. /auctions or /sell)"
                              className="flex-1 px-2.5 py-1 bg-white border border-gray-200 rounded-lg text-xs outline-none"
                              onFocus={() => {
                                setEditingDraftId(msg.id);
                                setEditedLink(draft.targetUrl || '/auctions');
                              }}
                            />
                            {editingDraftId === msg.id && (
                              <button
                                type="button"
                                onClick={() => {
                                  draft.targetUrl = editedLink;
                                  if (draft.isCarousel && draft.slides?.[activeSlideIdx[msg.id] || 0]) {
                                    draft.slides[activeSlideIdx[msg.id] || 0].targetUrl = editedLink;
                                  }
                                  setEditingDraftId(null);
                                }}
                                className="px-2.5 py-1 bg-purple-700 text-white rounded-lg text-xs font-bold cursor-pointer"
                              >
                                Save Link
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
                          <span className="text-[11px] text-gray-500">
                            {draft.status === 'published' ? 'Active live for all site visitors' : 'Requires admin authorization to publish'}
                          </span>
                          {draft.status === 'published' ? (
                            <span className="px-3 py-1.5 bg-emerald-100 text-emerald-800 rounded-xl font-bold text-xs flex items-center gap-1.5">
                              <span>✓</span> Published to Homepage
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handlePublishBannerDraft(draft, msg.id)}
                              disabled={isLoading}
                              className="px-4 py-2 bg-gradient-to-r from-red-600 to-orange-500 hover:from-red-700 hover:to-orange-600 text-white font-black text-xs rounded-xl shadow-md transition cursor-pointer flex items-center gap-1.5"
                            >
                              <span>🚀</span>
                              <span>Confirm & Publish to Homepage</span>
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Report Download Bar */}
                    {isAssistant && msg.metadata?.reportDownloadable && !draft && (
                      <div className="pt-2 border-t border-gray-200/80 flex items-center justify-between flex-wrap gap-2 text-xs">
                        <span className="text-[10px] text-gray-500 font-mono">
                          Report: {msg.metadata.reportTitle}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleDownloadReport(msg, 'md')}
                            className="px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-[10px] transition cursor-pointer flex items-center gap-1"
                          >
                            <span>📄</span> Markdown (.md)
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownloadReport(msg, 'csv')}
                            className="px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-[10px] transition cursor-pointer flex items-center gap-1"
                          >
                            <span>📊</span> CSV Sheet
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {isLoading && (
              <div className="flex items-center gap-3 p-4 rounded-2xl bg-gray-50 border border-gray-200 max-w-sm text-xs text-gray-600 animate-pulse">
                <span className="w-4 h-4 border-2 border-purple-600 border-t-transparent rounded-full animate-spin" />
                <span>AutoBid Groq AI Brain is analyzing internal telemetry & drafting...</span>
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>

          {/* Quick Command Suggestions Chips */}
          <div className="px-4 py-2 border-t border-gray-100 bg-gray-50/50 flex items-center gap-1.5 overflow-x-auto scrollbar-hide">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider whitespace-nowrap">
              Quick Commands:
            </span>
            {[
              'Draft a supercar carousel banner for homepage with 3 slides and links',
              'Create a special weekend zero-fee promo banner for home page',
              'YES publish this banner to homepage',
              'Reconcile CT Account Treasury vs CT Collection Balance',
              'Audit recent IP switches and multi-browser account collisions'
            ].map((prompt, pIdx) => (
              <button
                key={pIdx}
                onClick={() => handleSendMessage(prompt)}
                className="px-2.5 py-1 rounded-lg bg-white hover:bg-purple-50 text-gray-700 hover:text-purple-800 border border-gray-200/80 text-[11px] font-medium transition cursor-pointer whitespace-nowrap shadow-2xs"
              >
                {prompt}
              </button>
            ))}
          </div>

          {/* Uploaded Image Preview Tag */}
          {uploadedImage && (
            <div className="px-5 py-2 bg-purple-50 border-t border-purple-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <img src={uploadedImage.url} alt="Attached" className="w-8 h-8 rounded-lg object-cover border border-purple-200" />
                <span className="text-xs font-bold text-purple-950 truncate max-w-xs">
                  Attached Banner Asset: {uploadedImage.name}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setUploadedImage(null)}
                className="text-xs text-purple-700 hover:text-purple-900 font-bold cursor-pointer"
              >
                ✕ Remove
              </button>
            </div>
          )}

          {/* Chat Input Bar with Image Upload */}
          <div className="p-3.5 border-t border-gray-200 bg-white flex items-center gap-2">
            {/* Hidden File Input for Image Upload */}
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              className="hidden"
              onChange={handleImageFileChange}
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploadingImage || isLoading}
              className="p-2.5 rounded-xl bg-gray-100 hover:bg-purple-100 text-gray-700 hover:text-purple-800 transition cursor-pointer flex items-center justify-center shrink-0 border border-gray-200"
              title="Upload custom banner image or asset"
            >
              <span>📷</span>
            </button>

            <input
              type="text"
              value={inputQuery}
              onChange={(e) => setInputQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="Command AI Brain (e.g. 'Draft homepage carousel with 3 slides', 'YES publish', or upload an image)..."
              className="flex-1 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs sm:text-sm text-gray-900 outline-none focus:ring-2 focus:ring-purple-500"
              disabled={isLoading}
            />

            <button
              type="button"
              onClick={() => handleSendMessage()}
              disabled={isLoading || (!inputQuery.trim() && !uploadedImage)}
              className="px-5 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-bold text-xs sm:text-sm rounded-xl shadow-md transition disabled:opacity-50 cursor-pointer flex items-center gap-1.5 shrink-0"
            >
              <span>Send</span>
              <span>→</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
