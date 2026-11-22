import React, { useState, useEffect, useMemo } from 'react';
import {
  Package,
  ShieldCheck,
  Plus,
  Search,
  X,
  Trash2,
  Copy,
  Check,
  Phone,
  Settings,
  MessageCircle,
  ArrowRight,
  AlertTriangle,
  User as UserIcon,
  Calendar,
  Tag,
  Flag,
  Radio,
  Car
} from 'lucide-react';
import { Vehicle, User, StockRecord, VehicleStatus } from '../types';
import { db, collection, onSnapshot } from '../firebase';
import { buildStockRecord, saveStockRecordToFirestore, deleteStockRecordFromFirestore } from '../utils/stockHelper';
import { logAdminAction } from './admin/adminAuditHelper';

interface StockManagementProps {
  vehicles: Vehicle[];
  allUsers: User[];
  currentUser?: User | null;
  onSelectVehicle: (vehicle: Vehicle) => void;
  onViewProfile?: (user: User) => void;
  onOpenChat?: (user: User) => void;
  onNavigate: (view: string) => void;
  initialStockQuery?: string;
  onDeleteVehicle?: (vehicleId: string, stockNumber?: string) => Promise<void> | void;
}

export const StockManagement: React.FC<StockManagementProps> = ({
  vehicles,
  allUsers,
  currentUser,
  onSelectVehicle,
  onViewProfile,
  onOpenChat,
  onNavigate,
  initialStockQuery = '',
  onDeleteVehicle
}) => {
  const [stockRecords, setStockRecords] = useState<StockRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'all' | 'live' | 'sold' | 'upcoming' | 'manual'>('all');
  const [searchQuery, setSearchQuery] = useState(initialStockQuery);
  const [selectedRecord, setSelectedRecord] = useState<StockRecord | null>(null);
  const [copiedStock, setCopiedStock] = useState<string | null>(null);
  const [copiedPhone, setCopiedPhone] = useState(false);

  // Admin deletion states
  const [recordToDelete, setRecordToDelete] = useState<StockRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());

  const isAdmin = currentUser?.role === 'admin';

  // 1. Listen to real-time 'stock' collection in Firestore
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'stock'), (snapshot) => {
      const records: StockRecord[] = [];
      snapshot.forEach(docSnap => {
        records.push({ id: docSnap.id, ...docSnap.data() } as StockRecord);
      });
      records.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
      setStockRecords(records);
      setIsLoading(false);
    }, (err) => {
      console.warn("Stock listener error:", err);
      setIsLoading(false);
    });

    return () => unsub();
  }, []);

  // 2. Self-healing database sync: Ensure all current vehicles exist in the 'stock' database
  useEffect(() => {
    if (vehicles.length === 0) return;

    vehicles.forEach(v => {
      if (deletedIds.has(v.id) || (v.stockNumber && deletedIds.has(v.stockNumber))) return;
      const existingInStock = stockRecords.find(r => r.vehicleId === v.id || r.stockNumber === v.stockNumber);
      if (!existingInStock) {
        const ownerUser = allUsers.find(u => u.id === v.ownerId || (u.username && u.username === v.ownerUsername));
        const record = buildStockRecord(v, ownerUser);
        saveStockRecordToFirestore(record);
      }
    });
  }, [vehicles, stockRecords, allUsers, deletedIds]);

  // Handle direct stock number search if initialStockQuery was passed
  useEffect(() => {
    if (initialStockQuery && stockRecords.length > 0) {
      const exactMatch = stockRecords.find(r => r.stockNumber === initialStockQuery.trim() || r.id === initialStockQuery.trim());
      if (exactMatch) {
        setSelectedRecord(exactMatch);
      }
    }
  }, [initialStockQuery, stockRecords]);

  // Combined records (from Firestore stock collection + fallback from live vehicles)
  const unifiedRecords: StockRecord[] = useMemo(() => {
    const map = new Map<string, StockRecord>();

    stockRecords.forEach(r => {
      if (r.stockNumber && !deletedIds.has(r.stockNumber) && (!r.vehicleId || !deletedIds.has(r.vehicleId))) {
        map.set(r.stockNumber, r);
      }
    });

    vehicles.forEach(v => {
      if (deletedIds.has(v.id) || (v.stockNumber && deletedIds.has(v.stockNumber))) return;
      const sNum = v.stockNumber || (v.id ? v.id.slice(-8) : '');
      if (sNum && !map.has(sNum)) {
        const owner = allUsers.find(u => u.id === v.ownerId || (u.username && u.username === v.ownerUsername));
        map.set(sNum, buildStockRecord(v, owner));
      }
    });

    return Array.from(map.values()).sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  }, [stockRecords, vehicles, allUsers, deletedIds]);

  // Handle admin deletion of livestock / stock records
  const handleConfirmDelete = async () => {
    if (!recordToDelete) return;
    setIsDeleting(true);
    const target = recordToDelete;
    try {
      setDeletedIds(prev => {
        const next = new Set(prev);
        if (target.stockNumber) next.add(target.stockNumber);
        if (target.vehicleId) next.add(target.vehicleId);
        return next;
      });

      await deleteStockRecordFromFirestore(target.stockNumber, target.vehicleId);

      if (currentUser) {
        try {
          await logAdminAction(
            currentUser,
            'DELETE_LIVESTOCK_STOCK',
            'stock',
            target.stockNumber,
            `Admin deleted livestock #${target.stockNumber} (${target.year} ${target.make} ${target.model}, category: ${target.category})`
          );
        } catch (_) {}
      }

      setStockRecords(prev => prev.filter(r => r.stockNumber !== target.stockNumber && r.vehicleId !== target.vehicleId));

      if (onDeleteVehicle) {
        await onDeleteVehicle(target.vehicleId, target.stockNumber);
      }

      if (selectedRecord && (selectedRecord.stockNumber === target.stockNumber || selectedRecord.vehicleId === target.vehicleId)) {
        setSelectedRecord(null);
      }

      setNotice({
        type: 'success',
        text: `Stock #${target.stockNumber} (${target.year} ${target.make} ${target.model}) was permanently deleted from stock and live auctions.`
      });
      setTimeout(() => setNotice(null), 5000);
      setRecordToDelete(null);
    } catch (err: any) {
      console.error("Failed to delete livestock:", err);
      setNotice({
        type: 'error',
        text: `Error deleting stock record: ${err?.message || 'Please check permissions or network'}`
      });
    } finally {
      setIsDeleting(false);
    }
  };

  // Counts for each category
  const categoryCounts = useMemo(() => {
    return {
      all: unifiedRecords.length,
      live: unifiedRecords.filter(r => r.category === 'live').length,
      sold: unifiedRecords.filter(r => r.category === 'sold').length,
      upcoming: unifiedRecords.filter(r => r.category === 'upcoming').length,
      manual: unifiedRecords.filter(r => r.category === 'manual').length,
    };
  }, [unifiedRecords]);

  // Filtered by tab and search
  const filteredRecords = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return unifiedRecords.filter(r => {
      if (activeTab !== 'all' && r.category !== activeTab) {
        return false;
      }

      if (query) {
        const matchesStockNum = (r.stockNumber || '').toLowerCase().includes(query);
        const matchesVehicleId = (r.vehicleId || '').toLowerCase().includes(query);
        const matchesMake = (r.make || '').toLowerCase().includes(query);
        const matchesModel = (r.model || '').toLowerCase().includes(query);
        const matchesVin = (r.vin || '').toLowerCase().includes(query);
        const matchesOwner = (r.ownerUsername || '').toLowerCase().includes(query) || (r.ownerName || '').toLowerCase().includes(query);
        const matchesPhone = (r.ownerPhone || '').toLowerCase().includes(query);

        return matchesStockNum || matchesVehicleId || matchesMake || matchesModel || matchesVin || matchesOwner || matchesPhone;
      }

      return true;
    });
  }, [unifiedRecords, activeTab, searchQuery]);

  // Direct lookup handler
  const handlePerformStockLookup = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = searchQuery.trim();
    if (!clean) return;

    const match = unifiedRecords.find(r =>
      r.stockNumber === clean ||
      r.stockNumber.toLowerCase() === clean.toLowerCase() ||
      r.vehicleId === clean
    );

    if (match) {
      setSelectedRecord(match);
    } else if (filteredRecords.length > 0) {
      setSelectedRecord(filteredRecords[0]);
    } else {
      setNotice({
        type: 'error',
        text: `No vehicle found with Stock Number "${clean}". Please verify the 8-9 digit stock ID.`
      });
    }
  };

  const handleCopyStockNumber = (num: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    navigator.clipboard.writeText(num);
    setCopiedStock(num);
    setTimeout(() => setCopiedStock(null), 2500);
  };

  const resolveOwnerUser = (record: StockRecord): User => {
    const found = allUsers.find(u => (record.ownerId && u.id === record.ownerId) || (record.ownerUsername && (u.username || '').toLowerCase() === record.ownerUsername.toLowerCase()));
    if (found) return found;

    return {
      id: record.ownerId || 'user_' + (record.ownerUsername || 'unknown'),
      username: record.ownerUsername || 'owner',
      fullName: record.ownerName || record.ownerUsername || 'Vehicle Owner',
      avatarUrl: record.ownerAvatarUrl || '',
      phoneNumber: record.ownerPhone || '',
      phoneVerified: record.ownerPhoneVerified || false,
      isVerified: record.ownerIsVerified || false,
      verificationStatus: record.ownerVerificationStatus || 'unverified',
      role: record.ownerRole || 'user',
      followers: 0,
      following: 0,
      bio: 'AutoBid Community Vehicle Seller',
      deposits: 0,
      createdAt: record.ownerCreatedAt || record.createdAt
    };
  };

  const getCategoryLabel = (category: string) => {
    if (category === 'live') return 'Live Auction';
    if (category === 'sold') return 'Sold';
    if (category === 'upcoming') return 'Upcoming';
    return 'Direct Sale';
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4">
      {/* Header Card */}
      <div className="bg-white rounded-lg p-4 sm:p-6 border border-gray-200 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-gray-100 border border-gray-200 text-gray-700 flex items-center justify-center shrink-0">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold text-gray-900 tracking-tight">
                  Stock Inventory
                </h1>
                <span className="text-xs bg-gray-100 text-gray-700 border border-gray-200 px-2 py-0.5 rounded-lg font-medium">
                  8-9 Digit Tracking
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Complete vehicle registry with stock tracking, live auction status, and owner verification.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isAdmin && (
              <span className="text-xs bg-gray-100 text-gray-700 border border-gray-200 px-2.5 py-1.5 rounded-lg font-medium inline-flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-gray-600" />
                <span>Admin Controls Active</span>
              </span>
            )}
            <button
              type="button"
              onClick={() => onNavigate('sell')}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold text-xs rounded-lg transition inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Add Vehicle</span>
            </button>
          </div>
        </div>

        {/* 5 Clean Summary Counters */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-4 border-t border-gray-100">
          {[
            { id: 'all', label: 'Total Stock', count: categoryCounts.all },
            { id: 'live', label: 'Live Auctions', count: categoryCounts.live },
            { id: 'sold', label: 'Sold', count: categoryCounts.sold },
            { id: 'upcoming', label: 'Upcoming', count: categoryCounts.upcoming },
            { id: 'manual', label: 'Direct Sale', count: categoryCounts.manual },
          ].map(stat => {
            const active = activeTab === stat.id;
            return (
              <button
                key={stat.id}
                type="button"
                onClick={() => setActiveTab(stat.id as any)}
                className={`p-3 rounded-lg border text-left transition cursor-pointer ${
                  active
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-gray-50 text-gray-900 border-gray-200 hover:bg-gray-100'
                }`}
              >
                <span className={`text-xs block font-medium ${active ? 'text-gray-300' : 'text-gray-500'}`}>
                  {stat.label}
                </span>
                <span className="text-lg font-bold tabular-nums mt-0.5 block">
                  {stat.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Inline Feedback Notice */}
      {notice && (
        <div
          className={`p-4 rounded-lg border text-xs flex items-center justify-between gap-3 ${
            notice.type === 'success'
              ? 'bg-green-50 border-green-200 text-green-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          <span className="font-medium">{notice.text}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-current opacity-70 hover:opacity-100 cursor-pointer shrink-0"
            aria-label="Dismiss notice"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Search & Filter Controls */}
      <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-xs space-y-3">
        <form onSubmit={handlePerformStockLookup} className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by Stock Number, VIN, Make, Model, or Owner..."
              className="w-full pl-9 pr-16 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-600/20 focus:border-red-600 focus:bg-white transition"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 cursor-pointer"
                aria-label="Clear search"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold text-xs rounded-lg transition cursor-pointer shrink-0"
          >
            Lookup Stock
          </button>
        </form>

        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {[
            { id: 'all', label: `All (${categoryCounts.all})` },
            { id: 'live', label: `Live Auctions (${categoryCounts.live})` },
            { id: 'sold', label: `Sold (${categoryCounts.sold})` },
            { id: 'upcoming', label: `Upcoming (${categoryCounts.upcoming})` },
            { id: 'manual', label: `Direct Sale (${categoryCounts.manual})` },
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition cursor-pointer border ${
                activeTab === tab.id
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Loading / Empty / Stock Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="bg-white rounded-lg border border-gray-200 overflow-hidden animate-pulse">
              <div className="aspect-[16/10] bg-gray-200" />
              <div className="p-4 space-y-3">
                <div className="h-4 bg-gray-200 rounded w-3/4" />
                <div className="h-3 bg-gray-100 rounded w-1/2" />
                <div className="h-12 bg-gray-100 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : filteredRecords.length === 0 ? (
        <div className="bg-white rounded-lg p-12 text-center border border-gray-200 max-w-md mx-auto">
          <div className="w-12 h-12 rounded-lg bg-gray-100 text-gray-500 flex items-center justify-center mx-auto mb-3">
            <Package className="w-6 h-6" />
          </div>
          <h3 className="font-bold text-gray-900 text-base mb-1">No Matching Stock Records</h3>
          <p className="text-xs text-gray-500 mb-4 leading-relaxed">
            {searchQuery
              ? `No stock item matched "${searchQuery}". Verify the 8-9 digit stock number.`
              : `There are currently no items in this category.`}
          </p>
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg transition cursor-pointer"
            >
              Clear Search
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredRecords.map((record) => {
            const isLive = record.category === 'live';
            const isSold = record.category === 'sold';
            const isUpcoming = record.category === 'upcoming';
            const isManual = record.category === 'manual';
            const imgUrl = record.images?.[record.coverImageIndex || 0];

            return (
              <div
                key={record.id || record.stockNumber}
                onClick={() => setSelectedRecord(record)}
                className="bg-white rounded-lg border border-gray-200 hover:border-gray-300 shadow-xs hover:shadow-sm transition flex flex-col overflow-hidden cursor-pointer group"
              >
                {/* Top Image */}
                <div className="relative aspect-[16/10] bg-gray-100 overflow-hidden">
                  {imgUrl ? (
                    <img
                      src={imgUrl}
                      alt={`${record.year} ${record.make} ${record.model}`}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400">
                      <Car className="w-10 h-10" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/20" />

                  {/* Stock Number Chip */}
                  <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={(e) => handleCopyStockNumber(record.stockNumber, e)}
                      className="px-2 py-1 rounded-lg bg-white/95 text-gray-900 font-mono font-bold text-xs shadow-xs border border-gray-200 inline-flex items-center gap-1 cursor-pointer hover:bg-white"
                      title="Click to copy Stock #"
                    >
                      <span>#{record.stockNumber}</span>
                      {copiedStock === record.stockNumber ? (
                        <Check className="w-3 h-3 text-green-600" />
                      ) : (
                        <Copy className="w-3 h-3 text-gray-400" />
                      )}
                    </button>
                  </div>

                  {/* Category Badge & Admin Delete */}
                  <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5">
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRecordToDelete(record);
                        }}
                        className="px-2 py-1 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-700 text-white shadow-xs transition inline-flex items-center gap-1 cursor-pointer"
                        title={isLive ? "Admin: Delete Present Livestock" : "Admin: Delete Stock Record"}
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Delete</span>
                      </button>
                    )}
                    <span
                      className={`px-2 py-1 rounded-lg text-xs font-semibold shadow-xs border ${
                        isLive
                          ? 'bg-red-600 text-white border-red-600'
                          : isSold
                          ? 'bg-green-600 text-white border-green-600'
                          : 'bg-white/95 text-gray-800 border-gray-200'
                      }`}
                    >
                      {getCategoryLabel(record.category)}
                    </span>
                  </div>

                  {/* Pricing on Image Bottom */}
                  <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-end justify-between text-white">
                    <div>
                      <span className="text-[11px] text-gray-200 font-medium block">
                        {isManual ? 'Direct Price' : isSold ? 'Sold Price' : isUpcoming ? 'Asking Price' : 'Current Bid'}
                      </span>
                      <span className="text-base font-bold tabular-nums text-white">
                        ₹{(record.finalSoldPrice || record.directPrice || record.currentBid || record.startingPrice || 0).toLocaleString()}
                      </span>
                    </div>
                    <span className="text-xs text-gray-200 font-mono tabular-nums bg-black/60 px-2 py-0.5 rounded-lg">
                      {(record.odometer || 0).toLocaleString()} km
                    </span>
                  </div>
                </div>

                {/* Card Content */}
                <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                  <div>
                    <h3 className="font-bold text-gray-900 text-sm group-hover:text-red-600 transition truncate mb-1">
                      {record.year} {record.make} {record.model}
                    </h3>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500 mb-3">
                      <span className="font-mono">VIN: {record.vin}</span>
                      <span>•</span>
                      <span>{record.transmission || 'Automatic'}</span>
                      <span>•</span>
                      <span>{record.fuelType || 'Petrol'}</span>
                    </div>

                    {/* Owner Summary Strip */}
                    <div className="bg-gray-50 rounded-lg p-2.5 border border-gray-200 flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        {record.ownerAvatarUrl ? (
                          <img
                            src={record.ownerAvatarUrl}
                            alt={record.ownerUsername || 'owner'}
                            className="w-7 h-7 rounded-full object-cover border border-gray-200 shrink-0"
                          />
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center shrink-0">
                            <UserIcon className="w-4 h-4" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1">
                            <span className="font-semibold text-gray-900 text-xs truncate">
                              {record.ownerName || `@${record.ownerUsername || 'seller'}`}
                            </span>
                            {record.ownerIsVerified && (
                              <ShieldCheck className="w-3.5 h-3.5 text-green-600 shrink-0" title="ID Verified" />
                            )}
                          </div>
                          <span className="text-[11px] text-gray-500 block truncate">
                            {record.ownerPhone || `@${record.ownerUsername || 'user'}`}
                          </span>
                        </div>
                      </div>

                      <span className="text-xs font-semibold text-gray-700 bg-white border border-gray-200 px-2 py-1 rounded-lg shrink-0 inline-flex items-center gap-1">
                        <span>Dossier</span>
                        <ArrowRight className="w-3 h-3" />
                      </span>
                    </div>
                  </div>

                  <div className="pt-2.5 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
                    <span className="truncate">Location: <strong className="text-gray-700">{record.location || 'India'}</strong></span>
                    <span className="font-mono text-[11px] text-gray-400 shrink-0">
                      ID: {record.vehicleId}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* COMPREHENSIVE STOCK & OWNER DOSSIER MODAL */}
      {selectedRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-lg max-w-3xl w-full max-h-[92vh] flex flex-col shadow-lg overflow-hidden border border-gray-200">
            {/* Modal Header */}
            <div className="p-4 sm:p-6 bg-gray-50 border-b border-gray-200 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-white border border-gray-200 text-gray-700 flex items-center justify-center shrink-0">
                  <Package className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base sm:text-lg font-bold font-mono text-gray-900 tracking-wide">
                      Stock #{selectedRecord.stockNumber}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopyStockNumber(selectedRecord.stockNumber)}
                      className="px-2 py-0.5 bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 rounded-lg text-xs font-medium transition inline-flex items-center gap-1 cursor-pointer"
                    >
                      {copiedStock === selectedRecord.stockNumber ? (
                        <>
                          <Check className="w-3 h-3 text-green-600" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-lg bg-gray-900 text-white">
                      {getCategoryLabel(selectedRecord.category)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">
                    Official record for {selectedRecord.year} {selectedRecord.make} {selectedRecord.model}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedRecord(null)}
                className="p-2 rounded-lg bg-white hover:bg-gray-100 text-gray-600 border border-gray-200 transition cursor-pointer shrink-0"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
              {/* Top Highlights Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-1 rounded-lg overflow-hidden aspect-[4/3] bg-gray-100 relative border border-gray-200">
                  {selectedRecord.images?.[selectedRecord.coverImageIndex || 0] ? (
                    <img
                      src={selectedRecord.images[selectedRecord.coverImageIndex || 0]}
                      alt={selectedRecord.model}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400">
                      <Car className="w-10 h-10" />
                    </div>
                  )}
                  <div className="absolute top-2 left-2 bg-black/70 text-white text-xs font-medium px-2 py-0.5 rounded-lg">
                    {selectedRecord.images?.length || 0} Photo(s)
                  </div>
                </div>

                <div className="sm:col-span-2 bg-gray-50 rounded-lg p-4 border border-gray-200 flex flex-col justify-between space-y-3">
                  <div>
                    <h2 className="text-lg font-bold text-gray-900 leading-snug">
                      {selectedRecord.year} {selectedRecord.make} {selectedRecord.model}
                    </h2>
                    <p className="text-xs text-gray-500 mb-3 font-mono mt-0.5">
                      VIN: <strong className="text-gray-800">{selectedRecord.vin}</strong> • ID: {selectedRecord.vehicleId}
                    </p>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-white p-2.5 rounded-lg border border-gray-200">
                        <span className="text-[11px] text-gray-500 block font-medium">Category</span>
                        <strong className="text-gray-900 inline-flex items-center gap-1 mt-0.5">
                          {selectedRecord.category === 'live' && <Radio className="w-3.5 h-3.5 text-red-600" />}
                          {selectedRecord.category === 'sold' && <Flag className="w-3.5 h-3.5 text-green-600" />}
                          {selectedRecord.category === 'upcoming' && <Calendar className="w-3.5 h-3.5 text-gray-600" />}
                          {selectedRecord.category === 'manual' && <Tag className="w-3.5 h-3.5 text-gray-600" />}
                          <span>{getCategoryLabel(selectedRecord.category)}</span>
                        </strong>
                      </div>

                      <div className="bg-white p-2.5 rounded-lg border border-gray-200">
                        <span className="text-[11px] text-gray-500 block font-medium">Pricing</span>
                        <strong className="text-gray-900 text-sm tabular-nums mt-0.5 block">
                          ₹{(selectedRecord.finalSoldPrice || selectedRecord.directPrice || selectedRecord.currentBid || selectedRecord.startingPrice || 0).toLocaleString()}
                        </strong>
                      </div>

                      <div className="bg-white p-2.5 rounded-lg border border-gray-200">
                        <span className="text-[11px] text-gray-500 block font-medium">Odometer</span>
                        <strong className="text-gray-900 tabular-nums mt-0.5 block">
                          {(selectedRecord.odometer || 0).toLocaleString()} km
                        </strong>
                      </div>

                      <div className="bg-white p-2.5 rounded-lg border border-gray-200">
                        <span className="text-[11px] text-gray-500 block font-medium">Location</span>
                        <strong className="text-gray-900 truncate block mt-0.5">
                          {selectedRecord.location || 'India'}
                        </strong>
                      </div>
                    </div>
                  </div>

                  <div className="pt-2.5 border-t border-gray-200 flex items-center justify-between text-xs gap-2">
                    <span className="text-gray-500">
                      Status: <strong className="text-gray-900">{selectedRecord.status}</strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const targetV = vehicles.find(v => v.id === selectedRecord.vehicleId || v.stockNumber === selectedRecord.stockNumber);
                        if (targetV) {
                          setSelectedRecord(null);
                          onSelectVehicle(targetV);
                        } else {
                          setSelectedRecord(null);
                          onSelectVehicle({
                            ...selectedRecord,
                            id: selectedRecord.vehicleId,
                            status: selectedRecord.status as VehicleStatus,
                            primaryDamage: selectedRecord.primaryDamage as any,
                            imageSeed: selectedRecord.imageSeed || 100,
                            endTime: selectedRecord.endTime || Date.now() + 7 * 86400000,
                            watchCount: selectedRecord.watchCount || 0,
                            hasKeys: selectedRecord.hasKeys ?? true,
                            engine: selectedRecord.engine || 'N/A',
                            transmission: selectedRecord.transmission || 'Automatic',
                            drive: selectedRecord.drive || 'FWD'
                          });
                        }
                      }}
                      className="px-3 py-1.5 bg-gray-900 hover:bg-black text-white font-semibold rounded-lg text-xs transition inline-flex items-center gap-1 cursor-pointer"
                    >
                      <span>Open Vehicle</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* COMPLETE OWNER INFORMATION SECTION */}
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-gray-200">
                  <div className="flex items-center gap-2">
                    <UserIcon className="w-4 h-4 text-gray-600" />
                    <div>
                      <h3 className="font-bold text-gray-900 text-sm">Owner Information</h3>
                      <p className="text-xs text-gray-500">Registered owner & verification linked to Stock #{selectedRecord.stockNumber}</p>
                    </div>
                  </div>

                  <span
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold border inline-flex items-center gap-1 ${
                      selectedRecord.ownerIsVerified || selectedRecord.ownerVerificationStatus === 'verified'
                        ? 'bg-green-50 text-green-700 border-green-200'
                        : 'bg-white text-gray-700 border-gray-200'
                    }`}
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>
                      {selectedRecord.ownerIsVerified || selectedRecord.ownerVerificationStatus === 'verified'
                        ? 'ID Verified Seller'
                        : 'Pending Verification'}
                    </span>
                  </span>
                </div>

                {(() => {
                  const resolvedUser = resolveOwnerUser(selectedRecord);

                  return (
                    <div className="space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3 rounded-lg border border-gray-200">
                        <div className="flex items-center gap-3">
                          {resolvedUser.avatarUrl ? (
                            <img
                              src={resolvedUser.avatarUrl}
                              alt={resolvedUser.username}
                              className="w-11 h-11 rounded-full object-cover border border-gray-200 shrink-0"
                            />
                          ) : (
                            <div className="w-11 h-11 rounded-full bg-gray-100 text-gray-500 border border-gray-200 flex items-center justify-center shrink-0">
                              <UserIcon className="w-5 h-5" />
                            </div>
                          )}
                          <div>
                            <div className="flex items-center gap-1.5">
                              <h4 className="font-bold text-gray-900 text-sm">
                                {resolvedUser.fullName || resolvedUser.username}
                              </h4>
                              <span className="text-xs text-gray-500 font-medium">@{resolvedUser.username}</span>
                              {resolvedUser.isVerified && (
                                <ShieldCheck className="w-4 h-4 text-green-600" title="Verified" />
                              )}
                            </div>
                            <p className="text-xs text-gray-500 mt-0.5">
                              Role: <span className="capitalize font-medium text-gray-800">{resolvedUser.role || 'user'}</span> • Joined {resolvedUser.createdAt ? new Date(resolvedUser.createdAt).toLocaleDateString() : 'Active'}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedRecord(null);
                              if (onOpenChat) onOpenChat(resolvedUser);
                            }}
                            className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white font-semibold text-xs rounded-lg transition inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                            <span>Message</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedRecord(null);
                              if (onViewProfile) onViewProfile(resolvedUser);
                            }}
                            className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold text-xs rounded-lg transition cursor-pointer"
                          >
                            Profile
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                        <div className="bg-white p-3 rounded-lg border border-gray-200">
                          <span className="text-[11px] font-medium text-gray-500 block mb-1">
                            Mobile Phone
                          </span>
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono font-semibold text-gray-900 truncate">
                              {resolvedUser.phoneNumber || selectedRecord.ownerPhone || 'Not Provided'}
                            </span>
                            {(resolvedUser.phoneVerified || selectedRecord.ownerPhoneVerified) ? (
                              <span className="text-[10px] bg-green-50 text-green-700 font-semibold px-1.5 py-0.5 rounded border border-green-200 shrink-0">
                                OTP Verified
                              </span>
                            ) : (
                              <span className="text-[10px] bg-gray-100 text-gray-500 font-medium px-1.5 py-0.5 rounded shrink-0">
                                Unverified
                              </span>
                            )}
                          </div>
                          {(resolvedUser.phoneNumber || selectedRecord.ownerPhone) && (
                            <button
                              type="button"
                              onClick={() => {
                                const ph = resolvedUser.phoneNumber || selectedRecord.ownerPhone || '';
                                navigator.clipboard.writeText(ph);
                                setCopiedPhone(true);
                                setTimeout(() => setCopiedPhone(false), 2000);
                              }}
                              className="text-xs text-red-600 font-semibold hover:underline mt-1.5 inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Phone className="w-3 h-3" />
                              <span>{copiedPhone ? 'Copied!' : 'Copy Phone'}</span>
                            </button>
                          )}
                        </div>

                        <div className="bg-white p-3 rounded-lg border border-gray-200">
                          <span className="text-[11px] font-medium text-gray-500 block mb-1">
                            Email Address
                          </span>
                          <span className="font-mono font-medium text-gray-800 text-xs truncate block">
                            {resolvedUser.email || selectedRecord.ownerEmail || 'private@autobid.com'}
                          </span>
                          <span className="text-[11px] text-gray-400 mt-1.5 block truncate">
                            Account ID: {resolvedUser.id}
                          </span>
                        </div>

                        <div className="bg-white p-3 rounded-lg border border-gray-200">
                          <span className="text-[11px] font-medium text-gray-500 block mb-1">
                            Identity Verification
                          </span>
                          <span className={`text-xs font-semibold block ${resolvedUser.isVerified ? 'text-green-700' : 'text-gray-700'}`}>
                            {resolvedUser.isVerified ? 'Officially Verified' : 'Standard Account'}
                          </span>
                          <span className="text-[11px] text-gray-500 mt-1 block">
                            Doc: {resolvedUser.idDocumentType ? resolvedUser.idDocumentType.replace('_', ' ').toUpperCase() : 'Government ID'}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Complete Vehicle Specifications */}
              <div className="bg-white rounded-lg p-4 border border-gray-200">
                <h3 className="font-bold text-gray-900 text-sm mb-3 flex items-center gap-2">
                  <Settings className="w-4 h-4 text-gray-600" />
                  <span>Vehicle Specifications</span>
                </h3>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-xs">
                  <div className="border-b border-gray-100 pb-2">
                    <span className="text-[11px] text-gray-500 block">Stock Number</span>
                    <strong className="font-mono text-gray-900 font-bold">#{selectedRecord.stockNumber}</strong>
                  </div>

                  <div className="border-b border-gray-100 pb-2">
                    <span className="text-[11px] text-gray-500 block">Vehicle Number</span>
                    <strong className="text-gray-900">{selectedRecord.vehicleNumber || 'N/A'}</strong>
                  </div>

                  <div className="border-b border-gray-100 pb-2">
                    <span className="text-[11px] text-gray-500 block">VIN / Chassis</span>
                    <strong className="font-mono text-gray-900">{selectedRecord.vin}</strong>
                  </div>

                  <div className="border-b border-gray-100 pb-2">
                    <span className="text-[11px] text-gray-500 block">Engine</span>
                    <strong className="text-gray-900">{selectedRecord.engine || 'N/A'}</strong>
                  </div>

                  <div className="border-b border-gray-100 pb-2">
                    <span className="text-[11px] text-gray-500 block">Transmission</span>
                    <strong className="text-gray-900">{selectedRecord.transmission || 'Automatic'}</strong>
                  </div>

                  <div className="border-b border-gray-100 pb-2">
                    <span className="text-[11px] text-gray-500 block">Fuel Type</span>
                    <strong className="text-gray-900">{selectedRecord.fuelType || 'Petrol'}</strong>
                  </div>

                  <div className="border-b border-gray-100 pb-2">
                    <span className="text-[11px] text-gray-500 block">Registration Card (RC)</span>
                    <strong className={selectedRecord.hasRegistrationCard ? 'text-green-700' : 'text-gray-500'}>
                      {selectedRecord.hasRegistrationCard ? `Available ${selectedRecord.rcCardNumber ? `(${selectedRecord.rcCardNumber})` : ''}` : 'Not Available'}
                    </strong>
                  </div>

                  <div className="border-b border-gray-100 pb-2">
                    <span className="text-[11px] text-gray-500 block">Damage Condition</span>
                    <strong className="text-gray-900">{selectedRecord.primaryDamage || 'Normal Wear'}</strong>
                  </div>

                  <div className="border-b border-gray-100 pb-2">
                    <span className="text-[11px] text-gray-500 block">Insurance Status</span>
                    <strong className={selectedRecord.isUnderInsurance ? 'text-green-700' : 'text-gray-500'}>
                      {selectedRecord.isUnderInsurance ? 'Active Insurance' : 'Not Insured'}
                    </strong>
                  </div>
                </div>

                {selectedRecord.description && (
                  <div className="mt-4 pt-3 border-t border-gray-100">
                    <span className="text-[11px] text-gray-500 block mb-1 font-medium">Seller Notes</span>
                    <p className="text-xs text-gray-700 bg-gray-50 p-3 rounded-lg border border-gray-200 leading-relaxed">
                      {selectedRecord.description}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-gray-200 bg-gray-50 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-gray-500">
                Stock ID: <strong className="font-mono text-gray-900">#{selectedRecord.stockNumber}</strong>
              </span>

              <div className="flex flex-wrap items-center gap-2">
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setRecordToDelete(selectedRecord)}
                    className="px-3 py-2 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-xs font-semibold rounded-lg transition inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{selectedRecord.category === 'live' ? 'Delete Livestock' : 'Delete Stock'}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedRecord(null)}
                  className="px-4 py-2 bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 text-xs font-semibold rounded-lg transition cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const targetV = vehicles.find(v => v.id === selectedRecord.vehicleId || v.stockNumber === selectedRecord.stockNumber);
                    setSelectedRecord(null);
                    if (targetV) {
                      onSelectVehicle(targetV);
                    }
                  }}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg transition cursor-pointer"
                >
                  View Vehicle Detail
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ADMIN DELETE CONFIRMATION MODAL */}
      {recordToDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/65 backdrop-blur-xs">
          <div className="bg-white rounded-lg max-w-md w-full p-6 shadow-lg border border-gray-200">
            <div className="w-12 h-12 rounded-lg bg-red-50 border border-red-200 text-red-600 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 text-center mb-1">
              {recordToDelete.category === 'live' ? 'Delete Live Auction Stock?' : 'Delete Stock Record?'}
            </h3>
            <p className="text-xs text-gray-500 text-center mb-4 leading-relaxed">
              This will permanently remove the vehicle from stock inventory, live auctions, and search. This action cannot be undone.
            </p>

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Stock Number</span>
                <span className="font-mono font-bold text-gray-900">#{recordToDelete.stockNumber}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Vehicle</span>
                <span className="font-semibold text-gray-900">{recordToDelete.year} {recordToDelete.make} {recordToDelete.model}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Category</span>
                <span className="font-semibold text-red-600">{getCategoryLabel(recordToDelete.category)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">VIN</span>
                <span className="font-mono text-gray-700">{recordToDelete.vin || 'N/A'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Listed By</span>
                <span className="font-medium text-gray-800">@{recordToDelete.ownerUsername || 'seller'}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setRecordToDelete(null)}
                className="flex-1 py-2.5 bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 font-semibold text-xs rounded-lg transition cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmDelete}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white font-semibold text-xs rounded-lg transition cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {isDeleting ? (
                  <span>Deleting...</span>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Confirm Delete</span>
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
