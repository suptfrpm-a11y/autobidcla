import React, { useState, useEffect, useMemo } from 'react';
import { db, doc, onSnapshot, updateDoc, getDoc, setDoc, addDoc, collection, query, where } from '../firebase';
import { User } from '../types';
import { saveWorkflowDraft, getWorkflowDraft, clearWorkflowDraft } from '../utils/cookieManager';
import { TransactionReceiptModal } from './TransactionReceiptModal';
import { enrichTransaction, getPaymentMethodInfo } from '../utils/transactionHelper';
import { authFetch } from '../utils/apiClient';
import {
  DEPOSIT_PROVIDERS,
  DEFAULT_DEPOSIT_PROVIDER_ID,
  getDepositProvider
} from '../utils/depositProviders';

interface WalletViewProps {
  currentUser?: User | null;
  onNavigate: (view: string) => void;
  onUpdateCurrentUser?: (updated: Partial<User>) => void;
}

export const WalletView: React.FC<WalletViewProps> = ({ currentUser, onNavigate, onUpdateCurrentUser }) => {
  // Real-time Firestore state
  const [liveUser, setLiveUser] = useState<User | null>(currentUser || null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [ctAccountBalance, setCtAccountBalance] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedTxReceipt, setSelectedTxReceipt] = useState<any | null>(null);

  // Active section inside WalletView: 'deposit' | 'spend' | 'history'
  const [activeTab, setActiveTab] = useState<'deposit' | 'spend' | 'history'>('deposit');
  const [isSpending, setIsSpending] = useState(false);
  const [customSpendAmount, setCustomSpendAmount] = useState<string>('500');
  const [customSpendReason, setCustomSpendReason] = useState<string>('Vehicle Pre-Purchase Inspection');
  
  // Deposit form state
  const [selectedDepositProviderId, setSelectedDepositProviderId] = useState<string>(DEFAULT_DEPOSIT_PROVIDER_ID);
  const [depositAmount, setDepositAmount] = useState<string>('2500');
  const [isDepositing, setIsDepositing] = useState(false);
  const [depositProgressLabel, setDepositProgressLabel] = useState<string>('');
  const [depositFeedback, setDepositFeedback] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  const activeDepositProvider = useMemo(
    () => getDepositProvider(selectedDepositProviderId),
    [selectedDepositProviderId]
  );

  // Sync state if currentUser changes
  useEffect(() => {
    if (currentUser) {
      setLiveUser(currentUser);
    }
  }, [currentUser]);

  // In-app Confirmation Modal for Wallet Payments (iframe-safe, replaces window.confirm)
  const [confirmPaymentModal, setConfirmPaymentModal] = useState<{
    isOpen: boolean;
    serviceId: string;
    title: string;
    price: number;
    description?: string;
  } | null>(null);

  // In-app toast notification (iframe-safe)
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  // Auto-restore wallet draft from cookies / storage on mount
  useEffect(() => {
    const draft = getWorkflowDraft<any>('wallet_transaction');
    if (draft && draft.data) {
      if (draft.data.activeTab && ['deposit', 'spend', 'history'].includes(draft.data.activeTab)) {
        setActiveTab(draft.data.activeTab);
      }
      if (draft.data.depositAmount) setDepositAmount(draft.data.depositAmount);
    }
  }, []);

  // Continuous auto-save of wallet form state
  useEffect(() => {
    const hasData = Boolean(depositAmount || activeTab !== 'deposit');
    if (!hasData) return;

    saveWorkflowDraft('wallet_transaction', 1, {
      activeTab,
      depositAmount
    });
  }, [activeTab, depositAmount]);

  const showToast = (type: 'success' | 'error' | 'info', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 6000);
  };

  // 1. Subscribe to Public User + Private Wallet/PII document in Firestore
  useEffect(() => {
    if (!currentUser?.id) return;
    let publicData: Record<string, any> = {};
    let privateData: Record<string, any> = {};
    const mergeLive = () => {
      setLiveUser({ ...currentUser, ...publicData, ...privateData, id: currentUser.id } as User);
      setIsLoading(false);
    };

    const unsubscribeUser = onSnapshot(doc(db, 'users', currentUser.id), (snap) => {
      if (snap.exists()) {
        publicData = snap.data() || {};
        mergeLive();
      } else {
        setIsLoading(false);
      }
    }, (err) => {
      console.error('Error fetching user wallet from Firestore:', err);
      setIsLoading(false);
    });

    const unsubscribePrivate = onSnapshot(doc(db, 'user_private', currentUser.id), (snap) => {
      if (snap.exists()) {
        privateData = snap.data() || {};
      } else {
        privateData = {};
      }
      mergeLive();
    }, (err) => {
      console.warn('Error fetching user_private wallet slice:', err);
    });

    return () => {
      unsubscribeUser();
      unsubscribePrivate();
    };
  }, [currentUser?.id]);

  // 2. Subscribe to CT Account balance in Firestore (Staff/Finance/Admin only)
  useEffect(() => {
    if (!currentUser || !['admin', 'finance', 'accountant'].includes(currentUser.role || '')) {
      return;
    }
    const ctRef = doc(db, 'settings', 'company_wallet');
    const unsubscribeCT = onSnapshot(ctRef, (snap) => {
      if (snap.exists()) {
        setCtAccountBalance(snap.data().balance || 0);
      }
    }, (err) => console.warn('CT balance listener notice:', err));

    return () => unsubscribeCT();
  }, [currentUser?.role]);

  // 3. Subscribe to User's Transactions in Firestore
  useEffect(() => {
    if (!currentUser?.id) return;
    const txQuery = query(collection(db, 'transactions'), where('userId', '==', currentUser.id));
    const unsubscribeTx = onSnapshot(txQuery, (snap) => {
      const txs: any[] = [];
      snap.forEach(d => txs.push({ id: d.id, ...d.data() }));
      txs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      setTransactions(txs);
    }, (err) => console.error('Transactions query error:', err));

    return () => unsubscribeTx();
  }, [currentUser?.id]);

  // Derived financial stats & private restriction flags (from user_private + users)
  const effectiveWalletUser = liveUser || currentUser;
  const virtualBalance = effectiveWalletUser?.deposits ?? 0;
  const isSuspendedOrRestricted = Boolean(
    effectiveWalletUser && (
      effectiveWalletUser.isDeleted ||
      effectiveWalletUser.isRevoked ||
      effectiveWalletUser.suspensionStatus === 'permanent' ||
      (
        effectiveWalletUser.suspensionStatus === 'temporary' &&
        (!effectiveWalletUser.suspensionUntil || Number(effectiveWalletUser.suspensionUntil) > Date.now())
      )
    )
  );

  const totalDeposited = useMemo(() => {
    return transactions
      .filter(tx => tx.type && (tx.type.includes('deposit') || tx.channel === 'ct_account'))
      .reduce((acc, tx) => acc + (tx.amount || 0), 0);
  }, [transactions]);

  const totalSpentPlatform = useMemo(() => {
    return transactions
      .filter(tx => tx.channel === 'ct_collection' || (tx.type && (tx.type.includes('service') || tx.type.includes('campaign') || tx.type.includes('fee'))))
      .reduce((acc, tx) => acc + (tx.amount || 0), 0);
  }, [transactions]);

  const isStockUnlocked = useMemo(() => {
    return Boolean(
      liveUser?.role === 'admin' ||
      liveUser?.hasStockInsightsAccess ||
      (currentUser && typeof window !== 'undefined' && localStorage.getItem('hasStockInsightsAccess_' + currentUser.id) === 'true')
    );
  }, [liveUser?.role, liveUser?.hasStockInsightsAccess, currentUser]);

  // ----------------------------------------------------
  // DEPOSIT HANDLER (Modular Provider Layer -> CT Treasury)
  // ----------------------------------------------------
  const handleInitiateDeposit = async () => {
    if (!currentUser) {
      showToast('error', 'Please sign in to deposit funds.');
      onNavigate('auth');
      return;
    }
    if (isSuspendedOrRestricted) {
      const msg = 'Your account is suspended, deleted, or revoked. Wallet deposits are blocked.';
      setDepositFeedback({ type: 'error', message: msg });
      showToast('error', msg);
      return;
    }

    const trimmed = depositAmount.trim();
    const parsed = Number(trimmed);
    const { minAmountInr, maxAmountInr } = activeDepositProvider;

    if (!trimmed || !Number.isInteger(parsed) || parsed < minAmountInr || parsed > maxAmountInr) {
      const msg = `Please enter a whole INR deposit amount between ₹${minAmountInr.toLocaleString()} and ₹${maxAmountInr.toLocaleString()}.`;
      setDepositFeedback({ type: 'error', message: msg });
      showToast('error', msg);
      return;
    }

    setIsDepositing(true);
    setDepositFeedback(null);
    setDepositProgressLabel('Starting payment...');
    try {
      const result = await activeDepositProvider.initiateDeposit({
        amountInr: parsed,
        user: {
          id: currentUser.id,
          name: effectiveWalletUser?.fullName || currentUser.fullName || currentUser.username,
          email: effectiveWalletUser?.email || currentUser.email,
          phone: effectiveWalletUser?.phoneNumber || currentUser.phoneNumber,
          username: effectiveWalletUser?.username || currentUser.username
        },
        onStatusChange: (statusMsg) => setDepositProgressLabel(statusMsg)
      });

      if (result.cancelled) {
        setDepositFeedback({ type: 'info', message: result.message });
        showToast('info', result.message);
        return;
      }

      if (!result.success) {
        setDepositFeedback({ type: 'error', message: result.message });
        showToast('error', result.message);
        return;
      }

      if (typeof result.newBalance === 'number') {
        setLiveUser((prev) => (prev ? { ...prev, deposits: result.newBalance } : null));
        onUpdateCurrentUser?.({ deposits: result.newBalance });
      }
      setDepositFeedback({ type: 'success', message: result.message });
      showToast('success', result.message);
      clearWorkflowDraft('wallet_transaction');
    } catch (err: any) {
      console.error('Deposit error:', err);
      const errMsg = err?.message || 'Deposit failed. Please try again.';
      setDepositFeedback({ type: 'error', message: errMsg });
      showToast('error', errMsg);
    } finally {
      setIsDepositing(false);
      setDepositProgressLabel('');
    }
  };

  // ----------------------------------------------------
  // SPEND HANDLER (Linked to CT Collection / CT Collector via server transaction)
  // ----------------------------------------------------
  const handleSpendVirtualCurrency = async (amount: number, serviceName: string, serviceKey: string) => {
    if (!currentUser) {
      showToast('error', 'Please sign in to access platform services.');
      onNavigate('auth');
      return;
    }
    if (isSuspendedOrRestricted) {
      showToast('error', 'Your account is suspended, deleted, or revoked. Wallet spending is blocked.');
      return;
    }

    if (isNaN(amount) || amount <= 0) {
      showToast('error', 'Please enter a valid spend amount.');
      return;
    }
    if (amount > virtualBalance) {
      showToast('error', `Insufficient wallet balance. Available balance: ₹${virtualBalance.toLocaleString()}`);
      return;
    }

    setIsSpending(true);
    try {
      const res = await authFetch('/api/wallet/spend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, serviceName, serviceKey })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to process service spend.');
      }

      const newBal = typeof data.newBalance === 'number' ? data.newBalance : (virtualBalance - amount);
      if (serviceKey === 'stock_insights') {
        if (typeof window !== 'undefined') {
          localStorage.setItem('hasStockInsightsAccess_' + currentUser.id, 'true');
        }
        setLiveUser(prev => prev ? {
          ...prev,
          deposits: newBal,
          hasStockInsightsAccess: true,
          stockInsightsUnlockedAt: Date.now()
        } : null);
        if (onUpdateCurrentUser) {
          onUpdateCurrentUser({
            deposits: newBal,
            hasStockInsightsAccess: true,
            stockInsightsUnlockedAt: Date.now()
          });
        }
        showToast('success', '🎉 "View Stock Insights" utility successfully activated! 📦 Stock is now in your bottom navigation.');
        setTimeout(() => {
          onNavigate('stock');
        }, 800);
      } else {
        setLiveUser(prev => prev ? { ...prev, deposits: newBal } : null);
        if (onUpdateCurrentUser) {
          onUpdateCurrentUser({ deposits: newBal });
        }
        showToast('success', `🎉 Payment of ₹${amount.toLocaleString()} for "${serviceName}" successful!`);
      }
    } catch (err: any) {
      console.error('Spend error:', err);
      showToast('error', `Failed to process payment: ${err.message}`);
    } finally {
      setIsSpending(false);
    }
  };

  const handleUnlockStockInsights = () => {
    if (!currentUser) {
      showToast('error', 'Please sign in to unlock platform utilities.');
      onNavigate('auth');
      return;
    }

    if (isStockUnlocked) {
      onNavigate('stock');
      return;
    }

    const cost = 1999;
    if (virtualBalance < cost) {
      showToast('error', `Insufficient wallet balance. You have ₹${virtualBalance.toLocaleString()}, but "View Stock Insights" requires ₹${cost.toLocaleString()} from your wallet.`);
      setActiveTab('deposit');
      return;
    }

    // In-app confirmation modal (100% reliable inside iframes, no window.confirm)
    setConfirmPaymentModal({
      isOpen: true,
      serviceId: 'stock_insights',
      title: 'View Stock Insights (Add Stock Tab)',
      price: cost,
      description: 'Unlock 8-9 digit stock search, warehouse yard dossiers, and permanently add the 📦 Stock tab to your bottom navigation bar.'
    });
  };

  if (!currentUser) {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center animate-fade-in-up">
        <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-3xl flex items-center justify-center text-4xl mx-auto mb-5 shadow-lg">
          🪙
        </div>
        <h2 className="text-2xl font-black text-gray-900 mb-2">Sign In to Access Your Wallet</h2>
        <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto leading-relaxed">
          Please sign in to manage your INR balance, deposit funds, unlock platform services, and view your complete transaction history.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center max-w-xs mx-auto">
          <button 
            type="button"
            onClick={() => onNavigate('auth')} 
            className="w-full sm:w-auto px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-md transition cursor-pointer"
          >
            Sign In / Register
          </button>
          <button 
            type="button"
            onClick={() => onNavigate('home')} 
            className="w-full sm:w-auto px-6 py-3 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold text-sm transition cursor-pointer"
          >
            Return Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-6 py-6 pb-28 animate-fadeIn space-y-6">
      {/* Toast Notification */}
      {toast && (
        <div className={`p-4 rounded-2xl flex items-center justify-between shadow-xl border transition-all animate-fadeIn ${
          toast.type === 'success' ? 'bg-emerald-900 text-emerald-100 border-emerald-700' :
          toast.type === 'error' ? 'bg-red-900 text-red-100 border-red-700' :
          'bg-gray-900 text-gray-100 border-gray-700'
        }`}>
          <div className="flex items-center gap-3">
            <span className="text-xl">{toast.type === 'success' ? '✅' : toast.type === 'error' ? '⚠️' : 'ℹ️'}</span>
            <span className="text-sm font-semibold">{toast.message}</span>
          </div>
          <button onClick={() => setToast(null)} className="text-xs text-gray-300 hover:text-white px-2 py-1 rounded">
            Dismiss
          </button>
        </div>
      )}

      {/* Suspended / Deleted / Revoked Banner from user_private */}
      {isSuspendedOrRestricted && (
        <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-900 flex items-start gap-3 shadow-xs">
          <span className="text-xl shrink-0">⛔</span>
          <div className="text-xs leading-relaxed">
            <p className="font-black uppercase tracking-wider text-red-800">
              Account Restricted — Wallet Actions Locked
            </p>
            <p className="mt-0.5 text-red-700">
              Your account is currently flagged as{' '}
              <strong>
                {effectiveWalletUser?.isDeleted
                  ? 'deleted'
                  : effectiveWalletUser?.isRevoked
                  ? 'session revoked'
                  : `${effectiveWalletUser?.suspensionStatus || 'suspended'} suspension`}
              </strong>
              . Financial deposits and wallet spending are disabled.
            </p>
          </div>
        </div>
      )}

      {/* Unified Single AutoBid Wallet Hero Card (Clean, No Duplicate Box) */}
      <div className="bg-gradient-to-br from-gray-950 via-gray-900 to-slate-900 text-white rounded-3xl p-6 sm:p-8 shadow-2xl border border-gray-800 relative overflow-hidden">
        <div className="absolute right-0 top-0 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute -left-10 -bottom-10 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl pointer-events-none"></div>

        {/* Top bar inside card with navigation & status */}
        <div className="relative z-10 flex items-center justify-between pb-4 border-b border-gray-800/80 mb-5">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => onNavigate('home')}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/10 transition-colors flex items-center gap-1.5 text-xs font-bold cursor-pointer"
              title="Return to Auctions"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              <span className="hidden sm:inline">Home</span>
            </button>
            <div className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center text-base font-black">
                👛
              </span>
              <div>
                <h1 className="text-base sm:text-lg font-black text-white tracking-tight leading-none">
                  AutoBid INR Wallet
                </h1>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  Escrow Secured • Instant Bids & Platform Services
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden sm:inline-block px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              @{liveUser?.username || currentUser?.username || 'member'}
            </span>
            <button
              type="button"
              onClick={() => onNavigate('settings')}
              className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/10 text-xs font-bold transition-colors flex items-center gap-1 cursor-pointer"
            >
              <span>⚙️</span>
              <span className="hidden sm:inline">Settings</span>
            </button>
          </div>
        </div>

        {/* Balance Display */}
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <span className="text-xs uppercase font-bold text-gray-400 tracking-wider block">
              Available Balance (INR)
            </span>
            <div className="flex items-baseline gap-2.5 mt-1">
              <span className="text-4xl sm:text-5xl font-black text-white tracking-tight">
                ₹{virtualBalance.toLocaleString()}
              </span>
              <span className="text-xs font-bold text-emerald-400 bg-emerald-950/70 px-2.5 py-0.5 rounded-lg border border-emerald-800">
                Live Funds
              </span>
            </div>
            <p className="text-xs text-gray-300 max-w-lg leading-relaxed pt-2">
              Your wallet balance is used for instant auction bids, pre-bids, and platform utilities routed to CT Collection.
            </p>
          </div>
        </div>

        {/* Financial Flow Stat Badges */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-8 pt-6 border-t border-gray-800/80">
          <div className="bg-gray-900/60 p-3.5 rounded-2xl border border-gray-800">
            <span className="text-[10px] uppercase font-bold text-emerald-400 block">Total Deposited</span>
            <span className="text-lg font-black text-white mt-0.5 block">₹{totalDeposited.toLocaleString()}</span>
            <span className="text-[10px] text-gray-400">CT Account Inflow</span>
          </div>

          <div className="bg-gray-900/60 p-3.5 rounded-2xl border border-gray-800">
            <span className="text-[10px] uppercase font-bold text-blue-400 block">Platform Payments</span>
            <span className="text-lg font-black text-white mt-0.5 block">₹{totalSpentPlatform.toLocaleString()}</span>
            <span className="text-[10px] text-gray-400">CT Collection (Services & Boosts)</span>
          </div>

          <div className="bg-gray-900/60 p-3.5 rounded-2xl border border-gray-800">
            <span className="text-[10px] uppercase font-bold text-amber-400 block">Ledger Entries</span>
            <span className="text-lg font-black text-white mt-0.5 block">{transactions.length}</span>
            <span className="text-[10px] text-gray-400">Verified Transactions</span>
          </div>
        </div>
      </div>

      {/* Main Mode Navigation Tabs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 bg-gray-100 p-1.5 rounded-2xl gap-1">
        <button
          onClick={() => setActiveTab('deposit')}
          className={`py-3 text-xs font-black rounded-xl transition-all flex items-center justify-center gap-1.5 ${
            activeTab === 'deposit'
              ? 'bg-white text-emerald-700 shadow-md ring-1 ring-emerald-200'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <span>🟢</span>
          <span>1. Deposit Funds</span>
        </button>

        <button
          onClick={() => setActiveTab('spend')}
          className={`py-3 text-xs font-black rounded-xl transition-all flex items-center justify-center gap-1.5 ${
            activeTab === 'spend'
              ? 'bg-white text-blue-700 shadow-md ring-1 ring-blue-200'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <span>🔵</span>
          <span>2. Platform Services</span>
        </button>

        <button
          onClick={() => setActiveTab('history')}
          className={`py-3 text-xs font-black rounded-xl transition-all flex items-center justify-center gap-1.5 ${
            activeTab === 'history'
              ? 'bg-white text-gray-900 shadow-md'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <span>📜</span>
          <span>3. Transaction History</span>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* SECTION 1: DEPOSIT FUNDS                                                  */}
      {/* ========================================================================= */}
      {activeTab === 'deposit' && (
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-gray-200 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-5">
            <div>
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-black text-sm">
                  ₹
                </span>
                <h2 className="text-lg font-black text-gray-900">Add Funds to Wallet</h2>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Money deposited here is credited directly into your verified AutoBid INR Wallet balance.
              </p>
            </div>
            <div className="px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center gap-1.5 self-start sm:self-auto">
              <span>Channel: AutoBid CT Treasury</span>
            </div>
          </div>

          {/* Provider Selector (auto-supports multiple deposit providers without changing WalletView) */}
          {DEPOSIT_PROVIDERS.length > 1 ? (
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-600 block">
                Select Deposit Method
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {DEPOSIT_PROVIDERS.map((provider) => {
                  const selected = provider.id === activeDepositProvider.id;
                  return (
                    <button
                      key={provider.id}
                      type="button"
                      onClick={() => setSelectedDepositProviderId(provider.id)}
                      className={`p-3.5 rounded-2xl border text-left transition-all cursor-pointer ${
                        selected
                          ? 'bg-emerald-50 border-emerald-600 ring-1 ring-emerald-500'
                          : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-black text-gray-900">{provider.name}</span>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white text-emerald-700 border border-emerald-200">
                          {provider.badgeText}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">{provider.description}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-2xl bg-emerald-50/60 border border-emerald-200 text-xs text-emerald-900 flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className="text-xl">⚡</span>
                <div>
                  <strong className="block font-black text-emerald-950 mb-0.5">
                    {activeDepositProvider.name} ({activeDepositProvider.badgeText})
                  </strong>
                  <span>{activeDepositProvider.description}</span>
                </div>
              </div>
            </div>
          )}

          {/* Inline Deposit Result Feedback */}
          {depositFeedback && (
            <div
              className={`p-4 rounded-2xl border text-xs font-semibold flex items-center justify-between gap-3 ${
                depositFeedback.type === 'success'
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                  : depositFeedback.type === 'error'
                  ? 'bg-red-50 border-red-300 text-red-900'
                  : 'bg-amber-50 border-amber-300 text-amber-900'
              }`}
            >
              <span>{depositFeedback.message}</span>
              <button
                type="button"
                onClick={() => setDepositFeedback(null)}
                className="text-[11px] font-bold underline shrink-0 cursor-pointer"
              >
                Clear
              </button>
            </div>
          )}

          {/* Quick Amount Presets */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-600 block">
              Quick Select Deposit Amount
            </label>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {['500', '1000', '2500', '5000', '10000', '25000'].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setDepositAmount(preset);
                    setDepositFeedback(null);
                  }}
                  className={`py-2.5 rounded-xl text-xs font-black transition-all border cursor-pointer ${
                    depositAmount === preset
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-md scale-102'
                      : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  ₹{parseInt(preset).toLocaleString()}
                </button>
              ))}
            </div>
          </div>

          {/* Custom Deposit Amount Input */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-600 block">
              Enter Custom Deposit Amount (Whole INR)
            </label>
            <div className="relative">
              <span className="absolute left-4 top-3.5 text-gray-400 font-bold text-lg">₹</span>
              <input
                type="number"
                min={activeDepositProvider.minAmountInr}
                max={activeDepositProvider.maxAmountInr}
                step="1"
                value={depositAmount}
                onChange={(e) => {
                  setDepositAmount(e.target.value);
                  if (depositFeedback) setDepositFeedback(null);
                }}
                placeholder="e.g. 5000"
                className="w-full pl-9 pr-4 py-3.5 rounded-2xl border-2 border-gray-200 focus:border-emerald-600 focus:outline-none text-lg font-black text-gray-900 placeholder:text-gray-300 transition-colors"
              />
            </div>
            <p className="text-[11px] text-gray-400">
              Limits: ₹{activeDepositProvider.minAmountInr.toLocaleString()} – ₹{activeDepositProvider.maxAmountInr.toLocaleString()} per deposit • {activeDepositProvider.supportedMethodsLabel}
            </p>
          </div>

          {/* Deposit Summary & Submit */}
          <div className="pt-4 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <span className="text-xs text-gray-400 block font-bold">You will receive in wallet:</span>
              <span className="text-xl font-black text-emerald-600">
                ₹{depositAmount && Number.isInteger(Number(depositAmount)) && Number(depositAmount) > 0 ? Number(depositAmount).toLocaleString() : '0'} INR
              </span>
            </div>

            <button
              type="button"
              disabled={isDepositing || !depositAmount || isSuspendedOrRestricted}
              onClick={handleInitiateDeposit}
              className="w-full sm:w-auto px-8 py-3.5 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-black text-sm shadow-xl shadow-emerald-600/25 transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
            >
              {isDepositing ? (
                <>
                  <span className="animate-spin">⏳</span>
                  <span>{depositProgressLabel || 'Processing Deposit...'}</span>
                </>
              ) : (
                <>
                  <span>🔒</span>
                  <span>Deposit Now</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SECTION 2: PLATFORM SERVICES & SPEND                                      */}
      {/* ========================================================================= */}
      {activeTab === 'spend' && (
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-gray-200 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-5">
            <div>
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-xl bg-blue-100 text-blue-800 flex items-center justify-center font-black text-sm">
                  ₹
                </span>
                <h2 className="text-lg font-black text-gray-900">Platform Services & Utilities</h2>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Purchase vehicle history reports, featured auction boosts, identity badges, and inspection services.
              </p>
            </div>
            <div className="px-3 py-1.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-xs font-bold flex items-center gap-1.5 self-start sm:self-auto">
              <span>Your Wallet Balance:</span>
              <span className="font-black text-blue-900">₹{virtualBalance.toLocaleString()}</span>
            </div>
          </div>

          {/* Educational Explainer */}
          <div className="p-4 rounded-2xl bg-blue-50/60 border border-blue-200 text-xs text-blue-900 flex items-start gap-3">
            <span className="text-xl">📊</span>
            <div>
              <strong className="block font-black text-blue-950 mb-0.5">Instant Wallet Settlement:</strong>
              Your wallet balance is deducted directly for platform services, inspection certifications, vehicle listing boosts, and auction transactions. Instant processing with zero transaction delays.
            </div>
          </div>

          {/* Predefined Platform Services Cards */}
          <div className="space-y-3">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-600 block">
              Available Platform Services & Utilities
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                {
                  id: 'stock_insights',
                  title: 'View Stock Insights (Add Stock Tab)',
                  desc: 'Search vehicles by unique 8-9 digit stock number and permanently add the 📦 Stock tab to your bottom navigation bar.',
                  price: 1999,
                  icon: '📦',
                  badge: isStockUnlocked ? 'Unlocked' : 'Utility'
                },
                {
                  id: 'vip_boost',
                  title: '24-Hour VIP Listing Booster',
                  desc: 'Places your auction vehicle at the top of the search feed with gold badge.',
                  price: 199,
                  icon: '🚀',
                  badge: 'Seller Tool'
                },
                {
                  id: 'bidder_priority',
                  title: 'Priority Bidder Fast-Pass',
                  desc: 'Priority queue for bidding in high-volume live competitive auctions.',
                  price: 299,
                  icon: '⚡',
                  badge: 'Bidder Perk'
                },
                {
                  id: 'commission_settle',
                  title: 'Sales Commission Clearance',
                  desc: 'Settle closing commission for a sold vehicle directly from virtual balance.',
                  price: 750,
                  icon: '🤝',
                  badge: 'Finance'
                },
                {
                  id: 'csr_foundation',
                  title: 'AutoBid Road Safety Donation',
                  desc: 'Contribute to our foundation for driver training and road safety initiatives.',
                  price: 100,
                  icon: '❤️',
                  badge: 'Non-Profit'
                }
              ].map((svc) => (
                <div
                  key={svc.id}
                  className="p-4 rounded-2xl border border-gray-200 bg-gray-50/60 hover:bg-white hover:border-blue-300 transition-all flex flex-col justify-between gap-3 shadow-xs"
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{svc.icon}</span>
                        <h4 className="text-sm font-bold text-gray-900">{svc.title}</h4>
                      </div>
                      <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
                        svc.id === 'stock_insights' && isStockUnlocked 
                          ? 'bg-emerald-100 text-emerald-800' 
                          : 'bg-blue-100 text-blue-800'
                      }`}>
                        {svc.badge}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 leading-relaxed">{svc.desc}</p>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-gray-200/60">
                    <div className="text-base font-black text-gray-900">
                      ₹{svc.price.toLocaleString()}
                    </div>
                    {svc.id === 'stock_insights' && isStockUnlocked ? (
                      <button
                        type="button"
                        onClick={() => onNavigate('stock')}
                        className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
                      >
                        <span>✓ Unlocked (Open 📦 Stock)</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={isSpending || virtualBalance < svc.price}
                        onClick={() => {
                          if (svc.id === 'stock_insights') {
                            handleUnlockStockInsights();
                          } else {
                            setConfirmPaymentModal({
                              isOpen: true,
                              serviceId: svc.id,
                              title: svc.title,
                              price: svc.price,
                              description: svc.desc
                            });
                          }
                        }}
                        className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-black shadow-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 cursor-pointer"
                      >
                        <span>Pay from Wallet</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Custom Platform Spend Form */}
          <div className="p-5 rounded-2xl border border-gray-200 bg-gray-50 space-y-4">
            <h4 className="text-xs font-black uppercase text-gray-700">Direct Platform Service Payment</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-bold text-gray-500 block mb-1">Purpose / Service Name</label>
                <input
                  type="text"
                  value={customSpendReason}
                  onChange={(e) => setCustomSpendReason(e.target.value)}
                  placeholder="e.g. VIP Featured Showcase"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-gray-500 block mb-1">Amount (₹ INR)</label>
                <input
                  type="number"
                  min="1"
                  max={virtualBalance}
                  value={customSpendAmount}
                  onChange={(e) => setCustomSpendAmount(e.target.value)}
                  placeholder="Amount"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <button
              type="button"
              disabled={isSpending || !customSpendAmount || parseFloat(customSpendAmount) <= 0 || parseFloat(customSpendAmount) > virtualBalance}
              onClick={() => {
                const amt = parseFloat(customSpendAmount);
                if (isNaN(amt) || amt <= 0) return;
                setConfirmPaymentModal({
                  isOpen: true,
                  serviceId: 'custom_spend',
                  title: customSpendReason || 'Platform Service Payment',
                  price: amt,
                  description: `Direct payment for ${customSpendReason || 'Platform Service'}`
                });
              }}
              className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-gray-900 hover:bg-black text-white text-xs font-black transition-all disabled:opacity-40 cursor-pointer"
            >
              Pay ₹{customSpendAmount || 0} from Wallet
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SECTION 3: TRANSACTION HISTORY                                            */}
      {/* ========================================================================= */}
      {activeTab === 'history' && (
        <div className="space-y-6">
          {/* Full Transaction History Table */}
          <div className="bg-white rounded-3xl p-6 border border-gray-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-black text-gray-900">INR Transaction History</h3>
                <p className="text-xs text-gray-500">Real-time ledger of your CT Account deposits, auction bids, and CT Collection services.</p>
              </div>
              <span className="text-xs font-bold text-gray-500">
                {transactions.length} Transactions
              </span>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-gray-100">
              <table className="w-full text-left text-xs text-gray-600">
                <thead className="bg-gray-50 text-[11px] uppercase font-black text-gray-500 border-b border-gray-100">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Transaction ID</th>
                    <th className="px-4 py-3">Mean of Payment</th>
                    <th className="px-4 py-3">Description & Order/UTR</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3 text-right">Receipt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {transactions.map((rawTx) => {
                    const tx = enrichTransaction(rawTx);
                    const methodInfo = getPaymentMethodInfo(tx.paymentMethod);
                    const isCredit = tx.type?.includes('deposit') || tx.type === 'admin_add';
                    const isFailed = tx.status === 'failed';

                    return (
                      <tr 
                        key={tx.id} 
                        onClick={() => setSelectedTxReceipt(tx)}
                        className="hover:bg-indigo-50/40 transition-colors cursor-pointer group"
                      >
                        <td className="px-4 py-3 whitespace-nowrap text-gray-400 font-mono text-[11px]">
                          {new Date(tx.timestamp).toLocaleString('en-IN', {
                            dateStyle: 'short',
                            timeStyle: 'short'
                          })}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="font-mono font-bold text-gray-900 bg-gray-100 group-hover:bg-white px-2 py-0.5 rounded border border-gray-200 text-[11px]">
                            {tx.transactionId}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black border flex items-center gap-1 w-fit ${methodInfo.badgeClass}`}>
                            <span>{methodInfo.icon}</span>
                            <span>{methodInfo.shortLabel}</span>
                          </span>
                        </td>
                        <td className="px-4 py-3 max-w-xs">
                          <div className="truncate font-medium text-gray-900">{tx.description}</div>
                          <div className="text-[10px] font-mono text-gray-400 truncate mt-0.5 flex items-center gap-2">
                            <span>Ord: {tx.gatewayOrderNumber || tx.orderId}</span>
                            {tx.utr && <span className="text-emerald-700">UTR: {tx.utr}</span>}
                          </div>
                        </td>
                        <td className={`px-4 py-3 text-right font-black text-sm whitespace-nowrap ${
                          isFailed ? 'text-gray-400 line-through' :
                          isCredit ? 'text-emerald-600' : 'text-gray-900'
                        }`}>
                          {isCredit ? `+₹${tx.amount?.toLocaleString()}` : `-₹${tx.amount?.toLocaleString()}`}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                            tx.status === 'success' ? 'bg-emerald-100 text-emerald-800' :
                            tx.status === 'pending' ? 'bg-amber-100 text-amber-800' :
                            'bg-rose-100 text-rose-800 border border-rose-200'
                          }`}>
                            {tx.status === 'failed' ? 'Failed / Exited' : tx.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedTxReceipt(tx);
                            }}
                            className="px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-[11px] font-bold transition cursor-pointer"
                          >
                            Receipt ↗
                          </button>
                        </td>
                      </tr>
                    );
                  })}

                  {transactions.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                        No transactions found in your wallet history.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Transaction Receipt & Gateway Audit Modal */}
      <TransactionReceiptModal
        transaction={selectedTxReceipt}
        isOpen={Boolean(selectedTxReceipt)}
        onClose={() => setSelectedTxReceipt(null)}
        isAdmin={currentUser?.role === 'admin'}
      />

      {/* ========================================================================= */}
      {/* IN-APP CONFIRMATION MODAL FOR WALLET PAYMENTS (CONFIRM BEFORE DEDUCTION)  */}
      {/* ========================================================================= */}
      {confirmPaymentModal && confirmPaymentModal.isOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-3xl p-6 sm:p-7 max-w-md w-full border border-gray-100 shadow-2xl space-y-4 animate-scale-up">
            <div className="flex items-center justify-between pb-2 border-b border-gray-100">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-blue-100 text-blue-700 flex items-center justify-center text-xl font-bold">
                  💳
                </div>
                <div>
                  <h3 className="text-base font-black text-gray-900">Confirm Payment</h3>
                  <p className="text-xs text-blue-600 font-semibold">AutoBid Wallet Deduction</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setConfirmPaymentModal(null)}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 flex items-center justify-center text-xs font-bold transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-4 rounded-2xl bg-blue-50/70 border border-blue-200 space-y-2 text-xs">
              <div className="flex items-start justify-between gap-2">
                <span className="text-gray-500 font-medium">Selected Service:</span>
                <span className="font-bold text-gray-900 text-right">{confirmPaymentModal.title}</span>
              </div>
              {confirmPaymentModal.description && (
                <p className="text-[11px] text-gray-600 leading-relaxed border-t border-blue-200/60 pt-2">
                  {confirmPaymentModal.description}
                </p>
              )}
            </div>

            <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200 space-y-2.5 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-gray-500 font-medium">Current Wallet Balance:</span>
                <span className="font-bold text-gray-800">₹{virtualBalance.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-700 font-bold">Cost to Pay:</span>
                <span className="font-black text-red-600">-₹{confirmPaymentModal.price.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-gray-200 text-xs">
                <span className="text-gray-600 font-semibold">Remaining Balance After:</span>
                <span className="font-black text-emerald-700">₹{Math.max(0, virtualBalance - confirmPaymentModal.price).toLocaleString()}</span>
              </div>
            </div>

            <p className="text-xs text-gray-600 text-center font-medium">
              Are you sure you want to proceed and pay <strong>₹{confirmPaymentModal.price.toLocaleString()}</strong> from your wallet?
            </p>

            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                disabled={isSpending}
                onClick={() => setConfirmPaymentModal(null)}
                className="flex-1 py-3 rounded-xl border border-gray-300 text-xs font-bold text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSpending}
                onClick={async () => {
                  const { price, title, serviceId } = confirmPaymentModal;
                  setConfirmPaymentModal(null);
                  await handleSpendVirtualCurrency(price, title, serviceId);
                }}
                className="flex-1 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-black shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                {isSpending ? (
                  <span>Processing...</span>
                ) : (
                  <>
                    <span>✓</span>
                    <span>Confirm & Pay ₹{confirmPaymentModal.price.toLocaleString()}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
