import { DashboardView } from './components/ManageDashboard';
import React, { useState, useEffect, useRef } from 'react';
import { Navbar } from './components/Navbar';
import { VehicleCard } from './components/VehicleCard';
import { VehicleDetail } from './components/VehicleDetail';
import { BottomNav } from './components/BottomNav';
import { Auth } from './components/Auth';
import { SellCar } from './components/SellCar';
import { Settings } from './components/Settings';
import { SearchUsers } from './components/SearchUsers';
import { AdminPanel } from './components/AdminPanel';
import { HelpSupport } from './components/HelpSupport';
import { WalletView } from './components/WalletView';
import { IdentityVerificationModal } from './components/IdentityVerificationModal';
import { VehicleCardSkeleton, VehicleDetailSkeleton, DashboardSkeleton } from './components/Skeletons';
import { HomeInfoPages, InfoSectionType } from './components/HomeInfoPages';
import { DirectChatView } from './components/DirectChatView';
import { StockManagement } from './components/StockManagement';
import { CookieConsentBanner } from './components/CookieConsentBanner';
import { HomeBannerCarousel } from './components/HomeBannerCarousel';
import { AiSupportDrawer } from './components/AiSupportDrawer';
import { generateStockNumber, buildStockRecord, saveStockRecordToFirestore } from './utils/stockHelper';
import { prepareVehicleForFirestore } from './utils/imageCompression';
import { saveActiveSession, getActiveSession } from './utils/cookieManager';
import { Vehicle, User, VehicleStatus } from './types';
import { TRANSLATIONS } from './constants';
import { auth, db } from './firebase';
import { onAuthStateChanged, signOut, User as FirebaseUser } from 'firebase/auth';
import { collection, onSnapshot, query, where, doc, updateDoc, setDoc, getDocs, getDoc, arrayUnion, arrayRemove, increment, addDoc, runTransaction } from 'firebase/firestore';
import { sanitizeInstagramUsername } from './utils/username';
import { authFetch } from './utils/apiClient';
import { playBidClickSound, playUserBidPlacedSound, playMultiUserRapidClick } from './utils/soundEffects';
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Coins,
  Cookie,
  Eye,
  FileText,
  Gavel,
  Headphones,
  Heart,
  HelpCircle,
  LayoutGrid,
  Lightbulb,
  Link2,
  Lock,
  Mail,
  MessageCircle,
  Package,
  Pencil,
  Plus,
  Search,
  Share2,
  ShieldCheck,
  Settings as SettingsIcon,
  Tag,
  Trophy,
  Users,
  X,
  Zap,
  Bookmark,
  BarChart3,
} from 'lucide-react';

type ViewState = 'home' | 'detail' | 'profile' | 'auth' | 'sell' | 'stock' | 'settings' | 'search' | 'admin' | 'deleted' | 'support' | 'wallet' | 'terms' | 'privacy' | 'help' | 'faq' | 'contact' | 'help_center' | 'chat';
type AuctionFilter = 'all' | 'live' | 'upcoming' | 'for_sale';
type ProfileTab = 'auctions' | 'watchlist' | 'won' | 'lost' | 'dashboard';

export const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pendingVerificationUser, setPendingVerificationUser] = useState<FirebaseUser | null>(null);
  const [authSyncTick, setAuthSyncTick] = useState(0);
  const [currentView, setCurrentView] = useState<ViewState>('home');
  const [activeInfoSection, setActiveInfoSection] = useState<InfoSectionType>('help_center');
  const [settingsSection, setSettingsSection] = useState<any>(undefined);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  
  // User State
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [currentLanguage, setCurrentLanguage] = useState('English (US)');
  const [showVerificationModal, setShowVerificationModal] = useState(false);
  const [isAiSupportOpen, setIsAiSupportOpen] = useState(false);

  // Chat State
  const [chatTargetUser, setChatTargetUser] = useState<User | null>(null);
  const [unreadChatCount, setUnreadChatCount] = useState<number>(0);

  // Profile State
  const [profileUser, setProfileUser] = useState<User | null>(null); // User currently being viewed
  const [profileTab, setProfileTab] = useState<ProfileTab>('auctions');
  const [profileListedFilter, setProfileListedFilter] = useState<'all' | 'auction' | 'direct'>('all');
  
  const [auctionFilter, setAuctionFilter] = useState<AuctionFilter>('all');
  const [isLoading, setIsLoading] = useState(true);

  // User Bidding History State (for Won & Lost profile tracking)
  const [allBids, setAllBids] = useState<any[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [archiveFilter, setArchiveFilter] = useState<'all' | 'listings' | 'bids'>('all');
  const [showFollowModal, setShowFollowModal] = useState<'followers' | 'following' | null>(null);
  const [showDiscoverDrawer, setShowDiscoverDrawer] = useState(false);
  const [discoverSearch, setDiscoverSearch] = useState('');
  const [isFollowLoading, setIsFollowLoading] = useState(false);

  // 100% Live Server-backed User Bids (replaces localStorage & cookies completely)
  const [userBidVehicleIds, setUserBidVehicleIds] = useState<string[]>([]);

  // Firestore Quota Guard
  const [isQuotaExhausted, setIsQuotaExhausted] = useState<boolean>(false);

  // Non-blocking in-app toast & account appeal state
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [appealReason, setAppealReason] = useState('');
  const [isSubmittingAppeal, setIsSubmittingAppeal] = useState(false);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
  };

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!currentUser?.id || allBids.length === 0) return;
    const ids = Array.from(
      new Set(
        allBids
          .filter(b => b.userId === currentUser.id || b.bidderId === currentUser.id)
          .map(b => String(b.vehicleId))
          .filter(Boolean)
      )
    );
    setUserBidVehicleIds(prev => Array.from(new Set([...prev, ...ids])));
  }, [currentUser?.id, allBids]);

  // Translations
  const t = TRANSLATIONS[currentLanguage] || TRANSLATIONS['English (US)'];

  const [notifications, setNotifications] = useState<any[]>([]);

  // Dynamically synchronize vehicle ownership whenever currentUser changes
  useEffect(() => {
    if (!currentUser?.id) return;
    setVehicles(prev => prev.map(v => ({
      ...v,
      isOwner: Boolean(currentUser.id && v.ownerId === currentUser.id)
    })));
  }, [currentUser?.id]);

  const isVerifiedAuthUser = async (fbUser: FirebaseUser | null): Promise<boolean> => {
    if (!fbUser) return false;
    if (fbUser.emailVerified) return true;
    try {
      const tokenResult = await fbUser.getIdTokenResult();
      if (tokenResult?.signInProvider === 'microsoft.com') {
        return true;
      }
    } catch {
      // Fallback to providerData if token lookup fails
      if (fbUser.providerData?.some((p) => p?.providerId === 'microsoft.com')) {
        return true;
      }
    }
    return false;
  };

  const syncedBootstrapAdminUidRef = useRef<string | null>(null);

  // Listen to Auth State + Dual Public/Private User Docs (A1)
  useEffect(() => {
    let unsubUserDoc: (() => void) | null = null;
    let unsubUserPrivateDoc: (() => void) | null = null;
    let unsubNotifs: (() => void) | null = null;
    let authEventSeq = 0;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      const currentSeq = ++authEventSeq;
      if (unsubUserDoc) {
        unsubUserDoc();
        unsubUserDoc = null;
      }
      if (unsubUserPrivateDoc) {
        unsubUserPrivateDoc();
        unsubUserPrivateDoc = null;
      }
      if (unsubNotifs) {
        unsubNotifs();
        unsubNotifs = null;
      }

      if (user) {
        void (async () => {
          const verified = await isVerifiedAuthUser(user);
          if (currentSeq !== authEventSeq) return;

          if (!verified) {
            setPendingVerificationUser(user);
            setIsAuthenticated(false);
            setCurrentUser(null);
            setProfileUser(null);
            setNotifications([]);
            return;
          }

          setPendingVerificationUser(null);
          setIsAuthenticated(true);
        const userDocRef = doc(db, 'users', user.uid);
        const userPrivateRef = doc(db, 'user_private', user.uid);
        let latestPublicUser: Record<string, any> | null = null;
        let latestPrivateUser: Record<string, any> = {};
        let createdPrivateDoc = false;

        const isBootstrapAdmin = Boolean(
          verified && (user.email || '').toLowerCase().trim() === 'mmwajnnd@gmail.com'
        );

        const syncMergedUser = () => {
          if (!latestPublicUser) return;
          const userData = {
            ...latestPublicUser,
            ...latestPrivateUser,
            id: user.uid
          } as User;

          if (isBootstrapAdmin && userData.role !== 'admin') {
            userData.role = 'admin';
            if (syncedBootstrapAdminUidRef.current !== user.uid) {
              syncedBootstrapAdminUidRef.current = user.uid;
              authFetch('/api/auth/sync-bootstrap-admin', { method: 'POST' })
                .then(async (res) => {
                  if (res.ok) {
                    await user.getIdToken(true).catch(() => {});
                  }
                })
                .catch(() => {});
            }
          }

          // Immediate Session Revocation Check (Force-termination by administrator)
          if (userData.isRevoked || (userData.sessionRevokedAt && (!userData.loginTime || userData.sessionRevokedAt > userData.loginTime))) {
            console.warn("[Security] Active session has been force-terminated by administrator.");
            signOut(auth).catch(() => {});
            setCurrentUser(null);
            setIsAuthenticated(false);
            setCurrentView('home');
            showToast("Security Alert: Your active session has been terminated by the platform administrator. You have been signed out.", "error");
            return;
          }

          setCurrentUser(userData);
          setProfileUser(prev => (!prev || prev.id === userData.id) ? userData : prev);
          if (userData.suspensionStatus === 'temporary' || userData.suspensionStatus === 'permanent' || userData.isDeleted) {
            setCurrentView('deleted');
          } else {
            setCurrentView(prev => (prev === 'deleted' ? 'home' : prev));
          }
        };

        unsubUserPrivateDoc = onSnapshot(userPrivateRef, (privSnap) => {
          if (privSnap.exists()) {
            createdPrivateDoc = true;
            latestPrivateUser = privSnap.data() || {};
          } else {
            latestPrivateUser = {};
          }
          syncMergedUser();
        }, (err) => {
          console.warn('User private fetch notice:', err);
        });

        unsubUserDoc = onSnapshot(userDocRef, (docSnap) => {
          if (docSnap.exists()) {
            latestPublicUser = docSnap.data() as Record<string, any>;
            syncMergedUser();
          } else {
            let pendingStoredUsername: string | null = null;
            try {
              pendingStoredUsername = sessionStorage.getItem(`autobid_pending_username_${user.uid}`);
              if (pendingStoredUsername) {
                sessionStorage.removeItem(`autobid_pending_username_${user.uid}`);
              }
            } catch {
              pendingStoredUsername = null;
            }
            const rawUsername = pendingStoredUsername || user.displayName || user.email?.split('@')[0] || `user_${Math.floor(Math.random() * 10000)}`;
            const cleanUsername = sanitizeInstagramUsername(rawUsername) || `user_${Math.floor(Math.random() * 10000)}`;
            const now = Date.now();
            const publicUserPayload: Record<string, any> = {
              id: user.uid,
              username: cleanUsername,
              fullName: user.displayName || pendingStoredUsername || user.email?.split('@')[0] || 'User',
              avatarUrl: user.photoURL || `https://i.pravatar.cc/150?u=${user.uid}`,
              isVerified: false,
              verificationStatus: 'unverified',
              followers: 0,
              following: 0,
              followingIds: [],
              followersIds: [],
              bio: 'New member at AutoBid.',
              role: isBootstrapAdmin ? 'admin' : 'user',
              hasStockInsightsAccess: false,
              createdAt: now,
              agreedToTerms: true,
              agreedToTermsAt: now
            };
            const privateUserPayload: Record<string, any> = {
              email: user.email || '',
              deposits: 0,
              suspensionStatus: 'none',
              isDeleted: false,
              isRevoked: false
            };

            setDoc(userDocRef, publicUserPayload).catch(err => console.error('Error creating user doc:', err));
            if (!createdPrivateDoc) {
              createdPrivateDoc = true;
              setDoc(userPrivateRef, privateUserPayload).catch(err => console.warn('Error creating user_private doc:', err));
            }
            setDoc(doc(db, 'usernames', cleanUsername), { uid: user.uid }).catch(err => console.error('Error claiming username:', err));
          }
        }, (err) => {
          console.error('User fetch error:', err);
        });

        const notifQ = query(collection(db, 'notifications'), where('userId', '==', user.uid), where('read', '==', false));
        unsubNotifs = onSnapshot(notifQ, (snap) => {
          const notifs: any[] = [];
          snap.forEach(d => notifs.push({ id: d.id, ...d.data() }));
          setNotifications(notifs);
        }, (err) => {
          console.error('Notifications fetch error:', err);
        });
        })();
      } else {
        setPendingVerificationUser(null);
        setIsAuthenticated(false);
        setCurrentUser(null);
        setProfileUser(null);
        setNotifications([]);
      }
    });

    return () => {
      authEventSeq++;
      unsubscribeAuth();
      if (unsubUserDoc) unsubUserDoc();
      if (unsubUserPrivateDoc) unsubUserPrivateDoc();
      if (unsubNotifs) unsubNotifs();
    };
  }, [authSyncTick]);

  // Listen to Firestore Vehicles & Bids with Real-Time Millisecond Sound Triggers
  useEffect(() => {
    const vehiclesCol = collection(db, 'vehicles');
    let isInitialVehiclesLoad = true;
    const prevBidsMap = new Map<string, number>();

    const unsubscribe = onSnapshot(vehiclesCol, (snapshot) => {
      const vehiclesData: Vehicle[] = [];
      const currentUid = auth.currentUser?.uid;

      if (!isInitialVehiclesLoad) {
        let soundTriggered = false;
        snapshot.docChanges().forEach((change, idx) => {
          if (change.type === 'modified') {
            const d = change.doc.data();
            const prev = prevBidsMap.get(change.doc.id) || 0;
            if (d.currentBid && d.currentBid > prev) {
              playMultiUserRapidClick(idx);
              soundTriggered = true;
            }
          }
        });
      }

      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        prevBidsMap.set(docSnap.id, d.currentBid || 0);
        const sNum = d.stockNumber || generateStockNumber();
        vehiclesData.push({ 
          ...d, 
          id: docSnap.id || d.id,
          stockNumber: sNum,
          isOwner: Boolean(currentUid && d.ownerId === currentUid)
        } as Vehicle);
      });
      isInitialVehiclesLoad = false;

      // Sort: live auctions ending soonest first, upcoming by startTime
      setVehicles(vehiclesData.sort((a, b) => {
        const now = Date.now();
        const aIsUpcoming = (a.startTime && a.startTime > now) || a.status === 'Upcoming';
        const bIsUpcoming = (b.startTime && b.startTime > now) || b.status === 'Upcoming';
        if (aIsUpcoming && !bIsUpcoming) return 1;
        if (!aIsUpcoming && bIsUpcoming) return -1;
        return a.endTime - b.endTime;
      }));
      setSelectedVehicle(prev => {
        if (!prev) return null;
        const updated = vehiclesData.find(v => v.id === prev.id);
        return updated || prev;
      });
      setIsLoading(false);
    }, (err: any) => {
      console.warn("Vehicles fetch notice:", err);
      setIsLoading(false);
    });

    const bidsCol = collection(db, 'bids');
    let isInitialBidsLoad = true;
    const unsubBids = onSnapshot(bidsCol, (snapshot) => {
      const bList: any[] = [];
      let newBidsCount = 0;
      snapshot.forEach((doc) => {
        bList.push({ id: doc.id, ...doc.data() });
      });
      setAllBids(bList);

      // Play click sound for all connected users whenever any bid arrives in real time
      if (!isInitialBidsLoad) {
        snapshot.docChanges().forEach((change) => {
          if (change.type === 'added') {
            playMultiUserRapidClick(newBidsCount++);
          }
        });
      }
      isInitialBidsLoad = false;
    }, (err) => {
      console.warn("Bids listener notice:", err);
    });

    const usersCol = collection(db, 'users');
    const unsubUsers = onSnapshot(usersCol, (snapshot) => {
      const uList: User[] = [];
      snapshot.forEach((doc) => {
        uList.push(doc.data() as User);
      });
      setAllUsers(uList);
    }, (err) => {
      console.warn("Users listener notice:", err);
    });

    return () => {
      unsubscribe();
      unsubBids();
      unsubUsers();
    };
  }, []);

  // Listen to unread direct chats for current user
  useEffect(() => {
    if (!currentUser?.id) {
      setUnreadChatCount(0);
      return;
    }
    const q = query(
      collection(db, 'direct_chats'),
      where('participantIds', 'array-contains', currentUser.id)
    );
    const unsub = onSnapshot(q, (snap) => {
      let count = 0;
      snap.forEach((d) => {
        const data = d.data();
        if (data.unreadCount && typeof data.unreadCount[currentUser.id] === 'number') {
          count += data.unreadCount[currentUser.id];
        }
      });
      setUnreadChatCount(count);
    }, (err) => {
      console.warn("Unread direct chats listener error:", err);
    });
    return () => unsub();
  }, [currentUser?.id]);

  const handleLoginSuccess = async (_userData?: { username: string, uid: string }) => {
      const fbUser = auth.currentUser;
      if (fbUser && !(await isVerifiedAuthUser(fbUser))) {
        setPendingVerificationUser(fbUser);
        setIsAuthenticated(false);
        return;
      }
      setPendingVerificationUser(null);
      setAuthSyncTick(prev => prev + 1);
      setCurrentView('home');
  };

  const handleLogout = async () => {
      await signOut(auth);
      setPendingVerificationUser(null);
      setCurrentView('home');
  };

  const openChat = (target?: User | null) => {
    if (!currentUser) {
      handleViewChange('auth');
      return;
    }
    setChatTargetUser(target || null);
    handleViewChange('chat');
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 50);
  };

  const openInfoPage = (section: InfoSectionType) => {
    setActiveInfoSection(section);
    const settingsMap: Record<InfoSectionType, any> = {
      terms: 'LEGAL_AGREEMENT',
      privacy: 'PRIVACY_POLICY',
      cookies: 'COOKIE_POLICY',
      help_center: 'HELP_CENTRE',
      faq: 'FAQS',
      help: 'HELP_GUIDES',
      contact: 'CONTACT_US'
    };
    setSettingsSection(settingsMap[section] || 'INFO_HUB');
    handleViewChange('settings');
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 50);
  };

  // Auto-restore active session view from cookies / storage on initial launch
  useEffect(() => {
    const session = getActiveSession();
    if (session && session.view && session.view !== 'home') {
      if (session.view === 'settings' && session.settingsSection) {
        setSettingsSection(session.settingsSection);
      }
      setCurrentView(session.view as ViewState);
    }
  }, []);

  // Restore selected vehicle if returning to a detail session
  useEffect(() => {
    if (vehicles.length > 0 && currentView === 'detail' && !selectedVehicle) {
      const session = getActiveSession();
      if (session && session.vehicleId) {
        const found = vehicles.find(v => v.id === session.vehicleId);
        if (found) setSelectedVehicle(found);
      }
    }
  }, [vehicles, currentView, selectedVehicle]);

  // Periodic authenticated session heartbeat & IP/browser telemetry reporting
  useEffect(() => {
    if (!currentUser || !currentUser.id) return;
    const reportHeartbeat = () => {
      authFetch('/api/sessions/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })
      .then(res => res.json())
      .then(data => {
        if (data && data.revoked === true) {
          console.warn('[Session Security] Session terminated by administrator.');
          signOut(auth).catch(() => {});
          setCurrentUser(null);
          setIsAuthenticated(false);
          setCurrentView('home');
          showToast('Security Alert: Your active session has been terminated by the platform administrator. You have been signed out.', 'error');
        }
      })
      .catch(() => {});
    };

    reportHeartbeat();
    const heartbeatInterval = setInterval(reportHeartbeat, 15000);
    return () => clearInterval(heartbeatInterval);
  }, [currentUser?.id]);

  const handleTodaysAuctions = () => {
    setSelectedVehicle(null);
    setAuctionFilter('live');
    if (currentView !== 'home') {
      setCurrentView('home');
    }
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 60);
  };

  const handleJoinAuction = () => {
    const now = Date.now();
    // 1. Identify live auction vehicles first
    const liveVehicles = vehicles.filter(v => {
      if (v.status === 'Sold' || (v.status as string) === 'Sold') return false;
      if (v.isBlacklisted || v.status === 'Blacklisted') return false;
      if (v.listingType === 'direct' || v.status === 'Direct Sale') return false;
      const isUpcoming = (v.startTime && v.startTime > now) || v.status === 'Upcoming';
      if (isUpcoming) return false;
      return v.status === 'Live' || v.status === 'Live Auction' || v.endTime > now;
    });

    let topVehicle: Vehicle | null = null;
    if (liveVehicles.length > 0) {
      // Frequently viewed / highest interest live vehicle
      topVehicle = [...liveVehicles].sort((a, b) => {
        const scoreA = (a.views || 0) + (a.watchCount || 0) * 2 + (a.upcomingBids?.length || 0) * 3;
        const scoreB = (b.views || 0) + (b.watchCount || 0) * 2 + (b.upcomingBids?.length || 0) * 3;
        return scoreB - scoreA;
      })[0];
    } else {
      // If none currently active live, pick the most popular vehicle overall
      const available = vehicles.filter(v => v.status !== 'Sold' && !v.isBlacklisted);
      if (available.length > 0) {
        topVehicle = [...available].sort((a, b) => (b.views || 0) - (a.views || 0))[0];
      }
    }

    if (topVehicle) {
      setSelectedVehicle(topVehicle);
      navigate('detail');
      setTimeout(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }, 50);
    } else {
      setAuctionFilter('live');
      if (currentView !== 'home') {
        setCurrentView('home');
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleAuctionCalendar = () => {
    setSelectedVehicle(null);
    setAuctionFilter('upcoming');
    if (currentView !== 'home') {
      setCurrentView('home');
    }
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 60);
  };

  const navigate = (view: string) => {
    if (['terms', 'privacy', 'cookies', 'help_center', 'faq', 'help', 'contact', 'legal', 'legal_agreement'].includes(view)) {
      const mapped = (view === 'legal' || view === 'legal_agreement') ? 'terms' : (view as InfoSectionType);
      openInfoPage(mapped);
      return;
    }
    if (view === 'chat') {
        openChat(null);
        return;
    }
    if (view === 'dashboard') {
        setProfileUser(currentUser);
        setProfileTab('auctions');
        handleViewChange('profile');
        return;
    }
    if (view === 'wallet') {
        handleViewChange('wallet');
        return;
    }
    if (view === 'settings') {
        setSettingsSection('MENU');
        handleViewChange('settings');
        return;
    }
    setSettingsSection(undefined);
    if (view === 'profile') {
        setProfileUser(currentUser);
    }
    handleViewChange(view as ViewState);
  };

  const hasStockAccess = Boolean(
    currentUser?.role === 'admin' ||
      currentUser?.hasStockInsightsAccess ||
      (currentUser &&
        typeof window !== 'undefined' &&
        localStorage.getItem('hasStockInsightsAccess_' + currentUser.id) === 'true')
  );

  // Movable navigator sequence for swipe / wipe transitions between menus
  const SWIPE_NAV_MENU_ORDER: ViewState[] = ['home', 'search', 'sell', ...(hasStockAccess ? ['stock' as ViewState] : []), 'wallet', 'chat', 'profile'];

  const swipeTouchRef = React.useRef<{ startX: number; startY: number; startTime: number } | null>(null);

  const handleMainTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    // Don't trigger swipe navigation if touching inputs, buttons, sliders, horizontal scrollers or modals
    if (
      target.closest('input, textarea, select, button, [role="button"], [data-no-swipe], .overflow-x-auto, .overflow-x-scroll') ||
      showVerificationModal || showArchiveModal || showFollowModal || showDiscoverDrawer
    ) {
      swipeTouchRef.current = null;
      return;
    }

    if (e.touches.length === 1) {
      swipeTouchRef.current = {
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        startTime: Date.now()
      };
    }
  };

  const handleMainTouchEnd = (e: React.TouchEvent) => {
    if (!swipeTouchRef.current) return;
    const touch = e.changedTouches[0];
    if (!touch) return;

    const deltaX = touch.clientX - swipeTouchRef.current.startX;
    const deltaY = touch.clientY - swipeTouchRef.current.startY;
    const elapsed = Date.now() - swipeTouchRef.current.startTime;
    swipeTouchRef.current = null;

    // Check if on one of the 6 movable nav views
    const currentIndex = SWIPE_NAV_MENU_ORDER.indexOf(currentView);
    if (currentIndex === -1) return;

    // Must be a predominantly horizontal swipe (at least 50px distance, > 1.3x vertical motion, within 650ms)
    if (elapsed < 650 && Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY) * 1.3) {
      if (deltaX < 0 && currentIndex < SWIPE_NAV_MENU_ORDER.length - 1) {
        // Swiped Left (finger moved right-to-left) -> Next menu
        const nextView = SWIPE_NAV_MENU_ORDER[currentIndex + 1];
        navigate(nextView);
        try {
          if (typeof window !== 'undefined' && 'navigator' in window && navigator.vibrate) {
            navigator.vibrate(10);
          }
        } catch {}
      } else if (deltaX > 0 && currentIndex > 0) {
        // Swiped Right (finger moved left-to-right) -> Previous menu
        const prevView = SWIPE_NAV_MENU_ORDER[currentIndex - 1];
        navigate(prevView);
        try {
          if (typeof window !== 'undefined' && 'navigator' in window && navigator.vibrate) {
            navigator.vibrate(10);
          }
        } catch {}
      }
    }
  };

  const handleViewChange = (view: ViewState) => {
    setCurrentView(view);
    window.scrollTo(0, 0);
    saveActiveSession(view, {
      vehicleId: selectedVehicle?.id,
      settingsSection
    });
  };

  const handleVehicleClick = (vehicle: Vehicle) => {
    setSelectedVehicle(vehicle);
    saveActiveSession('detail', { vehicleId: vehicle.id });
    navigate('detail');
  };

  const handleBackToHome = () => {
    setSelectedVehicle(null);
    saveActiveSession('home');
    navigate('home');
  };

  const handleMarkSold = async () => {
    if (!selectedVehicle) return;
    try {
      const res = await authFetch('/api/auctions/mark-sold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicleId: selectedVehicle.id })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to mark vehicle as sold.');
      }
      const commission = Number(data.commission || 0);
      const finalPrice = Number(data.finalPrice ?? selectedVehicle.currentBid ?? 0);
      setSelectedVehicle({
        ...selectedVehicle,
        status: 'Sold',
        finalSoldPrice: finalPrice,
        commissionAmount: commission,
        isConcluded: true
      } as any);
      showToast(`Vehicle marked as sold! Commission of ₹${commission.toLocaleString()} deducted from owner's wallet.`, 'success');
    } catch (err: any) {
      console.error("Error marking sold: ", err);
      showToast("Error: " + err.message, 'error');
    }
  };

  // Server-authoritative conversion to Direct Sale (A6)
  const handleConvertToDirectSale = async (vehicleId: string, directPrice: number) => {
    try {
      const res = await authFetch('/api/vehicles/convert-direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicleId, directPrice })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed converting listing to Direct Sale.');
      }

      const patch = {
        listingType: 'direct' as const,
        status: 'Direct Sale' as any,
        directPrice: data.directPrice ?? directPrice,
        startingPrice: data.directPrice ?? directPrice,
        currentBid: data.directPrice ?? directPrice,
        listedAt: data.listedAt ?? Date.now(),
        expiresAt: data.expiresAt,
        endTime: data.endTime,
        isBlacklisted: false
      };

      setVehicles(prev => prev.map(v => v.id === vehicleId ? { ...v, ...patch } : v));
      if (selectedVehicle && selectedVehicle.id === vehicleId) {
        setSelectedVehicle(prev => prev ? { ...prev, ...patch } : null);
      }

      showToast(`Vehicle moved to Vehicles For Sale at ₹${directPrice.toLocaleString()} for 3 months.`, 'success');
    } catch (err: any) {
      console.error("Error shifting vehicle to direct sale:", err);
      showToast("Error shifting vehicle: " + (err.message || 'Unknown error'), 'error');
    }
  };

  const handlePlaceUpcomingBid = async () => {
    if (!selectedVehicle || !currentUser) return;
    if (!currentUser.isVerified && currentUser.role !== 'admin') {
      setShowVerificationModal(true);
      return;
    }
    if (selectedVehicle.ownerId && selectedVehicle.ownerId === currentUser.id) {
      showToast("You cannot place pre-bids on your own vehicle listing.", 'error');
      return;
    }

    const askingPrice = selectedVehicle.startingPrice || selectedVehicle.currentBid;
    try {
      const res = await authFetch('/api/bids/prebid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicleId: selectedVehicle.id })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        if (data.code === 'KYC_REQUIRED') {
          setShowVerificationModal(true);
          return;
        }
        throw new Error(data.error || 'Failed to record pre-bid.');
      }

      const newUpcomingBids = data.upcomingBids || [];
      setSelectedVehicle(prev => prev ? ({ ...prev, upcomingBids: newUpcomingBids }) : null);
      showToast(`Pre-bid registered at ₹${askingPrice.toLocaleString()}. You hold 1st Bidder priority.`, 'success');
    } catch (e: any) {
      console.error("Error saving upcoming pre-bid:", e);
      showToast(e?.message || "Failed to record pre-bid. Please try again.", 'error');
    }
  };

  const handlePlaceBid = async (amount: number) => {
    if (!selectedVehicle || !currentUser) return;

    if (!currentUser.isVerified && currentUser.role !== 'admin') {
      setShowVerificationModal(true);
      return;
    }

    if (selectedVehicle.ownerId && selectedVehicle.ownerId === currentUser.id) {
      showToast("You cannot place bids on your own vehicle listing.", 'error');
      return;
    }

    if (amount <= selectedVehicle.currentBid) {
      showToast(`Bid must be greater than current bid of ₹${selectedVehicle.currentBid.toLocaleString()}`, 'error');
      return;
    }

    // Instant mechanical click auditory feedback
    playUserBidPlacedSound();

    const targetVehicleId = selectedVehicle.id;
    const prevSelected = selectedVehicle;
    const prevVehicles = vehicles;
    const nowMs = Date.now();

    // Optimistic UI feedback
    setSelectedVehicle(prev => prev && prev.id === targetVehicleId ? ({
      ...prev,
      currentBid: amount,
      userBidStatus: 'winning',
      winningUserId: currentUser.id,
      winningUsername: currentUser.username,
      winningBidderId: currentUser.id,
      lastBidAt: nowMs,
      liveParticipants: Array.from(new Set([...(prev.liveParticipants || []), currentUser.id])),
      bidUserIds: prev.bidUserIds ? [...new Set([...prev.bidUserIds, currentUser.id])] : [currentUser.id]
    }) : prev);

    setVehicles(prev => prev.map(v => v.id === targetVehicleId ? {
      ...v,
      currentBid: amount,
      userBidStatus: 'winning',
      winningUserId: currentUser.id,
      winningUsername: currentUser.username,
      winningBidderId: currentUser.id,
      lastBidAt: nowMs
    } : v));

    setUserBidVehicleIds(prev => prev.includes(targetVehicleId) ? prev : [...prev, targetVehicleId]);

    try {
      const res = await authFetch('/api/bids/place', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicleId: targetVehicleId, amount })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        // Revert optimistic update on server validation failure
        setSelectedVehicle(prevSelected);
        setVehicles(prevVehicles);
        if (data.code === 'KYC_REQUIRED') {
          setShowVerificationModal(true);
          return;
        }
        showToast(data.error || 'Bid rejected by auction server.', 'error');
      }
    } catch (error: any) {
      setSelectedVehicle(prevSelected);
      setVehicles(prevVehicles);
      console.warn("[App] Bid placement notice:", error?.message || error);
      showToast(error?.message || 'Unable to place bid right now. Please try again.', 'error');
    }
  };

  const handleListVehicle = async (newVehicle: Vehicle) => {
      const activeUserId = auth.currentUser?.uid || currentUser.id;
      const activeUsername = currentUser.username || auth.currentUser?.displayName || 'user';
      const activeName = currentUser.fullName || currentUser.name || activeUsername;

      // Ensure 8-9 digit unique stock number
      const stockNumber = newVehicle.stockNumber || generateStockNumber();

      // Extract and remove static isOwner so it is never saved to Firestore
      const { isOwner: _ignored, ...cleanData } = newVehicle;
      const vehicleWithOwner = { 
        ...cleanData, 
        stockNumber,
        listingFee: 0,
        liveBidDuration: 0,
        boostOption: 'none',
        isConcluded: cleanData.isConcluded ?? false,
        isBlacklisted: cleanData.isBlacklisted ?? false,
        ownerId: activeUserId,
        ownerUsername: activeUsername,
        ownerName: activeName,
      };

      try {
        const vehicleId = newVehicle.id || Date.now().toString();
        const newVehicleRef = doc(collection(db, 'vehicles'), vehicleId);
        const vehicleWithId = { ...vehicleWithOwner, id: vehicleId } as any;
        
        // Remove undefined fields and guarantee images/data stay well below Firestore 1MB limit
        const cleanForFirestore = await prepareVehicleForFirestore(vehicleWithId);

        await setDoc(newVehicleRef, cleanForFirestore);

        // Store complete vehicle & owner data in 'stock' collection
        try {
          const stockRecord = buildStockRecord(cleanForFirestore, currentUser);
          await saveStockRecordToFirestore(stockRecord);
        } catch (sErr) {
          console.warn("[App] Stock record sync error:", sErr);
        }
        
        // Update local state immediately so user sees it right away across the app
        const localVehicleWithOwnership: Vehicle = {
          ...cleanForFirestore,
          isOwner: true
        };
        setVehicles(prev => [localVehicleWithOwnership, ...prev.filter(v => v.id !== vehicleWithId.id)]);
      } catch (error: any) {
        console.error("Error listing vehicle: ", error);
        showToast("Failed to list vehicle: " + (error?.message || "Please try again."), 'error');
        throw error;
      }
  };

  const handleUserSearch = (user: User) => {
      setProfileUser(user);
      setProfileTab('auctions'); // Reset tab to default when viewing a new user
      navigate('profile');
  };

  // Determine font class based on language
  const getFontClass = (lang: string) => {
    switch(lang) {
      case 'Hindi': return 'font-hindi';
      case 'Marathi': return 'font-marathi';
      case 'Sanskrit': return 'font-sanskrit';
      case 'Arabic': return 'font-arabic';
      case 'Urdu': return 'font-urdu';
      case 'Telugu': return 'font-telugu';
      case 'Malayalam': return 'font-malayalam';
      case 'Tamil': return 'font-tamil';
      case 'Gujarati': return 'font-gujarati';
      case 'Punjabi': return 'font-punjabi';
      case 'Odia': return 'font-odia';
      case 'Kannada': return 'font-kannada';
      case '日本語': return 'font-jp';
      default: return 'font-sans';
    }
  };

  const isRTL = ['Arabic', 'Urdu'].includes(currentLanguage);

  // Filter Logic for Home View
  const filteredVehicles = vehicles.filter(v => {
    // Hide deleted vehicles from feed
    if (v.isDeleted) return false;
    // Hide sold vehicles from main feed
    if (v.status === 'Sold' || (v.status as string) === 'Sold') return false; 
    // Hide blacklisted vehicles from active main feed
    if (v.isBlacklisted || v.status === 'Blacklisted' || (v.status as string) === 'Blacklisted') return false;
    // Hide restricted vehicles from public feed unless admin
    if (v.isRestricted && currentUser?.role !== 'admin') return false;
    // Shadow banned: hide from all regular users, but keep visible to vehicle owner & admin
    if (v.isShadowBanned && currentUser?.role !== 'admin' && (!currentUser || currentUser.id !== v.ownerId)) return false;

    const matchesSearch = 
      (v.make || '').toLowerCase().includes((searchQuery || '').toLowerCase()) || 
      (v.model || '').toLowerCase().includes((searchQuery || '').toLowerCase()) ||
      (v.vin || '').toLowerCase().includes((searchQuery || '').toLowerCase()) ||
      `${v.year} ${v.make} ${v.model}`.toLowerCase().includes((searchQuery || '').toLowerCase());
    
    if (!matchesSearch) return false;

    const now = Date.now();
    const isDirectSale = v.listingType === 'direct' || v.status === 'Direct Sale' || (v.status as any) === 'Direct Sale';
    const isUpcoming = !isDirectSale && ((v.startTime && v.startTime > now) || v.status === 'Upcoming');
    const isLive = !isDirectSale && !isUpcoming && (v.status === 'Live' || v.status === 'Live Auction' || v.endTime > now);

    if (auctionFilter === 'for_sale') {
      return isDirectSale;
    }
    if (auctionFilter === 'live') {
      return isLive;
    }
    if (auctionFilter === 'upcoming') {
      return isUpcoming;
    }
    
    // 'all' shows live auctions, upcoming auctions, and vehicles for sale
    return isLive || isUpcoming || isDirectSale;
  });

  const handleFollowToggle = async (targetUser: User) => {
    if (!currentUser?.id || !targetUser?.id) return;
    if (currentUser.id === targetUser.id) return;

    setIsFollowLoading(true);
    const isCurrentlyFollowing = (currentUser.followingIds || []).includes(targetUser.id);
    const targetFollowsMe = Boolean(
      (targetUser.followingIds || []).includes(currentUser.id) || 
      (currentUser.followersIds || []).includes(targetUser.id)
    );

    try {
      const currentUserRef = doc(db, 'users', currentUser.id);
      const targetUserRef = doc(db, 'users', targetUser.id);

      if (isCurrentlyFollowing) {
        // Unfollow
        await updateDoc(currentUserRef, {
          following: increment(-1),
          followingIds: arrayRemove(targetUser.id)
        });
        await updateDoc(targetUserRef, {
          followers: increment(-1),
          followersIds: arrayRemove(currentUser.id)
        });

        setCurrentUser(prev => ({
          ...prev,
          following: Math.max(0, (prev.following || 1) - 1),
          followingIds: (prev.followingIds || []).filter(id => id !== targetUser.id)
        }));
        setProfileUser(prev => prev.id === targetUser.id ? {
          ...prev,
          followers: Math.max(0, (prev.followers || 1) - 1),
          followersIds: (prev.followersIds || []).filter(id => id !== currentUser.id)
        } : prev);
      } else {
        // Follow or Follow Back
        await updateDoc(currentUserRef, {
          following: increment(1),
          followingIds: arrayUnion(targetUser.id)
        });
        await updateDoc(targetUserRef, {
          followers: increment(1),
          followersIds: arrayUnion(currentUser.id)
        });

        // Dispatch follow notification via authenticated server endpoint (B12)
        authFetch('/api/notifications/follow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetUserId: targetUser.id, followedBack: targetFollowsMe })
        }).catch((e) => console.warn("Could not dispatch follow notification", e));

        setCurrentUser(prev => ({
          ...prev,
          following: (prev.following || 0) + 1,
          followingIds: [...(prev.followingIds || []), targetUser.id]
        }));
        setProfileUser(prev => prev.id === targetUser.id ? {
          ...prev,
          followers: (prev.followers || 0) + 1,
          followersIds: [...(prev.followersIds || []), currentUser.id]
        } : prev);
      }
    } catch (err: any) {
      console.error("Error toggling follow:", err);
      showToast("Failed to update follow status: " + err.message, 'error');
    } finally {
      setIsFollowLoading(false);
    }
  };

  // Helper to determine vehicle auction bidding info & participants
  const getVehicleBiddingMeta = (v: Vehicle) => {
    // Collect all bids for this vehicle from the real-time bids collection
    const vehicleBids = allBids
      .filter(b => b.vehicleId === v.id)
      .sort((a, b) => (b.amount || 0) - (a.amount || 0));

    const highestBidFromCol = vehicleBids[0];

    // Participating user IDs who placed at least one bid on this vehicle
    const participantIds = new Set<string>([
      ...(v.bidUserIds || []),
      ...vehicleBids.map(b => (b.userId || b.bidderId) as string).filter(Boolean)
    ]);

    // Highest bidder ID & username (the user who holds the highest stake / won the bid)
    const winningUserId = v.winningUserId || highestBidFromCol?.userId || highestBidFromCol?.bidderId || null;
    const winningUsername = v.winningUsername || highestBidFromCol?.username || highestBidFromCol?.bidderUsername || 'Leading Bidder';
    const winningAmount = Math.max(v.currentBid || 0, highestBidFromCol?.amount || 0);

    return {
      participantIds: Array.from(participantIds),
      participantCount: participantIds.size,
      winningUserId,
      winningUsername,
      winningAmount,
      vehicleBids
    };
  };

  // Profile Data Filtering
  const isViewingSelf = Boolean(currentUser && profileUser && profileUser.id === currentUser.id);
  const targetUserId = profileUser?.id || currentUser?.id || '';
  const nowTime = Date.now();
  
  const profileListings = vehicles.filter(v => 
    (targetUserId && v.ownerId && v.ownerId === targetUserId) || 
    (Boolean(v.ownerUsername && (profileUser?.username || currentUser?.username) && v.ownerUsername.toLowerCase() === (profileUser?.username || currentUser?.username)?.toLowerCase()))
  );
  const profileAuctionVehicles = profileListings.filter(v => v.listingType !== 'direct' && v.status !== 'Direct Sale' && (v.status as any) !== 'Direct Sale');
  const profileDirectVehicles = profileListings.filter(v => v.listingType === 'direct' || v.status === 'Direct Sale' || (v.status as any) === 'Direct Sale');
  const profileWatchlist = isViewingSelf ? vehicles.filter(v => v.isWatchlisted) : [];
  
  // Won: vehicle auction bid won by the user (they placed the highest stake / won the auction)
  const profileWon = vehicles.filter(v => {
    const isClosed = v.status === 'Sold' || (v.status as string) === 'Ended' || v.endTime <= nowTime;
    const meta = getVehicleBiddingMeta(v);
    const isWinner = meta.winningUserId === targetUserId || (isViewingSelf && v.userBidStatus === 'won') || v.winningBidderId === targetUserId;
    const hasParticipated = meta.participantIds.includes(targetUserId) || (isViewingSelf && userBidVehicleIds.includes(v.id)) || isWinner;
    return isClosed && isWinner && hasParticipated;
  });

  // Lost: user participated in the live auction by placing a bid, but another user won.
  // Note: Users who ONLY placed an upcoming pre-bid and did NOT participate in the live auction are NOT considered as lost.
  const profileLost = vehicles.filter(v => {
    const isClosed = v.status === 'Sold' || (v.status as string) === 'Ended' || v.endTime <= nowTime;
    if (!isClosed) return false;

    const meta = getVehicleBiddingMeta(v);
    
    // Check active live participation:
    const inLiveParticipants = (v.liveParticipants || []).includes(targetUserId);
    const hasLiveBidRecord = allBids.some(b => b.vehicleId === v.id && (b.userId === targetUserId || b.bidderId === targetUserId));
    const wasLiveFirstBidder = v.firstBidderId === targetUserId;
    const hasActiveLiveParticipation = inLiveParticipants || hasLiveBidRecord || wasLiveFirstBidder || (isViewingSelf && userBidVehicleIds.includes(v.id));

    if (!hasActiveLiveParticipation) {
      return false; // Did not participate in the live auction; not considered lost
    }

    const isWinner = meta.winningUserId === targetUserId || (isViewingSelf && v.userBidStatus === 'won') || v.winningBidderId === targetUserId;
    return !isWinner;
  });

  // Archive filtering (Past concluded auctions: user listings that ended/sold, or past bids where auction concluded)
  const archivedVehicles = vehicles.filter(v => {
    const isClosed = v.status === 'Sold' || (v.status as string) === 'Ended' || v.endTime <= nowTime;
    if (!isClosed) return false;

    const meta = getVehicleBiddingMeta(v);
    const isOwner = Boolean(currentUser?.id && v.ownerId === currentUser.id);
    const hasBid = Boolean(currentUser?.id && (meta.participantIds.includes(currentUser.id) || userBidVehicleIds.includes(v.id)));

    if (archiveFilter === 'listings') return isOwner;
    if (archiveFilter === 'bids') return hasBid;
    return isOwner || hasBid;
  });

  // Determine which tab to show vehicles for
  let activeProfileVehicles: Vehicle[] = [];
  if (profileTab === 'auctions') {
    if (profileListedFilter === 'auction') activeProfileVehicles = profileAuctionVehicles;
    else if (profileListedFilter === 'direct') activeProfileVehicles = profileDirectVehicles;
    else activeProfileVehicles = profileListings;
  }
  else if (profileTab === 'watchlist') activeProfileVehicles = profileWatchlist;
  else if (profileTab === 'won') activeProfileVehicles = profileWon;
  else if (profileTab === 'lost') activeProfileVehicles = profileLost;


  // Force Authentication & Mandatory Email Verification
  if (!isAuthenticated || pendingVerificationUser) {
      return (
          <div className={`min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4 relative ${getFontClass(currentLanguage)}`} dir={isRTL ? 'rtl' : 'ltr'}>
              <Auth
                initialMode="login"
                onLoginSuccess={handleLoginSuccess}
                pendingVerificationUser={pendingVerificationUser}
                t={t}
              />
          </div>
      );
  }

  // Account Hydration Guard after Firebase Authentication
  if (isAuthenticated && !currentUser) {
      return (
          <div className={`min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6 ${getFontClass(currentLanguage)}`} dir={isRTL ? 'rtl' : 'ltr'}>
              <div className="bg-white border border-gray-200 rounded-lg p-6 max-w-sm w-full text-center shadow-xs space-y-4">
                  <div className="w-10 h-10 border-4 border-red-600 border-t-transparent rounded-full animate-spin mx-auto" />
                  <h2 className="text-base font-bold text-gray-900">Setting up your account...</h2>
                  <p className="text-xs text-gray-500">Syncing your AutoBid profile and wallet preferences.</p>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="text-xs font-semibold text-gray-600 hover:text-red-600 underline pt-1 cursor-pointer"
                  >
                    Cancel & Sign Out
                  </button>
              </div>
          </div>
      );
  }

  return (
    <div className={`min-h-screen font-sans text-gray-900 pb-24 md:pb-28 bg-gray-50 selection:bg-red-100 selection:text-red-900 ${getFontClass(currentLanguage)}`} dir={isRTL ? 'rtl' : 'ltr'}>
      <Navbar 
        onNavigate={navigate} 
        activePage={currentView} 
        currentUser={currentUser} 
        currentLanguage={currentLanguage}
        onOpenVerification={() => setShowVerificationModal(true)}
        onLogout={handleLogout}
        unreadChatCount={unreadChatCount}
        hasStockAccess={hasStockAccess}
      />

      {toast && (
        <div className="fixed top-4 right-4 z-[60] max-w-sm w-[calc(100%-2rem)]">
          <div className={`bg-white border rounded-lg p-3.5 shadow-sm flex items-start gap-2.5 ${toast.type === 'error' ? 'border-red-300' : 'border-emerald-300'}`}>
            {toast.type === 'error' ? (
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            )}
            <p className="text-xs font-medium text-gray-800 flex-1 leading-relaxed">{toast.message}</p>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="text-gray-400 hover:text-gray-700 shrink-0"
              aria-label="Dismiss notification"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {isQuotaExhausted && (
        <div className="bg-red-600 text-white text-xs px-4 py-2.5 text-center font-medium flex flex-wrap items-center justify-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            <strong>Firestore Daily Quota Exceeded:</strong> Updates are paused until quota reset or billing upgrade.
          </span>
        </div>
      )}

      <main 
        onTouchStart={handleMainTouchStart}
        onTouchEnd={handleMainTouchEnd}
        className="transition-all duration-200"
      >

        {notifications.length > 0 && (
          <div className="fixed top-16 right-4 z-50 flex flex-col gap-2 max-w-sm w-[calc(100%-2rem)]">
            {notifications.map(notif => (
              <div key={notif.id} className="bg-white border border-emerald-200 shadow-sm rounded-2xl p-3.5 flex justify-between items-start gap-2">
                <div>
                  <h4 className="font-semibold text-gray-900 text-xs mb-0.5">Update</h4>
                  <p className="text-gray-600 text-xs leading-relaxed">{notif.message}</p>
                </div>
                <button 
                  type="button"
                  onClick={() => updateDoc(doc(db, 'notifications', notif.id), { read: true })}
                  className="text-gray-400 hover:text-gray-700 shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
        {currentView === 'home' && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 pb-20">
            {/* Dynamic Marketing Carousel & Banners */}
            <HomeBannerCarousel onNavigate={handleViewChange} />

            {/* Search & Auction Type Toolbar */}
            <div className="bg-white p-2.5 sm:p-3 rounded-2xl mb-6 flex flex-col md:flex-row gap-2.5 items-stretch md:items-center justify-between border border-slate-200/90 shadow-xs">
              <div className="flex-1 w-full md:w-auto relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input 
                  type="text" 
                  placeholder={t.searchPlaceholder}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-9 py-2.5 focus:ring-2 focus:ring-red-600/15 focus:border-red-600 focus:bg-white transition-all outline-none text-sm text-slate-900 placeholder:text-slate-400"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear search"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl w-full md:w-auto overflow-x-auto scrollbar-hide">
                <button 
                  type="button"
                  onClick={() => setAuctionFilter('all')}
                  className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${auctionFilter === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  {t.allAuctions}
                </button>
                <button 
                  type="button"
                  onClick={() => setAuctionFilter('live')}
                  className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-all whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 cursor-pointer ${auctionFilter === 'live' ? 'bg-red-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  <Gavel className="w-3.5 h-3.5" />
                  <span>{t.liveAuctions}</span>
                </button>
                <button 
                  type="button"
                  onClick={() => setAuctionFilter('upcoming')}
                  className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${auctionFilter === 'upcoming' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  {t.upcoming}
                </button>
                <button 
                  type="button"
                  onClick={() => setAuctionFilter('for_sale')}
                  className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-all whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 cursor-pointer ${auctionFilter === 'for_sale' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  <Tag className="w-3.5 h-3.5" />
                  <span>Direct Sale</span>
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between mb-4 gap-3">
               <div className="flex items-baseline gap-2.5 flex-wrap">
                 <h2 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">
                   {auctionFilter === 'all' && t.homeTitle}
                   {auctionFilter === 'live' && t.liveAuctions}
                   {auctionFilter === 'upcoming' && t.upcoming}
                   {auctionFilter === 'for_sale' && 'Vehicles For Sale'}
                 </h2>
                 {!isLoading && (
                   <span className="text-slate-500 font-medium text-xs tabular-nums">
                     · {filteredVehicles.length} Vehicles
                   </span>
                 )}
               </div>
               <div className="hidden sm:block text-xs text-slate-500">
                 Sorted by <span className="font-semibold text-slate-800">Ending Soonest</span>
               </div>
            </div>

            {isLoading ? (
               <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                 {[...Array(10)].map((_, i) => <VehicleCardSkeleton key={i} />)}
               </div>
            ) : filteredVehicles.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {filteredVehicles.map(vehicle => (
                  <VehicleCard 
                    key={vehicle.id} 
                    vehicle={vehicle} 
                    onClick={handleVehicleClick} 
                    currentUser={currentUser}
                    t={t}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-12 px-4 bg-white rounded-2xl border border-slate-200 max-w-xl mx-auto shadow-xs">
                <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600">
                  <Package className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900">No vehicles listed yet</h3>
                <p className="text-slate-500 mt-1.5 text-sm max-w-md mx-auto leading-relaxed">
                  {auctionFilter === 'live' 
                    ? "There are currently no live auctions running. Check back soon or list your vehicle." 
                    : auctionFilter === 'for_sale' 
                    ? "No vehicles listed for direct sale yet. You can list one with direct sale options."
                    : "No vehicles currently listed. Be the first to list your vehicle for live auction or direct sale."}
                </p>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      if (!currentUser) {
                        setCurrentView('auth');
                      } else {
                        setCurrentView('sell');
                      }
                    }}
                    className="px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white font-semibold text-xs rounded-xl transition-colors cursor-pointer"
                  >
                    List Your Vehicle
                  </button>
                  {auctionFilter !== 'all' && (
                    <button
                      type="button"
                      onClick={() => setAuctionFilter('all')}
                      className="px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold text-xs rounded-xl transition-colors cursor-pointer"
                    >
                      View All Listings
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Quick Contact AutoBid Support on the Home Page */}
            <div className="mt-10 mb-4 p-5 sm:p-6 rounded-2xl border border-slate-200/90 bg-white shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div className="w-11 h-11 rounded-xl bg-slate-100 border border-slate-200 text-slate-700 flex items-center justify-center shrink-0">
                  <Headphones className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm sm:text-base font-semibold text-slate-900">Need help with bidding, verification, or legal terms?</h4>
                  <p className="text-xs text-slate-500 mt-0.5">Reach our support desk directly or review platform policies in Settings.</p>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full sm:w-auto shrink-0">
                <button
                  type="button"
                  onClick={() => openInfoPage('contact')}
                  className="px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <Headphones className="w-3.5 h-3.5" />
                  <span>Contact Support</span>
                </button>
                <button
                  type="button"
                  onClick={() => openInfoPage('terms')}
                  className="px-4 py-2.5 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Legal Terms</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {currentView === 'detail' && (
           isLoading ? (
             <VehicleDetailSkeleton />
           ) : (
             selectedVehicle && (
                <VehicleDetail 
                  vehicle={selectedVehicle} 
                  onBack={handleBackToHome}
                  onPlaceBid={handlePlaceBid}
                  onPlaceUpcomingBid={handlePlaceUpcomingBid}
                  onMarkSold={handleMarkSold}
                  onConvertToDirectSale={handleConvertToDirectSale}
                  currentUser={currentUser}
                  t={t}
                  onViewProfile={(u) => {
                    setProfileUser(u);
                    setProfileTab('auctions');
                    setCurrentView('profile');
                  }}
                  onFollowToggle={handleFollowToggle}
                  allUsers={allUsers}
                  isFollowLoading={isFollowLoading}
                  onOpenChat={openChat}
                  onMessageSeller={(sellerUsername) => {
                    const seller = allUsers.find(u => u.username?.toLowerCase() === sellerUsername.toLowerCase());
                    if (seller) {
                      openChat(seller);
                    } else {
                      openChat({
                        id: `user_${sellerUsername.toLowerCase()}`,
                        username: sellerUsername,
                        fullName: sellerUsername,
                        avatarUrl: '',
                        isVerified: false,
                        verificationStatus: 'unverified',
                        followers: 0,
                        following: 0,
                        bio: '',
                        role: 'user',
                        deposits: 0,
                        createdAt: Date.now()
                      });
                    }
                  }}
                  onUpdateVehicle={(patch) => {
                    setSelectedVehicle(prev => prev ? { ...prev, ...patch } : null);
                    setVehicles(prev => prev.map(v => v.id === selectedVehicle.id ? { ...v, ...patch } : v));
                  }}
                />
             )
           )
        )}

        {currentView === 'sell' && (
            <SellCar currentUser={currentUser} onNavigate={navigate} onListVehicle={handleListVehicle} />
        )}

        {currentView === 'stock' && (
          (currentUser?.role === 'admin' || currentUser?.hasStockInsightsAccess) ? (
            <StockManagement 
                vehicles={filteredVehicles}
                allUsers={allUsers}
                currentUser={currentUser}
                onSelectVehicle={handleVehicleClick}
                onViewProfile={(u) => {
                  setProfileUser(u);
                  setProfileTab('auctions');
                  setCurrentView('profile');
                }}
                onOpenChat={openChat}
                onNavigate={navigate}
                onDeleteVehicle={(vid, snum) => {
                  setVehicles(prev => prev.filter(v => v.id !== vid && (!snum || v.stockNumber !== snum)));
                  if (selectedVehicle && (selectedVehicle.id === vid || (snum && selectedVehicle.stockNumber === snum))) {
                    setSelectedVehicle(null);
                  }
                }}
            />
          ) : (
            <div className="max-w-lg mx-auto px-4 py-12">
              <div className="bg-white border border-gray-200 rounded-lg p-6 sm:p-8 text-center shadow-xs">
                <div className="w-12 h-12 rounded-lg bg-gray-100 border border-gray-200 text-gray-700 flex items-center justify-center mx-auto mb-4">
                  <Package className="w-6 h-6" />
                </div>
                <span className="text-xs font-semibold px-2.5 py-1 bg-gray-100 text-gray-700 border border-gray-200 rounded-lg mb-3 inline-block">
                  Platform Utility Required
                </span>
                <h2 className="text-xl font-bold text-gray-900 mb-2">Stock Insights Locked</h2>
                <p className="text-sm text-gray-600 leading-relaxed mb-6">
                  Direct stock number search and warehouse inventory dossiers require View Stock Insights. Activate it for ₹1,999 from your wallet to unlock this view and add Stock to navigation.
                </p>
                
                <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg mb-6 text-left text-xs text-gray-700 space-y-2">
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Lookup vehicles by 8–9 digit unique stock numbers</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Unlock the Stock tab between Sell and Wallet</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Instant ₹1,999 one-time activation from AutoBid wallet</span>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-2 justify-center">
                  <button
                    type="button"
                    onClick={() => {
                      setSettingsSection('PLATFORM_SERVICES');
                      setCurrentView('settings');
                    }}
                    className="px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white font-semibold text-xs rounded-lg transition-colors flex items-center justify-center gap-1.5"
                  >
                    <Zap className="w-4 h-4" />
                    <span>Unlock Stock Insights (₹1,999)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate('home')}
                    className="px-4 py-2.5 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 font-semibold text-xs rounded-lg transition-colors"
                  >
                    Return to Auctions
                  </button>
                </div>
              </div>
            </div>
          )
        )}

        {currentView === 'search' && (
            <SearchUsers 
                onSearchUser={handleUserSearch} 
                t={t} 
                vehicles={vehicles}
                onSelectVehicle={handleVehicleClick}
                currentUser={currentUser}
                onFollowToggle={handleFollowToggle}
                isFollowLoading={isFollowLoading}
                onNavigate={navigate}
                onOpenChat={openChat}
            />
        )}

        {currentView === 'wallet' && (
          <WalletView 
            currentUser={currentUser} 
            onNavigate={navigate}
            onUpdateCurrentUser={(updated) => {
              setCurrentUser(prev => prev ? { ...prev, ...updated } : null);
            }}
          />
        )}

        {currentView === 'settings' && (
            <Settings 
                key={`settings-${settingsSection || 'MENU'}`}
                onNavigate={(view) => {
                    navigate(view);
                }} 
                onLogout={handleLogout} 
                currentUser={currentUser} 
                currentLanguage={currentLanguage}
                setLanguage={setCurrentLanguage}
                t={t}
                initialSection={settingsSection || 'MENU'}
                initialInfoTab={activeInfoSection}
                onJoinAuction={handleJoinAuction}
                onTodaysAuctions={handleTodaysAuctions}
                onAuctionCalendar={handleAuctionCalendar}
                onUpdateCurrentUser={(updated) => {
                  setCurrentUser(prev => prev ? { ...prev, ...updated } : null);
                }}
            />
        )}

        {currentView === 'profile' && (
          isLoading ? (
            <div className="max-w-3xl mx-auto px-4 py-8 animate-pulse">
               <div className="flex gap-6 items-center mb-6 bg-white p-6 rounded-lg border border-gray-200">
                   <div className="w-20 h-20 rounded-full bg-gray-200 shrink-0"></div>
                   <div className="flex-1 space-y-3">
                       <div className="h-5 w-40 bg-gray-200 rounded-lg"></div>
                       <div className="h-4 w-3/4 bg-gray-200 rounded-lg"></div>
                   </div>
               </div>
               <div className="grid grid-cols-3 gap-2">
                   {[1,2,3,4,5,6].map(i => <div key={i} className="aspect-square bg-gray-200 rounded-lg"></div>)}
               </div>
            </div>
          ) : (
              <div className={`mx-auto px-4 pt-4 pb-20 transition-all duration-200 ${profileTab === 'dashboard' ? 'max-w-5xl' : 'max-w-2xl'}`}>
                {(() => {
                  const profileUserFollowsMe = Boolean(
                    (profileUser.followingIds || []).includes(currentUser.id) ||
                    (currentUser.followersIds || []).includes(profileUser.id)
                  );
                  const isFollowingProfileUser = Boolean((currentUser.followingIds || []).includes(profileUser.id));

                  return (
                    <div className="bg-white border border-gray-200 rounded-lg p-4 sm:p-6 mb-4 shadow-xs">
                      {/* Username Header */}
                      <div className="flex items-center justify-between gap-2 mb-4">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-sm font-bold text-gray-900 truncate">@{profileUser.username}</span>
                            {profileUser.isVerified && (
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                            )}
                            {!isViewingSelf && profileUserFollowsMe && (
                              <span className="text-xs bg-gray-100 text-gray-700 font-medium px-2 py-0.5 rounded-lg border border-gray-200 shrink-0">
                                Follows you
                              </span>
                            )}
                          </div>
                          {isViewingSelf && (
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => { setSettingsSection('MENU'); setCurrentView('settings'); }}
                                className="px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-xs font-medium text-gray-700 flex items-center gap-1.5 transition-colors cursor-pointer"
                              >
                                <SettingsIcon className="w-3.5 h-3.5" />
                                <span>Settings</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => openInfoPage('help_center')}
                                className="px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-xs font-medium text-gray-700 flex items-center gap-1.5 transition-colors cursor-pointer"
                              >
                                <HelpCircle className="w-3.5 h-3.5" />
                                <span>Help</span>
                              </button>
                            </div>
                          )}
                      </div>

                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                          {/* Avatar Column */}
                          <div className="flex items-center gap-4">
                              <img 
                                  src={profileUser.avatarUrl} 
                                  alt={profileUser.username}
                                  className="w-16 h-16 rounded-full object-cover border border-gray-200 shrink-0"
                              />
                              <div className="sm:hidden">
                                <h1 className="font-bold text-gray-900 text-sm">{profileUser.fullName}</h1>
                                <p className="text-xs text-gray-500">@{profileUser.username}</p>
                              </div>
                          </div>

                          {/* Stats Row */}
                          <div className="grid grid-cols-5 gap-2 flex-1">
                             <button type="button" className="flex flex-col items-center p-1.5 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => { setProfileTab('auctions'); setProfileListedFilter('all'); }}>
                                 <span className="font-bold text-sm sm:text-base text-gray-900 tabular-nums">{profileListings.length}</span>
                                 <span className="text-[11px] text-gray-500 font-medium">Listed</span>
                             </button>
                             <button type="button" className="flex flex-col items-center p-1.5 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => setProfileTab('won')}>
                                 <span className="font-bold text-sm sm:text-base text-emerald-600 tabular-nums">{profileWon.length}</span>
                                 <span className="text-[11px] text-emerald-700 font-medium">Won</span>
                             </button>
                             <button type="button" className="flex flex-col items-center p-1.5 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => setProfileTab('lost')}>
                                 <span className="font-bold text-sm sm:text-base text-red-600 tabular-nums">{profileLost.length}</span>
                                 <span className="text-[11px] text-red-600 font-medium">Lost</span>
                             </button>
                             <button type="button" className="flex flex-col items-center p-1.5 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => setShowFollowModal('followers')}>
                                 <span className="font-bold text-sm sm:text-base text-gray-900 tabular-nums">{profileUser.followers || 0}</span>
                                 <span className="text-[11px] text-gray-500 font-medium">Followers</span>
                             </button>
                             <button type="button" className="flex flex-col items-center p-1.5 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => setShowFollowModal('following')}>
                                 <span className="font-bold text-sm sm:text-base text-gray-900 tabular-nums">{profileUser.following || 0}</span>
                                 <span className="text-[11px] text-gray-500 font-medium">Following</span>
                             </button>
                          </div>
                      </div>

                      {/* Bio Section */}
                      <div className="mb-4">
                          <h1 className="hidden sm:block font-bold text-gray-900 text-sm mb-0.5">{profileUser.fullName}</h1>
                          {profileUser.bio && (
                            <div className="text-xs text-gray-700 whitespace-pre-line leading-relaxed">
                               {profileUser.bio}
                            </div>
                          )}
                          {profileUser.website && (
                              <a href={profileUser.website} target="_blank" rel="noopener noreferrer" className="mt-1 text-xs text-red-600 font-medium hover:underline inline-flex items-center gap-1">
                                  <Link2 className="w-3.5 h-3.5" />
                                  <span>{profileUser.website.replace(/^https?:\/\//, '')}</span>
                              </a>
                          )}
                      </div>

                      {/* ID Verification Status Banner for Self Profile */}
                      {isViewingSelf && !currentUser.isVerified && (
                        <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center text-gray-700 shrink-0">
                              <ShieldCheck className="w-4 h-4" />
                            </div>
                            <div className="text-left min-w-0">
                              <div className="text-xs font-semibold text-gray-900 truncate">
                                {currentUser.verificationStatus === 'pending' ? 'ID Verification Under Review' : 'ID Verification Required'}
                              </div>
                              <div className="text-xs text-gray-500">
                                {currentUser.verificationStatus === 'pending' 
                                  ? 'Review in progress.' 
                                  : 'Verify your ID to bid and list.'}
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setShowVerificationModal(true)}
                            className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white font-semibold text-xs rounded-lg shrink-0 transition-colors cursor-pointer"
                          >
                            {currentUser.verificationStatus === 'pending' ? 'Status' : 'Verify'}
                          </button>
                        </div>
                      )}

                      {/* Profile Action Buttons */}
                      <div className="grid grid-cols-3 gap-2 mb-4">
                           {isViewingSelf ? (
                              <>
                                  <button type="button" onClick={() => { setSettingsSection('EDIT_PROFILE'); setCurrentView('settings'); }} className="bg-gray-100 hover:bg-gray-200 text-gray-900 font-semibold py-2 px-2 rounded-lg text-xs transition-colors border border-gray-200 flex items-center justify-center gap-1.5 cursor-pointer">
                                      <Pencil className="w-3.5 h-3.5" />
                                      <span>Edit Profile</span>
                                  </button>
                                  <button type="button" onClick={() => setShowArchiveModal(true)} className="bg-gray-100 hover:bg-gray-200 text-gray-900 font-semibold py-2 px-2 rounded-lg text-xs transition-colors border border-gray-200 flex items-center justify-center gap-1.5 cursor-pointer">
                                      <Archive className="w-3.5 h-3.5" />
                                      <span>Archive</span>
                                  </button>
                                  <button 
                                      type="button"
                                      onClick={() => setShowDiscoverDrawer(true)} 
                                      className="bg-gray-100 hover:bg-gray-200 text-gray-900 font-semibold py-2 px-2 rounded-lg text-xs transition-colors border border-gray-200 flex items-center justify-center gap-1.5 cursor-pointer"
                                      title="Discover people to follow"
                                  >
                                      <Users className="w-3.5 h-3.5" />
                                      <span>Find People</span>
                                  </button>
                              </>
                           ) : (
                              <>
                                  <button 
                                      type="button"
                                      onClick={() => handleFollowToggle(profileUser)}
                                      disabled={isFollowLoading}
                                      className={`font-semibold py-2 px-3 rounded-lg text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
                                        isFollowingProfileUser
                                          ? 'bg-gray-100 hover:bg-red-50 text-gray-800 hover:text-red-600 border border-gray-200'
                                          : 'bg-red-600 hover:bg-red-700 text-white'
                                      }`}
                                  >
                                      {isFollowingProfileUser ? (
                                        <>
                                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                                          <span>Following</span>
                                        </>
                                      ) : (
                                        <>
                                          <Plus className="w-3.5 h-3.5" />
                                          <span>{profileUserFollowsMe ? 'Follow Back' : 'Follow'}</span>
                                        </>
                                      )}
                                  </button>
                                  <button 
                                      type="button"
                                      onClick={() => openChat(profileUser)} 
                                      className="bg-gray-100 hover:bg-gray-200 text-gray-900 font-semibold py-2 px-3 rounded-lg text-xs transition-colors border border-gray-200 flex items-center justify-center gap-1.5 cursor-pointer"
                                  >
                                      <MessageCircle className="w-3.5 h-3.5" />
                                      <span>Message</span>
                                  </button>
                                  <button 
                                    type="button"
                                    onClick={() => {
                                      navigator.clipboard.writeText(window.location.origin + '?u=' + profileUser.username);
                                      showToast(`Profile link for @${profileUser.username} copied to clipboard.`, 'success');
                                    }}
                                    title="Share Profile"
                                    className="bg-gray-100 hover:bg-gray-200 text-gray-900 py-2 px-3 rounded-lg border border-gray-200 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                                  >
                                      <Share2 className="w-3.5 h-3.5 text-gray-600" />
                                      <span>Share</span>
                                  </button>
                              </>
                           )}
                      </div>

                      {/* Suggested People to Follow */}
                      {isViewingSelf && allUsers.filter(u => u.id !== currentUser.id).length > 0 && (
                        <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
                              <Users className="w-3.5 h-3.5 text-gray-500" />
                              <span>Suggested People to Follow</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => setShowDiscoverDrawer(true)}
                              className="text-xs text-red-600 font-semibold hover:underline cursor-pointer"
                            >
                              See all ({allUsers.filter(u => u.id !== currentUser.id).length})
                            </button>
                          </div>
                          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                            {allUsers
                              .filter(u => u.id !== currentUser.id)
                              .slice(0, 5)
                              .map(u => {
                                const isFollowing = (currentUser.followingIds || []).includes(u.id);
                                const uFollowsMe = (u.followingIds || []).includes(currentUser.id) || (currentUser.followersIds || []).includes(u.id);

                                return (
                                  <div 
                                    key={u.id}
                                    className="bg-white p-2.5 rounded-lg border border-gray-200 flex flex-col items-center min-w-[120px] max-w-[130px] shrink-0 text-center"
                                  >
                                    <div 
                                      onClick={() => { setProfileUser(u); setProfileTab('auctions'); }}
                                      className="cursor-pointer"
                                    >
                                      <img 
                                        src={u.avatarUrl || `https://i.pravatar.cc/150?u=${u.id}`} 
                                        alt={u.username}
                                        className="w-10 h-10 rounded-full object-cover border border-gray-200 mx-auto mb-1.5"
                                      />
                                      <p className="font-semibold text-gray-900 text-xs truncate w-24">@{u.username}</p>
                                      {uFollowsMe && (
                                        <span className="text-[10px] text-gray-500 block truncate">
                                          Follows you
                                        </span>
                                      )}
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => handleFollowToggle(u)}
                                      disabled={isFollowLoading}
                                      className={`w-full mt-2 text-xs font-semibold py-1 px-2 rounded-lg transition-colors cursor-pointer ${
                                        isFollowing
                                          ? 'bg-gray-100 hover:bg-red-50 text-gray-700 hover:text-red-600 border border-gray-200'
                                          : 'bg-red-600 hover:bg-red-700 text-white'
                                      }`}
                                    >
                                      {isFollowing ? 'Following' : uFollowsMe ? 'Follow Back' : 'Follow'}
                                    </button>
                                  </div>
                                );
                              })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Profile Tabs */}
                <div className="border-t border-b border-gray-200 bg-white rounded-t-lg px-2">
                    <div className="flex justify-center gap-4 sm:gap-8 overflow-x-auto scrollbar-hide">
                         <button 
                            type="button"
                            onClick={() => setProfileTab('auctions')}
                            className={`flex items-center gap-1.5 py-2.5 border-b-2 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${profileTab === 'auctions' ? 'border-red-600 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
                        >
                            <LayoutGrid className="w-3.5 h-3.5" />
                            <span>Listed</span>
                            <span className="px-1.5 py-0.5 rounded-lg text-[10px] bg-gray-100 text-gray-700 tabular-nums">
                                {profileListings.length}
                            </span>
                        </button>
                        {isViewingSelf && (
                            <button 
                                type="button"
                                onClick={() => setProfileTab('watchlist')}
                                className={`flex items-center gap-1.5 py-2.5 border-b-2 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${profileTab === 'watchlist' ? 'border-red-600 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
                            >
                                <Bookmark className="w-3.5 h-3.5" />
                                <span>Saved</span>
                            </button>
                        )}
                        {isViewingSelf && (
                            <button 
                                type="button"
                                onClick={() => setProfileTab('dashboard')}
                                className={`flex items-center gap-1.5 py-2.5 border-b-2 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${profileTab === 'dashboard' ? 'border-red-600 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
                            >
                                <BarChart3 className="w-3.5 h-3.5" />
                                <span>Dashboard</span>
                            </button>
                        )}
                    </div>
                </div>

                {/* Sub-selector when Vehicle Listed tab is active */}
                {profileTab === 'auctions' && (
                  <div className="flex items-center justify-center gap-2 py-2.5 px-2 bg-white border-b border-gray-200 overflow-x-auto scrollbar-hide mb-3">
                    <button
                      type="button"
                      onClick={() => setProfileListedFilter('all')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer ${
                        profileListedFilter === 'all' 
                          ? 'bg-gray-900 text-white' 
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      <span>All:</span>
                      <span className="tabular-nums">{profileListings.length}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setProfileListedFilter('auction')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer ${
                        profileListedFilter === 'auction' 
                          ? 'bg-red-600 text-white' 
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      <Gavel className="w-3 h-3" />
                      <span>Auction:</span>
                      <span className="tabular-nums">{profileAuctionVehicles.length}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setProfileListedFilter('direct')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer ${
                        profileListedFilter === 'direct' 
                          ? 'bg-gray-900 text-white' 
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      <Tag className="w-3 h-3" />
                      <span>Direct Sale:</span>
                      <span className="tabular-nums">{profileDirectVehicles.length}</span>
                    </button>
                  </div>
                )}

                {/* Image Grid */}
                {profileTab === 'dashboard' ? (
                     <DashboardView 
                        userVehicles={profileListings} 
                        currentUser={currentUser}
                        onNavigate={navigate}
                        onSelectVehicle={handleVehicleClick}
                     />
                ) : (
                    <div>
                        {/* Context Banners for Won and Lost Tabs */}
                        {profileTab === 'won' && (
                            <div className="mb-3 mt-2 bg-white border border-emerald-200 rounded-lg p-3 flex items-center justify-between shadow-xs">
                                <div className="flex items-center gap-2.5">
                                    <div className="w-8 h-8 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-lg flex items-center justify-center shrink-0">
                                        <Trophy className="w-4 h-4" />
                                    </div>
                                    <div>
                                        <h4 className="text-xs font-semibold text-gray-900">Auctions Won</h4>
                                        <p className="text-xs text-gray-500">Vehicles won with the highest stake.</p>
                                    </div>
                                </div>
                                <span className="text-xs font-semibold bg-emerald-600 text-white px-2.5 py-1 rounded-lg tabular-nums">
                                    {profileWon.length} Won
                                </span>
                            </div>
                        )}

                        {profileTab === 'lost' && (
                            <div className="mb-3 mt-2 bg-white border border-red-200 rounded-lg p-3 flex items-center justify-between shadow-xs">
                                <div className="flex items-center gap-2.5">
                                    <div className="w-8 h-8 bg-red-50 text-red-600 border border-red-200 rounded-lg flex items-center justify-center shrink-0">
                                        <X className="w-4 h-4" />
                                    </div>
                                    <div>
                                        <h4 className="text-xs font-semibold text-gray-900">Auctions Lost</h4>
                                        <p className="text-xs text-gray-500">Auctions where another user placed a higher stake.</p>
                                    </div>
                                </div>
                                <span className="text-xs font-semibold bg-red-600 text-white px-2.5 py-1 rounded-lg tabular-nums">
                                    {profileLost.length} Lost
                                </span>
                            </div>
                        )}

                        <div className="grid grid-cols-3 gap-2 md:gap-3 mt-2">
                          {activeProfileVehicles.map(vehicle => {
                             const meta = getVehicleBiddingMeta(vehicle);
                             const isClosed = vehicle.status === 'Sold' || (vehicle.status as string) === 'Ended' || vehicle.endTime <= nowTime;

                             return (
                              <div 
                                 key={vehicle.id} 
                                 onClick={() => handleVehicleClick(vehicle)}
                                 className="relative aspect-square group cursor-pointer overflow-hidden bg-gray-200 rounded-lg border border-gray-200"
                             >
                                 <img 
                                     src={vehicle.images?.[vehicle.coverImageIndex || 0] || `https://picsum.photos/id/${vehicle.imageSeed}/1200/1200`} 
                                     alt={vehicle.model}
                                     className="w-full h-full object-cover"
                                 />
                                 <div className="absolute inset-0 bg-black/65 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1.5 text-white font-semibold text-xs p-2 text-center">
                                     <div className="flex items-center gap-3 tabular-nums">
                                          <div className="flex items-center gap-1">
                                             <Eye className="w-3.5 h-3.5" />
                                             <span>{vehicle.views || 0}</span>
                                          </div>
                                          <div className="flex items-center gap-1">
                                             <Heart className="w-3.5 h-3.5" />
                                             <span>{vehicle.interestedCount || vehicle.watchCount || 0}</span>
                                          </div>
                                     </div>
                                     <div className="flex flex-col items-center mt-1">
                                          <span className="uppercase text-gray-300 text-[10px]">
                                             {profileTab === 'won' ? (isClosed ? 'Winning Stake' : 'Highest Stake') : profileTab === 'lost' ? 'Winning Stake' : 'Current Bid'}
                                          </span>
                                          <span className="font-bold text-sm text-white tabular-nums">₹{(vehicle.currentBid || 0).toLocaleString()}</span>
                                          {profileTab === 'lost' && (
                                             <span className="text-[10px] text-red-200 mt-0.5 line-clamp-1">
                                               Won by @{meta.winningUsername || vehicle.winningUsername}
                                             </span>
                                          )}
                                          {(profileTab === 'lost' || profileTab === 'won') && meta.participantCount > 0 && (
                                             <span className="text-[10px] text-gray-200 mt-0.5 flex items-center gap-1 tabular-nums">
                                               <Users className="w-3 h-3" />
                                               <span>{meta.participantCount} bidders</span>
                                             </span>
                                          )}
                                     </div>
                                 </div>

                                 {/* Status Badges */}
                                 {profileTab === 'won' && (
                                     <div className="absolute top-2 left-2 bg-emerald-600 text-white text-[10px] font-semibold px-2 py-0.5 rounded-lg flex items-center gap-1">
                                         <Trophy className="w-3 h-3" />
                                         <span>{isClosed ? 'Won' : 'Leading'}</span>
                                     </div>
                                 )}
                                 {profileTab === 'lost' && (
                                     <div className="absolute top-2 left-2 bg-red-600 text-white text-[10px] font-semibold px-2 py-0.5 rounded-lg flex items-center gap-1">
                                         <X className="w-3 h-3" />
                                         <span>Outbid</span>
                                     </div>
                                 )}
                                 {profileTab !== 'won' && profileTab !== 'lost' && vehicle.status === 'Live Auction' && (
                                     <div className="absolute top-2 right-2 w-2.5 h-2.5 bg-red-600 rounded-full border border-white"></div>
                                 )}
                                 {profileTab !== 'won' && profileTab !== 'lost' && vehicle.status === 'Pending Review' && (
                                     <div className="absolute top-2 left-2 bg-gray-900 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-lg">Pending</div>
                                 )}
                              </div>
                             );
                          })}
                          {activeProfileVehicles.length === 0 && (
                              <div className="col-span-3 py-12 text-center text-gray-500 text-sm border border-gray-200 rounded-lg bg-white p-6">
                                  {profileTab === 'won' ? (
                                      <div className="flex flex-col items-center">
                                          <Trophy className="w-8 h-8 text-gray-400 mb-2" />
                                          <h5 className="font-semibold text-gray-900 text-sm mb-1">No Won Auctions Yet</h5>
                                          <p className="text-xs text-gray-500 max-w-sm mx-auto">When you hold the highest stake in a concluded auction, the vehicle will appear here.</p>
                                      </div>
                                  ) : profileTab === 'lost' ? (
                                      <div className="flex flex-col items-center">
                                          <Clock className="w-8 h-8 text-gray-400 mb-2" />
                                          <h5 className="font-semibold text-gray-900 text-sm mb-1">No Lost Auctions</h5>
                                          <p className="text-xs text-gray-500 max-w-sm mx-auto">Auctions where another participant placed a higher stake will appear here.</p>
                                      </div>
                                  ) : profileTab === 'watchlist' ? (
                                      "No saved vehicles yet."
                                  ) : isViewingSelf ? (
                                      "No vehicles found in this section."
                                  ) : (
                                      "This user has no active auctions."
                                  )}
                              </div>
                          )}
                        </div>
                    </div>
                )}
            </div>
          )
        )}

      {/* Auction & Activity Archive Modal */}
      {showArchiveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white border border-gray-200 rounded-lg max-w-lg w-full max-h-[85vh] flex flex-col shadow-sm overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gray-100 text-gray-700 border border-gray-200 flex items-center justify-center shrink-0">
                  <Archive className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 text-sm">Auction & Activity Archive</h3>
                  <p className="text-xs text-gray-500">Your historical record of completed auctions and bids</p>
                </div>
              </div>
              <button 
                type="button"
                onClick={() => setShowArchiveModal(false)}
                className="w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Filter Chips */}
            <div className="p-3 bg-gray-50 border-b border-gray-200 flex gap-2 overflow-x-auto scrollbar-hide">
              <button
                type="button"
                onClick={() => setArchiveFilter('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                  archiveFilter === 'all' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
                }`}
              >
                All Archived (<span className="tabular-nums">{archivedVehicles.length}</span>)
              </button>
              <button
                type="button"
                onClick={() => setArchiveFilter('listings')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                  archiveFilter === 'listings' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
                }`}
              >
                Closed Listings
              </button>
              <button
                type="button"
                onClick={() => setArchiveFilter('bids')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                  archiveFilter === 'bids' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
                }`}
              >
                Concluded Bids
              </button>
            </div>

            {/* Content List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
              {archivedVehicles.length === 0 ? (
                <div className="py-12 text-center text-gray-500">
                  <div className="w-12 h-12 mx-auto mb-3 bg-gray-100 text-gray-500 border border-gray-200 rounded-lg flex items-center justify-center">
                    <Archive className="w-5 h-5" />
                  </div>
                  <h4 className="font-semibold text-gray-900 text-sm mb-1">Archive is Empty</h4>
                  <p className="text-xs text-gray-500 max-w-xs mx-auto">
                    Concluded vehicle auctions you listed or bid on will appear here.
                  </p>
                </div>
              ) : (
                archivedVehicles.map(vehicle => {
                  const meta = getVehicleBiddingMeta(vehicle);
                  const isUserWinner = Boolean(currentUser?.id && (meta.winningUserId === currentUser.id || vehicle.userBidStatus === 'won'));
                  const isUserOwner = Boolean(currentUser && vehicle.ownerId === currentUser.id);

                  return (
                    <div 
                      key={vehicle.id}
                      onClick={() => {
                        handleVehicleClick(vehicle);
                        setShowArchiveModal(false);
                      }}
                      className="p-3 bg-white border border-gray-200 hover:border-gray-300 rounded-lg transition-colors cursor-pointer flex items-center gap-3"
                    >
                      <img 
                        src={vehicle.images?.[vehicle.coverImageIndex || 0] || `https://picsum.photos/id/${vehicle.imageSeed}/600/600`} 
                        alt={vehicle.model}
                        className="w-16 h-16 rounded-lg object-cover bg-gray-100 shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-gray-900 text-sm truncate mb-0.5">
                          {vehicle.year} {vehicle.make} {vehicle.model}
                        </h4>
                        <div className="flex items-center gap-2 text-xs text-gray-500 mb-1.5 tabular-nums">
                          <span className="font-semibold text-gray-800">
                            Final: ₹{(vehicle.currentBid || 0).toLocaleString()}
                          </span>
                          <span>•</span>
                          <span className="inline-flex items-center gap-1">
                            <Users className="w-3 h-3" />
                            <span>{meta.participantCount} bidders</span>
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {isUserOwner && (
                            <span className="text-[11px] font-medium px-2 py-0.5 rounded-lg bg-gray-100 text-gray-700 border border-gray-200">
                              Your Listing ({vehicle.status || 'Closed'})
                            </span>
                          )}
                          {!isUserOwner && isUserWinner && (
                            <span className="text-[11px] font-medium px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 inline-flex items-center gap-1">
                              <Trophy className="w-3 h-3" />
                              <span>Won Auction</span>
                            </span>
                          )}
                          {!isUserOwner && !isUserWinner && (
                            <span className="text-[11px] font-medium px-2 py-0.5 rounded-lg bg-red-50 text-red-700 border border-red-200 inline-flex items-center gap-1">
                              <X className="w-3 h-3" />
                              <span>Outbid by @{meta.winningUsername}</span>
                            </span>
                          )}
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-gray-400 shrink-0" />
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="p-3.5 border-t border-gray-200 bg-gray-50 flex justify-end">
              <button
                type="button"
                onClick={() => setShowArchiveModal(false)}
                className="px-4 py-2 bg-gray-900 hover:bg-black text-white font-semibold text-xs rounded-lg transition-colors cursor-pointer"
              >
                Close Archive
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Social Followers / Following Modal */}
      {showFollowModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white border border-gray-200 rounded-lg max-w-sm w-full max-h-[80vh] flex flex-col shadow-sm overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900 text-sm capitalize">
                  {showFollowModal === 'followers' ? 'Followers' : 'Following'}
                </h3>
                <p className="text-xs text-gray-500">@{profileUser.username}</p>
              </div>
              <button 
                type="button"
                onClick={() => setShowFollowModal(null)}
                className="w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* User List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {(() => {
                const userList = allUsers.filter(u => {
                  if (showFollowModal === 'followers') {
                    return (profileUser.followersIds || []).includes(u.id) || (u.followingIds || []).includes(profileUser.id);
                  } else {
                    return (profileUser.followingIds || []).includes(u.id);
                  }
                });

                if (userList.length === 0) {
                  return (
                    <div className="py-10 text-center text-gray-500">
                      <Users className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                      <p className="font-semibold text-gray-900 text-sm">
                        {showFollowModal === 'followers' ? 'No followers yet' : 'Not following anyone yet'}
                      </p>
                      <p className="text-xs text-gray-500 mt-1 mb-4">
                        {showFollowModal === 'followers' 
                          ? `@${profileUser.username} hasn't been followed by any users yet.` 
                          : `@${profileUser.username} is not following any accounts yet.`}
                      </p>
                      {currentUser && profileUser.id === currentUser.id && (
                        <button
                          type="button"
                          onClick={() => {
                            setShowFollowModal(null);
                            setShowDiscoverDrawer(true);
                          }}
                          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold text-xs rounded-lg transition-colors cursor-pointer"
                        >
                          Find People to Follow
                        </button>
                      )}
                    </div>
                  );
                }

                return userList.map(u => {
                  const isFollowingThisUser = Boolean(currentUser && (currentUser.followingIds || []).includes(u.id));
                  const uFollowsMe = Boolean(
                    currentUser && (
                      (u.followingIds || []).includes(currentUser.id) || 
                      (currentUser.followersIds || []).includes(u.id)
                    )
                  );
                  const isMe = Boolean(currentUser && u.id === currentUser.id);

                  return (
                    <div key={u.id} className="flex items-center justify-between gap-3">
                      <div 
                        onClick={() => {
                          setProfileUser(u);
                          setProfileTab('auctions');
                          setShowFollowModal(null);
                        }}
                        className="flex items-center gap-3 cursor-pointer flex-1 min-w-0"
                      >
                        <img 
                          src={u.avatarUrl || `https://i.pravatar.cc/150?u=${u.id}`} 
                          alt={u.username} 
                          className="w-10 h-10 rounded-full object-cover border border-gray-200 shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="font-semibold text-gray-900 text-xs truncate">@{u.username}</p>
                            {u.isVerified && (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            )}
                            {uFollowsMe && (
                              <span className="text-[10px] bg-gray-100 text-gray-700 font-medium px-1.5 py-0.5 rounded-lg border border-gray-200">
                                Follows you
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 truncate">{u.fullName}</p>
                        </div>
                      </div>

                      {!isMe && (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setShowFollowModal(null);
                              openChat(u);
                            }}
                            className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-200 transition-colors flex items-center justify-center cursor-pointer"
                            title={`Chat with @${u.username}`}
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleFollowToggle(u)}
                            disabled={isFollowLoading}
                            className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 cursor-pointer ${
                              isFollowingThisUser
                                ? 'bg-gray-100 hover:bg-red-50 text-gray-700 hover:text-red-600 border border-gray-200'
                                : 'bg-red-600 hover:bg-red-700 text-white'
                            }`}
                          >
                            {isFollowingThisUser ? (
                              'Following'
                            ) : (
                              <>
                                <Plus className="w-3 h-3" />
                                <span>{uFollowsMe ? 'Follow Back' : 'Follow'}</span>
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Discover & Follow Community Users Modal */}
      {showDiscoverDrawer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white border border-gray-200 rounded-lg max-w-md w-full max-h-[85vh] flex flex-col shadow-sm overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-gray-700" />
                  <span>Discover People to Follow</span>
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">Find sellers, collectors, and community members</p>
              </div>
              <button 
                type="button"
                onClick={() => {
                  setShowDiscoverDrawer(false);
                  setDiscoverSearch('');
                }}
                className="w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search Input */}
            <div className="p-3 border-b border-gray-200 bg-gray-50">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search members by username or name..."
                  value={discoverSearch}
                  onChange={(e) => setDiscoverSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-red-600 focus:border-red-600"
                />
                <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-2.5 pointer-events-none" />
              </div>
            </div>

            {/* Candidate User List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
              {(() => {
                const query = discoverSearch.toLowerCase().trim();
                const candidates = allUsers.filter(u => {
                  if (currentUser && u.id === currentUser.id) return false;
                  if (!query) return true;
                  return (u.username || '').toLowerCase().includes(query) || (u.fullName || '').toLowerCase().includes(query);
                });

                if (candidates.length === 0) {
                  return (
                    <div className="py-10 text-center text-gray-500">
                      <Search className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                      <p className="font-semibold text-gray-900 text-sm">No members found</p>
                      <p className="text-xs text-gray-500 mt-1">Try another search keyword.</p>
                    </div>
                  );
                }

                return candidates.map(u => {
                  const isFollowing = Boolean(currentUser && (currentUser.followingIds || []).includes(u.id));
                  const uFollowsMe = Boolean(
                    currentUser && (
                      (u.followingIds || []).includes(currentUser.id) || 
                      (currentUser.followersIds || []).includes(u.id)
                    )
                  );

                  return (
                    <div key={u.id} className="flex items-center justify-between gap-3 p-2 rounded-lg hover:bg-gray-50 transition-colors border border-transparent hover:border-gray-200">
                      <div 
                        onClick={() => {
                          setProfileUser(u);
                          setProfileTab('auctions');
                          setShowDiscoverDrawer(false);
                          setDiscoverSearch('');
                        }}
                        className="flex items-center gap-3 cursor-pointer flex-1 min-w-0"
                      >
                        <img 
                          src={u.avatarUrl || `https://i.pravatar.cc/150?u=${u.id}`} 
                          alt={u.username}
                          className="w-10 h-10 rounded-full object-cover border border-gray-200 shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="font-semibold text-gray-900 text-xs truncate">@{u.username}</p>
                            {u.isVerified && (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            )}
                            {uFollowsMe && (
                              <span className="text-[10px] bg-gray-100 text-gray-700 font-medium px-1.5 py-0.5 rounded-lg border border-gray-200">
                                Follows you
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 truncate">{u.fullName}</p>
                          <span className="text-[11px] text-gray-400 tabular-nums">{u.followers || 0} followers</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleFollowToggle(u)}
                        disabled={isFollowLoading}
                        className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 shrink-0 cursor-pointer ${
                          isFollowing
                            ? 'bg-gray-100 hover:bg-red-50 text-gray-700 hover:text-red-600 border border-gray-200'
                            : 'bg-red-600 hover:bg-red-700 text-white'
                        }`}
                      >
                        {isFollowing ? (
                          'Following'
                        ) : (
                          <>
                            <Plus className="w-3 h-3" />
                            <span>{uFollowsMe ? 'Follow Back' : 'Follow'}</span>
                          </>
                        )}
                      </button>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      )}

        {currentView === 'chat' && currentUser && (
            <DirectChatView 
                currentUser={currentUser} 
                targetUser={chatTargetUser}
                allUsers={allUsers}
                onNavigate={navigate}
                onViewProfile={(u) => {
                  setProfileUser(u);
                  setProfileTab('auctions');
                  setCurrentView('profile');
                }}
            />
        )}

        {currentView === 'chat' && !currentUser && (
            <div className="py-16 text-center max-w-md mx-auto px-4">
              <div className="bg-white border border-gray-200 rounded-lg p-8 shadow-xs">
                <div className="w-12 h-12 bg-gray-100 border border-gray-200 text-gray-700 rounded-lg flex items-center justify-center mx-auto mb-4">
                  <MessageCircle className="w-6 h-6" />
                </div>
                <h2 className="text-lg font-bold text-gray-900 mb-2">Sign in to start messaging</h2>
                <p className="text-xs text-gray-500 mb-6">Chat with car sellers and bidders, and send voice notes securely.</p>
                <button type="button" onClick={() => setCurrentView('auth')} className="px-5 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold text-xs transition-colors cursor-pointer">
                  Sign In / Register
                </button>
              </div>
            </div>
        )}

        {currentView === 'support' && (
            <HelpSupport currentUser={currentUser} onNavigate={navigate} />
        )}

        {currentView === 'admin' && (
            <AdminPanel currentUser={currentUser} onNavigate={navigate} onSelectVehicle={handleVehicleClick} />
        )}
      </main>

      {currentView !== 'settings' && currentView !== 'chat' && (
        <footer className="bg-white border-t border-gray-200 mt-12">
          <div className="max-w-7xl mx-auto px-6 py-10 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-8">
            <div>
              <span className="text-xl font-bold text-gray-900 tracking-tight">Auto<span className="text-red-600">Bid</span></span>
              <p className="mt-3 text-xs text-slate-500 leading-relaxed">{t.footerAboutText}</p>
              <div className="mt-4 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => openInfoPage('contact')}
                  className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Headphones className="w-3.5 h-3.5" />
                  <span>Contact AutoBid Support</span>
                </button>
              </div>
            </div>
            <div>
              <h4 className="font-semibold text-slate-900 mb-4 uppercase text-xs tracking-wider">{t.auctions}</h4>
              <ul className="space-y-2.5 text-xs text-slate-600 font-medium">
                <li>
                  <button
                    type="button"
                    onClick={handleTodaysAuctions}
                    className="hover:text-red-600 transition-colors text-left flex items-center gap-2 cursor-pointer"
                  >
                    <Gavel className="w-3.5 h-3.5 text-red-600" />
                    <span>{t.todaysAuctions}</span>
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={handleJoinAuction}
                    className="hover:text-red-700 transition-colors text-left flex items-center gap-2 font-semibold text-red-600 cursor-pointer"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    <span>{t.joinAuction}</span>
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={handleAuctionCalendar}
                    className="hover:text-red-600 transition-colors text-left flex items-center gap-2 cursor-pointer"
                  >
                    <Calendar className="w-3.5 h-3.5 text-gray-500" />
                    <span>{t.auctionCalendar}</span>
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => {
                      setAuctionFilter('for_sale');
                      if (currentView !== 'home') setCurrentView('home');
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    className="hover:text-red-600 transition-colors text-left flex items-center gap-2 cursor-pointer"
                  >
                    <Tag className="w-3.5 h-3.5 text-gray-500" />
                    <span>Direct Buy Vehicles</span>
                  </button>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 mb-4 uppercase text-xs tracking-wider">Help & Support</h4>
              <ul className="space-y-2.5 text-xs text-gray-600 font-medium">
                <li>
                  <button
                    type="button"
                    onClick={() => openInfoPage('help_center')}
                    className="hover:text-red-600 transition-colors text-left flex items-center gap-2 cursor-pointer"
                  >
                    <Building2 className="w-3.5 h-3.5 text-gray-500" />
                    <span>{t.helpCenter}</span>
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => openInfoPage('faq')}
                    className="hover:text-red-600 transition-colors text-left flex items-center gap-2 cursor-pointer"
                  >
                    <HelpCircle className="w-3.5 h-3.5 text-gray-500" />
                    <span>FAQ's</span>
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => openInfoPage('help')}
                    className="hover:text-red-600 transition-colors text-left flex items-center gap-2 cursor-pointer"
                  >
                    <Lightbulb className="w-3.5 h-3.5 text-gray-500" />
                    <span>Help & Guides</span>
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => openInfoPage('contact')}
                    className="hover:text-red-600 transition-colors text-left flex items-center gap-2 cursor-pointer"
                  >
                    <Mail className="w-3.5 h-3.5 text-gray-500" />
                    <span>{t.contactUs}</span>
                  </button>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 mb-4 uppercase text-xs tracking-wider">Legal & Trust</h4>
              <ul className="space-y-2.5 text-xs text-gray-600 font-medium">
                <li>
                  <button
                    type="button"
                    onClick={() => openInfoPage('terms')}
                    className="hover:text-red-600 transition-colors text-left flex items-center gap-2 cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5 text-gray-500" />
                    <span>Legal Agreement & Terms</span>
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => openInfoPage('privacy')}
                    className="hover:text-red-600 transition-colors text-left flex items-center gap-2 cursor-pointer"
                  >
                    <Lock className="w-3.5 h-3.5 text-gray-500" />
                    <span>Privacy Policy</span>
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => openInfoPage('cookies')}
                    className="hover:text-red-600 transition-colors text-left flex items-center gap-2 cursor-pointer"
                  >
                    <Cookie className="w-3.5 h-3.5 text-gray-500" />
                    <span>Cookie Policy & Auto-Recovery</span>
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => setShowVerificationModal(true)}
                    className="hover:text-red-600 transition-colors text-left flex items-center gap-2 cursor-pointer"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-gray-500" />
                    <span>Identity Verification</span>
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => navigate('wallet')}
                    className="hover:text-red-600 transition-colors text-left flex items-center gap-2 cursor-pointer"
                  >
                    <Coins className="w-3.5 h-3.5 text-gray-500" />
                    <span>Escrow & Deposits</span>
                  </button>
                </li>
              </ul>
            </div>
          </div>
          <div className="max-w-7xl mx-auto px-6 py-5 border-t border-gray-200 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-gray-500">
            <div>
              {t.footerRights}
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4 text-gray-500">
              <button type="button" onClick={() => openInfoPage('terms')} className="hover:text-red-600 transition-colors cursor-pointer">Terms & Conditions</button>
              <span>•</span>
              <button type="button" onClick={() => openInfoPage('privacy')} className="hover:text-red-600 transition-colors cursor-pointer">Privacy Policy</button>
              <span>•</span>
              <button type="button" onClick={() => openInfoPage('cookies')} className="hover:text-red-600 transition-colors cursor-pointer">Cookie Policy</button>
              <span>•</span>
              <button type="button" onClick={() => openInfoPage('help_center')} className="hover:text-red-600 transition-colors cursor-pointer">Help Centre</button>
              <span>•</span>
              <button type="button" onClick={() => openInfoPage('faq')} className="hover:text-red-600 transition-colors cursor-pointer">FAQ's</button>
              <span>•</span>
              <button type="button" onClick={() => openInfoPage('help')} className="hover:text-red-600 transition-colors cursor-pointer">Help</button>
              <span>•</span>
              <button type="button" onClick={() => openInfoPage('contact')} className="hover:text-red-600 transition-colors cursor-pointer">Contact Us</button>
            </div>
          </div>
        </footer>
      )}

      {currentView === 'deleted' && (
         <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-gray-50 z-50 fixed inset-0">
             <div className="bg-white border border-gray-200 p-6 sm:p-8 rounded-lg shadow-xs max-w-md w-full text-center">
                 <div className="w-12 h-12 bg-red-50 text-red-600 border border-red-200 rounded-lg flex items-center justify-center mx-auto mb-4">
                    <AlertTriangle className="w-6 h-6" />
                 </div>
                 <h2 className="text-xl font-bold text-gray-900 mb-2">Account Suspended</h2>
                 <p className="text-sm text-gray-600 mb-6">
                    Your account has been {currentUser.suspensionStatus === 'permanent' ? 'permanently' : 'temporarily'} suspended by an administrator.
                 </p>
                 <div className="text-left mb-4">
                   <label className="block text-xs font-semibold text-gray-700 mb-1.5">Appeal Reason</label>
                   <textarea
                     rows={3}
                     value={appealReason}
                     onChange={(e) => setAppealReason(e.target.value)}
                     placeholder="Explain why your account should be reviewed or recovered..."
                     className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs text-gray-800 focus:outline-none focus:ring-1 focus:ring-red-600 focus:border-red-600"
                   />
                 </div>
                 <button 
                    type="button"
                    disabled={isSubmittingAppeal}
                    onClick={async () => {
                       const reason = appealReason.trim();
                       if (!reason) {
                         showToast("Please enter a reason for your appeal.", 'error');
                         return;
                       }
                       setIsSubmittingAppeal(true);
                       try {
                          await setDoc(doc(collection(db, 'appeals')), {
                             userId: currentUser.id,
                             reason,
                             status: 'pending',
                             createdAt: Date.now()
                          });
                          setAppealReason('');
                          showToast("Your appeal has been submitted. An admin will review it shortly.", 'success');
                       } catch (err: any) {
                          showToast("Error submitting appeal: " + err.message, 'error');
                       } finally {
                          setIsSubmittingAppeal(false);
                       }
                    }}
                    className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-semibold py-2.5 text-xs rounded-lg mb-2.5 transition-colors cursor-pointer"
                 >
                    {isSubmittingAppeal ? 'Submitting Appeal...' : 'Submit Appeal'}
                 </button>
                 <button 
                    type="button"
                    onClick={handleLogout}
                    className="w-full text-gray-700 hover:bg-gray-100 border border-gray-200 font-semibold py-2.5 text-xs rounded-lg transition-colors cursor-pointer"
                 >
                    Sign Out
                 </button>
             </div>
         </div>
      )}
      
      {/* Global Identity Verification Modal */}
      {showVerificationModal && currentUser && (
        <IdentityVerificationModal
          currentUser={currentUser}
          isOpen={true}
          onClose={() => setShowVerificationModal(false)}
          onVerificationSubmitted={() => {
            setShowVerificationModal(false);
            showToast("Verification request submitted! Once approved, your bidding and selling privileges will be active.", 'success');
          }}
        />
      )}

      {currentView !== 'deleted' && !showVerificationModal && (
        <BottomNav 
          onNavigate={navigate} 
          hasStockAccess={hasStockAccess}
          unreadChatCount={unreadChatCount}
          walletBalance={currentUser?.deposits}
          userAvatarUrl={currentUser?.avatarUrl}
          activePage={
            currentView === 'wallet'
              ? 'wallet'
              : (currentView === 'settings' 
                ? (settingsSection === 'WALLET' ? 'wallet' : 'settings') 
                : currentView)
          } 
        />
      )}

      {/* Floating Cookie Consent & Auto-Recovery Banner */}
      <CookieConsentBanner onOpenPolicy={() => openInfoPage('cookies')} />

      {/* Bottom-right round AI Help button */}
      {currentView !== 'deleted' && (
        <button
          type="button"
          onClick={() => setIsAiSupportOpen(true)}
          className="fixed bottom-24 right-4 md:bottom-5 md:right-6 z-40 w-12 h-12 rounded-full bg-red-600 hover:bg-red-700 text-white shadow-sm flex items-center justify-center transition-colors cursor-pointer"
          title="Open AutoBid AI Help"
          aria-label="Open AutoBid AI Help"
        >
          <MessageCircle className="w-5 h-5" />
        </button>
      )}

      {/* Autonomous Groq AI Support & Escalation Drawer */}
      <AiSupportDrawer
        isOpen={isAiSupportOpen}
        onClose={() => setIsAiSupportOpen(false)}
        currentUser={currentUser}
        onNavigate={navigate}
        onSelectVehicle={(vehicle) => {
          setSelectedVehicle(vehicle);
          navigate('detail');
        }}
        onListVehicle={handleListVehicle}
      />
    </div>
  );
};