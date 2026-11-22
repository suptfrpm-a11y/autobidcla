import React, { useState, useEffect } from 'react';
import { Bell, Send, Smartphone, History, CheckCircle2, AlertTriangle, X, Loader2, PenLine } from 'lucide-react';
import { db, collection, addDoc, onSnapshot, query, orderBy } from '../../firebase';
import { User } from '../../types';
import { logAdminAction } from './adminAuditHelper';

interface AdminNotificationsProps {
  currentUser: User;
  users: User[];
}

export const AdminNotifications: React.FC<AdminNotificationsProps> = ({ currentUser, users }) => {
  const [targetAudience, setTargetAudience] = useState<'all' | 'bidders' | 'sellers' | 'admins'>('all');
  const [notifType, setNotifType] = useState<'announcement' | 'promo' | 'alert' | 'system'>('announcement');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [actionLink, setActionLink] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [broadcastHistory, setBroadcastHistory] = useState<any[]>([]);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'broadcast_history'), orderBy('sentAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      const list: any[] = [];
      snap.forEach(d => list.push({ id: d.id, ...d.data() }));
      setBroadcastHistory(list);
    }, (err) => console.warn('Broadcast history fetch error:', err));
    return () => unsub();
  }, []);

  const handleSendBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !message.trim()) return;

    setIsSending(true);
    setNotice(null);
    try {
      let recipientUsers = [...users];
      if (targetAudience === 'bidders') {
        recipientUsers = users.filter(u => (u.deposits || 0) > 0 || u.role === 'user');
      } else if (targetAudience === 'sellers') {
        recipientUsers = users.filter(u => u.isVerified);
      } else if (targetAudience === 'admins') {
        recipientUsers = users.filter(u => u.role === 'admin' || u.role === 'finance' || u.role === 'support');
      }

      const recipientCount = recipientUsers.length;

      const sendPromises = recipientUsers.map(u =>
        addDoc(collection(db, 'notifications'), {
          userId: u.id,
          title,
          message,
          type: notifType,
          read: false,
          createdAt: Date.now(),
          link: actionLink || 'home',
          broadcast: true
        })
      );

      await Promise.all(sendPromises);

      await addDoc(collection(db, 'broadcast_history'), {
        title,
        message,
        targetAudience,
        notifType,
        recipientCount,
        sentBy: currentUser.email || currentUser.username,
        sentAt: Date.now()
      });

      await logAdminAction(
        currentUser,
        'DISPATCH_BROADCAST_NOTIFICATION',
        'notifications',
        targetAudience,
        `Dispatched "${title}" to ${recipientCount} recipients (${targetAudience})`
      );

      setNotice({ type: 'success', text: `Notification broadcast dispatched to ${recipientCount} users.` });
      setTimeout(() => setNotice(null), 4000);
      setTitle('');
      setMessage('');
      setActionLink('');
    } catch (err: any) {
      setNotice({ type: 'error', text: 'Failed to send broadcast: ' + err.message });
    } finally {
      setIsSending(false);
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
          <h2 className="text-lg font-semibold text-gray-900">Push & In-App Notifications</h2>
          <p className="text-xs text-gray-500 mt-1">
            Reach marketplace users directly with announcements, auction alerts, and promotional messages.
          </p>
        </div>
        <div className="text-xs text-gray-500 font-medium tabular-nums">
          Audience Base: <strong className="text-gray-900">{users.length} Registered Users</strong>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white p-5 rounded-lg border border-gray-200 shadow-xs space-y-4">
          <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
            <PenLine className="w-4 h-4 text-gray-500" />
            <span>Compose Notification</span>
          </h3>

          <form onSubmit={handleSendBroadcast} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Target Audience</label>
                <select
                  value={targetAudience}
                  onChange={(e: any) => setTargetAudience(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-medium outline-none focus:ring-2 focus:ring-gray-900"
                >
                  <option value="all">All Registered Platform Users ({users.length})</option>
                  <option value="bidders">Active Bidders & Buyers</option>
                  <option value="sellers">Verified Vehicle Sellers</option>
                  <option value="admins">Admin & Operations Staff</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Notification Type</label>
                <select
                  value={notifType}
                  onChange={(e: any) => setNotifType(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-medium outline-none focus:ring-2 focus:ring-gray-900"
                >
                  <option value="announcement">Platform Announcement</option>
                  <option value="promo">Promotion / Discount Deal</option>
                  <option value="alert">Important Alert / Live Auction</option>
                  <option value="system">System Maintenance Update</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Notification Title *</label>
              <input
                type="text"
                required
                placeholder="e.g. Supercar Sunday: Live Bidding Starting Now"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-gray-900"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Message Body *</label>
              <textarea
                required
                rows={3}
                placeholder="Enter message details shown in the user notification panel..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-gray-900"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Action Link (Optional)</label>
              <input
                type="text"
                placeholder="e.g. /auctions or /settings"
                value={actionLink}
                onChange={(e) => setActionLink(e.target.value)}
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs outline-none"
              />
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="submit"
                disabled={isSending}
                className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white font-medium text-xs rounded-lg disabled:opacity-50 inline-flex items-center gap-2 cursor-pointer"
              >
                {isSending ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Broadcasting...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>Dispatch Broadcast</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>

        <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-xs space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-gray-500" />
              <span>Notification Preview</span>
            </h3>
            <p className="text-xs text-gray-500">How recipients will see this alert:</p>

            <div className="p-4 rounded-lg border border-gray-200 bg-gray-50 space-y-2">
              <div className="flex items-center justify-between text-[11px] text-gray-500">
                <span className="font-semibold text-red-600 flex items-center gap-1">
                  <Bell className="w-3.5 h-3.5" /> AutoBid Alert
                </span>
                <span>Just now</span>
              </div>
              <h4 className="font-semibold text-gray-900 text-xs">
                {title || 'Your Notification Title'}
              </h4>
              <p className="text-xs text-gray-600 leading-relaxed">
                {message || 'The notification message body will appear here.'}
              </p>
              {actionLink && (
                <div className="text-xs font-medium text-gray-900 underline">
                  Tap to view
                </div>
              )}
            </div>
          </div>

          <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 text-xs text-gray-600">
            In-app alerts sync immediately via Firestore for all signed-in members.
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-xs space-y-4">
        <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
          <History className="w-4 h-4 text-gray-500" />
          <span>Sent Broadcast History</span>
        </h3>
        {broadcastHistory.length === 0 ? (
          <p className="text-xs text-gray-500 py-4 text-center">No broadcasts sent yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 text-gray-500 uppercase font-semibold border-b border-gray-200 text-[11px]">
                <tr>
                  <th className="py-2.5 px-3">Date</th>
                  <th className="py-2.5 px-3">Title & Message</th>
                  <th className="py-2.5 px-3">Target</th>
                  <th className="py-2.5 px-3">Recipients</th>
                  <th className="py-2.5 px-3">Sent By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {broadcastHistory.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="py-2.5 px-3 whitespace-nowrap text-gray-500 tabular-nums">
                      {new Date(item.sentAt).toLocaleDateString()} {new Date(item.sentAt).toLocaleTimeString()}
                    </td>
                    <td className="py-2.5 px-3 max-w-sm">
                      <div className="font-semibold text-gray-900">{item.title}</div>
                      <div className="text-gray-500 text-[11px] truncate">{item.message}</div>
                    </td>
                    <td className="py-2.5 px-3 uppercase text-[11px] font-medium">
                      <span className="px-2 py-0.5 rounded-lg bg-gray-100 text-gray-700 border border-gray-200">
                        {item.targetAudience}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-medium text-emerald-700 tabular-nums">
                      {item.recipientCount} users
                    </td>
                    <td className="py-2.5 px-3 text-gray-500 text-xs">
                      {item.sentBy}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
