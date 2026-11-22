import React, { useState, useEffect } from 'react';
import {
  Car,
  Eye,
  Heart,
  Gavel,
  Zap,
  Radio,
  Clock,
  TrendingDown,
  Wallet,
  CheckCircle2,
  AlertTriangle,
  X,
  Plus,
  BarChart3,
  Check,
} from 'lucide-react';
import { Vehicle, VehicleStatus, User } from '../types';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { authFetch } from '../utils/apiClient';

interface BoostPlan {
  id: string;
  name: string;
  price: number;
  duration: string;
  durationMs: number;
  multiplier: string;
  features: string[];
}

const BOOST_PLANS: BoostPlan[] = [
  {
    id: 'starter',
    name: 'Starter Turbo',
    price: 199,
    duration: '24 Hours',
    durationMs: 24 * 60 * 60 * 1000,
    multiplier: '2x More Views',
    features: ['24-Hour highlighted card', 'Featured tag on feed', 'Ranked higher in search'],
  },
  {
    id: 'surge',
    name: 'Super Surge',
    price: 499,
    duration: '3 Days',
    durationMs: 3 * 24 * 60 * 60 * 1000,
    multiplier: '5x More Views',
    features: [
      '3 Days top-tier placement',
      'Push notification to bidders',
      'Priority in Live Auction grid',
      'Highlighted border',
    ],
  },
  {
    id: 'vip',
    name: 'Ultra VIP',
    price: 999,
    duration: 'Full Auction Duration',
    durationMs: 14 * 24 * 60 * 60 * 1000,
    multiplier: '10x Viral Reach',
    features: [
      'Sticky top placement till auction ends',
      'VIP badge on vehicle',
      'Instant alerts to saved buyers',
      'Maximum buyer exposure',
    ],
  },
];

interface DashboardViewProps {
  userVehicles: Vehicle[];
  currentUser?: User;
  onNavigate?: (page: string) => void;
  onSelectVehicle?: (vehicle: Vehicle) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  userVehicles,
  currentUser,
  onNavigate,
  onSelectVehicle,
}) => {
  const [postsTab, setPostsTab] = useState<'current' | 'closed'>('current');
  const [closedFilter, setClosedFilter] = useState<'all' | 'sold' | 'unsold'>('all');

  const [selectedVehicleForBoost, setSelectedVehicleForBoost] = useState<Vehicle | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('surge');
  const [isBoosting, setIsBoosting] = useState<boolean>(false);
  const [boostMessage, setBoostMessage] = useState<{
    text: string;
    type: 'error' | 'success';
  } | null>(null);
  const [endedVehicleNotice, setEndedVehicleNotice] = useState<string | null>(null);
  const [audienceModal, setAudienceModal] = useState<{
    type: 'views' | 'wishlist';
    vehicle: Vehicle;
  } | null>(null);
  const [audienceItems, setAudienceItems] = useState<any[]>([]);
  const [loadingAudience, setLoadingAudience] = useState(false);

  useEffect(() => {
    if (!audienceModal?.vehicle?.id) {
      setAudienceItems([]);
      return;
    }
    let cancelled = false;
    setLoadingAudience(true);
    getDocs(collection(db, 'vehicles', audienceModal.vehicle.id, audienceModal.type))
      .then((snap) => {
        if (cancelled) return;
        const subItems = snap.docs.map((d) => d.data());
        const legacy =
          audienceModal.type === 'views'
            ? audienceModal.vehicle.viewersList || []
            : audienceModal.vehicle.wishlistUsers || [];
        const map = new Map<string, any>();
        [...legacy, ...subItems].forEach((item: any) => {
          if (item?.userId) map.set(item.userId, item);
        });
        const combined = Array.from(map.values()).sort(
          (a, b) => (b.timestamp || 0) - (a.timestamp || 0)
        );
        setAudienceItems(combined);
      })
      .catch(() => {
        if (!cancelled) {
          setAudienceItems(
            audienceModal.type === 'views'
              ? audienceModal.vehicle.viewersList || []
              : audienceModal.vehicle.wishlistUsers || []
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingAudience(false);
      });
    return () => {
      cancelled = true;
    };
  }, [audienceModal?.vehicle?.id, audienceModal?.type]);

  const now = Date.now();
  const availableBalance = currentUser?.deposits || 0;

  const totalListed = userVehicles.length;

  const soldBid = userVehicles.filter(
    (v) =>
      (v.status === VehicleStatus.SOLD || (v.status as string) === 'Sold') &&
      (v.soldVia === 'bid' || !v.soldVia)
  ).length;
  const soldDirect = userVehicles.filter(
    (v) =>
      (v.status === VehicleStatus.SOLD || (v.status as string) === 'Sold') &&
      v.soldVia === 'direct'
  ).length;
  const soldLive = userVehicles.filter(
    (v) =>
      (v.status === VehicleStatus.SOLD || (v.status as string) === 'Sold') &&
      v.soldVia === 'live'
  ).length;

  const isVehicleClosed = (v: Vehicle) =>
    v.status === VehicleStatus.SOLD ||
    (v.status as string) === 'Sold' ||
    (v.status as string) === 'Ended' ||
    v.endTime <= now;
  const isVehicleSold = (v: Vehicle) =>
    v.status === VehicleStatus.SOLD || (v.status as string) === 'Sold' || !!v.soldVia;
  const isVehicleUnsold = (v: Vehicle) => isVehicleClosed(v) && !isVehicleSold(v);

  const unsoldBid = userVehicles.filter((v) => isVehicleUnsold(v) && !v.isBoosted).length;
  const unsoldBoosted = userVehicles.filter((v) => isVehicleUnsold(v) && v.isBoosted).length;

  const totalViews = userVehicles.reduce((acc, v) => acc + (v.views || 0), 0);
  const totalWishlists = userVehicles.reduce(
    (acc, v) => acc + (v.interestedCount || v.watchCount || 0),
    0
  );

  const currentAuctions = userVehicles.filter((v) => !isVehicleClosed(v));
  const allClosedAuctions = userVehicles.filter((v) => isVehicleClosed(v));
  const soldClosedAuctions = allClosedAuctions.filter((v) => isVehicleSold(v));
  const unsoldClosedAuctions = allClosedAuctions.filter((v) => isVehicleUnsold(v));

  let displayedPosts: Vehicle[] = [];
  if (postsTab === 'current') {
    displayedPosts = currentAuctions;
  } else {
    if (closedFilter === 'sold') displayedPosts = soldClosedAuctions;
    else if (closedFilter === 'unsold') displayedPosts = unsoldClosedAuctions;
    else displayedPosts = allClosedAuctions;
  }

  const handleBoostClick = (vehicle: Vehicle) => {
    if (isVehicleClosed(vehicle)) {
      setEndedVehicleNotice(
        `The selected vehicle (${vehicle.year} ${vehicle.make} ${vehicle.model}) auction period has ended. Please select a currently running auction vehicle to boost.`
      );
      return;
    }

    setSelectedVehicleForBoost(vehicle);
    setBoostMessage(null);
  };

  const handleConfirmBoost = async () => {
    if (!selectedVehicleForBoost || !currentUser) return;

    const plan = BOOST_PLANS.find((p) => p.id === selectedPlanId);
    if (!plan) return;

    if (availableBalance < plan.price) {
      setBoostMessage({
        text: `Insufficient wallet balance. Required: ₹${plan.price.toLocaleString()}, Available: ₹${availableBalance.toLocaleString()}. Please top up your wallet.`,
        type: 'error',
      });
      return;
    }

    setIsBoosting(true);
    try {
      const res = await authFetch('/api/wallet/spend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: plan.price,
          serviceName: `Boost Plan (${plan.name}) for ${selectedVehicleForBoost.year} ${selectedVehicleForBoost.make} ${selectedVehicleForBoost.model}`,
          serviceKey: 'vehicle_boost',
          vehicleId: selectedVehicleForBoost.id,
          boostPlanId: plan.id,
          boostPlanName: plan.name,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Server error');
      }

      setBoostMessage({
        text: `Your post has been boosted with the ${plan.name} plan.`,
        type: 'success',
      });

      setTimeout(() => {
        setSelectedVehicleForBoost(null);
        setBoostMessage(null);
      }, 1800);
    } catch (err: any) {
      console.error('Error activating boost:', err);
      setBoostMessage({
        text: `Failed to boost vehicle: ${err.message || 'Server error'}`,
        type: 'error',
      });
    } finally {
      setIsBoosting(false);
    }
  };

  return (
    <div className="mt-4 px-4 max-w-5xl mx-auto space-y-6 pb-20">
      {/* Header with Available Balance */}
      <div className="bg-white p-6 rounded-lg shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border border-gray-200">
        <div>
          <span className="text-xs uppercase font-semibold tracking-wider text-gray-500">
            Seller Activity Control Center
          </span>
          <h2 className="text-2xl font-semibold text-gray-900 mt-1">Manage Dashboard</h2>
          <p className="text-gray-500 text-sm mt-1">
            Track vehicle sales, bidding performance, views, wishlists, and post boosts.
          </p>
        </div>

        <div className="w-full md:w-auto bg-gray-50 border border-gray-200 p-4 rounded-lg flex items-center justify-between md:justify-start gap-5">
          <div>
            <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-gray-500">
              <Wallet className="w-4 h-4 text-gray-600" />
              <span>Available Balance</span>
            </div>
            <div className="text-2xl font-semibold text-gray-900 tabular-nums mt-0.5">
              ₹{availableBalance.toLocaleString()}
            </div>
          </div>

          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('settings')}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap inline-flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Top Up</span>
            </button>
          )}
        </div>
      </div>

      {/* Performance Analytics Grid */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-base text-gray-900 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-red-600" />
            <span>Listing Metrics Overview</span>
          </h3>
          <span className="text-xs text-gray-500">Real-time statistics</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard
            title="Total Vehicles Listed"
            value={totalListed}
            Icon={Car}
            subtitle={totalListed === 0 ? '0 Listed' : `${totalListed} registered`}
          />
          <StatCard
            title="Total Views"
            value={totalViews}
            Icon={Eye}
            subtitle="Across all posts"
          />
          <StatCard
            title="Total Wishlists"
            value={totalWishlists}
            Icon={Heart}
            subtitle="Saved by buyers"
          />
          <StatCard
            title="Sold (Bidding)"
            value={soldBid}
            Icon={Gavel}
            subtitle="Via competitive auction"
          />
          <StatCard
            title="Sold (Direct Buy)"
            value={soldDirect}
            Icon={Zap}
            subtitle="Purchased instantly"
          />
          <StatCard
            title="Sold (Live Listing)"
            value={soldLive}
            Icon={Radio}
            subtitle="Sold in live phase"
          />
          <StatCard
            title="Unsold (Bidding)"
            value={unsoldBid}
            Icon={Clock}
            subtitle="Ended with no winner"
          />
          <StatCard
            title="Unsold (After Boost)"
            value={unsoldBoosted}
            Icon={TrendingDown}
            subtitle="Ended after promotion"
          />
        </div>
      </div>

      {/* My Posts Section */}
      <div className="bg-white rounded-lg p-6 border border-gray-200 shadow-xs space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-200 pb-4">
          <div>
            <h3 className="font-semibold text-lg text-gray-900">My Posts</h3>
            <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
              Filter between your current active listings and closed auctions.
            </p>
          </div>

          <div className="flex bg-gray-100 p-1 rounded-lg gap-1 self-start sm:self-auto border border-gray-200">
            <button
              type="button"
              onClick={() => setPostsTab('current')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-colors ${
                postsTab === 'current'
                  ? 'bg-white text-gray-900 shadow-xs border border-gray-200'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <span>My Current Auctions</span>
              <span className="bg-gray-100 border border-gray-200 text-gray-700 px-2 py-0.5 rounded-lg text-[11px] tabular-nums">
                {currentAuctions.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setPostsTab('closed')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-colors ${
                postsTab === 'closed'
                  ? 'bg-white text-gray-900 shadow-xs border border-gray-200'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <span>My Closed Auctions</span>
              <span className="bg-gray-100 border border-gray-200 text-gray-700 px-2 py-0.5 rounded-lg text-[11px] tabular-nums">
                {allClosedAuctions.length}
              </span>
            </button>
          </div>
        </div>

        {postsTab === 'closed' && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-gray-600">Closed Filter:</span>
              <div className="flex bg-white p-1 rounded-lg border border-gray-200 gap-1">
                <button
                  type="button"
                  onClick={() => setClosedFilter('sold')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    closedFilter === 'sold'
                      ? 'bg-green-600 text-white'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Sold</span>
                  <span className="tabular-nums opacity-85">({soldClosedAuctions.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setClosedFilter('unsold')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    closedFilter === 'unsold'
                      ? 'bg-red-600 text-white'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Unsold</span>
                  <span className="tabular-nums opacity-85">({unsoldClosedAuctions.length})</span>
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setClosedFilter('all')}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
                closedFilter === 'all'
                  ? 'bg-red-600 text-white border-red-600'
                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-100'
              }`}
            >
              All Closed ({allClosedAuctions.length})
            </button>
          </div>
        )}

        {/* Vehicle Posts List */}
        <div className="space-y-4">
          {displayedPosts.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-gray-200 rounded-lg bg-gray-50">
              <div className="w-12 h-12 bg-white border border-gray-200 text-gray-400 rounded-lg flex items-center justify-center mx-auto mb-3">
                <Car className="w-6 h-6" />
              </div>
              <p className="text-gray-900 font-semibold text-base">
                {totalListed === 0 ? 'Total vehicles listed: 0' : 'No vehicles found in this section'}
              </p>
              <p className="text-gray-500 text-xs mt-1 max-w-sm mx-auto">
                {postsTab === 'current'
                  ? "You don't have any running auctions right now. Tap 'Sell' in the navigation bar to list a new vehicle."
                  : "You don't have any closed auctions in this filter category."}
              </p>
              {postsTab === 'current' && onNavigate && (
                <button
                  type="button"
                  onClick={() => onNavigate('sell')}
                  className="mt-4 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>List a Vehicle</span>
                </button>
              )}
            </div>
          ) : (
            displayedPosts.map((vehicle) => {
              const closed = isVehicleClosed(vehicle);
              const sold = isVehicleSold(vehicle);

              return (
                <div
                  key={vehicle.id}
                  className="bg-white border border-gray-200 rounded-lg p-4 flex flex-col md:flex-row gap-4 shadow-xs w-full"
                >
                  {/* Thumbnail */}
                  <div
                    className="relative w-full md:w-52 aspect-[16/10] shrink-0 cursor-pointer overflow-hidden rounded-lg bg-gray-100 border border-gray-200"
                    onClick={() => onSelectVehicle?.(vehicle)}
                  >
                    <img
                      src={
                        vehicle.images?.[vehicle.coverImageIndex || 0] ||
                        `https://picsum.photos/id/${vehicle.imageSeed}/1200/800`
                      }
                      className="w-full h-full object-cover object-center"
                      alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                    />

                    <div className="absolute top-2 left-2 flex flex-wrap items-center gap-1 z-10">
                      {sold ? (
                        <span className="bg-green-600 text-white text-[11px] font-semibold px-2 py-0.5 rounded-lg">
                          Sold
                        </span>
                      ) : closed ? (
                        <span className="bg-gray-800 text-white text-[11px] font-semibold px-2 py-0.5 rounded-lg">
                          Ended
                        </span>
                      ) : vehicle.status === 'Live Auction' ? (
                        <span className="bg-red-600 text-white text-[11px] font-semibold px-2 py-0.5 rounded-lg">
                          Live
                        </span>
                      ) : (
                        <span className="bg-white/95 text-gray-900 border border-gray-200 text-[11px] font-semibold px-2 py-0.5 rounded-lg">
                          {vehicle.status}
                        </span>
                      )}
                      {vehicle.hasRegistrationCard && (
                        <span
                          className="bg-green-600 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-lg"
                          title="Registration Card (RC) Available"
                        >
                          RC
                        </span>
                      )}
                    </div>

                    {vehicle.isBoosted && (
                      <div className="absolute bottom-2 left-2 bg-gray-900/90 text-white text-[10px] font-semibold px-2 py-0.5 rounded-lg flex items-center gap-1 z-10">
                        <Zap className="w-3 h-3 text-red-400" />
                        <span>{vehicle.boostPlan || 'Boosted'}</span>
                      </div>
                    )}
                  </div>

                  {/* Info & Metrics */}
                  <div className="flex-1 min-w-0 flex flex-col justify-between gap-3">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 min-w-0">
                      <div className="min-w-0 flex-1">
                        <h4
                          onClick={() => onSelectVehicle?.(vehicle)}
                          className="font-semibold text-gray-900 text-base hover:text-red-600 cursor-pointer transition-colors break-words leading-snug"
                        >
                          {vehicle.year} {vehicle.make} {vehicle.model}
                        </h4>
                        <p className="text-xs text-gray-500 tabular-nums mt-0.5 truncate">
                          VIN: {vehicle.vin}
                        </p>
                      </div>

                      <div className="sm:text-right shrink-0">
                        <div className="text-[11px] text-gray-500 font-medium uppercase tracking-wider">
                          {sold ? 'Final Sold Price' : 'Current Bid'}
                        </div>
                        <div className="text-lg sm:text-xl font-semibold text-gray-900 tabular-nums">
                          ₹{(vehicle.currentBid || 0).toLocaleString()}
                        </div>
                        {vehicle.buyNowPrice && (
                          <div className="text-xs text-gray-600 tabular-nums font-medium mt-0.5">
                            Direct Buy: ₹{(vehicle.buyNowPrice || 0).toLocaleString()}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-gray-200 text-xs font-medium text-gray-600">
                      <button
                        type="button"
                        onClick={() => setAudienceModal({ type: 'views', vehicle })}
                        className="inline-flex items-center gap-1.5 bg-gray-50 hover:bg-gray-100 px-2.5 py-1.5 rounded-lg border border-gray-200 transition-colors cursor-pointer shrink-0 text-xs"
                      >
                        <Eye className="w-3.5 h-3.5 text-gray-600 shrink-0" />
                        <span className="font-semibold text-gray-900 tabular-nums">
                          {vehicle.views || vehicle.viewersList?.length || 0} Views
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setAudienceModal({ type: 'wishlist', vehicle })}
                        className="inline-flex items-center gap-1.5 bg-gray-50 hover:bg-gray-100 px-2.5 py-1.5 rounded-lg border border-gray-200 transition-colors cursor-pointer shrink-0 text-xs"
                      >
                        <Heart className="w-3.5 h-3.5 text-red-600 shrink-0" />
                        <span className="font-semibold text-gray-900 tabular-nums">
                          {vehicle.wishlistUsers?.length ||
                            vehicle.interestedCount ||
                            vehicle.watchCount ||
                            0}{' '}
                          Wishlists
                        </span>
                      </button>

                      {sold && vehicle.soldVia && (
                        <div className="text-xs text-green-700 bg-green-50 border border-green-200 px-2.5 py-1 rounded-lg font-medium shrink-0">
                          Sold via:{' '}
                          {vehicle.soldVia === 'direct'
                            ? 'Direct Purchase'
                            : vehicle.soldVia === 'live'
                            ? 'Live Auction'
                            : 'Bidding'}
                        </div>
                      )}

                      {!sold && closed && (
                        <div className="text-xs text-gray-600 bg-gray-100 px-2.5 py-1 rounded-lg shrink-0">
                          Unsold at auction end
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Action Column */}
                  <div className="flex sm:flex-row md:flex-col items-stretch sm:items-center md:items-stretch justify-end md:justify-center border-t md:border-t-0 md:border-l border-gray-200 pt-3 md:pt-0 md:pl-4 gap-2 shrink-0 md:w-40">
                    <button
                      type="button"
                      onClick={() => handleBoostClick(vehicle)}
                      className={`w-full py-2 px-3 rounded-lg font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors ${
                        closed
                          ? 'bg-gray-100 text-gray-500 border border-gray-200 hover:bg-gray-200 cursor-pointer'
                          : 'bg-red-600 hover:bg-red-700 text-white cursor-pointer'
                      }`}
                    >
                      <Zap className="w-3.5 h-3.5" />
                      <span>
                        {closed ? 'Boost (Ended)' : vehicle.isBoosted ? 'Boost Again' : 'Boost Post'}
                      </span>
                    </button>

                    {onSelectVehicle && (
                      <button
                        type="button"
                        onClick={() => onSelectVehicle(vehicle)}
                        className="w-full py-2 px-3 bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 rounded-lg font-medium text-xs transition-colors text-center cursor-pointer"
                      >
                        View Post
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ENDED VEHICLE BOOST WARNING MODAL */}
      {endedVehicleNotice && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-md border border-gray-200 text-center space-y-4">
            <div className="w-12 h-12 bg-gray-100 border border-gray-200 text-gray-700 rounded-lg flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h4 className="text-lg font-semibold text-gray-900">Auction Period Has Ended</h4>
            <p className="text-sm text-gray-600 leading-relaxed">{endedVehicleNotice}</p>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-700 text-left">
              <strong>Note:</strong> Paid boost promotions are only applicable to currently running (Active or Upcoming) auction listings.
            </div>
            <div className="pt-2 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setEndedVehicleNotice(null);
                  setPostsTab('current');
                }}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg text-xs transition-colors"
              >
                Go to Current Auctions
              </button>
              <button
                type="button"
                onClick={() => setEndedVehicleNotice(null)}
                className="px-4 py-2.5 bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-700 font-medium rounded-lg text-xs transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PAID BOOST PLANS MODAL */}
      {selectedVehicleForBoost && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-lg max-w-xl w-full shadow-md border border-gray-200 overflow-hidden my-8">
            <div className="bg-white border-b border-gray-200 p-6">
              <div className="flex justify-between items-start">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-red-600 flex items-center gap-1.5 mb-1">
                    <Zap className="w-3.5 h-3.5" />
                    <span>Instant Promotion Plans</span>
                  </span>
                  <h3 className="text-xl font-semibold text-gray-900">Boost Vehicle Listing</h3>
                  <p className="text-xs text-gray-500 mt-1">
                    Promoting:{' '}
                    <strong className="text-gray-900">
                      {selectedVehicleForBoost.year} {selectedVehicleForBoost.make}{' '}
                      {selectedVehicleForBoost.model}
                    </strong>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedVehicleForBoost(null)}
                  className="text-gray-500 hover:text-gray-900 p-2 rounded-lg hover:bg-gray-100 border border-gray-200 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="mt-4 inline-flex items-center gap-2 bg-gray-50 px-3 py-1.5 rounded-lg text-xs border border-gray-200">
                <span className="text-gray-600">Your Wallet Balance:</span>
                <strong className="text-gray-900 font-semibold tabular-nums">
                  ₹{availableBalance.toLocaleString()}
                </strong>
              </div>
            </div>

            <div className="p-6 space-y-5">
              {boostMessage && (
                <div
                  className={`p-3 rounded-lg text-xs font-medium flex items-center gap-2.5 border ${
                    boostMessage.type === 'error'
                      ? 'bg-red-50 text-red-700 border-red-200'
                      : 'bg-green-50 text-green-700 border-green-200'
                  }`}
                >
                  {boostMessage.type === 'error' ? (
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                  )}
                  <div className="flex-1">{boostMessage.text}</div>
                  {boostMessage.type === 'error' && onNavigate && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedVehicleForBoost(null);
                        onNavigate('settings');
                      }}
                      className="px-3 py-1 bg-red-600 text-white rounded-lg text-xs font-semibold whitespace-nowrap"
                    >
                      Add Funds
                    </button>
                  )}
                </div>
              )}

              <div className="space-y-3">
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Select Promotion Tier
                </label>

                {BOOST_PLANS.map((plan) => {
                  const isSelected = selectedPlanId === plan.id;
                  const canAfford = availableBalance >= plan.price;

                  return (
                    <div
                      key={plan.id}
                      onClick={() => setSelectedPlanId(plan.id)}
                      className={`p-4 rounded-lg border transition-colors cursor-pointer ${
                        isSelected
                          ? 'border-red-600 bg-red-50/30 ring-1 ring-red-600'
                          : 'border-gray-200 hover:border-gray-300 bg-white'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className={`w-4 h-4 shrink-0 rounded-full border-2 flex items-center justify-center ${
                              isSelected ? 'border-red-600 bg-red-600' : 'border-gray-300'
                            }`}
                          >
                            {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                          </div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-gray-900 text-sm">
                                {plan.name}
                              </span>
                              <span className="text-[11px] font-medium text-gray-700 px-2 py-0.5 rounded-lg bg-gray-100 border border-gray-200 whitespace-nowrap">
                                {plan.multiplier}
                              </span>
                            </div>
                            <span className="text-xs text-gray-500 block mt-0.5">
                              Duration: {plan.duration}
                            </span>
                          </div>
                        </div>

                        <div className="flex sm:flex-col items-baseline sm:items-end justify-between sm:justify-start gap-1 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-gray-200 sm:text-right">
                          <span className="text-lg font-semibold text-gray-900 tabular-nums">
                            ₹{plan.price.toLocaleString()}
                          </span>
                          <div
                            className={`text-[11px] font-medium ${
                              canAfford ? 'text-green-600' : 'text-red-600'
                            }`}
                          >
                            {canAfford ? 'Available in wallet' : 'Insufficient balance'}
                          </div>
                        </div>
                      </div>

                      <ul className="mt-3 pt-3 border-t border-gray-200 grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs text-gray-600">
                        {plan.features.map((feat, fidx) => (
                          <li key={fidx} className="flex items-center gap-1.5">
                            <Check className="w-3.5 h-3.5 text-green-600 shrink-0" />
                            <span>{feat}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>

              <div className="pt-2 flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedVehicleForBoost(null)}
                  className="w-full sm:w-auto px-5 py-2.5 bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-700 font-medium rounded-lg text-sm transition-colors"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={handleConfirmBoost}
                  disabled={isBoosting}
                  className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <Zap className="w-4 h-4" />
                  <span>
                    {isBoosting
                      ? 'Activating Boost...'
                      : `Confirm & Activate Boost (₹${
                          BOOST_PLANS.find((p) => p.id === selectedPlanId)?.price
                        })`}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AUDIENCE MODAL */}
      {audienceModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg max-w-md w-full shadow-md border border-gray-200 overflow-hidden flex flex-col max-h-[85vh]">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-white">
              <div>
                <div className="flex items-center gap-2">
                  {audienceModal.type === 'views' ? (
                    <Eye className="w-4 h-4 text-gray-700" />
                  ) : (
                    <Heart className="w-4 h-4 text-red-600" />
                  )}
                  <h3 className="text-base font-semibold text-gray-900">
                    {audienceModal.type === 'views'
                      ? 'Original Listing Viewers'
                      : 'Original Wishlist Users'}
                  </h3>
                </div>
                <p className="text-xs text-gray-500 mt-0.5 truncate max-w-[280px]">
                  {audienceModal.vehicle.year} {audienceModal.vehicle.make}{' '}
                  {audienceModal.vehicle.model}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAudienceModal(null)}
                className="w-8 h-8 rounded-lg bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-500 flex items-center justify-center transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1 divide-y divide-gray-200">
              {(() => {
                if (loadingAudience) {
                  return (
                    <div className="text-center py-10 text-xs text-gray-500">
                      Loading engagement records...
                    </div>
                  );
                }
                const list = audienceItems;

                if (list.length === 0) {
                  return (
                    <div className="text-center py-10 px-4 space-y-2">
                      <div className="w-10 h-10 rounded-lg bg-gray-100 border border-gray-200 text-gray-500 flex items-center justify-center mx-auto">
                        {audienceModal.type === 'views' ? (
                          <Eye className="w-5 h-5" />
                        ) : (
                          <Heart className="w-5 h-5" />
                        )}
                      </div>
                      <h4 className="text-sm font-semibold text-gray-900">
                        {audienceModal.type === 'views'
                          ? 'No registered viewers recorded yet'
                          : 'No users have wishlisted this vehicle yet'}
                      </h4>
                      <p className="text-xs text-gray-500 max-w-xs mx-auto leading-relaxed">
                        {audienceModal.type === 'views'
                          ? 'AutoBid records registered accounts that inspect this post.'
                          : 'When prospective buyers wishlist your car, their profiles will appear here.'}
                      </p>
                    </div>
                  );
                }

                return (
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wider px-1">
                      {list.length} Verified Platform Member{list.length > 1 ? 's' : ''}
                    </div>
                    {list.map((u, i) => (
                      <div
                        key={u.userId || i}
                        className="flex items-center justify-between gap-3 p-2 rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <img
                            src={u.avatarUrl || `https://i.pravatar.cc/150?u=${u.userId || i}`}
                            alt={u.username || 'User'}
                            className="w-9 h-9 rounded-full object-cover border border-gray-200 shrink-0"
                          />
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-gray-900 truncate">
                              {u.fullName || u.username || 'AutoBid Member'}
                            </div>
                            <div className="text-xs text-gray-500 truncate">
                              @{u.username || 'member'}
                            </div>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-[11px] text-gray-400 tabular-nums block">
                            {u.timestamp
                              ? new Date(u.timestamp).toLocaleDateString(undefined, {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })
                              : 'Recent'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>

            <div className="p-4 border-t border-gray-200 bg-gray-50 text-center">
              <button
                type="button"
                onClick={() => setAudienceModal(null)}
                className="w-full py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const StatCard = ({
  title,
  value,
  Icon,
  subtitle,
}: {
  title: string;
  value: number;
  Icon: React.ComponentType<{ className?: string }>;
  subtitle?: string;
}) => (
  <div className="bg-white border border-gray-200 rounded-lg p-4 flex flex-col justify-between shadow-xs">
    <div className="flex items-center justify-between mb-2">
      <span className="text-xs font-medium text-gray-500 leading-tight">{title}</span>
      <span className="p-1.5 rounded-lg bg-gray-50 border border-gray-200 text-gray-600">
        <Icon className="w-4 h-4" />
      </span>
    </div>
    <div>
      <div className="text-2xl font-semibold text-gray-900 tabular-nums">{value}</div>
      {subtitle && <p className="text-xs text-gray-400 mt-1">{subtitle}</p>}
    </div>
  </div>
);
