import React, { useState, useRef, useEffect } from 'react';
import {
  Gavel,
  Search,
  PlusCircle,
  Package,
  Wallet,
  MessageSquare,
  User as UserIcon,
  Settings as SettingsIcon,
  HelpCircle,
  ShieldCheck,
  LayoutDashboard,
  LogOut,
  ChevronDown,
} from 'lucide-react';
import { User } from '../types';
import { TRANSLATIONS } from '../constants';

interface NavbarProps {
  onNavigate: (page: string) => void;
  activePage: string;
  currentUser?: User;
  currentLanguage?: string;
  onOpenVerification?: () => void;
  onLogout?: () => void;
  unreadChatCount?: number;
  hasStockAccess?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  onNavigate,
  activePage,
  currentUser,
  currentLanguage = 'English (US)',
  onOpenVerification,
  onLogout,
  unreadChatCount = 0,
  hasStockAccess,
}) => {
  const t = TRANSLATIONS[currentLanguage] || TRANSLATIONS['English (US)'];
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const showStock = Boolean(
    hasStockAccess ??
      (currentUser?.role === 'admin' ||
        currentUser?.hasStockInsightsAccess ||
        (currentUser &&
          typeof window !== 'undefined' &&
          localStorage.getItem('hasStockInsightsAccess_' + currentUser.id) === 'true'))
  );

  const isStaff = Boolean(
    currentUser &&
      ['admin', 'finance', 'accountant', 'support', 'employee'].includes(currentUser.role)
  );

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setProfileMenuOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, []);

  const navLinkClass = (isActive: boolean) =>
    `relative inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-red-600 ${
      isActive
        ? 'bg-slate-100 text-slate-900 font-semibold'
        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
    }`;

  return (
    <>
      {/* Compact Mobile Header (keeps Profile & Wallet instantly reachable alongside BottomNav) */}
      <header className="md:hidden sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/80 h-14 px-4 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => onNavigate('home')}
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-red-600 rounded-lg px-1"
        >
          Auto<span className="text-red-600">Bid</span>
        </button>

        <div className="flex items-center gap-2 shrink-0">
          {currentUser ? (
            <>
              <button
                type="button"
                onClick={() => onNavigate('wallet')}
                className="min-h-[36px] px-2.5 py-1 rounded-xl bg-slate-100 hover:bg-slate-200/80 text-slate-900 text-xs font-semibold tabular-nums inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Wallet className="w-3.5 h-3.5 text-slate-600" />
                <span>₹{(currentUser.deposits || 0).toLocaleString()}</span>
              </button>

              <button
                type="button"
                onClick={() => onNavigate('profile')}
                aria-label="Open Profile"
                className={`min-h-[40px] min-w-[40px] p-1 rounded-xl border flex items-center justify-center transition-colors cursor-pointer ${
                  activePage === 'profile'
                    ? 'border-red-600 bg-red-50'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                {currentUser.avatarUrl ? (
                  <img
                    src={currentUser.avatarUrl}
                    alt={currentUser.username || 'Profile'}
                    referrerPolicy="no-referrer"
                    className="w-7 h-7 rounded-full object-cover"
                  />
                ) : (
                  <UserIcon className="w-4 h-4 text-slate-700" />
                )}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => onNavigate('auth')}
              className="px-3.5 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Sign In
            </button>
          )}
        </div>
      </header>

      {/* Desktop Top Navigation Bar */}
      <header className="hidden md:block sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/80">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Brand Wordmark */}
          <button
            type="button"
            onClick={() => onNavigate('home')}
            className="text-xl font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-red-600 rounded-lg px-1"
          >
            Auto<span className="text-red-600">Bid</span>
          </button>

          {/* Zone 2: Concise Single-Line Navigation Links */}
          <nav aria-label="Primary Navigation" className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onNavigate('home')}
              className={navLinkClass(activePage === 'home' || activePage === 'detail')}
            >
              <Gavel className="w-4 h-4" />
              <span>{t.auctions || 'Auctions'}</span>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('search')}
              className={navLinkClass(activePage === 'search')}
            >
              <Search className="w-4 h-4" />
              <span>Search</span>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('sell')}
              className={navLinkClass(activePage === 'sell')}
            >
              <PlusCircle className="w-4 h-4" />
              <span>Sell Vehicle</span>
            </button>

            {showStock && (
              <button
                type="button"
                onClick={() => onNavigate('stock')}
                className={navLinkClass(activePage === 'stock')}
              >
                <Package className="w-4 h-4" />
                <span>Stock</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => onNavigate('wallet')}
              className={navLinkClass(activePage === 'wallet')}
            >
              <Wallet className="w-4 h-4" />
              <span>Wallet</span>
              {currentUser && (
                <span className="text-xs font-semibold text-slate-500 tabular-nums ml-0.5">
                  ₹{(currentUser.deposits || 0).toLocaleString()}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => onNavigate('chat')}
              className={navLinkClass(activePage === 'chat')}
            >
              <MessageSquare className="w-4 h-4" />
              <span>Chat</span>
              {unreadChatCount > 0 && (
                <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-red-600 text-white text-[11px] font-semibold leading-none tabular-nums">
                  {unreadChatCount > 99 ? '99+' : unreadChatCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => onNavigate('settings')}
              className={navLinkClass(activePage === 'settings')}
            >
              <SettingsIcon className="w-4 h-4" />
              <span>Settings</span>
            </button>
          </nav>

          {/* Zone 3: Primary Account / Sign In Action */}
          <div className="flex items-center gap-3 shrink-0" ref={menuRef}>
            {currentUser ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setProfileMenuOpen((prev) => !prev)}
                  aria-expanded={profileMenuOpen}
                  aria-haspopup="menu"
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border text-sm font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-red-600 ${
                    activePage === 'profile' ||
                    activePage === 'support' ||
                    activePage === 'admin' ||
                    profileMenuOpen
                      ? 'bg-slate-100 border-slate-300 text-slate-900'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <img
                    src={
                      currentUser.avatarUrl ||
                      `https://i.pravatar.cc/150?u=${currentUser.id}`
                    }
                    alt={currentUser.username || 'Profile'}
                    referrerPolicy="no-referrer"
                    className="w-6 h-6 rounded-full object-cover border border-slate-200"
                  />
                  <span className="max-w-[110px] truncate">{t.profile || 'Profile'}</span>
                  <ChevronDown className="w-4 h-4 text-slate-500" />
                </button>

                {profileMenuOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 mt-2 w-56 bg-white border border-slate-200 rounded-2xl shadow-lg py-1.5 z-50"
                  >
                    <div className="px-3.5 py-2.5 border-b border-slate-100">
                      <p className="text-sm font-semibold text-slate-900 truncate">
                        {currentUser.fullName || currentUser.username}
                      </p>
                      <p className="text-xs text-slate-500 truncate">
                        @{currentUser.username}
                      </p>
                    </div>

                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setProfileMenuOpen(false);
                        onNavigate('profile');
                      }}
                      className="w-full px-3.5 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900 flex items-center gap-2.5 cursor-pointer"
                    >
                      <UserIcon className="w-4 h-4 text-slate-500" />
                      <span>View Profile</span>
                    </button>

                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setProfileMenuOpen(false);
                        onNavigate('settings');
                      }}
                      className="w-full px-3.5 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900 flex items-center gap-2.5 cursor-pointer"
                    >
                      <SettingsIcon className="w-4 h-4 text-slate-500" />
                      <span>Settings</span>
                    </button>

                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setProfileMenuOpen(false);
                        onNavigate('support');
                      }}
                      className="w-full px-3.5 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900 flex items-center gap-2.5 cursor-pointer"
                    >
                      <HelpCircle className="w-4 h-4 text-slate-500" />
                      <span>Help & Support</span>
                    </button>

                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setProfileMenuOpen(false);
                        if (onOpenVerification) onOpenVerification();
                        else onNavigate('settings');
                      }}
                      className="w-full px-3.5 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900 flex items-center justify-between cursor-pointer"
                    >
                      <span className="flex items-center gap-2.5">
                        <ShieldCheck
                          className={`w-4 h-4 ${
                            currentUser.isVerified ? 'text-emerald-600' : 'text-slate-500'
                          }`}
                        />
                        <span>Identity Verification</span>
                      </span>
                      <span
                        className={`text-xs font-medium ${
                          currentUser.isVerified ? 'text-emerald-700' : 'text-slate-500'
                        }`}
                      >
                        {currentUser.isVerified ? 'Verified' : 'Pending'}
                      </span>
                    </button>

                    {isStaff && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setProfileMenuOpen(false);
                          onNavigate('admin');
                        }}
                        className="w-full px-3.5 py-2 text-left text-sm font-medium text-slate-900 hover:bg-slate-50 flex items-center gap-2.5 border-t border-slate-100 mt-1 pt-2 cursor-pointer"
                      >
                        <LayoutDashboard className="w-4 h-4 text-slate-600" />
                        <span>Admin Panel</span>
                      </button>
                    )}

                    {onLogout && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setProfileMenuOpen(false);
                          onLogout();
                        }}
                        className="w-full px-3.5 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2.5 border-t border-slate-100 mt-1 pt-2 cursor-pointer"
                      >
                        <LogOut className="w-4 h-4" />
                        <span>Sign Out</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate('auth')}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Sign In
              </button>
            )}
          </div>
        </div>
      </header>
    </>
  );
};