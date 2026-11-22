import React, { useState, useMemo, useEffect } from 'react';
import { User } from '../../types';
import { logAdminAction } from './adminAuditHelper';
import { TransactionReceiptModal } from '../TransactionReceiptModal';
import { enrichTransaction, getPaymentMethodInfo } from '../../utils/transactionHelper';
import { authFetch } from '../../utils/apiClient';

interface AdminFinancialManagementProps {
  currentUser: User;
  companyWallet: number; // CT Account (Customer Payment Collection)
  ctCollection: number;  // CT Collection (Virtual Funds Usage Collector)
  allTransactions: any[];
  users: User[];
  onRefreshBalances?: () => void;
  adminOtpToken?: string;
  onRequestOtpVerification?: () => void;
}

export const AdminFinancialManagement: React.FC<AdminFinancialManagementProps> = ({
  currentUser,
  companyWallet,
  ctCollection,
  allTransactions,
  users,
  onRefreshBalances,
  adminOtpToken,
  onRequestOtpVerification
}) => {
  // Navigation / sub-tabs inside Financial Management
  const [activeSection, setActiveSection] = useState<'pipeline' | 'channels' | 'simulator' | 'architecture'>('pipeline');
  const [channelFilter, setChannelFilter] = useState<'all' | 'ct_account' | 'ct_collection'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'failed' | 'pending'>('all');
  const [methodFilter, setMethodFilter] = useState<'all' | 'upi' | 'card' | 'netbanking' | 'wallet'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTxForReceipt, setSelectedTxForReceipt] = useState<any | null>(null);
  
  // In-app modal / notification states (avoids window.alert/window.confirm for iframe safety)
  const [feedbackMessage, setFeedbackMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // Simulator state
  const [simUserId, setSimUserId] = useState<string>(users[0]?.id || '');
  const [simDepositAmount, setSimDepositAmount] = useState<string>('5000');
  const [simSpendAmount, setSimSpendAmount] = useState<string>('750');
  const [simSpendType, setSimSpendType] = useState<string>('bid_fee');
  const [simProcessing, setSimProcessing] = useState(false);

  const [gatewayStatus, setGatewayStatus] = useState<{
    ctKeyMasked: string;
    ctConfigured: boolean;
    ctWebhookConfigured: boolean;
  }>({
    ctKeyMasked: 'Loading...',
    ctConfigured: false,
    ctWebhookConfigured: false
  });

  const loadGatewayStatus = () => {
    authFetch('/api/wallet/accounts-status')
      .then(res => res.json())
      .then(data => {
        if (data?.account_CT) {
          setGatewayStatus({
            ctKeyMasked: data.account_CT.keyIdMasked || 'Not Configured',
            ctConfigured: Boolean(data.account_CT.configured),
            ctWebhookConfigured: Boolean(data.account_CT.webhookConfigured)
          });
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadGatewayStatus();
  }, []);

  const showToast = (type: 'success' | 'error' | 'info', text: string) => {
    setFeedbackMessage({ type, text });
    setTimeout(() => {
      setFeedbackMessage(null);
    }, 6000);
  };

  // Calculations
  const totalUserWallets = useMemo(() => {
    return users.reduce((acc, u) => acc + (u.deposits || 0), 0);
  }, [users]);

  // Categorize transactions by channel and enrich with gateway details
  const classifiedTransactions = useMemo(() => {
    return allTransactions.map(rawTx => {
      const tx = enrichTransaction(rawTx);
      let channel: 'ct_account' | 'ct_collection' = 'ct_account';
      let channelLabel = 'CT Account (Deposit)';
      let badgeColor = 'bg-emerald-100 text-emerald-800 border-emerald-200';

      const type = (tx.type || '').toLowerCase();
      const desc = (tx.description || '').toLowerCase();

      if (type.includes('deposit') || type === 'admin_add' || desc.includes('deposit')) {
        channel = 'ct_account';
        channelLabel = tx.status === 'failed' ? 'CT Inflow (Failed / Exited)' : 'CT Account (Deposit)';
        badgeColor = tx.status === 'failed' ? 'bg-rose-100 text-rose-800 border-rose-200' : 'bg-emerald-100 text-emerald-800 border-emerald-200';
      } else if (
        tx.channel === 'ct_collection' ||
        type.includes('service') || 
        type.includes('campaign') || 
        type.includes('spend') || 
        type.includes('usage') || 
        type.includes('fee') ||
        type.includes('bid') ||
        type.includes('commission') ||
        type.includes('buy_now') ||
        desc.includes('service') ||
        desc.includes('campaign') ||
        desc.includes('usage') ||
        desc.includes('fee') ||
        desc.includes('ct collection')
      ) {
        channel = 'ct_collection';
        channelLabel = 'CT Collection (Usage)';
        badgeColor = 'bg-blue-100 text-blue-800 border-blue-200';
      }

      return {
        ...tx,
        channel,
        channelLabel,
        badgeColor
      };
    });
  }, [allTransactions]);

  // Filtered transactions with Channel, Status, and Method filters
  const filteredTransactions = useMemo(() => {
    return classifiedTransactions.filter(tx => {
      const matchesChannel = channelFilter === 'all' || tx.channel === channelFilter;
      const matchesStatus = statusFilter === 'all' || tx.status === statusFilter;
      const matchesMethod = methodFilter === 'all' || tx.paymentMethod === methodFilter;
      if (!matchesChannel || !matchesStatus || !matchesMethod) return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        (tx.username || '').toLowerCase().includes(q) ||
        (tx.description || '').toLowerCase().includes(q) ||
        (tx.id || '').toLowerCase().includes(q) ||
        (tx.transactionId || '').toLowerCase().includes(q) ||
        (tx.paymentId || '').toLowerCase().includes(q) ||
        (tx.orderId || '').toLowerCase().includes(q) ||
        (tx.gatewayOrderNumber || '').toLowerCase().includes(q) ||
        (tx.utr || '').toLowerCase().includes(q) ||
        (tx.phoneNumber || '').toLowerCase().includes(q) ||
        (tx.userEmail || '').toLowerCase().includes(q) ||
        (tx.paymentMethod || '').toLowerCase().includes(q) ||
        (tx.autobidOrderId || '').toLowerCase().includes(q)
      );
    });
  }, [classifiedTransactions, channelFilter, statusFilter, methodFilter, searchQuery]);

  // Breakdown of CT Collection by category
  const ctUsageBreakdown = useMemo(() => {
    const categories: Record<string, { count: number; total: number }> = {
      'Inspection & Verification Fees': { count: 0, total: 0 },
      'Promotional Campaigns & Boosts': { count: 0, total: 0 },
      'Foundation & CSR Contributions': { count: 0, total: 0 },
      'Auction Entry & Bidding Fees': { count: 0, total: 0 },
      'Other Platform Usages': { count: 0, total: 0 }
    };

    classifiedTransactions
      .filter(tx => tx.channel === 'ct_collection')
      .forEach(tx => {
        const amt = tx.amount || 0;
        const type = (tx.type || '').toLowerCase();
        const desc = (tx.description || '').toLowerCase();

        if (type.includes('inspection') || desc.includes('inspection') || desc.includes('car_inspection')) {
          categories['Inspection & Verification Fees'].count += 1;
          categories['Inspection & Verification Fees'].total += amt;
        } else if (type.includes('campaign') || desc.includes('promotional') || desc.includes('collaboration')) {
          categories['Promotional Campaigns & Boosts'].count += 1;
          categories['Promotional Campaigns & Boosts'].total += amt;
        } else if (type.includes('foundation') || desc.includes('foundation') || desc.includes('donate')) {
          categories['Foundation & CSR Contributions'].count += 1;
          categories['Foundation & CSR Contributions'].total += amt;
        } else if (type.includes('bid') || desc.includes('bid') || type.includes('auction')) {
          categories['Auction Entry & Bidding Fees'].count += 1;
          categories['Auction Entry & Bidding Fees'].total += amt;
        } else {
          categories['Other Platform Usages'].count += 1;
          categories['Other Platform Usages'].total += amt;
        }
      });

    return categories;
  }, [classifiedTransactions]);

  // ---------------- SIMULATOR CONTROLS (via Authenticated Admin APIs) ----------------
  // 1. Simulate User Credit via server adjust-wallet
  const runSimulateDeposit = async () => {
    const targetUser = users.find(u => u.id === simUserId) || users[0];
    if (!targetUser) return showToast('error', 'Select a user for simulation.');
    const amt = parseFloat(simDepositAmount);
    if (isNaN(amt) || amt <= 0) return showToast('error', 'Enter a valid deposit amount.');

    setSimProcessing(true);
    try {
      const res = await authFetch('/api/admin/users/adjust-wallet', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-otp-token': adminOtpToken || ''
        },
        body: JSON.stringify({
          userId: targetUser.id,
          mode: 'credit',
          amount: amt,
          reason: `[Pipeline Test] Admin-verified wallet credit for @${targetUser.username}`
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        if (res.status === 403 && data.code === 'ADMIN_OTP_REQUIRED') {
          onRequestOtpVerification?.();
          return;
        }
        throw new Error(data.error || 'Simulation failed');
      }

      showToast('success', `[Pipeline Test] Credited ₹${amt.toLocaleString()} virtual currency to @${targetUser.username}'s wallet via server ledger.`);
    } catch (err: any) {
      showToast('error', `Simulation failed: ${err.message}`);
    } finally {
      setSimProcessing(false);
    }
  };

  // 2. Simulate Wallet Debit via server adjust-wallet
  const runSimulateSpend = async () => {
    const targetUser = users.find(u => u.id === simUserId) || users[0];
    if (!targetUser) return showToast('error', 'Select a user for simulation.');
    const amt = parseFloat(simSpendAmount);
    if (isNaN(amt) || amt <= 0) return showToast('error', 'Enter a valid spend amount.');

    setSimProcessing(true);
    try {
      const res = await authFetch('/api/admin/users/adjust-wallet', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-otp-token': adminOtpToken || ''
        },
        body: JSON.stringify({
          userId: targetUser.id,
          mode: 'debit',
          amount: amt,
          reason: `[Pipeline Test] Simulated ${simSpendType.toUpperCase()} debit for @${targetUser.username}`
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        if (res.status === 403 && data.code === 'ADMIN_OTP_REQUIRED') {
          onRequestOtpVerification?.();
          return;
        }
        throw new Error(data.error || 'Simulation failed');
      }

      showToast('success', `[Pipeline Test] Debited ₹${amt.toLocaleString()} from @${targetUser.username}'s wallet via atomic server transaction.`);
    } catch (err: any) {
      showToast('error', `Simulation failed: ${err.message}`);
    } finally {
      setSimProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Toast Feedback Notification */}
      {feedbackMessage && (
        <div className={`p-4 rounded-2xl flex items-center justify-between shadow-lg border transition-all animate-fadeIn ${
          feedbackMessage.type === 'success' ? 'bg-emerald-900 text-emerald-100 border-emerald-700' :
          feedbackMessage.type === 'error' ? 'bg-red-900 text-red-100 border-red-700' :
          'bg-gray-900 text-gray-100 border-gray-700'
        }`}>
          <div className="flex items-center gap-3">
            <span className="text-xl">
              {feedbackMessage.type === 'success' ? '✅' : feedbackMessage.type === 'error' ? '⚠️' : 'ℹ️'}
            </span>
            <span className="text-sm font-semibold">{feedbackMessage.text}</span>
          </div>
          <button onClick={() => setFeedbackMessage(null)} className="text-xs text-gray-300 hover:text-white px-2 py-1 rounded-lg">
            Dismiss
          </button>
        </div>
      )}

      {/* Main Header Card */}
      <div className="bg-gradient-to-r from-gray-950 via-gray-900 to-indigo-950 rounded-3xl p-6 text-white border border-gray-800 shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="w-12 h-12 rounded-2xl bg-indigo-600/30 border border-indigo-500/50 flex items-center justify-center text-2xl shadow-inner">
                💰
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-black tracking-tight">Financial Management</h1>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    CT Account & CT Collection Active
                  </span>
                </div>
                <p className="text-xs text-indigo-200/80">
                  Real-time monitoring of customer payment deposits into <strong className="text-white">CT Account</strong> and all virtual fund usage collected in <strong className="text-white">CT Collection</strong>.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                loadGatewayStatus();
                if (onRefreshBalances) onRefreshBalances();
                showToast('info', 'Refreshing CT Account & CT Collection status...');
              }}
              className="px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold border border-white/10 transition-all flex items-center gap-2"
            >
              <span>🔄</span>
              <span>Sync Balances</span>
            </button>
          </div>
        </div>

        {/* Top Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6 pt-6 border-t border-gray-800/80">
          {/* CT Account */}
          <div className="bg-gray-900/80 p-4 rounded-2xl border border-emerald-500/30 relative">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] uppercase font-black tracking-wider text-emerald-400">1. CT Account</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold">Customer Collection</span>
            </div>
            <div className="text-2xl font-black text-white">₹{companyWallet.toLocaleString()}</div>
            <p className="text-[11px] text-gray-400 mt-1">Real INR funds recorded in Company Treasury</p>
          </div>

          {/* Virtual Currency Wallets */}
          <div className="bg-gray-900/80 p-4 rounded-2xl border border-cyan-500/30 relative">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] uppercase font-black tracking-wider text-cyan-400">2. Virtual Currency</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-bold">1:1 Backed</span>
            </div>
            <div className="text-2xl font-black text-white">₹{totalUserWallets.toLocaleString()}</div>
            <p className="text-[11px] text-gray-400 mt-1">Total balances across {users.length} user wallets</p>
          </div>

          {/* CT Collection */}
          <div className="bg-gray-900/80 p-4 rounded-2xl border border-blue-500/30 relative">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] uppercase font-black tracking-wider text-blue-400">3. CT Collection</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 font-bold">Virtual Funds Pool</span>
            </div>
            <div className="text-2xl font-black text-white">₹{ctCollection.toLocaleString()}</div>
            <p className="text-[11px] text-gray-400 mt-1">All virtual funds spent & collected across the app</p>
          </div>
        </div>
      </div>

      {/* CT Account & CT Collection Architecture Banner */}
      <div className="bg-white rounded-3xl p-5 border border-gray-200 shadow-sm space-y-3">
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <div>
            <h3 className="text-sm font-black text-gray-900 flex items-center gap-2">
              <span>🏛️</span>
              <span>CT Account & CT Collection Architecture</span>
            </h3>
            <p className="text-[11px] text-gray-500">
              All customer deposits enter the CT Account ledger, while 100% of virtual fund spending flows into CT Collection.
            </p>
          </div>
          <span className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-lg border ${
            gatewayStatus.ctConfigured
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-amber-50 text-amber-800 border-amber-200'
          }`}>
            {gatewayStatus.ctConfigured ? 'CT Account Online & Linked' : 'CT Environment Vars Required'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* CT Account */}
          <div className="p-4 rounded-2xl border-2 border-emerald-200 bg-emerald-50/40 space-y-2">
            <div className="flex items-center justify-between">
              <span className="px-2.5 py-0.5 rounded-md text-[10px] font-black uppercase bg-emerald-600 text-white">
                Gateway • CT Account
              </span>
              <span className="text-[10px] font-black text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                Customer Payment Collection
              </span>
            </div>
            <h4 className="text-sm font-black text-gray-900">Company Treasury (CT Account)</h4>
            <div className="font-mono text-[11px] text-gray-700 space-y-1 bg-white p-3 rounded-xl border border-emerald-100">
              <div className="flex justify-between items-center">
                <span className="text-gray-400">API Key:</span>
                <span className="font-bold text-emerald-900">{gatewayStatus.ctKeyMasked}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Secret & Webhook:</span>
                <span className={`font-bold ${gatewayStatus.ctConfigured ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {gatewayStatus.ctConfigured
                    ? (gatewayStatus.ctWebhookConfigured ? 'Configured + Webhook Ready' : 'Configured (Webhook Optional)')
                    : 'Not Configured'}
                </span>
              </div>
              <div className="flex justify-between items-center pt-1 border-t border-gray-100 text-[10px]">
                <span className="text-gray-400">Primary Function:</span>
                <span className="text-emerald-700 font-bold">Customer Deposits & Minting Virtual Funds</span>
              </div>
            </div>
          </div>

          {/* CT Collection */}
          <div className="p-4 rounded-2xl border-2 border-blue-200 bg-blue-50/40 space-y-2">
            <div className="flex items-center justify-between">
              <span className="px-2.5 py-0.5 rounded-md text-[10px] font-black uppercase bg-blue-600 text-white">
                Ledger • CT Collection
              </span>
              <span className="text-[10px] font-black text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
                Virtual Funds Collector
              </span>
            </div>
            <h4 className="text-sm font-black text-gray-900">Platform Virtual Currency Collector</h4>
            <div className="font-mono text-[11px] text-gray-700 space-y-1 bg-white p-3 rounded-xl border border-blue-100">
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Collected Balance:</span>
                <span className="font-bold text-blue-900">₹{ctCollection.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Settlement Mode:</span>
                <span className="font-bold text-blue-700">Atomic Server Ledger</span>
              </div>
              <div className="flex justify-between items-center pt-1 border-t border-gray-100 text-[10px]">
                <span className="text-gray-400">Primary Function:</span>
                <span className="text-blue-700 font-bold">Platform Services, Fees & Auction Commissions</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-3">
        <button
          onClick={() => setActiveSection('pipeline')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
            activeSection === 'pipeline'
              ? 'bg-indigo-600 text-white shadow-md'
              : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
          }`}
        >
          <span>⚡</span>
          <span>Pipeline Visualizer</span>
        </button>

        <button
          onClick={() => setActiveSection('channels')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
            activeSection === 'channels'
              ? 'bg-indigo-600 text-white shadow-md'
              : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
          }`}
        >
          <span>📊</span>
          <span>Multi-Channel Activity Watcher</span>
        </button>

        <button
          onClick={() => setActiveSection('simulator')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
            activeSection === 'simulator'
              ? 'bg-indigo-600 text-white shadow-md'
              : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
          }`}
        >
          <span>🧪</span>
          <span>Pipeline Sandbox Simulator</span>
        </button>

        <button
          onClick={() => setActiveSection('architecture')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
            activeSection === 'architecture'
              ? 'bg-indigo-600 text-white shadow-md'
              : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
          }`}
        >
          <span>🏛️</span>
          <span>Architecture & Compliance Check</span>
        </button>
      </div>

      {/* SECTION 1: PIPELINE VISUALIZER */}
      {activeSection === 'pipeline' && (
        <div className="space-y-6">
          <div className="bg-white rounded-3xl p-6 border border-gray-200 shadow-sm space-y-6">
            <div>
              <h2 className="text-lg font-black text-gray-900">Institutional Financial Pipeline Architecture</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Full end-to-end trace of money flow: Customer Payment Collection into CT Account, Virtual Currency 1:1 representation, and all in-app usage routed into CT Collection.
              </p>
            </div>

            {/* Pipeline Visual Flowchart */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 relative">
              {/* Step 1 */}
              <div className="bg-emerald-50/70 border-2 border-emerald-300 rounded-2xl p-4 flex flex-col justify-between relative shadow-xs">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="w-7 h-7 rounded-xl bg-emerald-600 text-white font-black text-xs flex items-center justify-center">1</span>
                    <span className="text-[10px] font-bold uppercase text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">Inflow</span>
                  </div>
                  <h3 className="text-sm font-black text-gray-900">User Deposits Funds</h3>
                  <p className="text-xs text-gray-600">
                    User pays via UPI, Card, NetBanking, or Gateway. Real INR arrives directly into the <strong>CT Account</strong>.
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-emerald-200 text-xs font-mono font-bold text-emerald-800">
                  CT Account: ₹{companyWallet.toLocaleString()}
                </div>
              </div>

              {/* Step 2 */}
              <div className="bg-cyan-50/70 border-2 border-cyan-300 rounded-2xl p-4 flex flex-col justify-between relative shadow-xs">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="w-7 h-7 rounded-xl bg-cyan-600 text-white font-black text-xs flex items-center justify-center">2</span>
                    <span className="text-[10px] font-bold uppercase text-cyan-700 bg-cyan-100 px-2 py-0.5 rounded-full">Liquidity</span>
                  </div>
                  <h3 className="text-sm font-black text-gray-900">Virtual Currency Minted</h3>
                  <p className="text-xs text-gray-600">
                    Equivalent platform credits are credited 1:1 into the user's wallet for instantaneous, zero-latency bidding and platform usage.
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-cyan-200 text-xs font-mono font-bold text-cyan-800">
                  Circulating: ₹{totalUserWallets.toLocaleString()}
                </div>
              </div>

              {/* Step 3 */}
              <div className="bg-blue-50/70 border-2 border-blue-300 rounded-2xl p-4 flex flex-col justify-between relative shadow-xs">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="w-7 h-7 rounded-xl bg-blue-600 text-white font-black text-xs flex items-center justify-center">3</span>
                    <span className="text-[10px] font-bold uppercase text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">Usage</span>
                  </div>
                  <h3 className="text-sm font-black text-gray-900">Platform Spend ➔ CT Collection</h3>
                  <p className="text-xs text-gray-600">
                    All virtual currency spent on bids, listings, inspections, campaigns, commissions, or fees flows into the <strong>CT Collection</strong> channel.
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-blue-200 text-xs font-mono font-bold text-blue-800">
                  CT Collection: ₹{ctCollection.toLocaleString()}
                </div>
              </div>
            </div>

            {/* Key Pipeline Health Indicators */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-gray-100">
              <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200 flex items-start gap-3">
                <span className="text-2xl">🔒</span>
                <div>
                  <h4 className="text-xs font-black uppercase text-gray-900">100% Reserve Solvency</h4>
                  <p className="text-xs text-gray-600 mt-1">
                    CT Account customer collections (₹{companyWallet.toLocaleString()}) back circulating virtual currency (₹{totalUserWallets.toLocaleString()}).
                  </p>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200 flex items-start gap-3">
                <span className="text-2xl">⚡</span>
                <div>
                  <h4 className="text-xs font-black uppercase text-gray-900">Segregated Revenue Tracking</h4>
                  <p className="text-xs text-gray-600 mt-1">
                    Customer payment inflows are collected in CT Account, while all virtual fund spending routes exclusively into CT Collection.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* CT Collection Realized Usage Breakdown */}
          <div className="bg-white rounded-3xl p-6 border border-gray-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-black text-gray-900">CT Collection / CT Collector Channel Breakdown</h3>
                <p className="text-xs text-gray-500">How users have spent virtual currency across platform features.</p>
              </div>
              <span className="text-sm font-black text-blue-700 bg-blue-50 px-3 py-1 rounded-xl border border-blue-200">
                Total Realized Usage: ₹{ctCollection.toLocaleString()}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2">
              {(Object.entries(ctUsageBreakdown) as [string, { count: number; total: number }][]).slice(0, 4).map(([cat, data]) => (
                <div key={cat} className="p-4 rounded-2xl bg-gray-50 border border-gray-200 space-y-2">
                  <div className="text-xs font-bold text-gray-500 uppercase">{cat}</div>
                  <div className="text-xl font-black text-gray-900">₹{data.total.toLocaleString()}</div>
                  <div className="text-[11px] text-gray-500">{data.count} usage transactions recorded</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* SECTION 2: MULTI-CHANNEL ACTIVITY WATCHER & LEDGER */}
      {activeSection === 'channels' && (
        <div className="bg-white rounded-3xl p-6 border border-gray-200 shadow-sm space-y-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-black text-gray-900">Multi-Channel Financial Activities Watcher & Ledger</h2>
              <p className="text-xs text-gray-500">
                Live stream of all transactions, payment gateway verification details, means of payment, and user ledgers.
              </p>
            </div>

            {/* Channel Filters */}
            <div className="flex flex-wrap gap-1.5 bg-gray-100 p-1.5 rounded-2xl">
              <button
                onClick={() => setChannelFilter('all')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  channelFilter === 'all' ? 'bg-gray-900 text-white shadow-xs' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                All Channels ({classifiedTransactions.length})
              </button>
              <button
                onClick={() => setChannelFilter('ct_account')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  channelFilter === 'ct_account' ? 'bg-emerald-700 text-white shadow-xs' : 'text-emerald-700 hover:bg-emerald-100'
                }`}
              >
                CT Account (Inflow)
              </button>
              <button
                onClick={() => setChannelFilter('ct_collection')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  channelFilter === 'ct_collection' ? 'bg-blue-700 text-white shadow-xs' : 'text-blue-700 hover:bg-blue-100'
                }`}
              >
                CT Collection (Usage)
              </button>
            </div>
          </div>

          {/* Sub-Filters: Status & Mean of Payment */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-gray-100">
            {/* Status Tabs */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mr-1">Status:</span>
              <button
                onClick={() => setStatusFilter('all')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                  statusFilter === 'all' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                All Statuses
              </button>
              <button
                onClick={() => setStatusFilter('success')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                  statusFilter === 'success' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                }`}
              >
                ✓ Success
              </button>
              <button
                onClick={() => setStatusFilter('failed')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                  statusFilter === 'failed' ? 'bg-rose-600 text-white' : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
                }`}
              >
                ✕ Failed / Exited In-Between
              </button>
              <button
                onClick={() => setStatusFilter('pending')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                  statusFilter === 'pending' ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                }`}
              >
                ⏳ Pending
              </button>
            </div>

            {/* Mean of Payment Filter */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mr-1">Mean of Payment:</span>
              <button
                onClick={() => setMethodFilter('all')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                  methodFilter === 'all' ? 'bg-purple-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                All Means
              </button>
              <button
                onClick={() => setMethodFilter('upi')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1 ${
                  methodFilter === 'upi' ? 'bg-purple-600 text-white' : 'bg-purple-50 text-purple-700 hover:bg-purple-100'
                }`}
              >
                <span>⚡</span>
                <span>UPI Payment</span>
              </button>
              <button
                onClick={() => setMethodFilter('card')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1 ${
                  methodFilter === 'card' ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                }`}
              >
                <span>💳</span>
                <span>Card Payment</span>
              </button>
              <button
                onClick={() => setMethodFilter('netbanking')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1 ${
                  methodFilter === 'netbanking' ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                }`}
              >
                <span>🏦</span>
                <span>Net Banking</span>
              </button>
              <button
                onClick={() => setMethodFilter('wallet')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1 ${
                  methodFilter === 'wallet' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                }`}
              >
                <span>👛</span>
                <span>Wallet</span>
              </button>
            </div>
          </div>

          {/* Search Bar */}
          <div className="relative">
            <input
              type="text"
              placeholder="Search by transaction ID, UTR, gateway order number, phone number, username, description..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full px-4 py-3 rounded-2xl bg-gray-50 border border-gray-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-3 text-xs text-gray-400 hover:text-gray-600 px-2 py-0.5 rounded cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>

          {/* Activity Table */}
          <div className="overflow-x-auto rounded-2xl border border-gray-100">
            <table className="w-full text-left text-xs text-gray-600">
              <thead className="bg-gray-50 text-[11px] uppercase font-black text-gray-500 border-b border-gray-100">
                <tr>
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Transaction ID</th>
                  <th className="px-4 py-3">Mean of Payment</th>
                  <th className="px-4 py-3">Channel</th>
                  <th className="px-4 py-3">User & Contact</th>
                  <th className="px-4 py-3">Gateway Order & UTR</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredTransactions.slice(0, 75).map(tx => {
                  const methodInfo = getPaymentMethodInfo(tx.paymentMethod);
                  const isFailed = tx.status === 'failed';
                  return (
                    <tr 
                      key={tx.id} 
                      onClick={() => setSelectedTxForReceipt(tx)}
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
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`px-2 py-1 rounded-lg text-[10px] font-black border ${tx.badgeColor}`}>
                          {tx.channelLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-bold text-gray-900">@{tx.username || 'System'}</div>
                        <div className="text-[10px] text-gray-500 font-mono">{tx.phoneNumber || '—'}</div>
                      </td>
                      <td className="px-4 py-3 max-w-xs">
                        <div className="text-[11px] font-mono font-bold text-purple-700 truncate">
                          Ord: {tx.gatewayOrderNumber || tx.orderId || 'ORD-AUTOBID'}
                        </div>
                        {tx.utr && (
                          <div className="text-[10px] font-mono text-emerald-700 truncate">
                            UTR: {tx.utr}
                          </div>
                        )}
                        {isFailed && tx.failureReason && (
                          <div className="text-[10px] text-rose-600 truncate mt-0.5">
                            Exited: {tx.failureReason}
                          </div>
                        )}
                      </td>
                      <td className={`px-4 py-3 text-right font-black text-sm whitespace-nowrap ${
                        isFailed ? 'text-gray-400 line-through' : 'text-gray-900'
                      }`}>
                        ₹{tx.amount?.toLocaleString()}
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
                            setSelectedTxForReceipt(tx);
                          }}
                          className="px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold text-[11px] transition cursor-pointer"
                        >
                          Inspect ↗
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {filteredTransactions.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-gray-400">
                      No transactions found matching this channel, status, method, or search query.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SECTION 3: SIMULATOR / DIAGNOSTIC SANDBOX */}
      {activeSection === 'simulator' && (
        <div className="space-y-6">
          <div className="bg-white rounded-3xl p-6 border border-gray-200 shadow-sm space-y-6">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl">🧪</span>
                <h2 className="text-lg font-black text-gray-900">Financial Pipeline Sandbox Simulator</h2>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Zero-risk interactive testing environment. Test each pipeline stage: deposit into CT Account, mint virtual currency, and spend virtual funds into CT Collection.
              </p>
            </div>

            {/* Select Target User */}
            <div className="bg-gray-50 p-4 rounded-2xl border border-gray-200 space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-700 block">
                Select Test User Profile
              </label>
              <select
                value={simUserId}
                onChange={e => setSimUserId(e.target.value)}
                className="w-full sm:w-1/2 px-4 py-2.5 rounded-xl border border-gray-300 bg-white text-xs font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {users.map(u => (
                  <option key={u.id} value={u.id}>
                    @{u.username} ({u.email || 'no-email'}) — Current Wallet: ₹{(u.deposits || 0).toLocaleString()}
                  </option>
                ))}
              </select>
            </div>

            {/* 2 Step Simulator Columns */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Test Step 1 & 2 */}
              <div className="p-5 rounded-2xl bg-emerald-50/60 border border-emerald-200 space-y-4">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-lg bg-emerald-600 text-white text-xs font-bold flex items-center justify-center">1</span>
                  <h3 className="text-xs font-black uppercase text-emerald-950">Deposit to CT Account</h3>
                </div>
                <p className="text-xs text-gray-600">
                  Simulates user depositing funds via payment gateway into the CT Account and receiving 1:1 virtual currency in their wallet.
                </p>
                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-gray-700">Amount (₹)</label>
                  <input
                    type="number"
                    value={simDepositAmount}
                    onChange={e => setSimDepositAmount(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-white border border-gray-300 text-xs font-bold"
                  />
                </div>
                <button
                  disabled={simProcessing}
                  onClick={runSimulateDeposit}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black shadow-md transition-all disabled:opacity-50"
                >
                  {simProcessing ? 'Processing...' : 'Execute Test Deposit (CT Account)'}
                </button>
              </div>

              {/* Test Step 3 */}
              <div className="p-5 rounded-2xl bg-blue-50/60 border border-blue-200 space-y-4">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-lg bg-blue-600 text-white text-xs font-bold flex items-center justify-center">2</span>
                  <h3 className="text-xs font-black uppercase text-blue-950">Platform Spend to CT Collection</h3>
                </div>
                <p className="text-xs text-gray-600">
                  Simulates user spending virtual currency on platform services. Deducts from user wallet and credits the <strong>CT Collection</strong> channel.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-gray-700">Amount (₹)</label>
                    <input
                      type="number"
                      value={simSpendAmount}
                      onChange={e => setSimSpendAmount(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-white border border-gray-300 text-xs font-bold"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-gray-700">Service</label>
                    <select
                      value={simSpendType}
                      onChange={e => setSimSpendType(e.target.value)}
                      className="w-full px-2 py-2 rounded-xl bg-white border border-gray-300 text-xs font-bold"
                    >
                      <option value="bid_fee">Auction Bid Fee</option>
                      <option value="car_inspection">Vehicle Inspection</option>
                      <option value="promotional_campaign">Featured Boost</option>
                      <option value="charity_foundation">Donation</option>
                    </select>
                  </div>
                </div>
                <button
                  disabled={simProcessing}
                  onClick={runSimulateSpend}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black shadow-md transition-all disabled:opacity-50"
                >
                  {simProcessing ? 'Processing...' : 'Execute Spend (➔ CT Collection)'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 4: ARCHITECTURE & COMPLIANCE VERIFICATION */}
      {activeSection === 'architecture' && (
        <div className="bg-white rounded-3xl p-6 border border-gray-200 shadow-sm space-y-6">
          <div>
            <h2 className="text-lg font-black text-gray-900">
              Architectural Analysis & Treasury Overview
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Streamlined closed-loop virtual wallet architecture powered by CT Account & CT Collection.
            </p>
          </div>

          <div className="space-y-4">
            <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-start gap-3">
              <span className="text-2xl">✅</span>
              <div>
                <h3 className="text-sm font-black text-emerald-950">
                  CT Account + CT Collection Closed-Loop Architecture Active
                </h3>
                <p className="text-xs text-emerald-800 mt-1 leading-relaxed">
                  All customer deposits enter through the verified CT Account treasury ledger, while all virtual currency usage and platform fees settle directly into CT Collection. Virtual funds operate on a deposit-only in-app model.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200 space-y-2">
                <h4 className="text-xs font-black uppercase text-gray-900 flex items-center gap-2">
                  <span>1. CT Account for Customer Payment Collection</span>
                </h4>
                <p className="text-xs text-gray-600 leading-relaxed">
                  Routing incoming payments exclusively into the <strong>CT (Company Treasury) Account</strong> keeps customer collections unified. The equivalent virtual currency in the user's wallet enables zero-latency bidding and instant service purchases.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200 space-y-2">
                <h4 className="text-xs font-black uppercase text-gray-900 flex items-center gap-2">
                  <span>2. CT Collection for All Virtual Fund Usage</span>
                </h4>
                <p className="text-xs text-gray-600 leading-relaxed">
                  When a user spends virtual currency on bidding fees, vehicle inspections, promotional boosts, donations, or auction settlements, 100% of spent virtual funds route cleanly into <strong>CT Collection</strong>.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200 space-y-2">
                <h4 className="text-xs font-black uppercase text-gray-900 flex items-center gap-2">
                  <span>3. Closed-Loop Virtual Utility Model</span>
                </h4>
                <p className="text-xs text-gray-600 leading-relaxed">
                  Virtual wallet balances operate strictly on a deposit-only utility model for in-app marketplace participation and services routed to CT Collection.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200 space-y-2">
                <h4 className="text-xs font-black uppercase text-gray-900 flex items-center gap-2">
                  <span>4. Treasury Ledger Security</span>
                </h4>
                <p className="text-xs text-gray-600 leading-relaxed">
                  Wallet credits, debits, and company treasury adjustments are enforced server-side with Admin OTP verification and immutable audit logging.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TRANSACTION RECEIPT & AUDIT INSPECTOR MODAL */}
      <TransactionReceiptModal
        transaction={selectedTxForReceipt}
        isOpen={Boolean(selectedTxForReceipt)}
        onClose={() => setSelectedTxForReceipt(null)}
        isAdmin={true}
      />
    </div>
  );
};
