import React, { useState, useEffect, useRef } from 'react';
import {
  MessageCircle,
  Mail,
  Ticket,
  ShieldCheck,
  Send,
  CheckCircle2,
  AlertCircle,
  ArrowLeft,
  X,
  Upload,
} from 'lucide-react';
import { User, SupportChat, ChatMessage } from '../types';
import {
  db,
  collection,
  addDoc,
  query,
  where,
  onSnapshot,
  orderBy,
  updateDoc,
  doc,
} from '../firebase';

interface HelpSupportProps {
  currentUser: User;
  onNavigate: (view: string) => void;
}

export const HelpSupport: React.FC<HelpSupportProps> = ({ currentUser }) => {
  const [activeTab, setActiveTab] = useState<'help' | 'verify'>('help');
  const [chatMode, setChatMode] = useState(false);
  const [ticketMode, setTicketMode] = useState(false);

  // Notice State (replaces window.alert)
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Verification State
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState(currentUser.email || '');
  const [docName, setDocName] = useState('');
  const [isSubmittingVerify, setIsSubmittingVerify] = useState(false);

  // Chat State
  const [chat, setChat] = useState<SupportChat | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [msgInput, setMsgInput] = useState('');

  // Ticket State
  const [ticketSubject, setTicketSubject] = useState('');
  const [ticketDesc, setTicketDesc] = useState('');
  const [isSubmittingTicket, setIsSubmittingTicket] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatMode) {
      const q = query(
        collection(db, 'support_chats'),
        where('userId', '==', currentUser.id),
        where('status', 'in', ['open', 'active'])
      );
      const unsub = onSnapshot(
        q,
        (snap) => {
          if (!snap.empty) {
            const c = { id: snap.docs[0].id, ...snap.docs[0].data() } as SupportChat;
            setChat(c);

            if (c.unreadCountUser && c.unreadCountUser > 0) {
              updateDoc(doc(db, 'support_chats', c.id), { unreadCountUser: 0 });
            }
          } else {
            setChat(null);
          }
        },
        (err) => console.error('Chat fetch error:', err)
      );
      return () => unsub();
    }
  }, [chatMode, currentUser.id]);

  useEffect(() => {
    if (chat) {
      const q = query(
        collection(db, 'support_chats', chat.id, 'messages'),
        orderBy('timestamp', 'asc')
      );
      const unsub = onSnapshot(
        q,
        (snap) => {
          const msgs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ChatMessage));
          setMessages(msgs);
          setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
        },
        (err) => console.error('Messages fetch error:', err)
      );
      return () => unsub();
    }
  }, [chat]);

  const startChat = async () => {
    setNotice(null);
    setChatMode(true);
    if (!chat) {
      try {
        const newChat = {
          userId: currentUser.id,
          username: currentUser.username,
          status: 'open',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          unreadCountAdmin: 0,
          unreadCountUser: 0,
        };
        const res = await addDoc(collection(db, 'support_chats'), newChat);
        setChat({ id: res.id, ...newChat } as SupportChat);
      } catch (err: any) {
        setNotice({ type: 'error', text: err?.message || 'Unable to start live chat.' });
      }
    }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!msgInput.trim() || !chat) return;

    const text = msgInput;
    setMsgInput('');

    await addDoc(collection(db, 'support_chats', chat.id, 'messages'), {
      chatId: chat.id,
      senderId: currentUser.id,
      senderRole: currentUser.role || 'user',
      text,
      timestamp: Date.now(),
    });

    await updateDoc(doc(db, 'support_chats', chat.id), {
      updatedAt: Date.now(),
      unreadCountAdmin: (chat.unreadCountAdmin || 0) + 1,
      status: 'open',
    });
  };

  const submitVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    if (!phone.trim() || !docName.trim()) {
      setNotice({ type: 'error', text: 'Please fill out your phone number and select your documents.' });
      return;
    }
    setIsSubmittingVerify(true);
    try {
      await addDoc(collection(db, 'appeals'), {
        userId: currentUser.id,
        reason: 'Verification Request',
        type: 'verification',
        phone,
        email,
        documents: docName,
        status: 'pending',
        createdAt: Date.now(),
      });
      setNotice({
        type: 'success',
        text: 'Verification request submitted successfully. Our team will review your documents soon.',
      });
      setPhone('');
      setDocName('');
      setActiveTab('help');
    } catch (err: any) {
      setNotice({ type: 'error', text: 'Error submitting request: ' + (err?.message || 'Unknown error') });
    } finally {
      setIsSubmittingVerify(false);
    }
  };

  const submitTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    if (!ticketSubject.trim() || !ticketDesc.trim()) return;
    setIsSubmittingTicket(true);
    try {
      await addDoc(collection(db, 'tickets'), {
        userId: currentUser.id,
        subject: ticketSubject,
        description: ticketDesc,
        status: 'open',
        createdAt: Date.now(),
      });
      setNotice({ type: 'success', text: 'Support ticket raised successfully.' });
      setTicketMode(false);
      setTicketSubject('');
      setTicketDesc('');
    } catch (err: any) {
      setNotice({ type: 'error', text: 'Error raising ticket: ' + (err?.message || 'Unknown error') });
    } finally {
      setIsSubmittingTicket(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 pb-24 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-200 pb-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Help & Support</h1>
          <p className="text-sm text-gray-500 mt-1">
            Contact our support team, raise a ticket, or submit identity verification documents.
          </p>
        </div>
        <div className="flex gap-2 bg-gray-100 p-1 rounded-lg border border-gray-200 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => {
              setActiveTab('help');
              setNotice(null);
            }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'help'
                ? 'bg-white text-gray-900 shadow-xs border border-gray-200'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Support
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('verify');
              setChatMode(false);
              setTicketMode(false);
              setNotice(null);
            }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'verify'
                ? 'bg-white text-gray-900 shadow-xs border border-gray-200'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Get Verified
          </button>
        </div>
      </div>

      {notice && (
        <div
          className={`p-4 rounded-lg border flex items-start justify-between gap-3 text-sm ${
            notice.type === 'success'
              ? 'bg-green-50 border-green-200 text-green-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {notice.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            )}
            <span>{notice.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Dismiss notification"
            className="text-gray-500 hover:text-gray-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {activeTab === 'help' && !chatMode && !ticketMode && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button
            type="button"
            onClick={startChat}
            className="bg-white border border-gray-200 rounded-lg p-6 text-left hover:border-gray-300 shadow-xs transition-colors flex flex-col gap-3"
          >
            <div className="w-10 h-10 bg-gray-100 text-gray-700 rounded-lg border border-gray-200 flex items-center justify-center">
              <MessageCircle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-gray-900">Live Chat</h3>
              <p className="text-gray-500 text-sm mt-1">
                Chat with our support specialists in real time.
              </p>
            </div>
          </button>

          <a
            href="mailto:support@autobid.com"
            className="bg-white border border-gray-200 rounded-lg p-6 text-left hover:border-gray-300 shadow-xs transition-colors flex flex-col gap-3"
          >
            <div className="w-10 h-10 bg-gray-100 text-gray-700 rounded-lg border border-gray-200 flex items-center justify-center">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-gray-900">Email Support</h3>
              <p className="text-gray-500 text-sm mt-1">
                Reach us directly at support@autobid.com.
              </p>
            </div>
          </a>

          <button
            type="button"
            onClick={() => setTicketMode(true)}
            className="bg-white border border-gray-200 rounded-lg p-6 text-left hover:border-gray-300 shadow-xs transition-colors flex flex-col gap-3"
          >
            <div className="w-10 h-10 bg-gray-100 text-gray-700 rounded-lg border border-gray-200 flex items-center justify-center">
              <Ticket className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-gray-900">Raise Ticket</h3>
              <p className="text-gray-500 text-sm mt-1">
                Submit a structured ticket for detailed inquiries.
              </p>
            </div>
          </button>
        </div>
      )}

      {chatMode && (
        <div className="bg-white border border-gray-200 rounded-lg shadow-xs overflow-hidden flex flex-col h-[560px]">
          <div className="bg-white border-b border-gray-200 px-4 py-3 flex justify-between items-center">
            <div className="flex items-center gap-2.5">
              <MessageCircle className="w-5 h-5 text-red-600" />
              <h3 className="font-semibold text-gray-900 text-sm">Live Support Chat</h3>
            </div>
            <button
              type="button"
              onClick={() => setChatMode(false)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded-lg border border-gray-200 bg-gray-50"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Close
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
            {messages.length === 0 && (
              <div className="text-center py-12 text-sm text-gray-500">
                Start the conversation below. A support agent will reply shortly.
              </div>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.senderId === currentUser.id ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[75%] px-4 py-2.5 rounded-lg text-sm ${
                    m.senderId === currentUser.id
                      ? 'bg-red-600 text-white'
                      : 'bg-white border border-gray-200 text-gray-900'
                  }`}
                >
                  <p>{m.text}</p>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
          <form onSubmit={sendMessage} className="p-4 bg-white border-t border-gray-200 flex gap-2">
            <input
              type="text"
              value={msgInput}
              onChange={(e) => setMsgInput(e.target.value)}
              placeholder="Type your message..."
              className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-red-500 focus:bg-white"
            />
            <button
              type="submit"
              aria-label="Send message"
              className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg flex items-center justify-center transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      )}

      {ticketMode && (
        <div className="bg-white border border-gray-200 rounded-lg shadow-xs p-6 max-w-2xl mx-auto">
          <div className="flex justify-between items-center mb-6 pb-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Raise a Support Ticket</h2>
            <button
              type="button"
              onClick={() => setTicketMode(false)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded-lg border border-gray-200 bg-gray-50"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Cancel
            </button>
          </div>
          <form onSubmit={submitTicket} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Subject</label>
              <input
                type="text"
                value={ticketSubject}
                onChange={(e) => setTicketSubject(e.target.value)}
                required
                placeholder="Brief summary of the issue"
                className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3.5 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:bg-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Description</label>
              <textarea
                value={ticketDesc}
                onChange={(e) => setTicketDesc(e.target.value)}
                required
                rows={4}
                placeholder="Provide full details so our team can assist quickly..."
                className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3.5 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:bg-white"
              />
            </div>
            <button
              type="submit"
              disabled={isSubmittingTicket}
              className="w-full bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white font-semibold py-2.5 px-4 rounded-lg text-sm transition-colors"
            >
              {isSubmittingTicket ? 'Submitting...' : 'Submit Ticket'}
            </button>
          </form>
        </div>
      )}

      {activeTab === 'verify' && (
        <div className="bg-white border border-gray-200 rounded-lg shadow-xs p-6 max-w-2xl mx-auto">
          {currentUser.isVerified ? (
            <div className="text-center py-8 space-y-3">
              <div className="w-14 h-14 bg-green-50 text-green-600 border border-green-200 rounded-lg flex items-center justify-center mx-auto">
                <ShieldCheck className="w-7 h-7" />
              </div>
              <h2 className="text-xl font-semibold text-gray-900">Your account is verified</h2>
              <p className="text-gray-500 text-sm max-w-md mx-auto">
                You already hold an active verified badge and full bidding privileges.
              </p>
            </div>
          ) : (
            <>
              <div className="mb-6 pb-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Request Identity Verification</h2>
                <p className="text-gray-500 mt-1 text-sm">
                  Submit your details and supporting documents to receive a verified badge on your profile.
                </p>
              </div>
              <form onSubmit={submitVerification} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm bg-gray-50 text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Phone Number</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    placeholder="+91 98765 43210"
                    className="w-full border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm bg-gray-50 text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Documents (ID, Driving License, Photo)
                  </label>
                  <label className="flex items-center gap-3 w-full border border-dashed border-gray-300 rounded-lg px-4 py-3 bg-gray-50 hover:bg-gray-100 cursor-pointer transition-colors">
                    <Upload className="w-4 h-4 text-gray-500 shrink-0" />
                    <span className="text-sm text-gray-700 truncate">
                      {docName || 'Select supporting document files'}
                    </span>
                    <input
                      type="file"
                      onChange={(e) => setDocName(e.target.files?.[0]?.name || 'uploaded_docs.pdf')}
                      multiple
                      className="hidden"
                    />
                  </label>
                </div>
                <button
                  type="submit"
                  disabled={isSubmittingVerify}
                  className="w-full bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white font-semibold py-2.5 px-4 rounded-lg text-sm transition-colors mt-2"
                >
                  {isSubmittingVerify ? 'Submitting...' : 'Submit Documents'}
                </button>
              </form>
            </>
          )}
        </div>
      )}
    </div>
  );
};
