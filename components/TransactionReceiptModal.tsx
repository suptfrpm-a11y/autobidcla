import React, { useState } from 'react';
import { WalletTransaction } from '../types';
import { enrichTransaction, getPaymentMethodInfo } from '../utils/transactionHelper';

interface TransactionReceiptModalProps {
  transaction: any | null;
  isOpen: boolean;
  onClose: () => void;
  isAdmin?: boolean;
}

export const TransactionReceiptModal: React.FC<TransactionReceiptModalProps> = ({
  transaction,
  isOpen,
  onClose,
  isAdmin = false
}) => {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showRawJson, setShowRawJson] = useState<boolean>(false);

  if (!isOpen || !transaction) return null;

  const tx: WalletTransaction = enrichTransaction(transaction);
  const methodInfo = getPaymentMethodInfo(tx.paymentMethod);
  const isFailed = tx.status === 'failed';
  const isPending = tx.status === 'pending';

  const copyToClipboard = (text: string, fieldName: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/75 backdrop-blur-xs animate-fade-in overflow-y-auto">
      <div 
        className="bg-white rounded-3xl max-w-xl w-full my-auto shadow-2xl border border-gray-100 flex flex-col max-h-[92vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-gray-50 to-white">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center text-lg shadow-xs ${
              isFailed ? 'bg-rose-100 text-rose-700' : isPending ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
            }`}>
              {isFailed ? '✕' : isPending ? '⏳' : '✓'}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-black text-gray-900 text-base">Payment Gateway Receipt</h3>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                  isFailed ? 'bg-rose-100 text-rose-800 border border-rose-200' :
                  isPending ? 'bg-amber-100 text-amber-800 border border-amber-200' :
                  'bg-emerald-100 text-emerald-800 border border-emerald-200'
                }`}>
                  {isFailed ? 'Failed / Exited' : isPending ? 'Pending' : 'Success'}
                </span>
              </div>
              <p className="text-xs text-gray-500 font-mono mt-0.5">
                ID: {tx.transactionId}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 flex items-center justify-center font-bold text-xs cursor-pointer transition"
          >
            ✕
          </button>
        </div>

        {/* Modal Body: Scrollable */}
        <div className="p-5 overflow-y-auto space-y-5 flex-1 text-xs">
          {/* Main Status & Amount Banner */}
          <div className={`p-4 rounded-2xl border text-center space-y-1.5 ${
            isFailed ? 'bg-rose-50/70 border-rose-200 text-rose-950' :
            isPending ? 'bg-amber-50/70 border-amber-200 text-amber-950' :
            'bg-emerald-50/70 border-emerald-200 text-emerald-950'
          }`}>
            <span className="text-[11px] font-black uppercase tracking-wider opacity-75">
              {isFailed ? 'Transaction Interrupted / Failed' : 'Total Amount Authorized'}
            </span>
            <div className="text-3xl font-black tracking-tight text-gray-900">
              ₹{Number(tx.amount || 0).toLocaleString()}
            </div>
            <div className="text-xs font-semibold text-gray-700">
              {tx.description}
            </div>
            <div className="text-[11px] text-gray-500 font-mono">
              {new Date(tx.timestamp).toLocaleString('en-IN', {
                dateStyle: 'medium',
                timeStyle: 'medium'
              })}
            </div>
          </div>

          {/* Failure / Exit In-Between Callout if Failed */}
          {isFailed && (
            <div className="p-3.5 bg-rose-50 rounded-2xl border border-rose-200 space-y-1 text-rose-900">
              <div className="flex items-center gap-2 font-bold text-xs">
                <span>⚠️</span>
                <span>Payment Interrupted or Exited In-Between</span>
              </div>
              <p className="text-[11px] text-rose-800 leading-relaxed">
                <strong>Reason:</strong> {tx.failureReason || 'User exited payment checkout in-between (Payment Dismissed before completion).'}
              </p>
              <p className="text-[10px] text-rose-600">
                This transaction record was preserved for reconciliation, user ledger audit, and dispute tracking. No wallet balance was credited.
              </p>
            </div>
          )}

          {/* Primary Gateway Details Grid */}
          <div className="space-y-3">
            <h4 className="text-[11px] font-black uppercase tracking-wider text-gray-400">
              Payment Gateway Verification & Ledger Details
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* 1. Transaction ID */}
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 flex flex-col justify-between">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                  Transaction ID
                </span>
                <div className="flex items-center justify-between gap-1.5 mt-1">
                  <span className="font-mono font-bold text-xs text-gray-900 truncate">
                    {tx.transactionId}
                  </span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(tx.transactionId || '', 'txId')}
                    className="px-2 py-0.5 rounded bg-white hover:bg-gray-200 border border-gray-200 text-[10px] font-bold text-gray-700 cursor-pointer transition shrink-0"
                  >
                    {copiedField === 'txId' ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
              </div>

              {/* 2. Mean of Payment / Method */}
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 flex flex-col justify-between">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                  Mean of Payment (Form of Payment)
                </span>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`px-2 py-0.5 rounded-lg text-xs font-black flex items-center gap-1 border ${methodInfo.badgeClass}`}>
                    <span>{methodInfo.icon}</span>
                    <span>{methodInfo.label}</span>
                  </span>
                </div>
                {tx.paymentMethodDetails && (
                  <span className="text-[10px] text-gray-500 mt-1 truncate">
                    {tx.paymentMethodDetails}
                  </span>
                )}
              </div>

              {/* 3. Gateway Order Number */}
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 flex flex-col justify-between">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                  Gateway Order Number / ID
                </span>
                <div className="flex items-center justify-between gap-1.5 mt-1">
                  <span className="font-mono font-bold text-xs text-purple-700 truncate">
                    {tx.gatewayOrderNumber || tx.orderId || 'ORD-AUTOBID'}
                  </span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(tx.gatewayOrderNumber || tx.orderId || '', 'orderId')}
                    className="px-2 py-0.5 rounded bg-white hover:bg-gray-200 border border-gray-200 text-[10px] font-bold text-gray-700 cursor-pointer transition shrink-0"
                  >
                    {copiedField === 'orderId' ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
              </div>

              {/* 4. UTR / Bank Reference Number */}
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 flex flex-col justify-between">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                  UTR / Bank Reference (RRN)
                </span>
                <div className="flex items-center justify-between gap-1.5 mt-1">
                  <span className="font-mono font-bold text-xs text-emerald-700 truncate">
                    {tx.utr || 'Pending Settlement'}
                  </span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(tx.utr || '', 'utr')}
                    className="px-2 py-0.5 rounded bg-white hover:bg-gray-200 border border-gray-200 text-[10px] font-bold text-gray-700 cursor-pointer transition shrink-0"
                  >
                    {copiedField === 'utr' ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
              </div>

              {/* 5. Phone Number Used */}
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 flex flex-col justify-between">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                  Phone Number Used at Gateway
                </span>
                <div className="flex items-center justify-between gap-1.5 mt-1">
                  <span className="font-mono font-bold text-xs text-gray-900 truncate">
                    📱 {tx.phoneNumber || 'Not provided'}
                  </span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(tx.phoneNumber || '', 'phone')}
                    className="px-2 py-0.5 rounded bg-white hover:bg-gray-200 border border-gray-200 text-[10px] font-bold text-gray-700 cursor-pointer transition shrink-0"
                  >
                    {copiedField === 'phone' ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
              </div>

              {/* 6. User Account Info */}
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 flex flex-col justify-between">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                  Account Payer
                </span>
                <div className="font-bold text-xs text-gray-900 truncate mt-1">
                  @{tx.username || 'user'}
                </div>
                <div className="text-[10px] text-gray-500 truncate">
                  {tx.userEmail || `${tx.username || 'user'}@autobid.com`}
                </div>
              </div>
            </div>
          </div>

          {/* Ledger Accounting Details */}
          <div className="p-3.5 bg-gray-50 rounded-2xl border border-gray-200 space-y-2">
            <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 block">
              Accounting & Treasury Route
            </span>
            <div className="flex items-center justify-between text-xs py-1 border-b border-gray-200">
              <span className="text-gray-600">Treasury Channel</span>
              <span className="font-bold text-gray-900">
                {tx.channel === 'ct_account' ? 'CT Account (Customer Payment Collection)' :
                 tx.channel === 'ct_collection' ? 'CT Collection (Virtual Funds Collection)' : 'CT Treasury'}
              </span>
            </div>
            {tx.balanceAfter !== undefined && (
              <div className="flex items-center justify-between text-xs py-1">
                <span className="text-gray-600">Wallet Balance After Transaction</span>
                <span className="font-bold text-emerald-600 font-mono">
                  ₹{Number(tx.balanceAfter).toLocaleString()}
                </span>
              </div>
            )}
          </div>

          {/* Admin Raw Gateway JSON Toggle */}
          {isAdmin && (
            <div className="space-y-2 pt-1">
              <button
                type="button"
                onClick={() => setShowRawJson(!showRawJson)}
                className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 cursor-pointer"
              >
                <span>{showRawJson ? '▼ Hide' : '▶ Show'} Raw Payment Gateway Metadata & Audit Log</span>
              </button>

              {showRawJson && (
                <pre className="p-3 bg-gray-950 text-gray-200 rounded-xl text-[10px] font-mono overflow-x-auto max-h-48 border border-gray-800">
                  {JSON.stringify(tx, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-gray-100 flex items-center justify-between bg-gray-50">
          <div className="text-[11px] text-gray-400 font-mono truncate max-w-xs">
            Ref: {tx.gatewayOrderNumber || tx.transactionId}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 bg-gray-900 hover:bg-black text-white font-bold rounded-xl text-xs shadow-sm cursor-pointer transition active:scale-95"
            >
              Close Receipt
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
