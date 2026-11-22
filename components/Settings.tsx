import React, { useState, useEffect } from 'react';
import { User, WalletTransaction } from '../types';
import { db, doc, getDoc, setDoc, deleteDoc, updateDoc, collection, query, where, onSnapshot, addDoc } from '../firebase';
import { IdentityVerificationModal } from './IdentityVerificationModal';
import { WalletView } from './WalletView';
import { sanitizeInstagramUsername, validateInstagramUsername } from '../utils/username';
import { HomeInfoPages, InfoSectionType } from './HomeInfoPages';
import { authFetch } from '../utils/apiClient';

interface SettingsProps {
  onNavigate: (page: string) => void;
  onLogout: () => void;
  currentUser?: User | null;
  currentLanguage: string;
  setLanguage: (lang: string) => void;
  t: any;
  initialSection?: SettingsSection;
  initialInfoTab?: InfoSectionType;
  onJoinAuction?: () => void;
  onTodaysAuctions?: () => void;
  onAuctionCalendar?: () => void;
  onUpdateCurrentUser?: (updated: Partial<User>) => void;
}

type SettingsSection = 
  | 'MENU' 
  | 'EDIT_PROFILE'
  | 'WALLET'
  | 'BLOCKED_USERS' 
  | 'LANGUAGES' 
  | 'VERIFY' 
  | 'AI_ASSISTANT' 
  | 'RAISE_TICKET' 
  | 'VIEW_TICKETS' 
  | 'CONTACT_SUPPORT' 
  | 'CHANGE_PASSWORD' 
  | 'DEVICES'
  | 'PLATFORM_SERVICES'
  | 'PROMOTIONS'
  | 'DONATE'
  | 'LEGAL_AGREEMENT'
  | 'TERMS_CONDITIONS'
  | 'PRIVACY_POLICY'
  | 'COOKIE_POLICY'
  | 'HELP_CENTRE'
  | 'FAQS'
  | 'HELP_GUIDES'
  | 'CONTACT_US'
  | 'INFO_HUB';

// --- Helper Components ---

const SectionHeader: React.FC<{ title: string; icon: React.ReactNode }> = ({ title, icon }) => (
  <div className="flex items-center gap-2 px-4 py-3 text-sm font-bold text-gray-500 uppercase tracking-wider mt-4">
    {icon}
    {title}
  </div>
);

const MenuItem: React.FC<{ 
  label: string; 
  onClick?: () => void; 
  isDestructive?: boolean;
  rightElement?: React.ReactNode;
}> = ({ label, onClick, isDestructive, rightElement }) => (
  <div 
    onClick={onClick}
    className={`flex items-center justify-between px-6 py-4 bg-white/60 hover:bg-white/80 border-b border-gray-100 last:border-0 cursor-pointer transition-colors ${isDestructive ? 'text-red-600 font-semibold' : 'text-gray-800'}`}
  >
    <span className="font-medium text-sm sm:text-base">{label}</span>
    {rightElement || (
      <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
      </svg>
    )}
  </div>
);

const SubViewHeader: React.FC<{ title: string; onBack: () => void }> = ({ title, onBack }) => (
    <div className="flex items-center mb-6">
       <button 
            onClick={onBack}
            className="p-2 -ml-2 rounded-full hover:bg-gray-200 transition-colors mr-2 text-gray-600"
        >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
        </button>
        <h2 className="text-xl font-bold text-gray-900">{title}</h2>
    </div>
);

// --- Isolated Settings Menu Component ---

interface SettingsMenuProps {
  t: any;
  currentUser?: User | null;
  currentLanguage: string;
  isPrivate: boolean;
  setIsPrivate: (val: boolean) => void;
  setActiveSection: (section: SettingsSection) => void;
  onNavigate: (page: string) => void;
  onLogout: () => void;
  setShowDownloadConfirm: (val: boolean) => void;
}

const SettingsMenu: React.FC<SettingsMenuProps> = ({ 
  t, currentUser, currentLanguage, isPrivate, setIsPrivate, setActiveSection, onNavigate, onLogout, setShowDownloadConfirm 
}) => {
  return (
    <>
      <div className="flex items-center mb-6">
          <button 
              onClick={() => onNavigate('profile')}
              className="p-2 rounded-full hover:bg-gray-200 transition-colors mr-2 text-gray-600"
          >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
          </button>
          <h1 className="text-2xl font-bold text-gray-900">{t.settingsTitle}</h1>
      </div>

      <div className="glass-panel rounded-[2rem] overflow-hidden shadow-sm">
          {/* Account Details */}
          <SectionHeader 
              title={t.accountDetails} 
              icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>} 
          />
          <div className="flex flex-col">
              <div className="px-6 py-4 bg-white/60 border-b border-gray-100">
                  <span className="block font-medium text-gray-800 text-sm sm:text-base mb-2">{t.privateAccount}</span>
                  <div className="flex gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                          <input 
                              type="radio" 
                              name="privacy" 
                              checked={isPrivate} 
                              onChange={() => setIsPrivate(true)}
                              className="w-4 h-4 text-red-600 focus:ring-red-500"
                          />
                          <span className="text-sm text-gray-700">{t.onPrivate}</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                          <input 
                              type="radio" 
                              name="privacy" 
                              checked={!isPrivate} 
                              onChange={() => setIsPrivate(false)}
                              className="w-4 h-4 text-red-600 focus:ring-red-500"
                          />
                          <span className="text-sm text-gray-700">{t.offPublic}</span>
                      </label>
                  </div>
              </div>
              <MenuItem label="Edit Profile" onClick={() => setActiveSection('EDIT_PROFILE')} />
              <MenuItem label="My Wallet" onClick={() => onNavigate('wallet')} rightElement={<span className="text-green-600 font-bold text-sm bg-green-50 px-2 py-1 rounded-full mr-2">₹{(currentUser?.deposits || 0).toLocaleString()}</span>} />
          </div>

          <SectionHeader 
              title="Services & Contributions" 
              icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>} 
          />
          <div className="bg-white/40">
              <MenuItem 
                label="Available Platform Services & Utilities" 
                onClick={() => setActiveSection('PLATFORM_SERVICES')} 
                rightElement={currentUser?.hasStockInsightsAccess ? (
                  <span className="text-[11px] bg-emerald-50 text-emerald-700 font-bold px-2 py-0.5 rounded-full">Stock Active</span>
                ) : (
                  <span className="text-[11px] bg-amber-50 text-amber-700 font-bold px-2 py-0.5 rounded-full">Stock Insights ₹1,999</span>
                )}
              />
              <MenuItem label="Promotions & Advertising" onClick={() => setActiveSection('PROMOTIONS')} />
              <MenuItem label="Make a Donation" onClick={() => setActiveSection('DONATE')} />
          </div>

          <SectionHeader 
              title="Preferences & Safety" 
              icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>} 
          />
          <div className="bg-white/40">
              <MenuItem label={t.blockedUsers} onClick={() => setActiveSection('BLOCKED_USERS')} />
              <MenuItem label={t.languages} onClick={() => setActiveSection('LANGUAGES')} rightElement={<span className="text-gray-500 text-sm mr-2">{currentLanguage}</span>} />
              <MenuItem label={t.verifyAccount} onClick={() => setActiveSection('VERIFY')} rightElement={currentUser?.isVerified ? <span className="text-blue-500 font-bold text-xs bg-blue-50 px-2 py-1 rounded-full">Verified</span> : <span className="text-gray-400 text-xs">Not Verified</span>} />
          </div>

          {/* Help and Support */}
          <SectionHeader 
              title={t.helpSupport} 
              icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" /></svg>} 
          />
          <div className="flex flex-col">
              <MenuItem label="AutoBid Help Centre" onClick={() => setActiveSection('HELP_CENTRE')} rightElement={<span className="text-gray-400 text-xs">Knowledge Base</span>} />
              <MenuItem label="Frequently Asked Questions (FAQ's)" onClick={() => setActiveSection('FAQS')} />
              <MenuItem label="Help & Bidding Guides" onClick={() => setActiveSection('HELP_GUIDES')} />
              <MenuItem label="Contact AutoBid Support" onClick={() => setActiveSection('CONTACT_US')} rightElement={<span className="text-red-600 text-xs font-bold bg-red-50 px-2 py-0.5 rounded-full">24/7 Support</span>} />
              <MenuItem label={t.aiAssistant} onClick={() => setActiveSection('AI_ASSISTANT')} />
              <MenuItem label={t.raiseTicket} onClick={() => setActiveSection('RAISE_TICKET')} />
              <MenuItem label={t.viewTickets} onClick={() => setActiveSection('VIEW_TICKETS')} />
              <MenuItem label={t.contactSupport} onClick={() => setActiveSection('CONTACT_SUPPORT')} />
          </div>

          {/* Legal Agreement & Policies */}
          <SectionHeader 
              title="Legal Agreement & Policies" 
              icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>} 
          />
          <div className="flex flex-col">
              <MenuItem 
                label="Legal Agreement & Terms of Service" 
                onClick={() => setActiveSection('LEGAL_AGREEMENT')} 
                rightElement={<span className="text-xs bg-red-50 text-red-600 font-bold px-2 py-0.5 rounded-full">Binding Rules</span>}
              />
              <MenuItem 
                label="Privacy Policy & Security" 
                onClick={() => setActiveSection('PRIVACY_POLICY')} 
                rightElement={<span className="text-xs bg-blue-50 text-blue-600 font-bold px-2 py-0.5 rounded-full">Data Rights</span>}
              />
              <MenuItem 
                label="Cookie Policy & Auto-Recovery" 
                onClick={() => setActiveSection('COOKIE_POLICY')} 
                rightElement={<span className="text-xs bg-amber-50 text-amber-700 font-bold px-2 py-0.5 rounded-full">Cookies & Session</span>}
              />
              <MenuItem 
                label="Resource, Support & Legal Hub" 
                onClick={() => setActiveSection('INFO_HUB')} 
                rightElement={<span className="text-gray-400 text-xs">All Sections</span>}
              />
          </div>

          {/* Credentials & Data */}
          <SectionHeader 
              title={t.credentialsData} 
              icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>} 
          />
          <div className="flex flex-col">
              <MenuItem label={t.changePassword} onClick={() => setActiveSection('CHANGE_PASSWORD')} />
              <MenuItem label={t.loginDevices} onClick={() => setActiveSection('DEVICES')} />
              
              <MenuItem 
                  label={t.downloadData} 
                  onClick={() => setShowDownloadConfirm(true)}
                  rightElement={<svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>}
              />
          </div>

          {/* Login Actions */}
          <SectionHeader 
              title={t.loginSection} 
              icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" /></svg>} 
          />
          <div className="flex flex-col">
              <MenuItem label={t.addAccount} onClick={() => alert("Add Account feature would open a new login flow.")} />
              <MenuItem label={t.switchAccount} onClick={() => alert("Switch Account would show a list of saved accounts.")} />
              <div className="border-t border-gray-100">
                  <MenuItem 
                      label={t.logOut} 
                      isDestructive 
                      onClick={onLogout}
                      rightElement={<svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" /></svg>}
                  />
              </div>
          </div>
      </div>

      <div className="mt-8 text-center">
          <p className="text-xs text-gray-400 font-medium">AutoBid AI v1.0.7</p>
          <p className="text-gray-300 text-[10px] mt-1">© 2024 AutoBid Inc.</p>
      </div>
    </>
  );
};

// --- Main Settings Component ---

export const Settings: React.FC<SettingsProps> = ({ 
  onNavigate, 
  onLogout, 
  currentUser, 
  currentLanguage, 
  setLanguage, 
  t, 
  initialSection,
  initialInfoTab,
  onJoinAuction,
  onTodaysAuctions,
  onAuctionCalendar,
  onUpdateCurrentUser
}) => {
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection || 'MENU');

  useEffect(() => {
     if (initialSection) {
         setActiveSection(initialSection);
     } else {
         setActiveSection('MENU');
     }
  }, [initialSection]);
  
  // -- State for Account Details & live private user state --
  const [liveUser, setLiveUser] = useState<User | null>(currentUser || null);
  const [isPrivate, setIsPrivate] = useState(false);
  const [blockedUsers, setBlockedUsers] = useState([
    { id: 'b1', name: 'spam_bot_99' },
    { id: 'b2', name: 'annoying_bidder' }
  ]);
  const [isVerificationPending, setIsVerificationPending] = useState(false);
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [showDownloadConfirm, setShowDownloadConfirm] = useState(false);

  // Sync live merged users/{uid} + user_private/{uid} so balance and suspension/deleted/revoked flags always reflect user_private
  useEffect(() => {
    setLiveUser(currentUser || null);
    if (!currentUser?.id) return;

    let pubData: Record<string, any> = {};
    let privData: Record<string, any> = {};
    const syncEffectiveUser = () => {
      setLiveUser({ ...currentUser, ...pubData, ...privData, id: currentUser.id } as User);
    };

    const unsubPub = onSnapshot(doc(db, 'users', currentUser.id), (snap) => {
      pubData = snap.exists() ? (snap.data() || {}) : {};
      syncEffectiveUser();
    }, () => {});

    const unsubPriv = onSnapshot(doc(db, 'user_private', currentUser.id), (snap) => {
      privData = snap.exists() ? (snap.data() || {}) : {};
      syncEffectiveUser();
    }, () => {});

    return () => {
      unsubPub();
      unsubPriv();
    };
  }, [currentUser?.id]);

  const effectiveUser = liveUser || currentUser || null;
  const isAccountRestricted = Boolean(
    effectiveUser && (
      effectiveUser.isDeleted ||
      effectiveUser.isRevoked ||
      effectiveUser.suspensionStatus === 'permanent' ||
      (
        effectiveUser.suspensionStatus === 'temporary' &&
        (!effectiveUser.suspensionUntil || Number(effectiveUser.suspensionUntil) > Date.now())
      )
    )
  );

  // -- State for Tickets --
  const [tickets, setTickets] = useState<any[]>([]);

  useEffect(() => {
     if (activeSection === 'VIEW_TICKETS' || activeSection === 'RAISE_TICKET') {
         const ticketsCol = collection(db, 'tickets');
         const unsub = onSnapshot(ticketsCol, (snapshot) => {
             const fsTickets: any[] = [];
             snapshot.forEach(d => {
                 fsTickets.push({ id: d.id, ...d.data() });
             });

             const localGuestEmail = localStorage.getItem('autobid_ai_guest_email') || '';
             const targetEmail = (currentUser?.email || localGuestEmail || '').toLowerCase().trim();

             authFetch(`/api/tickets/user?userId=${currentUser?.id || ''}&email=${encodeURIComponent(targetEmail)}`)
               .then(res => res.json())
               .then(srvData => {
                 const srvTickets = srvData?.tickets || [];
                 const combinedMap = new Map<string, any>();
                 fsTickets.forEach(t => combinedMap.set(t.id, t));
                 srvTickets.forEach((t: any) => {
                   if (!combinedMap.has(t.id)) combinedMap.set(t.id, t);
                 });

                 const all = Array.from(combinedMap.values());
                 const filtered = all.filter(t => {
                   if (currentUser?.id && t.userId === currentUser.id) return true;
                   if (currentUser?.email && t.userEmail && t.userEmail.toLowerCase() === currentUser.email.toLowerCase()) return true;
                   if (currentUser?.email && t.email && t.email.toLowerCase() === currentUser.email.toLowerCase()) return true;
                   if (localGuestEmail && t.userEmail && t.userEmail.toLowerCase() === localGuestEmail.toLowerCase()) return true;
                   return false;
                 });

                 filtered.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
                 setTickets(filtered);
               })
               .catch(() => {
                 const filtered = fsTickets.filter(t => {
                   if (currentUser?.id && t.userId === currentUser.id) return true;
                   if (currentUser?.email && t.userEmail && t.userEmail.toLowerCase() === currentUser.email.toLowerCase()) return true;
                   if (currentUser?.email && t.email && t.email.toLowerCase() === currentUser.email.toLowerCase()) return true;
                   if (localGuestEmail && t.userEmail && t.userEmail.toLowerCase() === localGuestEmail.toLowerCase()) return true;
                   return false;
                 });
                 filtered.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
                 setTickets(filtered);
               });
         }, (err) => {
           console.warn("Tickets fetch note, falling back to server:", err);
           const localGuestEmail = localStorage.getItem('autobid_ai_guest_email') || '';
           const targetEmail = (currentUser?.email || localGuestEmail || '').toLowerCase().trim();
           authFetch(`/api/tickets/user?userId=${currentUser?.id || ''}&email=${encodeURIComponent(targetEmail)}`)
             .then(res => res.json())
             .then(srvData => {
               if (srvData?.tickets) {
                 setTickets(srvData.tickets);
               }
             })
             .catch(console.warn);
         });
         return () => unsub();
     }
  }, [activeSection, currentUser?.id, currentUser?.email]);

  // -- Helpers --
  const generateUserData = () => {
    if (!currentUser) return null;
    return {
      personalInfo: {
        id: currentUser.id,
        username: currentUser.username,
        email: currentUser.email || `${currentUser.username}@autobid.com`,
        verified: currentUser.isVerified,
      },
      settings: { isPrivate, language: currentLanguage },
      exportMetaData: {
        app: "AutoBid AI",
        timestamp: new Date().toISOString(),
      }
    };
  };

  const executeDownload = (format: 'json' | 'html') => {
    const data = generateUserData();
    if (!data) return;
    let content = '';
    let mimeType = '';
    let extension = '';

    if (format === 'json') {
      content = JSON.stringify(data, null, 2);
      mimeType = 'application/json';
      extension = 'json';
    } else {
      content = `
        <html>
          <head><title>AutoBid Export</title></head>
          <body>
            <h1>Data Export for ${currentUser.username}</h1>
            <pre>${JSON.stringify(data, null, 2)}</pre>
          </body>
        </html>
      `;
      mimeType = 'text/html';
      extension = 'html';
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `autobid_data.${extension}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setShowDownloadConfirm(false);
  };

  // --- Sub-Views ---

  const EditProfileView = () => {
    const [username, setUsername] = useState(currentUser?.username || '');
    const [fullName, setFullName] = useState(currentUser?.fullName || '');
    const [bio, setBio] = useState(currentUser?.bio || '');
    const [website, setWebsite] = useState(currentUser?.website || '');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!currentUser) {
      return (
        <div className="animate-fade-in-right p-8 text-center glass-panel rounded-2xl">
          <p className="text-gray-600 font-bold mb-4">Please sign in to edit your profile.</p>
          <button onClick={() => onNavigate('auth')} className="bg-red-600 text-white font-bold px-6 py-2.5 rounded-xl cursor-pointer">
            Sign In / Register
          </button>
        </div>
      );
    }

    const handleSave = async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);

      const validation = validateInstagramUsername(username);
      if (!validation.isValid) {
        setError(validation.error || "Please enter a valid Instagram-style username.");
        return;
      }

      setLoading(true);

      const lowerNewUser = sanitizeInstagramUsername(username);
      const lowerOldUser = sanitizeInstagramUsername(currentUser.username || '');
      
      try {
        if (lowerNewUser !== lowerOldUser) {
          const usernameRef = doc(db, 'usernames', lowerNewUser);
          const usernameDoc = await getDoc(usernameRef);
          if (usernameDoc.exists()) {
             setError("Username @" + lowerNewUser + " is already taken by another user.");
             setLoading(false);
             return;
          }
          // Delete old, set new
          if (lowerOldUser) await deleteDoc(doc(db, 'usernames', lowerOldUser));
          await setDoc(usernameRef, { uid: currentUser.id });
        }

        await updateDoc(doc(db, 'users', currentUser.id), {
          username: lowerNewUser,
          fullName: fullName,
          bio: bio,
          website: website
        });
        
        alert("Profile updated successfully!");
        setActiveSection('MENU');
      } catch (err: any) {
        setError("Error updating profile: " + err.message);
      } finally {
        setLoading(false);
      }
    };

    return (
      <div className="animate-fade-in-right">
        <SubViewHeader title="Edit Profile" onBack={() => setActiveSection('MENU')} />
        <div className="glass-panel p-6 rounded-[2rem]">
            {error && <div className="mb-4 text-red-600 font-medium text-sm bg-red-50 p-3 rounded-xl">{error}</div>}
            <form onSubmit={handleSave} className="space-y-4">
                <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="block text-sm font-bold text-gray-700">Username</label>
                      <span className="text-[11px] text-gray-400 font-medium">No spaces • Instagram format</span>
                    </div>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-sm">@</span>
                      <input 
                        type="text" 
                        required 
                        value={username} 
                        onChange={(e) => {
                          const sanitized = sanitizeInstagramUsername(e.target.value);
                          setUsername(sanitized);
                        }} 
                        className="w-full pl-9 pr-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500 font-medium" 
                        placeholder="your_handle" 
                      />
                    </div>
                    {username && (
                      <p className="text-[11px] text-gray-500 mt-1">
                        Public handle: <strong className="text-gray-900">@{username}</strong>
                      </p>
                    )}
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                    <input type="text" required value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-gray-200" placeholder="Full Name" />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Bio</label>
                    <textarea value={bio} onChange={(e) => setBio(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-gray-200" placeholder="Tell us about yourself..." />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Website / Link</label>
                    <input type="url" value={website} onChange={(e) => setWebsite(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-gray-200" placeholder="https://..." />
                </div>
                <button type="submit" disabled={loading} className="w-full bg-red-600 text-white font-bold py-3 rounded-xl shadow-lg mt-4 disabled:opacity-50">
                    {loading ? 'Saving...' : 'Save Changes'}
                </button>
            </form>
        </div>
      </div>
    );
  };

  const BlockedUsersView = () => (
    <div className="animate-fade-in-right">
      <SubViewHeader title={t.blockedUsers} onBack={() => setActiveSection('MENU')} />
      <div className="glass-panel rounded-2xl overflow-hidden">
        {blockedUsers.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No blocked users.</div>
        ) : (
          blockedUsers.map(user => (
            <div key={user.id} className="flex items-center justify-between p-4 border-b border-gray-100 last:border-0">
               <span className="font-medium text-gray-800">{user.name}</span>
               <button 
                 onClick={() => setBlockedUsers(blockedUsers.filter(u => u.id !== user.id))}
                 className="text-xs bg-gray-100 hover:bg-red-50 text-gray-600 hover:text-red-600 px-3 py-1.5 rounded-full transition-colors"
               >
                 Unblock
               </button>
            </div>
          ))
        )}
      </div>
    </div>
  );

  const LanguageView = () => {
    const langs = ['English (US)', 'Español', 'Français', 'Deutsch', 'Hindi', 'Marathi', 'Sanskrit', 'Arabic', 'Urdu', 'Telugu', 'Malayalam', 'Tamil', 'Gujarati', 'Punjabi', 'Odia', 'Kannada', '日本語'];
    return (
      <div className="animate-fade-in-right">
        <SubViewHeader title={t.languages} onBack={() => setActiveSection('MENU')} />
        <div className="glass-panel rounded-2xl overflow-hidden">
          {langs.map(lang => (
            <div 
              key={lang} 
              onClick={() => { setLanguage(lang); setActiveSection('MENU'); }}
              className="flex items-center justify-between p-4 border-b border-gray-100 last:border-0 cursor-pointer hover:bg-white/50"
            >
              <span className="font-medium text-gray-800">{lang}</span>
              {currentLanguage === lang && <span className="text-red-600 font-bold">✓</span>}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const VerifyView = () => {
    if (!currentUser) {
      return (
        <div className="animate-fade-in-right p-8 text-center glass-panel rounded-2xl">
          <p className="text-gray-600 font-bold mb-4">Please sign in to verify your account identity.</p>
          <button onClick={() => onNavigate('auth')} className="bg-red-600 text-white font-bold px-6 py-2.5 rounded-xl cursor-pointer">
            Sign In / Register
          </button>
        </div>
      );
    }

    return (
      <div className="animate-fade-in-right">
        <SubViewHeader title={t.verifyAccount} onBack={() => setActiveSection('MENU')} />
        <div className="glass-panel rounded-[2rem] p-6 text-center">
           <div className={`w-20 h-20 ${currentUser?.isVerified ? 'bg-emerald-50 text-emerald-600' : currentUser?.verificationStatus === 'pending' ? 'bg-amber-50 text-amber-600' : 'bg-blue-50 text-blue-600'} rounded-full flex items-center justify-center mx-auto mb-4 text-3xl shadow-sm`}>
              {currentUser?.isVerified ? '🛡️' : currentUser?.verificationStatus === 'pending' ? '⏳' : '🪪'}
           </div>
           <h3 className="text-xl font-bold text-gray-900 mb-2">
              {currentUser?.isVerified ? 'Account Verified' : currentUser?.verificationStatus === 'pending' ? 'Verification In Review' : 'Verify Your Identity'}
           </h3>
           <p className="text-gray-500 text-sm mb-6 max-w-md mx-auto leading-relaxed">
             {currentUser?.isVerified 
              ? 'Your account has been authenticated using your PAN / National ID. You have full access to bid on all vehicles, list and sell your cars, and participate in auction events.'
              : currentUser?.verificationStatus === 'pending'
              ? 'Your identity documents have been submitted to our verification team and admin for review. You will be authorized once verified.'
              : 'AutoBid requires PAN Card or National ID verification for platform security. Only verified accounts are authorized to bid, sell vehicles, and participate in auction events.'}
         </p>
         
         {currentUser?.isVerified ? (
            <div className="inline-flex items-center gap-2 bg-emerald-100 text-emerald-800 px-6 py-3 rounded-2xl font-bold text-sm shadow-sm">
              <svg className="w-5 h-5 text-emerald-600" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
              <span>Verified Account — Authorized for Bidding & Selling</span>
            </div>
         ) : currentUser?.verificationStatus === 'pending' ? (
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 bg-amber-100 text-amber-800 px-6 py-3 rounded-2xl font-bold text-sm">
                <span>⏳</span>
                <span>Verification Request Pending Admin Review</span>
              </div>
              <div>
                <button
                  onClick={() => setShowVerifyModal(true)}
                  className="text-xs text-amber-800 underline hover:text-amber-900 font-semibold"
                >
                  View / Re-submit Details
                </button>
              </div>
            </div>
         ) : (
            <button 
              onClick={() => setShowVerifyModal(true)}
              className="w-full max-w-sm mx-auto bg-gradient-to-r from-red-600 to-amber-600 hover:from-red-700 hover:to-amber-700 text-white font-bold py-3.5 px-6 rounded-2xl transition-all shadow-lg shadow-red-500/30 flex items-center justify-center gap-2"
            >
              <span>🛡️</span>
              <span>Verify with PAN / National ID</span>
            </button>
         )}
      </div>

      {showVerifyModal && (
        <IdentityVerificationModal
          currentUser={currentUser}
          isOpen={true}
          onClose={() => setShowVerifyModal(false)}
          onVerificationSubmitted={() => {
            setShowVerifyModal(false);
            alert("Verification request submitted! Once verified by our verification team / admin, your bidding, selling, and event privileges will be active.");
          }}
        />
      )}
    </div>
    );
  };

  const AIAssistantView = () => {
    const [sessionId, setSessionId] = useState<string>(() => 'chat_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7));
    const [messages, setMessages] = useState<{ role: 'user' | 'model'; text: string; id?: string; deleteAppealData?: any }[]>([
      { role: 'model', text: "👋 Hello! I am your 24/7 AutoBid AI Agent powered by Groq. I can resolve minor bidding questions, deposit/wallet concerns, KYC requirements, vehicle listings, or process account deletion appeals. How can I assist you today?" }
    ]);
    const [input, setInput] = useState('');
    const [guestEmail, setGuestEmail] = useState<string>(() => localStorage.getItem('autobid_guest_email') || '');
    const [needsEmail, setNeedsEmail] = useState<boolean>(!currentUser && !localStorage.getItem('autobid_guest_email'));
    const [emailInput, setEmailInput] = useState('');
    const [emailError, setEmailError] = useState('');
    const [loading, setLoading] = useState(false);
    const [statusBadge, setStatusBadge] = useState<string | null>(null);
    const [deletionAppealStatus, setDeletionAppealStatus] = useState<{ submitted: boolean; appealId?: string; reason?: string } | null>(null);
    const [isSubmittingAppeal, setIsSubmittingAppeal] = useState(false);

    const effectiveEmail = currentUser?.email || guestEmail;

    const handleSaveEmail = (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = emailInput.trim().toLowerCase();
      if (!trimmed || !trimmed.includes('@') || !trimmed.includes('.')) {
        setEmailError('Please enter a valid email address to save and share your conversation.');
        return;
      }
      localStorage.setItem('autobid_guest_email', trimmed);
      setGuestEmail(trimmed);
      setNeedsEmail(false);
      setEmailError('');
    };

    const handleSubmitAppeal = async (appealReason?: string) => {
      if (isSubmittingAppeal || deletionAppealStatus?.submitted) return;
      if (!currentUser?.id) {
        alert("Please sign in to submit an account deletion appeal.");
        onNavigate('auth');
        return;
      }
      const finalReason = appealReason?.trim() || "User requested account deletion via AI Support";
      setIsSubmittingAppeal(true);
      try {
        const res = await authFetch('/api/ai/submit-deletion-appeal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            reason: finalReason
          })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Failed to submit deletion appeal.');
        }

        const appealId = data.appealId || `appeal_del_${Date.now()}`;
        const targetUsername = currentUser.username || 'Member';
        const targetEmail = currentUser.email || effectiveEmail || 'user@autobid.com';

        setDeletionAppealStatus({ submitted: true, appealId, reason: finalReason });
        setMessages(prev => [
          ...prev,
          {
            role: 'model',
            id: 'conf_' + Date.now(),
            text: `✅ **Account Deletion Appeal Successfully Submitted to Admin Panel!**\n\n• **Appeal Reference:** \`${appealId}\`\n• **Target Account:** @${targetUsername} (${targetEmail})\n• **Reason Provided:** "${finalReason}"\n• **Status:** Pending Administrator Action (Module 13: Appeals)\n\nOur administration team has received your request and reason in the Admin Panel. An admin will review and permanently delete your account.`
          }
        ]);
      } catch (err: any) {
        alert("Error submitting deletion appeal: " + err.message);
      } finally {
        setIsSubmittingAppeal(false);
      }
    };

    const handleSend = async (customPrompt?: string) => {
      const msgToSend = (customPrompt || input).trim();
      if (!msgToSend || loading) return;
      if (!currentUser?.id) {
        setMessages(prev => [
          ...prev,
          {
            role: 'model',
            id: 'auth_req_' + Date.now(),
            text: '🔐 Please sign in to your AutoBid account to chat with our AI Support Agent.'
          }
        ]);
        return;
      }

      const updatedMessages = [...messages, { role: 'user' as const, text: msgToSend, id: 'u_' + Date.now() }];
      setMessages(updatedMessages);
      setInput('');
      setLoading(true);

      try {
        const res = await authFetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: updatedMessages.map(m => ({
              role: m.role === 'model' ? 'assistant' : 'user',
              content: m.text
            })),
            sessionId,
            userEmail: effectiveEmail || 'anonymous_guest@autobid.com',
            username: currentUser?.username || (effectiveEmail ? effectiveEmail.split('@')[0] : 'GuestVisitor'),
            userId: currentUser?.id,
            isGuest: !currentUser
          })
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'AI service temporarily unavailable.');
        }
        if (data.sessionId) {
          setSessionId(data.sessionId);
        }
        const replyText = data.reply || data.response || "I am here to help!";
        setMessages(prev => [...prev, {
          role: 'model',
          text: replyText,
          id: 'a_' + Date.now(),
          deleteAppealData: data.deleteAppeal
        }]);

        if (data.deleteAppeal?.stage === 'confirmed' && !deletionAppealStatus?.submitted) {
          handleSubmitAppeal(data.deleteAppeal.reason || msgToSend);
        }

        if (data.status === 'resolved') {
          setStatusBadge('✓ Minor Issue Resolved by AI');
        } else if (data.status === 'escalated') {
          setStatusBadge('⚠️ Escalated to Admin Panel');
        }
      } catch (e: any) {
        setMessages(prev => [...prev, { role: 'model', text: "Service temporarily unavailable. Please try again or check Support Tickets." }]);
      } finally {
        setLoading(false);
      }
    };

    return (
      <div className="animate-fade-in-right h-[calc(100vh-140px)] flex flex-col">
        <SubViewHeader title={t.aiAssistant || "AI Support Agent"} onBack={() => setActiveSection('MENU')} />
        <div className="glass-panel flex-1 rounded-2xl overflow-hidden flex flex-col border border-gray-200/80 shadow-md">
          {/* Header bar */}
          <div className="p-3.5 bg-gradient-to-r from-purple-900 via-indigo-900 to-gray-900 text-white flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span className="font-extrabold">Autonomous Support Agent</span>
              <span className="bg-white/20 text-white px-2 py-0.5 rounded-full text-[10px] font-mono">Groq Powered</span>
            </div>
            {effectiveEmail && (
              <span className="text-[11px] text-purple-200 truncate max-w-[180px]">
                {currentUser ? `Member: @${currentUser.username}` : `Guest: ${effectiveEmail}`}
              </span>
            )}
          </div>

          {/* Needs email prompt for guests */}
          {needsEmail && !currentUser && (
            <div className="p-3 bg-amber-50 border-b border-amber-200 text-xs">
              <form onSubmit={handleSaveEmail} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <span className="font-bold text-amber-900 shrink-0">Enter email to save conversation:</span>
                <input
                  type="email"
                  value={emailInput}
                  onChange={e => setEmailInput(e.target.value)}
                  placeholder="name@example.com"
                  className="flex-1 px-3 py-1.5 bg-white border border-amber-300 rounded-lg text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 bg-gray-900 hover:bg-black text-white font-bold rounded-lg text-xs cursor-pointer shrink-0"
                >
                  Save Email
                </button>
              </form>
              {emailError && <p className="text-[11px] text-red-600 mt-1 font-semibold">{emailError}</p>}
            </div>
          )}

          {statusBadge && (
            <div className="px-4 py-1.5 bg-emerald-50 border-b border-emerald-100 text-[11px] font-bold text-emerald-800 flex items-center gap-1.5">
              <span>{statusBadge}</span>
            </div>
          )}

          {/* Messages scroll */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-gray-50/40">
            {messages.map((m, i) => (
              <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div className={`max-w-[85%] px-4 py-3 rounded-2xl text-xs sm:text-sm leading-relaxed whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'bg-gradient-to-r from-purple-700 to-indigo-700 text-white rounded-tr-xs shadow-sm'
                    : 'bg-white text-gray-800 rounded-tl-xs shadow-xs border border-gray-100'
                }`}>
                  <div>{m.text}</div>

                  {/* Account Deletion Appeal Card */}
                  {m.deleteAppealData && m.deleteAppealData.stage === 'ready_to_submit' && !deletionAppealStatus?.submitted && (
                    <div className="w-full bg-red-50 border border-red-300 rounded-xl p-3 text-xs text-red-900 mt-2 space-y-2">
                      <div className="flex items-center gap-1.5 font-black text-red-700">
                        <span>🗑️</span>
                        <span>Account Deletion Appeal</span>
                      </div>
                      {m.deleteAppealData.reason && (
                        <div className="text-[11px] bg-white p-2 rounded-lg border border-red-200 text-gray-800">
                          <span className="font-bold text-red-600 block mb-0.5">Stated Reason:</span>
                          "{m.deleteAppealData.reason}"
                        </div>
                      )}
                      <p className="text-[11px] text-gray-600">
                        Account deletion is permanent. Confirm to send your deletion appeal to the Admin Panel.
                      </p>
                      <button
                        type="button"
                        disabled={isSubmittingAppeal}
                        onClick={() => handleSubmitAppeal(m.deleteAppealData?.reason)}
                        className="w-full py-2 bg-gradient-to-r from-red-600 to-rose-700 hover:from-red-700 hover:to-rose-800 text-white font-bold rounded-lg shadow-sm text-xs transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <span>🗑️</span>
                        <span>{isSubmittingAppeal ? 'Submitting Appeal to Admin...' : 'Confirm & Submit Delete Appeal to Admin'}</span>
                      </button>
                    </div>
                  )}

                  {/* Deletion Appeal Submitted Badge */}
                  {deletionAppealStatus?.submitted && m.role === 'model' && (
                    <div className="w-full bg-emerald-50 border border-emerald-300 rounded-xl p-2 text-xs text-emerald-900 mt-2 flex items-center gap-1.5 font-bold">
                      <span>✅</span>
                      <span>Appeal Submitted to Admin Panel: #{deletionAppealStatus.appealId?.slice(0, 10)}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-xs text-purple-700 font-bold ml-2">
                <div className="w-2 h-2 rounded-full bg-purple-600 animate-ping"></div>
                <span>AutoBid AI Agent analyzing and formulating solution...</span>
              </div>
            )}
          </div>

          {/* Quick Suggestion Chips */}
          <div className="px-3 py-1.5 bg-gray-50 border-t border-gray-100 flex gap-1.5 overflow-x-auto scrollbar-hide shrink-0">
            <button
              type="button"
              onClick={() => handleSend("I want to post a vehicle for auction on AutoBid.")}
              className="px-2.5 py-1 rounded-full bg-gradient-to-r from-purple-700 to-indigo-700 text-white text-[11px] font-bold shadow-xs whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-1"
            >
              <span>🚗</span>
              <span>Post Vehicle for Auction / Sale</span>
            </button>
            <button
              type="button"
              onClick={() => handleSend("How do live auction bids and pre-stakes work?")}
              className="px-2 py-1 rounded-full bg-white border border-gray-200 text-[10px] font-medium text-gray-700 hover:bg-gray-100 whitespace-nowrap shrink-0"
            >
              Live Bidding Rules
            </button>
            <button
              type="button"
              onClick={() => handleSend("How to deposit funds into wallet?")}
              className="px-2 py-1 rounded-full bg-white border border-gray-200 text-[10px] font-medium text-gray-700 hover:bg-gray-100 whitespace-nowrap shrink-0"
            >
              Deposit Funds
            </button>
          </div>

          {/* Input bar */}
          <div className="p-3 bg-white border-t border-gray-100 flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder={needsEmail && !currentUser ? "Please enter your email above to begin..." : "Describe your question or issue (e.g. deposit, bid, KYC)..."}
              disabled={needsEmail && !currentUser}
              className="flex-1 px-4 py-2.5 rounded-full bg-gray-50 border border-gray-200 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white text-gray-900 disabled:opacity-50"
            />
            <button
              onClick={handleSend}
              disabled={loading || !input.trim() || (needsEmail && !currentUser)}
              className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white p-2.5 rounded-full transition shadow-md disabled:opacity-50 cursor-pointer"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    );
  };

  const RaiseTicketView = () => {
    const [category, setCategory] = useState('amount_related');
    const [subject, setSubject] = useState('');
    const [desc, setDesc] = useState('');
    const [submitted, setSubmitted] = useState(false);

    if (!currentUser) {
      return (
        <div className="animate-fade-in-right p-8 text-center glass-panel rounded-2xl">
          <p className="text-gray-600 font-bold mb-4">Please sign in to submit a support ticket.</p>
          <button onClick={() => onNavigate('auth')} className="bg-red-600 text-white font-bold px-6 py-2.5 rounded-xl cursor-pointer">
            Sign In / Register
          </button>
        </div>
      );
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitted(true);
        try {
            await addDoc(collection(db, 'tickets'), {
                userId: currentUser.id,
                category,
                subject,
                description: desc,
                status: 'open',
                createdAt: Date.now()
            });
            alert("Support ticket created!");
            setSubject('');
            setDesc('');
            setCategory('amount_related');
            setActiveSection('VIEW_TICKETS');
        } catch (err: any) {
            alert("Error creating ticket: " + err.message);
        } finally {
            setSubmitted(false);
        }
    };

    return (
      <div className="animate-fade-in-right">
        <SubViewHeader title={t.raiseTicket} onBack={() => setActiveSection('MENU')} />
        <div className="glass-panel p-6 rounded-[2rem]">
            {submitted ? (
                 <div className="text-center py-10">
                     <p className="font-bold text-gray-700">Submitting your ticket...</p>
                 </div>
            ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                    <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-red-400 bg-white">
                        <option value="amount_related">Amount Related Query</option>
                        <option value="account_related">Account Related Query</option>
                        <option value="other">Other Query</option>
                    </select>
                    <input required value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-red-400" placeholder="Subject" />
                    <textarea required value={desc} onChange={(e) => setDesc(e.target.value)} rows={4} className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-red-400" placeholder="Description..." />
                    <button type="submit" className="w-full bg-red-600 text-white font-bold py-3 rounded-xl shadow-lg hover:bg-red-700 transition-all">Submit</button>
                </form>
            )}
        </div>
      </div>
    );
  };

  const ViewTicketsView = () => {
    const [copiedId, setCopiedId] = useState<string | null>(null);

    const handleCopy = (id: string) => {
      navigator.clipboard.writeText(id);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2500);
    };

    return (
      <div className="animate-fade-in-right space-y-4">
        <SubViewHeader title={t.viewTickets || "View Support Tickets"} onBack={() => setActiveSection('MENU')} />

        {/* Info header */}
        <div className="bg-gradient-to-r from-slate-900 to-indigo-950 text-white rounded-2xl p-4 shadow-md flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-xl">
              🎫
            </div>
            <div>
              <h4 className="font-bold text-sm text-white">Your Support Tickets</h4>
              <p className="text-[11px] text-gray-300">
                {currentUser?.email ? `Associated with ${currentUser.email}` : `Tracking user & AI tickets`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setActiveSection('AI_ASSISTANT')}
            className="px-3 py-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-bold rounded-xl text-xs transition flex items-center gap-1 cursor-pointer"
          >
            <span>🤖</span>
            <span>Ask AI</span>
          </button>
        </div>

        <div className="glass-panel rounded-2xl overflow-hidden shadow-xs divide-y divide-gray-100">
          {tickets.length === 0 ? (
            <div className="p-8 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center mx-auto text-2xl">
                📭
              </div>
              <p className="text-gray-600 font-bold text-sm">No support tickets found yet.</p>
              <p className="text-xs text-gray-400 max-w-sm mx-auto">
                Tickets raised via our Autonomous AI Agent or submitted directly will appear here with live resolution status.
              </p>
            </div>
          ) : (
            tickets.map(ticket => (
              <div key={ticket.id} className="p-4 sm:p-5 hover:bg-white/60 transition space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-extrabold text-sm text-gray-900">{ticket.subject}</span>
                    {ticket.source === 'ai_agent' && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-purple-100 text-purple-700 border border-purple-200 flex items-center gap-1">
                        <span>🤖</span>
                        <span>AI Escalated</span>
                      </span>
                    )}
                    {ticket.category && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-600">
                        {ticket.category.replace(/_/g, ' ')}
                      </span>
                    )}
                  </div>
                  <span className={`text-[11px] px-2.5 py-1 rounded-full font-bold uppercase shrink-0 self-start sm:self-auto ${
                    ticket.status === 'Resolved' || ticket.status === 'closed'
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                      : 'bg-amber-100 text-amber-800 border border-amber-200'
                  }`}>
                    {ticket.status || 'open'}
                  </span>
                </div>

                {/* Ticket ID & Metadata */}
                <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500">
                  <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 px-2.5 py-1 rounded-lg font-mono text-[11px]">
                    <span className="text-gray-400">Ref:</span>
                    <strong className="text-gray-800 dark:text-gray-200 select-all">{ticket.id}</strong>
                    <button
                      type="button"
                      onClick={() => handleCopy(ticket.id)}
                      title="Copy Ticket ID"
                      className="ml-1 text-purple-600 hover:text-purple-800 font-bold cursor-pointer"
                    >
                      {copiedId === ticket.id ? '✓ Copied' : '📋'}
                    </button>
                  </div>
                  <span>•</span>
                  <span>{ticket.createdAt ? new Date(ticket.createdAt).toLocaleString() : (ticket.date || 'Recently')}</span>
                  {(ticket.userEmail || ticket.email) && (
                    <>
                      <span>•</span>
                      <span className="text-gray-600 font-medium">Follow-up: <strong>{ticket.userEmail || ticket.email}</strong></span>
                    </>
                  )}
                </div>

                {ticket.description && (
                  <p className="text-xs sm:text-sm text-gray-600 bg-gray-50/60 p-3 rounded-xl border border-gray-100 leading-relaxed whitespace-pre-wrap">
                    {ticket.description}
                  </p>
                )}
              </div>
            ))
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
          <button 
            type="button"
            onClick={() => setActiveSection('RAISE_TICKET')} 
            className="w-full py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl shadow-sm transition text-xs flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <span>📝</span>
            <span>{t.raiseTicket || "Raise Direct Ticket"}</span>
          </button>
          <button 
            type="button"
            onClick={() => setActiveSection('AI_ASSISTANT')} 
            className="w-full py-3 bg-white hover:bg-gray-50 text-purple-700 border border-purple-200 font-bold rounded-xl shadow-xs transition text-xs flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <span>🤖</span>
            <span>Resolve via AI Support Agent</span>
          </button>
        </div>
      </div>
    );
  };

  const ContactSupportView = () => (
    <div className="animate-fade-in-right">
      <SubViewHeader title={t.contactSupport} onBack={() => setActiveSection('MENU')} />
      <div className="glass-panel p-6 rounded-[2rem] space-y-4">
         <div className="flex items-center gap-4 p-4 bg-white/60 rounded-xl">
            <div className="bg-red-100 p-3 rounded-full text-red-600">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
            </div>
            <div>
                <p className="text-sm text-gray-500 font-bold uppercase">Call Us</p>
                <p className="text-lg font-bold text-gray-900">+1 (800) 123-4567</p>
            </div>
         </div>
         <div className="flex items-center gap-4 p-4 bg-white/60 rounded-xl">
            <div className="bg-blue-100 p-3 rounded-full text-blue-600">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
            </div>
            <div>
                <p className="text-sm text-gray-500 font-bold uppercase">Email Us</p>
                <p className="text-lg font-bold text-gray-900">support@autobid.ai</p>
            </div>
         </div>
         <p className="text-center text-xs text-gray-400 mt-4">Hours: Mon-Fri 9am - 6pm EST</p>
      </div>
    </div>
  );

  const ChangePasswordView = () => (
      <div className="animate-fade-in-right">
        <SubViewHeader title={t.changePassword} onBack={() => setActiveSection('MENU')} />
        <div className="glass-panel p-6 rounded-[2rem]">
            <form onSubmit={(e) => { e.preventDefault(); alert("Password updated successfully!"); setActiveSection('MENU'); }} className="space-y-4">
                <input type="password" required className="w-full px-4 py-3 rounded-xl border border-gray-200" placeholder="Current Password" />
                <input type="password" required className="w-full px-4 py-3 rounded-xl border border-gray-200" placeholder="New Password" />
                <input type="password" required className="w-full px-4 py-3 rounded-xl border border-gray-200" placeholder="Confirm New Password" />
                <button type="submit" className="w-full bg-red-600 text-white font-bold py-3 rounded-xl shadow-lg">Update Password</button>
            </form>
        </div>
      </div>
  );

  const DevicesView = () => (
      <div className="animate-fade-in-right">
          <SubViewHeader title={t.loginDevices} onBack={() => setActiveSection('MENU')} />
          <div className="glass-panel rounded-2xl overflow-hidden">
              <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-green-50/50">
                  <div>
                      <p className="font-bold text-gray-800">Chrome on Windows</p>
                      <p className="text-xs text-green-600 font-bold">Current Session</p>
                  </div>
              </div>
              <div className="p-4 border-b border-gray-100 flex justify-between items-center">
                  <div>
                      <p className="font-bold text-gray-800">iPhone 13 Pro</p>
                      <p className="text-xs text-gray-500">Last active: 2 hours ago</p>
                  </div>
                  <button className="text-xs text-red-500 font-bold border border-red-100 px-3 py-1 rounded-full hover:bg-red-50">{t.logOut}</button>
              </div>
              <div className="p-4 flex justify-between items-center">
                  <div>
                      <p className="font-bold text-gray-800">Safari on Mac</p>
                      <p className="text-xs text-gray-500">Last active: 5 days ago</p>
                  </div>
                   <button className="text-xs text-red-500 font-bold border border-red-100 px-3 py-1 rounded-full hover:bg-red-50">{t.logOut}</button>
              </div>
          </div>
      </div>
  );

  const PlatformServicesView = () => {
    const [serviceType, setServiceType] = useState<'view_stock_insights' | 'boost_auction' | 'boost_bidding' | 'sales_commission'>('view_stock_insights');
    const [amount, setAmount] = useState('1999');
    const [processing, setProcessing] = useState(false);
    
    const isStockUnlocked = Boolean(effectiveUser?.hasStockInsightsAccess);
    const userWalletBalance = effectiveUser?.deposits ?? 0;

    const handleServiceSelect = (val: 'view_stock_insights' | 'boost_auction' | 'boost_bidding' | 'sales_commission') => {
      setServiceType(val);
      if (val === 'view_stock_insights') {
        setAmount('1999');
      } else if (val === 'boost_auction') {
        setAmount('500');
      } else if (val === 'boost_bidding') {
        setAmount('350');
      } else if (val === 'sales_commission') {
        setAmount('1000');
      }
    };

    const handleUnlockStockInsights = async () => {
      if (!currentUser) {
        alert("Please sign in to unlock platform services.");
        onNavigate('auth');
        return;
      }
      if (isAccountRestricted) {
        alert("Account suspended or restricted from wallet transactions.");
        return;
      }

      if (isStockUnlocked) {
        onNavigate('stock');
        return;
      }

      const cost = 1999;
      if (userWalletBalance < cost) {
        if (window.confirm(`Insufficient wallet balance. You have ₹${userWalletBalance.toLocaleString()}, but "View Stock Insights" requires ₹${cost.toLocaleString()} from your wallet. Would you like to go to My Wallet to deposit funds?`)) {
          onNavigate('wallet');
        }
        return;
      }

      const confirmed = window.confirm(`Unlock "View Stock Insights" for ₹${cost.toLocaleString()}? This will deduct ₹${cost.toLocaleString()} from your wallet balance and permanently add the 📦 Stock tab to your bottom navigation bar.`);
      if (!confirmed) return;

      setProcessing(true);
      try {
        const res = await authFetch('/api/wallet/spend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: cost,
            serviceName: 'Platform Utility: View Stock Insights (Unlocked Stock in bottom navigation)',
            serviceKey: 'stock_insights'
          })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Failed to activate Stock Insights');
        }
        onUpdateCurrentUser?.({ deposits: data.newBalance, hasStockInsightsAccess: true });
        alert('🎉 "View Stock Insights" utility successfully activated! The 📦 Stock option has been added to your bottom navigation bar.');
        onNavigate('stock');
      } catch (err: any) {
        alert("Error activating Stock Insights: " + err.message);
      } finally {
        setProcessing(false);
      }
    };

    const handlePayGeneric = async () => {
      if (!currentUser) {
        alert("Please sign in to access platform services.");
        onNavigate('auth');
        return;
      }
      if (isAccountRestricted) {
        alert("Account suspended or restricted from wallet transactions.");
        return;
      }

      if (serviceType === 'view_stock_insights') {
        return handleUnlockStockInsights();
      }

      const val = parseInt(amount, 10);
      if (isNaN(val) || val <= 0) return alert('Invalid amount');
      if (val > userWalletBalance) {
        if (window.confirm(`Insufficient funds in wallet (Available: ₹${userWalletBalance.toLocaleString()}). Go to My Wallet to deposit?`)) {
          onNavigate('wallet');
        }
        return;
      }
      
      const confirmMsg = `Pay ₹${val.toLocaleString()} from your wallet for ${serviceType.replace(/_/g, ' ')}?`;
      if (!window.confirm(confirmMsg)) return;

      setProcessing(true);
      try {
        const res = await authFetch('/api/wallet/spend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: val,
            serviceName: `Platform Service: ${serviceType.replace(/_/g, ' ')}`,
            serviceKey: serviceType
          })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Failed to purchase service');
        }
        onUpdateCurrentUser?.({ deposits: data.newBalance });
        alert('Service purchased successfully!');
        setActiveSection('MENU');
      } catch (err: any) {
        alert("Error purchasing service: " + err.message);
      } finally {
        setProcessing(false);
      }
    };

    return (
      <div className="animate-fade-in-right space-y-6">
        <SubViewHeader title="Platform Services & Utilities" onBack={() => setActiveSection('MENU')} />

        {/* Current Wallet Balance Header Card */}
        <div className="bg-gradient-to-r from-slate-900 to-gray-800 text-white rounded-3xl p-5 shadow-xl flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-400 font-bold">Your Available Wallet Balance</p>
            <p className="text-2xl font-black text-emerald-400 mt-1">₹{userWalletBalance.toLocaleString()}</p>
          </div>
          <button 
            type="button"
            onClick={() => onNavigate('wallet')}
            className="px-3.5 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-xs font-bold text-white transition-all flex items-center gap-1.5"
          >
            <span>🪙</span>
            <span>Manage Wallet</span>
          </button>
        </div>

        {/* FEATURED UTILITY CARD: View Stock Insights */}
        <div className={`p-6 rounded-3xl border transition-all ${
          isStockUnlocked 
            ? 'bg-emerald-50/80 border-emerald-300 dark:bg-emerald-950/20 dark:border-emerald-800' 
            : 'bg-gradient-to-br from-amber-50 via-white to-orange-50 border-amber-300/80 shadow-lg shadow-amber-500/10'
        }`}>
          <div className="flex items-start justify-between gap-4 mb-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 text-white flex items-center justify-center text-2xl shadow-md">
                📦
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-black text-gray-900">View Stock Insights</h3>
                  <span className="text-[10px] uppercase font-black px-2 py-0.5 rounded-full bg-amber-500 text-white tracking-wide">
                    Utility
                  </span>
                </div>
                <p className="text-xs font-semibold text-gray-500">Search & lookup vehicles by 8-9 digit unique stock numbers</p>
              </div>
            </div>
            <div className="text-right shrink-0">
              <span className="text-xl font-black text-gray-900">₹1,999</span>
              <p className="text-[10px] text-gray-400 font-medium">One-time Wallet deduction</p>
            </div>
          </div>

          <p className="text-xs text-gray-600 leading-relaxed mb-4">
            Activate the official Stock Dossier utility to browse verified auction warehouse stock, search by 8-9 digit unique stock numbers, check reserve benchmarks, and evaluate vehicle inventory records. Paying for this utility automatically unlocks the <strong>📦 Stock</strong> option directly in your persistent bottom navigation bar.
          </p>

          <div className="bg-white/80 dark:bg-slate-900/80 rounded-2xl p-3 border border-amber-200/60 mb-4 flex items-center justify-between text-xs font-semibold">
            <span className="text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
              <span>📱</span>
              <span>Bottom Navigation Stock Tab:</span>
            </span>
            {isStockUnlocked ? (
              <span className="inline-flex items-center gap-1 text-emerald-600 font-bold bg-emerald-100 px-2.5 py-1 rounded-full text-[11px]">
                <span>✓</span> Active & Unlocked
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-amber-800 font-bold bg-amber-100 px-2.5 py-1 rounded-full text-[11px]">
                <span>🔒</span> Locked (Requires ₹1,999)
              </span>
            )}
          </div>

          {isStockUnlocked ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onNavigate('stock')}
                className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all flex items-center justify-center gap-2 text-sm"
              >
                <span>📦</span>
                <span>Open Stock Inventory & Search by Stock Number</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={processing}
              onClick={handleUnlockStockInsights}
              className={`w-full py-3.5 px-4 rounded-xl font-bold text-white shadow-lg transition-all flex items-center justify-center gap-2 text-sm ${
                userWalletBalance >= 1999
                  ? 'bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 shadow-orange-500/25 cursor-pointer'
                  : 'bg-gradient-to-r from-gray-700 to-gray-800 hover:from-gray-800 hover:to-gray-900 shadow-gray-500/20'
              }`}
            >
              {processing ? (
                <span>Activating Stock Insights...</span>
              ) : userWalletBalance >= 1999 ? (
                <>
                  <span>⚡ Pay ₹1,999 from Wallet & Add Stock to Bottom Nav</span>
                </>
              ) : (
                <>
                  <span>Deposit Funds in Wallet to Unlock (₹{userWalletBalance.toLocaleString()} / ₹1,999)</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* OTHER PLATFORM SERVICES FORM */}
        <div className="glass-panel p-6 rounded-[2rem] space-y-5">
          <div>
             <h3 className="text-base font-bold text-gray-900 mb-1">Additional Platform Services</h3>
             <p className="text-xs text-gray-600">Select any platform service to boost listings or pay sales commissions. Deductions are processed directly from your AutoBid wallet.</p>
          </div>
          
          <div className="space-y-3">
             <label className="block text-xs font-bold uppercase tracking-wider text-gray-600">Choose Service</label>
             <select 
               value={serviceType} 
               onChange={(e) => handleServiceSelect(e.target.value as any)} 
               className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500 text-sm bg-white"
             >
                <option value="view_stock_insights">View Stock Insights (₹1,999 — Unlocks Bottom Nav)</option>
                <option value="boost_auction">Boost Vehicle Auction (₹500)</option>
                <option value="boost_bidding">Boost Bidding on Homepage (₹350)</option>
                <option value="sales_commission">Pay Sales Commission (Custom amount)</option>
             </select>
          </div>

          <div className="space-y-3">
             <label className="block text-xs font-bold uppercase tracking-wider text-gray-600">Cost / Amount (₹)</label>
             <input 
               type="number" 
               value={amount} 
               readOnly={serviceType === 'view_stock_insights'}
               onChange={(e) => setAmount(e.target.value)} 
               className={`w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500 text-sm ${
                 serviceType === 'view_stock_insights' ? 'bg-gray-100 font-bold text-gray-700 cursor-not-allowed' : 'bg-white'
               }`} 
               placeholder="Enter amount..." 
             />
          </div>

          <button 
            type="button"
            disabled={processing}
            onClick={handlePayGeneric} 
            className="w-full py-3.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold rounded-xl shadow-md transition-all text-sm"
          >
            {processing ? 'Processing...' : `Pay ₹${amount || 0} from Wallet`}
          </button>
        </div>
      </div>
    );
  };

  const PromotionsView = () => {
    const [amount, setAmount] = useState('2000');
    const [description, setDescription] = useState('');
    
    const handlePay = async () => {
      if (!currentUser) {
        alert("Please sign in to collaborate or run promotional campaigns.");
        onNavigate('auth');
        return;
      }

      const val = parseInt(amount, 10);
      if (isNaN(val) || val <= 0) return alert('Invalid amount');
      if (!description.trim()) return alert('Please enter campaign description.');
      if (isAccountRestricted) return alert('Account suspended or restricted from wallet transactions.');
      if (val > (effectiveUser?.deposits ?? 0)) return alert('Insufficient funds in wallet.');
      
      const confirmMsg = `Pay ₹${val} for Promotional Collaboration from your wallet?`;
      if (!window.confirm(confirmMsg)) return;

      try {
        const res = await authFetch('/api/wallet/spend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: val,
            serviceName: `Promotional Campaign: ${description}`,
            serviceKey: 'promotion_campaign'
          })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Failed paying for promotion');
        }
        onUpdateCurrentUser?.({ deposits: data.newBalance });
        alert('Promotion campaign submitted successfully!');
        setActiveSection('MENU');
      } catch (err: any) {
        alert("Error paying for promotion: " + err.message);
      }
    };

    return (
      <div className="animate-fade-in-right">
        <SubViewHeader title="Promotions & Advertising" onBack={() => setActiveSection('MENU')} />
        <div className="glass-panel p-6 rounded-[2rem] space-y-6">
          <div>
             <h3 className="text-xl font-bold text-gray-900 mb-2">Collaborate with Us</h3>
             <p className="text-sm text-gray-600">Run ads, promotions, or collaboration campaigns on our platform. Provide details of your campaign below.</p>
          </div>
          <div className="space-y-4">
             <label className="block text-sm font-semibold text-gray-700">Campaign Details</label>
             <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500 text-sm" placeholder="e.g. Instagram promotion for a brand..." />
          </div>
          <div className="space-y-4">
             <label className="block text-sm font-semibold text-gray-700">Campaign Budget (₹)</label>
             <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500 text-sm" placeholder="Enter budget..." />
          </div>
          <button onClick={handlePay} className="w-full py-4 bg-gray-900 hover:bg-black text-white font-bold rounded-xl shadow-md">
            Pay ₹{amount || 0} from Wallet
          </button>
        </div>
      </div>
    );
  };

  const DonationsView = () => {
    const [amount, setAmount] = useState('100');
    const [isAnonymous, setIsAnonymous] = useState(false);
    
    const handlePay = async () => {
      if (!currentUser) {
        alert("Please sign in to make a donation.");
        onNavigate('auth');
        return;
      }

      const val = parseInt(amount, 10);
      if (isNaN(val) || val <= 0) return alert('Invalid amount');
      if (isAccountRestricted) return alert('Account suspended or restricted from wallet transactions.');
      if (val > (effectiveUser?.deposits ?? 0)) return alert('Insufficient funds in wallet.');
      
      const confirmMsg = `Donate ₹${val} to AutoBid Foundation?`;
      if (!window.confirm(confirmMsg)) return;

      try {
        const res = await authFetch('/api/wallet/spend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: val,
            serviceName: `Donation to AutoBid Foundation${isAnonymous ? ' (Anonymous)' : ''}`,
            serviceKey: 'foundation_donation'
          })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Failed processing donation');
        }
        onUpdateCurrentUser?.({ deposits: data.newBalance });
        alert('Thank you for your generous donation!');
        setActiveSection('MENU');
      } catch (err: any) {
        alert("Error processing donation: " + err.message);
      }
    };

    return (
      <div className="animate-fade-in-right">
        <SubViewHeader title="Make a Donation" onBack={() => setActiveSection('MENU')} />
        <div className="glass-panel p-6 rounded-[2rem] space-y-6">
          <div className="text-center">
             <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
             </div>
             <h3 className="text-xl font-bold text-gray-900 mb-2">Support AutoBid Foundation</h3>
             <p className="text-sm text-gray-600 mb-6">Your donations help us improve the community and support local charities. You can choose to remain publicly anonymous.</p>
          </div>
          
          <div className="space-y-4 bg-gray-50 p-4 rounded-xl">
             <label className="block text-sm font-semibold text-gray-700">Donation Amount (₹)</label>
             <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500 text-sm" placeholder="Enter amount..." />
          </div>

          <label className="flex items-center gap-3 p-4 border border-gray-100 rounded-xl cursor-pointer hover:bg-gray-50">
             <input type="checkbox" checked={isAnonymous} onChange={(e) => setIsAnonymous(e.target.checked)} className="w-5 h-5 text-red-600 rounded focus:ring-red-500 border-gray-300" />
             <div>
               <p className="text-sm font-bold text-gray-900">Donate Anonymously</p>
               <p className="text-xs text-gray-500">Your details will be kept private and only used for lawful compliance.</p>
             </div>
          </label>

          <button onClick={handlePay} className="w-full py-4 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl shadow-md flex items-center justify-center gap-2">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
            Donate ₹{amount || 0}
          </button>
        </div>
      </div>
    );
  };

  // --- Render ---

  const isInfoView = ['LEGAL_AGREEMENT', 'TERMS_CONDITIONS', 'PRIVACY_POLICY', 'COOKIE_POLICY', 'HELP_CENTRE', 'FAQS', 'HELP_GUIDES', 'CONTACT_US', 'INFO_HUB'].includes(activeSection);

  return (
    <div className={`mx-auto px-4 py-8 pb-32 animate-fade-in-up relative transition-all duration-300 ${isInfoView ? 'max-w-5xl' : 'max-w-2xl'}`}>
      
      {/* Confirmation Modal */}
      {showDownloadConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowDownloadConfirm(false)}></div>
          <div className="relative bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl animate-fade-in-up">
            <h3 className="text-xl font-bold text-gray-900 mb-2">{t.downloadData}</h3>
            <div className="bg-red-50 border border-red-100 p-3 rounded-lg mb-4">
              <p className="text-red-700 text-xs font-bold uppercase mb-1">Warning</p>
              <p className="text-red-600 text-sm">Contains sensitive personal info.</p>
            </div>
            <p className="text-gray-600 text-sm mb-6">Select a format to download your account history.</p>
            <div className="flex flex-col gap-3">
              <button 
                onClick={() => executeDownload('json')}
                className="w-full py-3 rounded-xl border-2 border-gray-100 hover:border-red-100 hover:bg-red-50 text-gray-800 font-bold transition-all flex items-center justify-center gap-2"
              >
                Download JSON
              </button>
              <button 
                onClick={() => executeDownload('html')}
                className="w-full py-3 rounded-xl border-2 border-gray-100 hover:border-red-100 hover:bg-red-50 text-gray-800 font-bold transition-all flex items-center justify-center gap-2"
              >
                Download HTML
              </button>
               <button 
                onClick={() => setShowDownloadConfirm(false)}
                className="w-full py-2 text-gray-400 font-medium hover:text-gray-600 mt-2"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {isAccountRestricted && (
        <div className="mb-4 p-4 rounded-2xl bg-red-50 border border-red-200 text-red-900 flex items-start gap-3">
          <span className="text-xl">⛔</span>
          <div className="text-xs leading-relaxed">
            <p className="font-black uppercase text-red-800">Account Suspended or Restricted</p>
            <p className="mt-0.5 text-red-700">
              Status: <strong>{effectiveUser?.isDeleted ? 'Deleted' : effectiveUser?.isRevoked ? 'Revoked' : effectiveUser?.suspensionStatus}</strong>.
              Financial utilities and account modifications are locked.
            </p>
          </div>
        </div>
      )}

      {/* Render Main Menu or Sub-View */}
      {activeSection === 'MENU' ? (
        <SettingsMenu 
           t={t}
           currentUser={effectiveUser}
           currentLanguage={currentLanguage}
           isPrivate={isPrivate}
           setIsPrivate={setIsPrivate}
           setActiveSection={setActiveSection}
           onNavigate={onNavigate}
           onLogout={onLogout}
           setShowDownloadConfirm={setShowDownloadConfirm}
        />
      ) : (
         <>
            {activeSection === 'EDIT_PROFILE' && <EditProfileView />}
            {activeSection === 'WALLET' && <WalletView currentUser={effectiveUser} onNavigate={onNavigate} onUpdateCurrentUser={onUpdateCurrentUser} />}
            {activeSection === 'BLOCKED_USERS' && <BlockedUsersView />}
            {activeSection === 'LANGUAGES' && <LanguageView />}
            {activeSection === 'VERIFY' && <VerifyView />}
            {activeSection === 'AI_ASSISTANT' && <AIAssistantView />}
            {activeSection === 'RAISE_TICKET' && <RaiseTicketView />}
            {activeSection === 'VIEW_TICKETS' && <ViewTicketsView />}
            {activeSection === 'CONTACT_SUPPORT' && <ContactSupportView />}
            {activeSection === 'CHANGE_PASSWORD' && <ChangePasswordView />}
            {activeSection === 'DEVICES' && <DevicesView />}
            {activeSection === 'PLATFORM_SERVICES' && <PlatformServicesView />}
            {activeSection === 'PROMOTIONS' && <PromotionsView />}
            {activeSection === 'DONATE' && <DonationsView />}

            {/* Legal Agreement, Privacy, Help & Support Hub */}
            {isInfoView && (
              <div className="w-full">
                <SubViewHeader 
                  title={
                    activeSection === 'LEGAL_AGREEMENT' || activeSection === 'TERMS_CONDITIONS' ? 'Legal Agreement & Terms of Service' :
                    activeSection === 'PRIVACY_POLICY' ? 'Privacy Policy & Data Security' :
                    activeSection === 'COOKIE_POLICY' ? 'Cookie Policy & Auto-Recovery' :
                    activeSection === 'HELP_CENTRE' ? 'AutoBid Help Centre' :
                    activeSection === 'FAQS' ? "Frequently Asked Questions (FAQ's)" :
                    activeSection === 'HELP_GUIDES' ? 'Help & Bidding Guides' :
                    activeSection === 'CONTACT_US' ? 'Contact AutoBid Support' :
                    'Customer Support & Legal Hub'
                  }
                  onBack={() => setActiveSection('MENU')}
                />
                <HomeInfoPages
                  currentUser={currentUser}
                  activeSection={
                    activeSection === 'LEGAL_AGREEMENT' || activeSection === 'TERMS_CONDITIONS' ? 'terms' :
                    activeSection === 'PRIVACY_POLICY' ? 'privacy' :
                    activeSection === 'COOKIE_POLICY' ? 'cookies' :
                    activeSection === 'HELP_CENTRE' ? 'help_center' :
                    activeSection === 'FAQS' ? 'faq' :
                    activeSection === 'HELP_GUIDES' ? 'help' :
                    activeSection === 'CONTACT_US' ? 'contact' :
                    (initialInfoTab || 'terms')
                  }
                  onNavigate={onNavigate}
                  onOpenVerification={() => setActiveSection('VERIFY')}
                  onJoinAuction={onJoinAuction}
                  onTodaysAuctions={onTodaysAuctions}
                  onAuctionCalendar={onAuctionCalendar}
                  embeddedInSettings={true}
                  onBackToMenu={() => setActiveSection('MENU')}
                />
              </div>
            )}
         </>
      )}

    </div>
  );
};