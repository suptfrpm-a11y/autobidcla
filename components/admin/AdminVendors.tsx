import React, { useState, useEffect } from 'react';
import { Building2, Plus, CheckCircle2, AlertTriangle, X, BadgeCheck } from 'lucide-react';
import { db, collection, onSnapshot, addDoc, updateDoc, doc } from '../../firebase';
import { DealerPartner, User } from '../../types';
import { logAdminAction } from './adminAuditHelper';
import { authFetch } from '../../utils/apiClient';

interface AdminVendorsProps {
  currentUser: User;
  users: User[];
}

export const AdminVendors: React.FC<AdminVendorsProps> = ({ currentUser, users }) => {
  const [dealers, setDealers] = useState<DealerPartner[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedMetricsDealer, setSelectedMetricsDealer] = useState<DealerPartner | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [newDealer, setNewDealer] = useState({
    userId: '',
    businessName: '',
    ownerName: '',
    email: '',
    phone: '',
    dealerLicense: '',
    taxId: '',
    tier: 'Gold' as 'Silver' | 'Gold' | 'Platinum'
  });

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'dealers'), (snap) => {
      const list: DealerPartner[] = [];
      snap.forEach(d => list.push({ id: d.id, ...d.data() } as DealerPartner));
      setDealers(list);
    });
    return () => unsub();
  }, []);

  const showNotice = (type: 'success' | 'error', text: string) => {
    setNotice({ type, text });
    setTimeout(() => setNotice(null), 4000);
  };

  const handleCreateDealer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDealer.businessName.trim()) return;

    try {
      const docRef = await addDoc(collection(db, 'dealers'), {
        ...newDealer,
        isVerified: true,
        status: 'active',
        activeListingsCount: 0,
        totalGmv: 0,
        rating: 5.0,
        joinedAt: Date.now()
      });

      if (newDealer.userId) {
        await authFetch('/api/admin/users/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: newDealer.userId, decision: 'approve' })
        });
      }

      await logAdminAction(
        currentUser,
        'ONBOARD_DEALERSHIP',
        'dealers',
        docRef.id,
        `Onboarded dealer ${newDealer.businessName} (Tier: ${newDealer.tier})`
      );

      setShowAddModal(false);
      const name = newDealer.businessName;
      setNewDealer({
        userId: '',
        businessName: '',
        ownerName: '',
        email: '',
        phone: '',
        dealerLicense: '',
        taxId: '',
        tier: 'Gold'
      });
      showNotice('success', `Dealership partner ${name} onboarded successfully.`);
    } catch (err: any) {
      showNotice('error', 'Failed to onboard dealership: ' + err.message);
    }
  };

  const handleToggleTier = async (dealer: DealerPartner, tier: 'Silver' | 'Gold' | 'Platinum') => {
    try {
      await updateDoc(doc(db, 'dealers', dealer.id), { tier });
      await logAdminAction(currentUser, 'UPDATE_DEALER_TIER', 'dealers', dealer.id, `Changed tier to ${tier} for ${dealer.businessName}`);
    } catch (err: any) {
      showNotice('error', 'Failed to update tier: ' + err.message);
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
          <h2 className="text-lg font-semibold text-gray-900">Vendor & Dealership Management</h2>
          <p className="text-xs text-gray-500 mt-1">
            Onboard, verify, and manage automotive dealerships and commercial fleet sellers.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium text-xs rounded-lg inline-flex items-center gap-1.5 cursor-pointer transition"
        >
          <Plus className="w-4 h-4" />
          Onboard Certified Dealership
        </button>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-xs">
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 text-sm tabular-nums">Certified Dealership Partners ({dealers.length})</h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 text-gray-500 uppercase font-semibold border-b border-gray-200 text-[11px]">
              <tr>
                <th className="py-3 px-4">Dealership Business</th>
                <th className="py-3 px-4">Owner & Contact</th>
                <th className="py-3 px-4">License / GSTIN</th>
                <th className="py-3 px-4">Partner Tier</th>
                <th className="py-3 px-4">Inventory / GMV</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {dealers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-gray-500">
                    <div className="max-w-xs mx-auto space-y-2">
                      <div className="w-10 h-10 mx-auto rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-500">
                        <Building2 className="w-5 h-5" />
                      </div>
                      <p className="font-semibold text-gray-900 text-sm">No commercial dealerships onboarded</p>
                      <p className="text-xs text-gray-500">Onboard car dealerships to scale verified inventory.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                dealers.map((dealer) => (
                  <tr key={dealer.id} className="hover:bg-gray-50">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-gray-900 text-sm flex items-center gap-1.5">
                        <span>{dealer.businessName}</span>
                        <BadgeCheck className="w-4 h-4 text-emerald-600" />
                      </div>
                      <div className="text-[11px] text-gray-500 tabular-nums">Member since {new Date(dealer.joinedAt).toLocaleDateString()}</div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-gray-900">{dealer.ownerName}</div>
                      <div className="text-[11px] text-gray-500">{dealer.email}</div>
                      <div className="text-[11px] text-gray-400">{dealer.phone}</div>
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-gray-600">
                      <div>Lic: {dealer.dealerLicense || 'N/A'}</div>
                      <div>GST: {dealer.taxId || 'N/A'}</div>
                    </td>
                    <td className="py-3 px-4">
                      <select
                        value={dealer.tier}
                        onChange={(e: any) => handleToggleTier(dealer, e.target.value)}
                        className="px-2.5 py-1 rounded-lg font-medium text-xs bg-gray-100 text-gray-800 border border-gray-200 outline-none cursor-pointer"
                      >
                        <option value="Silver">Silver Tier</option>
                        <option value="Gold">Gold Partner</option>
                        <option value="Platinum">Platinum VIP</option>
                      </select>
                    </td>
                    <td className="py-3 px-4 tabular-nums">
                      <div className="font-semibold text-gray-900">{dealer.activeListingsCount || 0} active cars</div>
                      <div className="text-[11px] text-emerald-700 font-medium">₹{(dealer.totalGmv || 0).toLocaleString()} GMV</div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded-lg text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 capitalize">
                        {dealer.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => setSelectedMetricsDealer(dealer)}
                        className="px-3 py-1 rounded-lg text-xs font-medium bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 cursor-pointer"
                      >
                        Performance
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedMetricsDealer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-lg max-w-sm w-full p-5 space-y-4 shadow-lg border border-gray-200">
            <div className="flex justify-between items-center border-b border-gray-200 pb-3">
              <h3 className="font-semibold text-gray-900 text-sm">{selectedMetricsDealer.businessName}</h3>
              <button type="button" onClick={() => setSelectedMetricsDealer(null)} className="text-gray-400 hover:text-gray-700 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1.5 border-b border-gray-100">
                <span className="text-gray-500">Partner Rating</span>
                <span className="font-semibold text-gray-900 tabular-nums">{selectedMetricsDealer.rating} / 5.0</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-gray-100">
                <span className="text-gray-500">Active Inventory</span>
                <span className="font-semibold text-gray-900 tabular-nums">{selectedMetricsDealer.activeListingsCount || 0} cars</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-gray-500">Total GMV</span>
                <span className="font-semibold text-emerald-700 tabular-nums">₹{(selectedMetricsDealer.totalGmv || 0).toLocaleString()}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSelectedMetricsDealer(null)}
              className="w-full py-2 bg-gray-900 hover:bg-black text-white rounded-lg text-xs font-medium cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-lg max-w-lg w-full p-6 space-y-4 shadow-lg border border-gray-200">
            <div className="flex justify-between items-center border-b border-gray-200 pb-3">
              <h3 className="font-semibold text-gray-900 text-base">Onboard Certified Dealership Partner</h3>
              <button type="button" onClick={() => setShowAddModal(false)} className="text-gray-400 hover:text-gray-600 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateDealer} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Dealership Business Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Apex Pre-Owned Motor Group"
                  value={newDealer.businessName}
                  onChange={(e) => setNewDealer(prev => ({ ...prev, businessName: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-gray-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Owner Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Rajiv Khanna"
                    value={newDealer.ownerName}
                    onChange={(e) => setNewDealer(prev => ({ ...prev, ownerName: e.target.value }))}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Link Platform Account</label>
                  <select
                    value={newDealer.userId}
                    onChange={(e) => {
                      const u = users.find(usr => usr.id === e.target.value);
                      setNewDealer(prev => ({
                        ...prev,
                        userId: e.target.value,
                        email: u?.email || prev.email,
                        ownerName: u?.fullName || prev.ownerName
                      }));
                    }}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs outline-none"
                  >
                    <option value="">Select registered user...</option>
                    {users.map(u => (
                      <option key={u.id} value={u.id}>{u.username} ({u.email || u.id})</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Email Address *</label>
                  <input
                    type="email"
                    required
                    placeholder="dealers@apexmotors.in"
                    value={newDealer.email}
                    onChange={(e) => setNewDealer(prev => ({ ...prev, email: e.target.value }))}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Phone Number *</label>
                  <input
                    type="tel"
                    required
                    placeholder="+91 XXXXX XXXXX"
                    value={newDealer.phone}
                    onChange={(e) => setNewDealer(prev => ({ ...prev, phone: e.target.value }))}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Dealer License</label>
                  <input
                    type="text"
                    placeholder="DL-2026-X99"
                    value={newDealer.dealerLicense}
                    onChange={(e) => setNewDealer(prev => ({ ...prev, dealerLicense: e.target.value }))}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">GST / Tax ID</label>
                  <input
                    type="text"
                    placeholder="07AAAAA0000A1Z5"
                    value={newDealer.taxId}
                    onChange={(e) => setNewDealer(prev => ({ ...prev, taxId: e.target.value }))}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Tier Level</label>
                  <select
                    value={newDealer.tier}
                    onChange={(e: any) => setNewDealer(prev => ({ ...prev, tier: e.target.value }))}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs outline-none"
                  >
                    <option value="Silver">Silver Tier</option>
                    <option value="Gold">Gold Partner</option>
                    <option value="Platinum">Platinum VIP</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg cursor-pointer"
                >
                  Onboard Dealership
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
