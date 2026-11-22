import React, { useState, useEffect, useRef } from 'react';
import {
  MessageCircle,
  Plus,
  Search,
  Mail,
  ChevronLeft,
  Send,
  Mic,
  Play,
  Pause,
  IndianRupee,
  X,
  AlertTriangle,
  Check,
  Loader2,
  ArrowRight
} from 'lucide-react';
import { User, DirectChat, DirectChatMessage } from '../types';
import { db } from '../firebase';
import {
  collection,
  doc,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  setDoc,
  updateDoc,
  increment
} from 'firebase/firestore';

interface DirectChatViewProps {
  currentUser: User;
  onNavigate: (view: string) => void;
  targetUser?: User | null;
  onViewProfile?: (user: User) => void;
  allUsers?: User[];
}

export const DirectChatView: React.FC<DirectChatViewProps> = ({
  currentUser,
  onViewProfile,
  allUsers = [],
  targetUser
}) => {
  const [chats, setChats] = useState<DirectChat[]>([]);
  const [activeChat, setActiveChat] = useState<DirectChat | null>(null);
  const [messages, setMessages] = useState<DirectChatMessage[]>([]);
  const [messageText, setMessageText] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const [isLoadingChats, setIsLoadingChats] = useState(true);
  const [isSending, setIsSending] = useState(false);

  // New Chat Modal
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState('');

  // Voice Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingError, setRecordingError] = useState('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<any>(null);

  // Audio Playback State
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  // Scroll to bottom
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Subscribe to User's Direct Chats
  useEffect(() => {
    if (!currentUser?.id) return;
    setIsLoadingChats(true);
    const chatsRef = collection(db, 'direct_chats');
    const q = query(chatsRef, where('participantIds', 'array-contains', currentUser.id));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const chatList: DirectChat[] = [];
      snapshot.forEach((docSnap) => {
        chatList.push({ id: docSnap.id, ...docSnap.data() } as DirectChat);
      });
      chatList.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      setChats(chatList);
      setIsLoadingChats(false);
    }, (err) => {
      console.warn('Direct chats listener error:', err);
      setIsLoadingChats(false);
    });

    return () => unsubscribe();
  }, [currentUser?.id]);

  // Open or create chat if targetUser is provided
  useEffect(() => {
    if (!targetUser || !currentUser?.id || targetUser.id === currentUser.id) return;

    const chatId = [currentUser.id, targetUser.id].sort().join('_');
    const existing = chats.find(c => c.id === chatId);

    if (existing) {
      setActiveChat(existing);
    } else {
      const newChat: DirectChat = {
        id: chatId,
        participantIds: [currentUser.id, targetUser.id],
        participants: {
          [currentUser.id]: {
            username: currentUser.username,
            fullName: currentUser.fullName || currentUser.username,
            avatarUrl: currentUser.avatarUrl || ''
          },
          [targetUser.id]: {
            username: targetUser.username,
            fullName: targetUser.fullName || targetUser.username,
            avatarUrl: targetUser.avatarUrl || ''
          }
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        unreadCount: {
          [currentUser.id]: 0,
          [targetUser.id]: 0
        }
      };

      setDoc(doc(db, 'direct_chats', chatId), newChat, { merge: true })
        .then(() => setActiveChat(newChat))
        .catch((e) => {
          console.warn('Create chat error:', e);
          setActiveChat(newChat);
        });
    }
  }, [targetUser, currentUser?.id]);

  // Subscribe to active chat messages
  useEffect(() => {
    if (!activeChat?.id) {
      setMessages([]);
      return;
    }

    const messagesCol = collection(db, 'direct_chats', activeChat.id, 'messages');
    const q = query(messagesCol, orderBy('timestamp', 'asc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgList: DirectChatMessage[] = [];
      snapshot.forEach((docSnap) => {
        msgList.push({ id: docSnap.id, ...docSnap.data() } as DirectChatMessage);
      });
      setMessages(msgList);
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 80);

      if (activeChat.unreadCount && activeChat.unreadCount[currentUser.id] > 0) {
        updateDoc(doc(db, 'direct_chats', activeChat.id), {
          [`unreadCount.${currentUser.id}`]: 0
        }).catch(() => {});
      }
    }, (err) => {
      console.warn('Messages listener error:', err);
    });

    return () => unsubscribe();
  }, [activeChat?.id, currentUser?.id]);

  const getOtherParticipant = (chat: DirectChat) => {
    const otherId = chat.participantIds.find(id => id !== currentUser.id);
    if (!otherId) return { id: '', username: 'User', fullName: 'User', avatarUrl: '' };

    if (chat.participants && chat.participants[otherId]) {
      return { id: otherId, ...chat.participants[otherId] };
    }

    const userObj = allUsers.find(u => u.id === otherId);
    if (userObj) {
      return {
        id: otherId,
        username: userObj.username,
        fullName: userObj.fullName || userObj.username,
        avatarUrl: userObj.avatarUrl || ''
      };
    }

    return { id: otherId, username: 'AutoBid Member', fullName: 'AutoBid Member', avatarUrl: '' };
  };

  // Send Text Message
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!messageText.trim() || !activeChat || !currentUser?.id || isSending) return;

    const other = getOtherParticipant(activeChat);
    const textToSend = messageText.trim();
    setMessageText('');
    setIsSending(true);

    try {
      const now = Date.now();
      const newMsg: Omit<DirectChatMessage, 'id'> = {
        chatId: activeChat.id,
        senderId: currentUser.id,
        senderUsername: currentUser.username,
        recipientId: other.id,
        type: 'text',
        text: textToSend,
        timestamp: now,
        read: false
      };

      await addDoc(collection(db, 'direct_chats', activeChat.id, 'messages'), newMsg);

      await setDoc(doc(db, 'direct_chats', activeChat.id), {
        participantIds: activeChat.participantIds,
        participants: {
          [currentUser.id]: {
            username: currentUser.username,
            fullName: currentUser.fullName || currentUser.username,
            avatarUrl: currentUser.avatarUrl || ''
          },
          [other.id]: {
            username: other.username,
            fullName: other.fullName || other.username,
            avatarUrl: other.avatarUrl || ''
          }
        },
        lastMessage: textToSend,
        lastMessageType: 'text',
        lastMessageTimestamp: now,
        lastSenderId: currentUser.id,
        updatedAt: now,
        unreadCount: {
          [other.id]: increment(1)
        }
      }, { merge: true });
    } catch (err: any) {
      console.error('Error sending message:', err);
      setMessageText(textToSend);
    } finally {
      setIsSending(false);
    }
  };

  // VOICE RECORDING LOGIC
  const startRecording = async () => {
    setRecordingError('');
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setRecordingError('Voice recording is not supported in this browser.');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];

      const mimeType = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/ogg')
        ? 'audio/ogg'
        : 'audio/mp4';

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start(200);
      setIsRecording(true);
      setRecordingSeconds(0);

      timerIntervalRef.current = setInterval(() => {
        setRecordingSeconds(prev => prev + 1);
      }, 1000);
    } catch (err: any) {
      console.error('Microphone access error:', err);
      setRecordingError('Microphone access denied or unavailable. Please allow mic permission.');
      setIsRecording(false);
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
    clearInterval(timerIntervalRef.current);
    setIsRecording(false);
    setRecordingSeconds(0);
    audioChunksRef.current = [];
  };

  const stopAndSendRecording = async () => {
    if (!mediaRecorderRef.current || !activeChat || !currentUser?.id) return;

    clearInterval(timerIntervalRef.current);
    const duration = recordingSeconds;
    setIsRecording(false);
    setIsSending(true);

    mediaRecorderRef.current.onstop = async () => {
      try {
        const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorderRef.current?.mimeType || 'audio/webm' });
        mediaRecorderRef.current?.stream.getTracks().forEach(track => track.stop());

        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          const base64Audio = reader.result as string;
          const other = getOtherParticipant(activeChat);
          const now = Date.now();

          const voiceMsg: Omit<DirectChatMessage, 'id'> = {
            chatId: activeChat.id,
            senderId: currentUser.id,
            senderUsername: currentUser.username,
            recipientId: other.id,
            type: 'voice',
            audioData: base64Audio,
            audioDuration: Math.max(1, duration),
            timestamp: now,
            read: false
          };

          await addDoc(collection(db, 'direct_chats', activeChat.id, 'messages'), voiceMsg);

          await setDoc(doc(db, 'direct_chats', activeChat.id), {
            participantIds: activeChat.participantIds,
            lastMessage: `Voice Message (${formatTime(Math.max(1, duration))})`,
            lastMessageType: 'voice',
            lastMessageTimestamp: now,
            lastSenderId: currentUser.id,
            updatedAt: now,
            unreadCount: {
              [other.id]: increment(1)
            }
          }, { merge: true });

          setIsSending(false);
          audioChunksRef.current = [];
        };
      } catch (err: any) {
        console.error('Error saving voice message:', err);
        setRecordingError('Failed to encode or send voice note.');
        setIsSending(false);
      }
    };

    if (mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  // Play / Pause voice message
  const togglePlayAudio = (messageId: string, audioDataUrl?: string) => {
    if (!audioDataUrl) return;

    if (playingMessageId === messageId) {
      audioPlayerRef.current?.pause();
      setPlayingMessageId(null);
      return;
    }

    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
    }

    const audio = new Audio(audioDataUrl);
    audioPlayerRef.current = audio;
    setPlayingMessageId(messageId);

    audio.onended = () => {
      setPlayingMessageId(null);
    };

    audio.onerror = () => {
      console.warn('Audio playback error');
      setPlayingMessageId(null);
    };

    audio.play().catch(e => {
      console.warn('Play failed:', e);
      setPlayingMessageId(null);
    });
  };

  const startChatWithUser = (user: User) => {
    setShowNewChatModal(false);
    const chatId = [currentUser.id, user.id].sort().join('_');
    const existing = chats.find(c => c.id === chatId);

    if (existing) {
      setActiveChat(existing);
    } else {
      const newChat: DirectChat = {
        id: chatId,
        participantIds: [currentUser.id, user.id],
        participants: {
          [currentUser.id]: {
            username: currentUser.username,
            fullName: currentUser.fullName || currentUser.username,
            avatarUrl: currentUser.avatarUrl || ''
          },
          [user.id]: {
            username: user.username,
            fullName: user.fullName || user.username,
            avatarUrl: user.avatarUrl || ''
          }
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        unreadCount: {
          [currentUser.id]: 0,
          [user.id]: 0
        }
      };

      setDoc(doc(db, 'direct_chats', chatId), newChat, { merge: true })
        .then(() => setActiveChat(newChat))
        .catch(() => setActiveChat(newChat));
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const formatTimestamp = (timestamp?: number) => {
    if (!timestamp) return '';
    const now = Date.now();
    const diff = now - timestamp;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const filteredChats = chats.filter(c => {
    const other = getOtherParticipant(c);
    const q = searchFilter.toLowerCase();
    return (
      other.username.toLowerCase().includes(q) ||
      (other.fullName && other.fullName.toLowerCase().includes(q)) ||
      (c.lastMessage && c.lastMessage.toLowerCase().includes(q))
    );
  });

  const availableUsersToChat = allUsers.filter(
    u =>
      u.id !== currentUser.id &&
      (u.username.toLowerCase().includes(userSearchQuery.toLowerCase()) ||
        (u.fullName && u.fullName.toLowerCase().includes(userSearchQuery.toLowerCase())))
  );

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 pb-24 md:pb-12">
      <div className="rounded-lg border border-gray-200 shadow-xs overflow-hidden bg-white flex flex-col md:flex-row h-[76vh] min-h-[540px]">
        {/* LEFT COLUMN: CONVERSATION LIST */}
        <div
          className={`w-full md:w-80 lg:w-96 border-r border-gray-200 flex flex-col bg-gray-50 ${
            activeChat ? 'hidden md:flex' : 'flex'
          }`}
        >
          {/* Header */}
          <div className="p-4 border-b border-gray-200 bg-white space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-gray-100 border border-gray-200 text-gray-700 flex items-center justify-center">
                  <MessageCircle className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-gray-900 leading-tight">Messages</h2>
                  <p className="text-xs text-gray-500">Direct Member Chat</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowNewChatModal(true)}
                className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold transition-colors inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Chat</span>
              </button>
            </div>

            <div className="relative">
              <input
                type="text"
                value={searchFilter}
                onChange={e => setSearchFilter(e.target.value)}
                placeholder="Search conversations..."
                className="w-full bg-gray-50 border border-gray-200 rounded-lg pl-8 pr-3 py-2 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-red-600 focus:bg-white transition-colors"
              />
              <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            </div>
          </div>

          {/* Chat List Scroll Area */}
          <div className="flex-1 overflow-y-auto divide-y divide-gray-200">
            {isLoadingChats ? (
              <div className="p-8 text-center text-gray-500 space-y-2">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400 mx-auto" />
                <p className="text-xs font-medium">Loading conversations...</p>
              </div>
            ) : filteredChats.length === 0 ? (
              <div className="p-8 text-center text-gray-500 space-y-3">
                <div className="w-11 h-11 rounded-lg bg-white border border-gray-200 text-gray-400 flex items-center justify-center mx-auto">
                  <Mail className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-800">No chats yet</p>
                  <p className="text-xs text-gray-500 mt-1 max-w-xs mx-auto">
                    Connect with any seller or bidder on AutoBid to discuss vehicles.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowNewChatModal(true)}
                  className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold transition-colors cursor-pointer"
                >
                  Start a Chat
                </button>
              </div>
            ) : (
              filteredChats.map((chat) => {
                const other = getOtherParticipant(chat);
                const isActive = activeChat?.id === chat.id;
                const unread = chat.unreadCount ? chat.unreadCount[currentUser.id] || 0 : 0;

                return (
                  <div
                    key={chat.id}
                    onClick={() => setActiveChat(chat)}
                    className={`p-3.5 flex items-center gap-3 cursor-pointer transition-colors ${
                      isActive ? 'bg-white' : 'hover:bg-gray-100/70'
                    }`}
                  >
                    <div className="relative shrink-0">
                      {other.avatarUrl ? (
                        <img
                          src={other.avatarUrl}
                          alt={other.username}
                          className="w-10 h-10 rounded-full object-cover border border-gray-200"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-gray-900 text-white font-semibold text-sm flex items-center justify-center">
                          {other.username.charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-xs truncate ${isActive ? 'font-bold text-gray-900' : 'font-semibold text-gray-900'}`}>
                          @{other.username}
                        </span>
                        <span className="text-xs text-gray-400 whitespace-nowrap tabular-nums">
                          {formatTimestamp(chat.lastMessageTimestamp || chat.updatedAt)}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 truncate mt-0.5">
                        {chat.lastMessage || 'Tap to start conversation'}
                      </p>
                    </div>

                    {unread > 0 && (
                      <span className="w-5 h-5 rounded-full bg-red-600 text-white text-xs font-semibold flex items-center justify-center shrink-0 tabular-nums">
                        {unread}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: ACTIVE CONVERSATION */}
        <div className={`flex-1 flex flex-col bg-white ${!activeChat ? 'hidden md:flex' : 'flex'}`}>
          {activeChat ? (
            <>
              {(() => {
                const other = getOtherParticipant(activeChat);
                return (
                  <div className="px-4 py-3 border-b border-gray-200 bg-white flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <button
                        type="button"
                        onClick={() => setActiveChat(null)}
                        aria-label="Back to chats"
                        className="md:hidden p-1.5 rounded-lg hover:bg-gray-100 text-gray-600 transition-colors cursor-pointer"
                      >
                        <ChevronLeft className="w-5 h-5" />
                      </button>

                      <div
                        className="flex items-center gap-2.5 cursor-pointer hover:opacity-85 transition-opacity min-w-0"
                        onClick={() => {
                          const targetUserObj = allUsers.find(u => u.id === other.id);
                          if (targetUserObj && onViewProfile) {
                            onViewProfile(targetUserObj);
                          }
                        }}
                      >
                        {other.avatarUrl ? (
                          <img
                            src={other.avatarUrl}
                            alt={other.username}
                            className="w-9 h-9 rounded-full object-cover border border-gray-200 shrink-0"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-gray-900 text-white font-semibold text-sm flex items-center justify-center shrink-0">
                            {other.username.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-sm text-gray-900 truncate">@{other.username}</span>
                            <span className="text-xs text-gray-400">· Verified</span>
                          </div>
                          <span className="text-xs text-emerald-600 font-medium block">Active Member</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Messages Feed */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50/40">
                {messages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-6 text-gray-500 space-y-2">
                    <MessageCircle className="w-8 h-8 text-gray-400" />
                    <p className="text-sm font-semibold text-gray-800">Start the conversation</p>
                    <p className="text-xs text-gray-500 max-w-xs">
                      Send a message or record a voice note.
                    </p>
                  </div>
                ) : (
                  messages.map((msg) => {
                    const isMe = msg.senderId === currentUser.id;

                    return (
                      <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                        {msg.type === 'fund_transfer' ? (
                          <div
                            className={`p-4 rounded-lg max-w-sm border ${
                              isMe
                                ? 'bg-emerald-50 border-emerald-200 text-gray-900'
                                : 'bg-white border-emerald-200 text-gray-900'
                            }`}
                          >
                            <div className="flex items-center gap-2 mb-2">
                              <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
                                <IndianRupee className="w-4 h-4" />
                              </div>
                              <div>
                                <span className="text-xs font-semibold text-emerald-800 block">
                                  INR Wallet Transfer
                                </span>
                                <span className="text-xs text-gray-700">
                                  {isMe ? `Sent to @${msg.recipientUsername}` : `Received from @${msg.senderUsername}`}
                                </span>
                              </div>
                            </div>
                            <div className="my-2 p-2.5 rounded-lg bg-white border border-emerald-200 flex items-baseline justify-between">
                              <span className="text-xs text-gray-500">Amount</span>
                              <span className="text-xl font-bold text-gray-900 tabular-nums">
                                ₹{(msg.transferAmount || 0).toLocaleString()}
                              </span>
                            </div>
                            {msg.transferNote && (
                              <p className="text-xs text-gray-600 mb-2">"{msg.transferNote}"</p>
                            )}
                            <div className="flex items-center justify-between text-xs text-gray-500 pt-2 border-t border-emerald-200">
                              <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                                <Check className="w-3 h-3" />
                                Credited to Wallet
                              </span>
                              <span className="tabular-nums">{formatTimestamp(msg.timestamp)}</span>
                            </div>
                          </div>
                        ) : msg.type === 'voice' ? (
                          <div
                            className={`p-3 rounded-lg max-w-xs sm:max-w-sm flex items-center gap-3 ${
                              isMe
                                ? 'bg-gray-900 text-white'
                                : 'bg-white border border-gray-200 text-gray-900'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => togglePlayAudio(msg.id, msg.audioData)}
                              className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                                isMe
                                  ? 'bg-white text-gray-900 hover:bg-gray-100'
                                  : 'bg-gray-900 text-white hover:bg-black'
                              }`}
                            >
                              {playingMessageId === msg.id ? (
                                <Pause className="w-4 h-4" />
                              ) : (
                                <Play className="w-4 h-4 ml-0.5" />
                              )}
                            </button>

                            <div className="flex-1 min-w-[140px]">
                              <div className="flex items-center gap-1 h-5">
                                {[10, 18, 14, 20, 12, 18, 14, 20, 14, 12, 18, 12].map((h, i) => (
                                  <span
                                    key={i}
                                    style={{ height: `${h}px` }}
                                    className={`w-1 rounded-full ${
                                      playingMessageId === msg.id
                                        ? isMe
                                          ? 'bg-white animate-pulse'
                                          : 'bg-red-600 animate-pulse'
                                        : isMe
                                        ? 'bg-white/40'
                                        : 'bg-gray-300'
                                    }`}
                                  />
                                ))}
                              </div>
                              <div className="flex items-center justify-between text-xs mt-1 opacity-80 tabular-nums">
                                <span>Voice ({formatTime(msg.audioDuration || 0)})</span>
                                <span>{formatTimestamp(msg.timestamp)}</span>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div
                            className={`px-3.5 py-2.5 rounded-lg max-w-sm sm:max-w-md text-xs sm:text-sm leading-relaxed ${
                              isMe
                                ? 'bg-gray-900 text-white'
                                : 'bg-white border border-gray-200 text-gray-900'
                            }`}
                          >
                            <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                            <span
                              className={`text-[10px] block text-right mt-1 tabular-nums ${
                                isMe ? 'text-gray-300' : 'text-gray-400'
                              }`}
                            >
                              {formatTimestamp(msg.timestamp)}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Recording Banner */}
              {isRecording && (
                <div className="px-4 py-2.5 bg-red-50 border-t border-red-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse" />
                    <span className="text-xs font-semibold text-red-700">Recording Voice Message</span>
                    <span className="text-xs font-mono font-semibold text-red-900 tabular-nums">
                      {formatTime(recordingSeconds)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={cancelRecording}
                      className="px-2.5 py-1 text-xs text-red-600 hover:text-red-800 font-medium cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={stopAndSendRecording}
                      className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold cursor-pointer inline-flex items-center gap-1"
                    >
                      <span>Send Voice</span>
                      <Send className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )}

              {/* Recording Error */}
              {recordingError && (
                <div className="px-4 py-2 bg-red-50 text-red-800 text-xs border-t border-red-200 flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
                    <span>{recordingError}</span>
                  </span>
                  <button type="button" onClick={() => setRecordingError('')} className="cursor-pointer">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Input Area */}
              <form onSubmit={handleSendMessage} className="p-3 border-t border-gray-200 bg-white flex items-center gap-2">
                <button
                  type="button"
                  onClick={isRecording ? stopAndSendRecording : startRecording}
                  title={isRecording ? 'Stop & Send Recording' : 'Record Voice Message'}
                  className={`p-2.5 rounded-lg border transition-colors cursor-pointer shrink-0 ${
                    isRecording
                      ? 'bg-red-600 text-white border-red-600'
                      : 'bg-gray-50 hover:bg-gray-100 text-gray-700 border-gray-200'
                  }`}
                >
                  <Mic className="w-4 h-4" />
                </button>

                <input
                  type="text"
                  value={messageText}
                  onChange={e => setMessageText(e.target.value)}
                  placeholder="Type a message..."
                  disabled={isRecording}
                  className="flex-1 bg-white border border-gray-200 rounded-lg px-3.5 py-2 text-xs sm:text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-red-600 transition-colors"
                />

                <button
                  type="submit"
                  disabled={!messageText.trim() || isSending}
                  aria-label="Send message"
                  className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-xs font-semibold transition-colors flex items-center justify-center shrink-0 cursor-pointer"
                >
                  {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </form>
            </>
          ) : (
            <div className="h-full flex flex-col items-center justify-center p-8 text-center text-gray-500 space-y-3">
              <div className="w-12 h-12 rounded-lg bg-gray-100 border border-gray-200 text-gray-600 flex items-center justify-center">
                <MessageCircle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-900">Select a Conversation</h3>
                <p className="text-xs text-gray-500 mt-1 max-w-sm">
                  Choose a conversation on the left or start a new chat with any buyer or seller on AutoBid.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowNewChatModal(true)}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                Start New Chat
              </button>
            </div>
          )}
        </div>
      </div>

      {/* MODAL 2: NEW CHAT */}
      {showNewChatModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-xs" onClick={() => setShowNewChatModal(false)} />
          <div className="relative bg-white rounded-lg p-6 max-w-md w-full shadow-lg border border-gray-200 flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between pb-3 border-b border-gray-200">
              <h3 className="text-base font-bold text-gray-900">Start a New Chat</h3>
              <button
                type="button"
                onClick={() => setShowNewChatModal(false)}
                className="text-gray-500 hover:text-gray-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="my-3 relative">
              <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={userSearchQuery}
                onChange={e => setUserSearchQuery(e.target.value)}
                placeholder="Search username or name..."
                className="w-full bg-gray-50 border border-gray-200 rounded-lg pl-8 pr-3 py-2 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-red-600"
              />
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-gray-200">
              {availableUsersToChat.length === 0 ? (
                <div className="p-6 text-center text-gray-500 text-xs">
                  No users found matching "{userSearchQuery}".
                </div>
              ) : (
                availableUsersToChat.map((user) => (
                  <div
                    key={user.id}
                    onClick={() => startChatWithUser(user)}
                    className="p-3 flex items-center justify-between hover:bg-gray-50 rounded-lg cursor-pointer transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      {user.avatarUrl ? (
                        <img
                          src={user.avatarUrl}
                          alt={user.username}
                          className="w-9 h-9 rounded-full object-cover border border-gray-200"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-gray-900 text-white font-semibold text-xs flex items-center justify-center">
                          {user.username.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <span className="font-semibold text-xs text-gray-900 block">@{user.username}</span>
                        <span className="text-xs text-gray-500">{user.fullName || 'AutoBid Member'}</span>
                      </div>
                    </div>
                    <span className="text-xs font-semibold text-red-600 inline-flex items-center gap-1">
                      <span>Chat</span>
                      <ArrowRight className="w-3 h-3" />
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
