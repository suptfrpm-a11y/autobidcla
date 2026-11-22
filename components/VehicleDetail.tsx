import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft,
  Share2,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  ZoomIn,
  Play,
  Pause,
  Heart,
  Bookmark,
  Eye,
  MessageCircle,
  UserPlus,
  Check,
  ShieldCheck,
  Zap,
  AlertTriangle,
  Lock,
  Tag,
  Calendar,
  Flag,
  Radio,
  Package,
  FileText,
  Trophy,
  X,
  Shuffle,
  Copy,
  Sparkles,
  Plus
} from 'lucide-react';
import { Vehicle, User } from '../types';
import { generateVehicleAnalysis } from '../services/geminiService';
import { IdentityVerificationModal } from './IdentityVerificationModal';
import { playBidClickSound } from '../utils/soundEffects';
import { db, doc, collection, onSnapshot, setDoc, deleteDoc } from '../firebase';
import { authFetch } from '../utils/apiClient';

interface VehicleDetailProps {
  vehicle: Vehicle;
  onBack: () => void;
  onPlaceBid: (amount: number) => void;
  onPlaceUpcomingBid?: () => void;
  onMarkSold?: () => void;
  onConvertToDirectSale?: (vehicleId: string, directPrice: number) => void;
  currentUser?: User;
  t: any;
  onViewProfile?: (user: User) => void;
  onFollowToggle?: (user: User) => void;
  allUsers?: User[];
  isFollowLoading?: boolean;
  onOpenChat?: (user: User) => void;
  onMessageSeller?: (sellerUsername: string) => void;
  onUpdateVehicle?: (patch: Partial<Vehicle>) => void;
}

export const VehicleDetail: React.FC<VehicleDetailProps> = ({
  vehicle,
  onBack,
  onPlaceBid,
  onPlaceUpcomingBid,
  onMarkSold,
  onConvertToDirectSale,
  currentUser,
  t,
  onViewProfile,
  onFollowToggle,
  allUsers,
  isFollowLoading = false,
  onOpenChat,
  onMessageSeller,
  onUpdateVehicle
}) => {
  const formatPrice = (val: any): string => {
    const num = Number(val);
    return (isNaN(num) ? 0 : num).toLocaleString();
  };

  const calculateDefaultIncrement = (currentBid: number = 0): number => {
    const base = Number(currentBid) || 0;
    return Math.max(1, Math.ceil(base * 0.001));
  };

  const calculateDefaultLeadingBid = (currentBid: number = 0): number => {
    const base = Number(currentBid) || 0;
    return base + calculateDefaultIncrement(base);
  };

  const [bidAmount, setBidAmount] = useState<number>(() => calculateDefaultLeadingBid(vehicle.currentBid || vehicle.startingPrice || 0));

  const [oneClickBidEnabled, setOneClickBidEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('autobid_one_click_bid') === 'true';
    } catch {
      return false;
    }
  });

  const [rememberOneClickInModal, setRememberOneClickInModal] = useState<boolean>(false);
  const prevBidRef = useRef<number>(vehicle.currentBid || vehicle.startingPrice || 0);

  const [analysis, setAnalysis] = useState<string | null>(null);
  const [isLoadingAnalysis, setIsLoadingAnalysis] = useState(false);
  const [showBidModal, setShowBidModal] = useState(false);
  const [showVerificationModal, setShowVerificationModal] = useState(false);
  const [showDirectShiftModal, setShowDirectShiftModal] = useState(false);
  const [newDirectPrice, setNewDirectPrice] = useState<number>(
    vehicle.directPrice || vehicle.startingPrice || vehicle.currentBid || 100000
  );
  const [currentTimeLeft, setCurrentTimeLeft] = useState<string>('');
  const [fitMode, setFitMode] = useState<'contain' | 'cover'>('contain');
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [showRcModal, setShowRcModal] = useState(false);
  const [isAutoScrollPaused, setIsAutoScrollPaused] = useState<boolean>(false);
  const [likesList, setLikesList] = useState<any[]>(vehicle.likesList || []);
  const [wishlistUsers, setWishlistUsers] = useState<any[]>(vehicle.wishlistUsers || []);
  const [viewersList, setViewersList] = useState<any[]>(vehicle.viewersList || []);
  const [viewsCount, setViewsCount] = useState<number>(() => Math.max(vehicle.views || 0, (vehicle.viewersList || []).length));
  const [engagementModal, setEngagementModal] = useState<{ type: 'likes' | 'wishlist' | 'views' } | null>(null);
  const [inlineToast, setInlineToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [copiedStock, setCopiedStock] = useState(false);

  const showToast = (type: 'success' | 'error', text: string) => {
    setInlineToast({ type, text });
    setTimeout(() => setInlineToast(null), 3500);
  };

  useEffect(() => {
    if (vehicle.likesList) setLikesList(vehicle.likesList);
    if (vehicle.wishlistUsers) setWishlistUsers(vehicle.wishlistUsers);
    if (vehicle.viewersList) setViewersList(vehicle.viewersList);
    if (typeof vehicle.views === 'number') {
      setViewsCount(prev => Math.max(prev, vehicle.views || 0));
    }
  }, [vehicle.id, vehicle.views, vehicle.likesCount, vehicle.interestedCount, vehicle.watchCount]);

  useEffect(() => {
    if (!vehicle?.id) return;
    const unsubViews = onSnapshot(collection(db, 'vehicles', vehicle.id, 'views'), (snap) => {
      const list = snap.docs.map(d => d.data());
      list.sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0));
      setViewersList(list);
      setViewsCount(prev => Math.max(prev, list.length, vehicle.views || 0));
    }, () => {});
    const unsubLikes = onSnapshot(collection(db, 'vehicles', vehicle.id, 'likes'), (snap) => {
      const list = snap.docs.map(d => d.data());
      list.sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0));
      setLikesList(list);
    }, () => {});
    const unsubWish = onSnapshot(collection(db, 'vehicles', vehicle.id, 'wishlist'), (snap) => {
      const list = snap.docs.map(d => d.data());
      list.sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0));
      setWishlistUsers(list);
    }, () => {});
    return () => {
      unsubViews();
      unsubLikes();
      unsubWish();
    };
  }, [vehicle.id]);

  const isLiked = Boolean(currentUser?.id && likesList.some(u => u.userId === currentUser.id));
  const isWishlisted = Boolean(currentUser?.id && wishlistUsers.some(u => u.userId === currentUser.id));
  const likesCount = Math.max(likesList.length, vehicle.likesCount || 0);
  const wishlistCount = Math.max(wishlistUsers.length, vehicle.interestedCount || vehicle.watchCount || 0);

  useEffect(() => {
    if (!vehicle?.id) return;
    setViewsCount(prev => Math.max(prev, (vehicle.views || 0) + 1));

    if (!currentUser?.id) return;
    const viewerObj = {
      userId: currentUser.id,
      username: currentUser.username || 'Verified Member',
      fullName: currentUser.fullName || currentUser.username || 'AutoBid Member',
      avatarUrl: currentUser.avatarUrl || '',
      timestamp: Date.now()
    };

    const persistRealView = async () => {
      try {
        await setDoc(doc(db, 'vehicles', vehicle.id, 'views', currentUser.id), viewerObj, { merge: true });
        await authFetch(`/api/vehicles/${vehicle.id}/engage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        }).catch(() => {});
      } catch (err) {
        console.warn("View record warn:", err);
      }
    };

    persistRealView();
  }, [vehicle.id, currentUser?.id]);

  const handleToggleLike = async () => {
    if (!currentUser?.id) {
      showToast('error', 'Please sign in to like this vehicle.');
      return;
    }
    const alreadyLiked = likesList.some(u => u.userId === currentUser.id);

    try {
      const likeRef = doc(db, 'vehicles', vehicle.id, 'likes', currentUser.id);
      if (alreadyLiked) {
        await deleteDoc(likeRef);
      } else {
        await setDoc(likeRef, {
          userId: currentUser.id,
          username: currentUser.username,
          fullName: currentUser.fullName || currentUser.username,
          avatarUrl: currentUser.avatarUrl || '',
          timestamp: Date.now()
        });
      }
      const res = await authFetch(`/api/vehicles/${vehicle.id}/engage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      if (res.ok && onUpdateVehicle) {
        const data = await res.json();
        if (data.success) {
          onUpdateVehicle({ likesCount: data.likesCount });
        }
      }
    } catch (err) {
      console.warn("Error updating likes:", err);
    }
  };

  const handleToggleWishlist = async () => {
    if (!currentUser?.id) {
      showToast('error', 'Please sign in to save this vehicle to your wishlist.');
      return;
    }
    const alreadySaved = wishlistUsers.some(u => u.userId === currentUser.id);
    try {
      const wishRef = doc(db, 'vehicles', vehicle.id, 'wishlist', currentUser.id);
      if (alreadySaved) {
        await deleteDoc(wishRef);
      } else {
        await setDoc(wishRef, {
          userId: currentUser.id,
          username: currentUser.username,
          fullName: currentUser.fullName || currentUser.username,
          avatarUrl: currentUser.avatarUrl || '',
          timestamp: Date.now()
        });
      }
      const res = await authFetch(`/api/vehicles/${vehicle.id}/engage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      if (res.ok && onUpdateVehicle) {
        const data = await res.json();
        if (data.success) {
          onUpdateVehicle({ watchCount: data.watchCount, interestedCount: data.interestedCount });
        }
      }
    } catch (err) {
      console.warn("Error updating wishlist:", err);
    }
  };

  const handleSharePost = async () => {
    const shareTitle = `${vehicle.year} ${vehicle.make} ${vehicle.model} on AutoBid`;
    const shareText = `Check out this ${vehicle.year} ${vehicle.make} ${vehicle.model} on AutoBid! Current Bid: ₹${(vehicle.currentBid || vehicle.startingPrice || 0).toLocaleString()}`;
    const shareUrl = window.location.href;

    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: shareTitle,
          text: shareText,
          url: shareUrl
        });
        return;
      } catch (err: any) {
        if (err.name === 'AbortError') return;
      }
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast('success', 'Vehicle link copied to clipboard.');
    } catch {
      showToast('success', `Link ready: ${shareUrl}`);
    }
  };

  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const thumbnailContainerRef = useRef<HTMLDivElement | null>(null);
  const thumbnailRefs = useRef<(HTMLDivElement | null)[]>([]);

  const now = Date.now();
  const isDirectSale = vehicle.listingType === 'direct' || vehicle.status === 'Direct Sale' || (vehicle.status as any) === 'Direct Sale';
  const isUpcoming = !isDirectSale && ((vehicle.startTime && vehicle.startTime > now) || vehicle.status === 'Upcoming');
  const isEnded = !isDirectSale && (vehicle.status === 'Sold' || (!isUpcoming && vehicle.endTime <= now));
  const isLive = !isDirectSale && !isUpcoming && !isEnded;
  const isOwner = Boolean(currentUser && currentUser.id && vehicle.ownerId === currentUser.id);
  const isUnsoldAuction = !isDirectSale && isEnded && vehicle.status !== 'Sold' && (!vehicle.winningUserId || vehicle.currentBid === vehicle.startingPrice);

  const sellerUser: User | undefined = allUsers?.find(u =>
    (vehicle.ownerId && u.id === vehicle.ownerId) ||
    (vehicle.ownerUsername && (u.username || '').toLowerCase() === vehicle.ownerUsername.toLowerCase())
  );

  const isFollowingSeller = Boolean(
    currentUser?.followingIds && (
      (vehicle.ownerId && currentUser.followingIds.includes(vehicle.ownerId)) ||
      (sellerUser?.id && currentUser.followingIds.includes(sellerUser.id))
    )
  );

  const sellerFollowsMe = Boolean(
    (sellerUser?.followingIds && currentUser?.id && sellerUser.followingIds.includes(currentUser.id)) ||
    (currentUser?.followersIds && (
      (vehicle.ownerId && currentUser.followersIds.includes(vehicle.ownerId)) ||
      (sellerUser?.id && currentUser.followersIds.includes(sellerUser.id))
    ))
  );

  const resolvedSeller: User = sellerUser || {
    id: vehicle.ownerId || 'seller_' + (vehicle.ownerUsername || 'user'),
    username: vehicle.ownerUsername || 'seller',
    fullName: vehicle.ownerUsername ? `@${vehicle.ownerUsername}` : 'Vehicle Seller',
    avatarUrl: `https://i.pravatar.cc/150?u=${vehicle.ownerUsername || vehicle.ownerId || 'seller'}`,
    followers: 0,
    following: 0,
    bio: 'Vehicle Seller on AutoBid'
  };

  const askingPrice = vehicle.startingPrice || vehicle.currentBid || 0;
  const upcomingBids = vehicle.upcomingBids || [];
  const lastPreBidder = upcomingBids.length > 0 ? upcomingBids[upcomingBids.length - 1] : null;
  const hasUserPreBid = currentUser ? upcomingBids.some(b => b.userId === currentUser.id) : false;
  const isUserLeadingPreBid = lastPreBidder && currentUser && lastPreBidder.userId === currentUser.id;

  const galleryImages = (vehicle.images && vehicle.images.length > 0)
    ? vehicle.images
    : [0, 1, 2, 3].map((i) => `https://picsum.photos/id/${vehicle.imageSeed + i}/1200/800`);

  const initialCover = (vehicle.images && vehicle.images.length > 0)
    ? (vehicle.coverImageIndex !== undefined && vehicle.images[vehicle.coverImageIndex] ? vehicle.images[vehicle.coverImageIndex] : vehicle.images[0])
    : galleryImages[0];

  const [mainImage, setMainImage] = useState<string>(initialCover);

  useEffect(() => {
    const cover = (vehicle.images && vehicle.images.length > 0)
      ? (vehicle.coverImageIndex !== undefined && vehicle.images[vehicle.coverImageIndex] ? vehicle.images[vehicle.coverImageIndex] : vehicle.images[0])
      : `https://picsum.photos/id/${vehicle.imageSeed}/1200/800`;
    setMainImage(cover);
    setBidAmount(calculateDefaultLeadingBid(vehicle.currentBid || vehicle.startingPrice || 0));
  }, [vehicle]);

  const currentImageIndex = Math.max(0, galleryImages.indexOf(mainImage));

  const handlePrevImage = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const nextIdx = (currentImageIndex - 1 + galleryImages.length) % galleryImages.length;
    setMainImage(galleryImages[nextIdx]);
  };

  const handleNextImage = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const nextIdx = (currentImageIndex + 1) % galleryImages.length;
    setMainImage(galleryImages[nextIdx]);
  };

  useEffect(() => {
    if (galleryImages.length <= 1 || isAutoScrollPaused || isLightboxOpen) return;
    const interval = setInterval(() => {
      setMainImage((prev) => {
        const idx = galleryImages.indexOf(prev);
        const nextIdx = (idx + 1) % galleryImages.length;
        return galleryImages[nextIdx];
      });
    }, 3800);
    return () => clearInterval(interval);
  }, [galleryImages, isAutoScrollPaused, isLightboxOpen]);

  useEffect(() => {
    const activeThumb = thumbnailRefs.current[currentImageIndex];
    const container = thumbnailContainerRef.current;
    if (activeThumb && container) {
      const targetLeft = activeThumb.offsetLeft - (container.clientWidth / 2) + (activeThumb.clientWidth / 2);
      container.scrollTo({
        left: targetLeft,
        behavior: 'smooth'
      });
    }
  }, [currentImageIndex]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0].clientX;
    touchStartYRef.current = e.touches[0].clientY;
    setIsAutoScrollPaused(true);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartXRef.current !== null && touchStartYRef.current !== null) {
      const touchEndX = e.changedTouches[0].clientX;
      const touchEndY = e.changedTouches[0].clientY;
      const diffX = touchStartXRef.current - touchEndX;
      const diffY = touchStartYRef.current - touchEndY;

      if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 35) {
        if (diffX > 0) {
          const nextIdx = (currentImageIndex + 1) % galleryImages.length;
          setMainImage(galleryImages[nextIdx]);
        } else {
          const prevIdx = (currentImageIndex - 1 + galleryImages.length) % galleryImages.length;
          setMainImage(galleryImages[prevIdx]);
        }
      }
    }
    touchStartXRef.current = null;
    touchStartYRef.current = null;
    const resumeTimer = setTimeout(() => {
      setIsAutoScrollPaused(false);
    }, 4500);
    return () => clearTimeout(resumeTimer);
  };

  useEffect(() => {
    const formatDiff = (diffMs: number) => {
      if (diffMs <= 0) return '0m 0s';
      const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);
      const pad = (n: number) => n.toString().padStart(2, '0');

      if (days > 0) return `${days}d ${hours}h ${pad(minutes)}m`;
      if (hours > 0) return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
      return `${pad(minutes)}m ${pad(seconds)}s`;
    };

    const updateTimer = () => {
      const currentNow = Date.now();
      if (isEnded) {
        setCurrentTimeLeft('Auction Ended');
      } else if (isUpcoming) {
        const diff = (vehicle.startTime || currentNow) - currentNow;
        setCurrentTimeLeft(diff > 0 ? `Starts in ${formatDiff(diff)}` : 'Starting now...');
      } else {
        const diff = vehicle.endTime - currentNow;
        setCurrentTimeLeft(diff > 0 ? formatDiff(diff) : 'Ended');
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [vehicle, isUpcoming, isEnded]);

  useEffect(() => {
    const cur = vehicle.currentBid || vehicle.startingPrice || 0;
    if (prevBidRef.current !== undefined && cur > prevBidRef.current) {
      playBidClickSound();
      setBidAmount(calculateDefaultLeadingBid(cur));
    }
    prevBidRef.current = cur;
  }, [vehicle.currentBid, vehicle.startingPrice]);

  const handleSetDefaultLeadingBid = () => {
    setBidAmount(calculateDefaultLeadingBid(vehicle.currentBid || vehicle.startingPrice || 0));
  };

  const handleQuickPercentBoost = (pct: number) => {
    const base = vehicle.currentBid || vehicle.startingPrice || 0;
    const boost = Math.max(1, Math.ceil(base * pct));
    setBidAmount(base + boost);
  };

  const handleRandomBoost = () => {
    const base = vehicle.currentBid || vehicle.startingPrice || 0;
    const baseIncrement = calculateDefaultIncrement(base);
    const factor = 2 + Math.floor(Math.random() * 16);
    let boost = baseIncrement * factor;
    if (boost > 500) {
      boost = Math.round(boost / 50) * 50;
    } else if (boost > 50) {
      boost = Math.round(boost / 10) * 10;
    }
    const finalBoost = Math.max(baseIncrement + 1, boost);
    setBidAmount(base + finalBoost);
  };

  const toggleOneClickBid = (enabled: boolean) => {
    setOneClickBidEnabled(enabled);
    try {
      localStorage.setItem('autobid_one_click_bid', enabled ? 'true' : 'false');
    } catch {}
  };

  const handleGenerateAnalysis = async () => {
    setIsLoadingAnalysis(true);
    const result = await generateVehicleAnalysis(vehicle);
    setAnalysis(result);
    setIsLoadingAnalysis(false);
  };

  const executeBid = (targetAmount: number) => {
    const currBid = vehicle.currentBid || vehicle.startingPrice || 0;
    if (targetAmount <= currBid) {
      showToast('error', `Your bid must be higher than ₹${formatPrice(currBid)}.`);
      return;
    }
    if (currentUser && vehicle.ownerId && vehicle.ownerId === currentUser.id) {
      showToast('error', 'You cannot place bids on your own vehicle listing.');
      return;
    }
    if (currentUser && !currentUser.isVerified) {
      setShowVerificationModal(true);
      return;
    }

    const nextInc = Math.max(1, Math.ceil(targetAmount * 0.001));
    setBidAmount(targetAmount + nextInc);
    onPlaceBid(targetAmount);
  };

  const handleBidSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const currBid = vehicle.currentBid || vehicle.startingPrice || 0;
    if (bidAmount <= currBid) {
      showToast('error', `Your bid must be higher than ₹${formatPrice(currBid)}.`);
      return;
    }
    if (currentUser && vehicle.ownerId && vehicle.ownerId === currentUser.id) {
      showToast('error', 'You cannot place bids on your own vehicle listing.');
      return;
    }
    if (currentUser && !currentUser.isVerified) {
      setShowVerificationModal(true);
      return;
    }

    if (oneClickBidEnabled) {
      executeBid(bidAmount);
    } else {
      setShowBidModal(true);
    }
  };

  const handleConfirmBid = () => {
    if (rememberOneClickInModal) {
      toggleOneClickBid(true);
    }
    setShowBidModal(false);
    executeBid(bidAmount);
  };

  const handleUpcomingBidClick = () => {
    if (currentUser && vehicle.ownerId && vehicle.ownerId === currentUser.id) {
      showToast('error', 'You cannot place bids on your own vehicle listing.');
      return;
    }
    if (currentUser && !currentUser.isVerified) {
      setShowVerificationModal(true);
      return;
    }
    if (onPlaceUpcomingBid) {
      onPlaceUpcomingBid();
    }
  };

  const renderBiddingCard = () => (
    <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-xs lg:sticky lg:top-20 space-y-4">
      <div>
        <h1 className="text-lg sm:text-xl font-bold text-gray-900 leading-snug">
          {vehicle.year} {vehicle.make} {vehicle.model}
        </h1>

        <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500 mt-2">
          <span
            className={`font-semibold px-2 py-0.5 rounded-lg text-[11px] border inline-flex items-center gap-1 ${
              isLive
                ? 'bg-red-50 text-red-700 border-red-200'
                : isEnded && vehicle.status === 'Sold'
                ? 'bg-green-50 text-green-700 border-green-200'
                : 'bg-gray-100 text-gray-700 border-gray-200'
            }`}
          >
            {isDirectSale ? (
              <>
                <Tag className="w-3 h-3" />
                <span>Direct Sale</span>
              </>
            ) : isUpcoming ? (
              <>
                <Calendar className="w-3 h-3" />
                <span>Upcoming</span>
              </>
            ) : isEnded ? (
              <>
                <Flag className="w-3 h-3" />
                <span>Concluded</span>
              </>
            ) : (
              <>
                <Radio className="w-3 h-3" />
                <span>Live Auction</span>
              </>
            )}
          </span>
          <span className="px-2 py-0.5 bg-gray-100 text-gray-800 border border-gray-200 font-mono font-semibold rounded-lg text-[11px] inline-flex items-center gap-1">
            <Package className="w-3 h-3 text-gray-500" />
            <span>#{vehicle.stockNumber || (vehicle.id ? vehicle.id.slice(-8) : 'N/A')}</span>
          </span>
          <span className="font-mono text-gray-500 text-xs ml-auto tabular-nums">
            {isDirectSale ? '90 Days Valid' : currentTimeLeft}
          </span>
        </div>
      </div>

      {/* Price Display */}
      <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
        <div className="flex justify-between items-baseline">
          <span className="text-xs font-medium text-gray-500">
            {isDirectSale ? 'Fixed Price' : isUpcoming ? 'Asking Price' : t.currentBid}
          </span>
          <span className="text-2xl font-bold text-gray-900 tabular-nums tracking-tight">
            ₹{formatPrice(isDirectSale ? (vehicle.directPrice || vehicle.startingPrice || vehicle.currentBid) : isUpcoming ? askingPrice : (vehicle.currentBid || vehicle.startingPrice))}
          </span>
        </div>
        {vehicle.buyNowPrice && !isDirectSale && (
          <div className="flex justify-between items-center text-xs mt-2 pt-2 border-t border-gray-200">
            <span className="text-gray-500">{t.buyNow}</span>
            <span className="font-semibold text-gray-900 tabular-nums">₹{formatPrice(vehicle.buyNowPrice)}</span>
          </div>
        )}
        {isLive && vehicle.winningUsername && (
          <div className="flex justify-between items-center text-xs mt-2 pt-2 border-t border-gray-200">
            <span className="text-gray-500">Leading Bidder</span>
            <span className="font-semibold text-gray-900">@{vehicle.winningUsername}</span>
          </div>
        )}
        {vehicle.firstBidderUsername && !isDirectSale && (
          <div className="flex justify-between items-center text-xs mt-1.5 text-gray-500">
            <span>1st Bidder</span>
            <span className="font-medium text-gray-900">@{vehicle.firstBidderUsername}</span>
          </div>
        )}
      </div>

      {vehicle.isRestricted ? (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-900 text-center space-y-2">
          <Lock className="w-6 h-6 text-red-600 mx-auto" />
          <h4 className="font-bold text-xs uppercase tracking-wide">
            Listing Temporarily Restricted
          </h4>
          <p className="text-xs text-red-800 leading-relaxed">
            {vehicle.restrictionReason || 'Bidding and direct buying are locked pending administrative review.'}
          </p>
        </div>
      ) : (
        <>
          {/* DIRECT SALE FLOW */}
          {isDirectSale && (
            <div className="space-y-3">
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-700 leading-relaxed space-y-1">
                <div className="flex items-center gap-1.5 font-semibold text-gray-900">
                  <Tag className="w-3.5 h-3.5" />
                  <span>Direct Fixed Price Sale</span>
                </div>
                <p>
                  Listed at a fixed price of <strong>₹{formatPrice(vehicle.directPrice || vehicle.startingPrice || vehicle.currentBid)}</strong> with no bidding countdown.
                </p>
              </div>

              {!isOwner ? (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => {
                      showToast('success', `Purchase request for ${vehicle.year} ${vehicle.make} ${vehicle.model} sent to @${vehicle.ownerUsername || 'Seller'}.`);
                    }}
                    className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-2.5 rounded-lg text-xs sm:text-sm transition cursor-pointer"
                  >
                    Buy Now (₹{formatPrice(vehicle.directPrice || vehicle.startingPrice || vehicle.currentBid)})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (onOpenChat) {
                        onOpenChat(resolvedSeller);
                      } else if (onMessageSeller && vehicle.ownerUsername) {
                        onMessageSeller(vehicle.ownerUsername);
                      }
                    }}
                    className="w-full bg-white hover:bg-gray-50 text-gray-900 font-semibold py-2.5 rounded-lg text-xs border border-gray-200 transition flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <MessageCircle className="w-4 h-4 text-gray-600" />
                    <span>Message Seller @{vehicle.ownerUsername || 'Owner'}</span>
                  </button>
                </div>
              ) : (
                <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 text-center text-xs text-gray-600">
                  <p className="font-semibold text-gray-900 mb-0.5">You own this Direct Sale listing</p>
                  <p>Active in Direct Sales for 90 days.</p>
                </div>
              )}
            </div>
          )}

          {/* UPCOMING AUCTION FLOW */}
          {isUpcoming && (
            <div className="space-y-3">
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-700 leading-relaxed space-y-1">
                <div className="font-semibold text-gray-900 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Upcoming Pre-Bidding Active</span>
                </div>
                <p>
                  Join at the asking price of <strong>₹{formatPrice(askingPrice)}</strong>. The latest registered user holds 1st Bidder Priority when live competition starts.
                </p>
              </div>

              {/* Joined Pre-Bidders List */}
              <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-gray-900">Participants ({upcomingBids.length})</span>
                  <span className="text-[11px] text-gray-500">Asking Price</span>
                </div>

                {upcomingBids.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-2">No pre-bids yet. Be the first to join.</p>
                ) : (
                  <div className="space-y-1.5 max-h-36 overflow-y-auto">
                    {upcomingBids.map((b, idx) => {
                      const isLast = idx === upcomingBids.length - 1;
                      const isMe = currentUser && b.userId === currentUser.id;
                      return (
                        <div
                          key={b.userId + idx}
                          className={`flex items-center justify-between text-xs px-2.5 py-1.5 rounded-lg border ${
                            isLast
                              ? 'bg-white border-gray-300 text-gray-900 font-semibold'
                              : 'bg-white border-gray-200 text-gray-600'
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[11px] text-gray-400">#{idx + 1}</span>
                            <span>@{b.username}</span>
                            {isMe && <span className="text-[10px] bg-gray-100 text-gray-800 px-1.5 rounded font-semibold">You</span>}
                          </div>
                          {isLast ? (
                            <span className="text-[11px] bg-gray-900 text-white font-semibold px-2 py-0.5 rounded">
                              1st Priority
                            </span>
                          ) : (
                            <span className="text-[11px] text-gray-400">Joined</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {currentUser && !currentUser.isVerified && (
                <button
                  type="button"
                  onClick={() => setShowVerificationModal(true)}
                  className="w-full p-2.5 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg flex items-center gap-2.5 text-left transition cursor-pointer"
                >
                  <ShieldCheck className="w-4 h-4 text-gray-700 shrink-0" />
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-gray-900">ID Verification Required</p>
                    <p className="text-[11px] text-gray-500">Verify your ID to participate in auctions.</p>
                  </div>
                </button>
              )}

              {hasUserPreBid && isUserLeadingPreBid && (
                <div className="p-2.5 bg-green-50 border border-green-200 rounded-lg text-xs text-green-800">
                  <p className="font-semibold">You hold 1st Bidder Priority at ₹{formatPrice(askingPrice)}.</p>
                </div>
              )}

              {hasUserPreBid && !isUserLeadingPreBid && (
                <div className="p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-800">
                  <p className="font-semibold">Priority shifted to @{lastPreBidder?.username}. Re-stake below to reclaim priority.</p>
                </div>
              )}

              <button
                type="button"
                onClick={handleUpcomingBidClick}
                className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-2.5 rounded-lg transition text-xs sm:text-sm cursor-pointer"
              >
                {!hasUserPreBid
                  ? `Join Upcoming Auction (₹${formatPrice(askingPrice)})`
                  : isUserLeadingPreBid
                  ? `Re-Confirm 1st Bidder Priority (₹${formatPrice(askingPrice)})`
                  : `Re-Stake 1st Bidder Priority (₹${formatPrice(askingPrice)})`}
              </button>
            </div>
          )}

          {/* LIVE AUCTION FLOW */}
          {isLive && (
            <form onSubmit={handleBidSubmit} className="space-y-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <label className="font-semibold text-gray-800">
                    Enter Bid Price (₹)
                  </label>
                  <span className="text-gray-500 tabular-nums">
                    Current: <strong className="text-gray-900 font-mono">₹{formatPrice(vehicle.currentBid || vehicle.startingPrice)}</strong>
                  </span>
                </div>

                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-gray-500 font-semibold text-sm">₹</span>
                  <input
                    type="number"
                    value={bidAmount || ''}
                    onChange={(e) => setBidAmount(parseInt(e.target.value) || 0)}
                    min={(vehicle.currentBid || vehicle.startingPrice || 0) + 1}
                    placeholder={`Enter bid (min ₹${formatPrice(calculateDefaultLeadingBid(vehicle.currentBid || vehicle.startingPrice || 0))})`}
                    className="w-full pl-7 pr-3 py-2 bg-white border border-gray-300 rounded-lg focus:border-red-600 outline-none text-base font-bold text-gray-900 tabular-nums"
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] text-gray-500 tabular-nums">
                  <span>
                    {bidAmount > (vehicle.currentBid || vehicle.startingPrice || 0) ? (
                      <span className="text-green-700 font-semibold">
                        +₹{formatPrice(bidAmount - (vehicle.currentBid || vehicle.startingPrice || 0))} ({(((bidAmount - (vehicle.currentBid || vehicle.startingPrice || 0)) / ((vehicle.currentBid || vehicle.startingPrice) || 1)) * 100).toFixed(2)}%)
                      </span>
                    ) : (
                      <span className="text-red-600 font-medium">Must exceed ₹{formatPrice(vehicle.currentBid || vehicle.startingPrice)}</span>
                    )}
                  </span>
                  <span>
                    Min bump: +₹{formatPrice(calculateDefaultIncrement(vehicle.currentBid || vehicle.startingPrice || 0))}
                  </span>
                </div>

                {/* Quick Stake Actions */}
                <div className="pt-1 grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  <button
                    type="button"
                    onClick={handleSetDefaultLeadingBid}
                    className={`col-span-2 py-1.5 px-2 rounded-lg border text-xs font-semibold transition cursor-pointer tabular-nums ${
                      bidAmount === calculateDefaultLeadingBid(vehicle.currentBid || vehicle.startingPrice || 0)
                        ? 'bg-gray-900 text-white border-gray-900'
                        : 'bg-white hover:bg-gray-50 text-gray-800 border-gray-200'
                    }`}
                  >
                    +0.1%: ₹{formatPrice(calculateDefaultLeadingBid(vehicle.currentBid || vehicle.startingPrice || 0))}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleQuickPercentBoost(0.005)}
                    className="py-1.5 px-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-800 text-xs font-semibold transition cursor-pointer"
                  >
                    +0.5%
                  </button>

                  <button
                    type="button"
                    onClick={handleRandomBoost}
                    title="Random increase to outbid competitors"
                    className="py-1.5 px-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-800 text-xs font-semibold transition flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Shuffle className="w-3 h-3" />
                    <span>Boost</span>
                  </button>
                </div>
              </div>

              {/* 1-Click Fast Bidding Mode Toggle */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 flex items-center justify-between gap-2.5">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-gray-700 shrink-0" />
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-gray-900">1-Click Fast Bidding</span>
                      {oneClickBidEnabled && (
                        <span className="text-[10px] bg-green-50 text-green-700 border border-green-200 font-semibold px-1.5 py-0.2 rounded">
                          Active
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-500">Skip confirmation dialog</p>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={oneClickBidEnabled}
                    onChange={(e) => toggleOneClickBid(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-red-600"></div>
                </label>
              </div>

              {currentUser && !currentUser.isVerified && (
                <button
                  type="button"
                  onClick={() => setShowVerificationModal(true)}
                  className="w-full p-2.5 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg flex items-center gap-2.5 text-left transition cursor-pointer"
                >
                  <ShieldCheck className="w-4 h-4 text-gray-700 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-gray-900">ID Verification Required</p>
                    <p className="text-[11px] text-gray-500">Verify your PAN or National ID to bid.</p>
                  </div>
                </button>
              )}

              {currentUser && currentUser.isVerified && (
                <div className="px-3 py-1.5 bg-green-50 border border-green-200 rounded-lg flex items-center gap-1.5 text-xs text-green-800 font-medium">
                  <ShieldCheck className="w-3.5 h-3.5 text-green-600" />
                  <span>Verified Bidder — Live bidding authorized</span>
                </div>
              )}

              {oneClickBidEnabled ? (
                <button
                  type="button"
                  onClick={() => handleBidSubmit()}
                  className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-2.5 rounded-lg transition text-xs sm:text-sm flex items-center justify-center gap-1.5 cursor-pointer tabular-nums"
                >
                  <Zap className="w-4 h-4" />
                  <span>Place 1-Click Bid: ₹{formatPrice(bidAmount)}</span>
                </button>
              ) : (
                <button
                  type="submit"
                  className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-2.5 rounded-lg transition text-xs sm:text-sm cursor-pointer tabular-nums"
                >
                  {t.placeBid}: ₹{formatPrice(bidAmount)}
                </button>
              )}
            </form>
          )}

          {/* CONCLUDED / SOLD FLOW */}
          {isEnded && (
            <div className="space-y-3">
              <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 text-center space-y-2">
                <div className="text-sm font-bold text-gray-900">Auction Concluded</div>
                {vehicle.winningUsername ? (
                  <div className="text-xs text-green-700 font-semibold tabular-nums">
                    Won by @{vehicle.winningUsername} for ₹{formatPrice(vehicle.currentBid || vehicle.startingPrice)}
                  </div>
                ) : (
                  <div className="text-xs text-gray-500">Ended without winning bidder</div>
                )}
                {currentUser && vehicle.winningUserId === currentUser.id && (
                  <div className="bg-green-50 border border-green-200 text-green-800 text-xs font-semibold py-1.5 px-3 rounded-lg inline-flex items-center gap-1.5">
                    <Trophy className="w-3.5 h-3.5" />
                    <span>You Won This Auction</span>
                  </div>
                )}
                {currentUser && vehicle.winningUserId && vehicle.winningUserId !== currentUser.id && (vehicle.liveParticipants || []).includes(currentUser.id) && (
                  <div className="bg-red-50 text-red-700 text-xs font-semibold py-1.5 px-3 rounded-lg border border-red-200 inline-flex items-center gap-1.5">
                    <X className="w-3.5 h-3.5" />
                    <span>You Were Outbid</span>
                  </div>
                )}
              </div>

              {isOwner && isUnsoldAuction && onConvertToDirectSale && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3.5 space-y-2.5 text-left">
                  <div>
                    <h4 className="text-xs font-bold text-gray-900">Unsold in Auction?</h4>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Shift this vehicle to Direct Sale at a fixed price for 90 days.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowDirectShiftModal(true)}
                    className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-3 rounded-lg text-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Tag className="w-3.5 h-3.5" />
                    <span>Shift to Direct Sale</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      <div className="pt-4 border-t border-gray-200">
        <h4 className="font-semibold text-gray-900 text-xs mb-2.5">{t.saleStatus}</h4>
        <div className="space-y-2 text-xs bg-gray-50 p-3 rounded-lg border border-gray-200">
          <div className="flex justify-between">
            <span className="text-gray-500">{t.saleDate}</span>
            <span className="text-gray-900 font-medium">{isUpcoming ? 'Scheduled' : 'Active'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">{isUpcoming ? 'Auction Starts' : t.timeLeft}</span>
            <span className={`font-semibold tabular-nums ${isEnded ? 'text-gray-500' : 'text-gray-900'}`}>
              {currentTimeLeft}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Location</span>
            <span className="text-gray-900 font-medium">{vehicle.location}</span>
          </div>
        </div>
        {currentUser && onMarkSold && vehicle.status !== 'Sold' && (currentUser.role === 'admin' || currentUser.id === vehicle.ownerId) && (
          <button
            type="button"
            onClick={onMarkSold}
            className="mt-3 w-full bg-gray-900 hover:bg-black text-white font-semibold py-2 rounded-lg transition text-xs cursor-pointer"
          >
            Close Auction & Mark as Sold
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
      {/* Top Header Row */}
      <div className="flex items-center justify-between mb-4 gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-gray-700 hover:text-gray-900 font-semibold text-xs transition bg-white hover:bg-gray-50 px-3 py-2 rounded-lg border border-gray-200 shadow-xs cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>{t.backToSearch}</span>
        </button>

        <button
          type="button"
          onClick={handleSharePost}
          className="inline-flex items-center gap-1.5 text-gray-700 hover:text-gray-900 font-semibold text-xs bg-white hover:bg-gray-50 px-3 py-2 rounded-lg border border-gray-200 shadow-xs transition cursor-pointer"
        >
          <Share2 className="w-3.5 h-3.5" />
          <span>Share</span>
        </button>
      </div>

      {inlineToast && (
        <div
          className={`mb-4 px-4 py-2.5 rounded-lg border text-xs font-medium flex items-center justify-between ${
            inlineToast.type === 'success'
              ? 'bg-green-50 border-green-200 text-green-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          <span>{inlineToast.text}</span>
          <button type="button" onClick={() => setInlineToast(null)} className="cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column */}
        <div className="lg:col-span-2 space-y-4">
          {/* Main Gallery */}
          <div
            className="p-2.5 rounded-lg bg-white shadow-xs border border-gray-200"
            onMouseEnter={() => setIsAutoScrollPaused(true)}
            onMouseLeave={() => setIsAutoScrollPaused(false)}
          >
            <div
              className="relative w-full aspect-[16/10] sm:aspect-[16/9] min-h-[280px] sm:min-h-[400px] bg-gray-950 rounded-lg overflow-hidden flex items-center justify-center group select-none touch-pan-y"
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
            >
              <img
                key={mainImage}
                src={mainImage}
                className={`relative z-10 w-full h-full transition-all duration-300 cursor-pointer ${
                  fitMode === 'contain' ? 'object-contain' : 'object-cover object-center'
                }`}
                alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                onClick={() => setIsLightboxOpen(true)}
              />

              {/* Top Controls */}
              <div className="absolute top-2.5 left-2.5 right-2.5 z-20 flex items-center justify-between pointer-events-none">
                <div className="pointer-events-auto flex items-center gap-1.5">
                  <span className="bg-black/65 text-white text-xs font-medium px-2.5 py-1 rounded-lg tabular-nums">
                    {currentImageIndex + 1} / {galleryImages.length}
                  </span>
                  {galleryImages.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setIsAutoScrollPaused(!isAutoScrollPaused)}
                      className="bg-black/65 hover:bg-black/85 text-white text-xs font-medium px-2.5 py-1 rounded-lg transition inline-flex items-center gap-1 cursor-pointer"
                    >
                      {isAutoScrollPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                      <span>{isAutoScrollPaused ? 'Play' : 'Auto'}</span>
                    </button>
                  )}
                </div>
                <div className="pointer-events-auto flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setFitMode(fitMode === 'contain' ? 'cover' : 'contain')}
                    className="bg-black/65 hover:bg-black/85 text-white text-xs font-medium px-2.5 py-1 rounded-lg transition inline-flex items-center gap-1 cursor-pointer"
                  >
                    {fitMode === 'contain' ? <Maximize2 className="w-3 h-3" /> : <Minimize2 className="w-3 h-3" />}
                    <span>{fitMode === 'contain' ? 'Fit' : 'Fill'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsLightboxOpen(true)}
                    className="bg-black/65 hover:bg-black/85 text-white text-xs font-medium px-2.5 py-1 rounded-lg transition inline-flex items-center gap-1 cursor-pointer"
                  >
                    <ZoomIn className="w-3 h-3" />
                    <span>Enlarge</span>
                  </button>
                </div>
              </div>

              {galleryImages.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={handlePrevImage}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-black/60 hover:bg-black/85 text-white flex items-center justify-center transition cursor-pointer"
                    aria-label="Previous Image"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={handleNextImage}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-black/60 hover:bg-black/85 text-white flex items-center justify-center transition cursor-pointer"
                    aria-label="Next Image"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </>
              )}
            </div>

            {/* Thumbnails */}
            <div
              ref={thumbnailContainerRef}
              className="flex gap-2 mt-2.5 overflow-x-auto pb-1 scroll-smooth"
            >
              {galleryImages.map((imgUrl, i) => (
                <div
                  key={i}
                  ref={(el) => { thumbnailRefs.current[i] = el; }}
                  onClick={() => {
                    setMainImage(imgUrl);
                    setIsAutoScrollPaused(true);
                    setTimeout(() => setIsAutoScrollPaused(false), 5000);
                  }}
                  className={`relative h-16 w-24 rounded-lg overflow-hidden border-2 cursor-pointer transition shrink-0 bg-gray-900 ${
                    mainImage === imgUrl ? 'border-red-600 opacity-100' : 'border-transparent opacity-70 hover:opacity-100'
                  }`}
                >
                  <img src={imgUrl} className="w-full h-full object-cover" alt={`Thumbnail ${i + 1}`} />
                </div>
              ))}

              {vehicle.rcCardUrl && (
                <div
                  onClick={() => setShowRcModal(true)}
                  className="relative h-16 w-24 rounded-lg overflow-hidden border border-gray-300 bg-gray-100 cursor-pointer transition shrink-0 group"
                  title="View Registration Card"
                >
                  <img src={vehicle.rcCardUrl} className="w-full h-full object-cover opacity-75 group-hover:opacity-100" alt="RC Card" />
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                    <span className="bg-white text-gray-900 text-[10px] font-bold px-1.5 py-0.5 rounded inline-flex items-center gap-0.5">
                      <FileText className="w-3 h-3" /> RC
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Action Bar: Likes, Saves, Views */}
          <div className="p-3 rounded-lg bg-white border border-gray-200 shadow-xs flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <div className={`inline-flex items-center rounded-lg border overflow-hidden ${
                isLiked ? 'bg-red-50 border-red-200 text-red-700' : 'bg-white border-gray-200 text-gray-700'
              }`}>
                <button
                  type="button"
                  onClick={handleToggleLike}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold cursor-pointer hover:bg-gray-50/50"
                >
                  <Heart className={`w-4 h-4 ${isLiked ? 'fill-red-600 text-red-600' : 'text-gray-500'}`} />
                  <span>{isLiked ? 'Liked' : 'Like'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setEngagementModal({ type: 'likes' })}
                  className="px-2.5 py-1.5 text-xs font-bold border-l border-gray-200 cursor-pointer hover:bg-gray-50 tabular-nums"
                >
                  {likesCount}
                </button>
              </div>

              <div className={`inline-flex items-center rounded-lg border overflow-hidden ${
                isWishlisted ? 'bg-gray-900 border-gray-900 text-white' : 'bg-white border-gray-200 text-gray-700'
              }`}>
                <button
                  type="button"
                  onClick={handleToggleWishlist}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold cursor-pointer"
                >
                  <Bookmark className={`w-4 h-4 ${isWishlisted ? 'fill-white text-white' : 'text-gray-500'}`} />
                  <span>{isWishlisted ? 'Saved' : 'Save'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setEngagementModal({ type: 'wishlist' })}
                  className={`px-2.5 py-1.5 text-xs font-bold border-l cursor-pointer tabular-nums ${
                    isWishlisted ? 'border-gray-700' : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {wishlistCount}
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setEngagementModal({ type: 'views' })}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-700 bg-white hover:bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-200 cursor-pointer tabular-nums"
            >
              <Eye className="w-4 h-4 text-gray-500" />
              <span>{viewsCount} views</span>
            </button>
          </div>

          {vehicle.isRestricted && (
            <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-900 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div>
                <strong className="block font-bold text-sm">Listing Restricted by Platform Admin</strong>
                <p className="text-xs text-red-800 mt-0.5">
                  {vehicle.restrictionReason || 'Bidding and direct sales are locked pending inspection or verification.'}
                </p>
              </div>
            </div>
          )}

          {/* Mobile Bidding Box */}
          <div className="block lg:hidden">
            {renderBiddingCard()}
          </div>

          {/* Seller Profile Banner */}
          {vehicle.ownerUsername && (
            <div className="rounded-lg p-4 flex items-center justify-between gap-3 border border-gray-200 bg-white shadow-xs">
              <div
                onClick={() => onViewProfile && onViewProfile(resolvedSeller)}
                className="flex items-center gap-3 cursor-pointer group flex-1 min-w-0"
              >
                <img
                  src={resolvedSeller.avatarUrl}
                  alt={vehicle.ownerUsername}
                  className="w-11 h-11 rounded-full object-cover border border-gray-200 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-sm font-bold text-gray-900 group-hover:text-red-600 transition-colors truncate">
                      @{vehicle.ownerUsername}
                    </span>
                    {resolvedSeller.isVerified && (
                      <ShieldCheck className="w-4 h-4 text-green-600 shrink-0" />
                    )}
                    {sellerFollowsMe && (
                      <span className="text-[11px] bg-gray-100 text-gray-700 font-medium px-1.5 py-0.5 rounded border border-gray-200">
                        Follows you
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 truncate">
                    {resolvedSeller.fullName} • {resolvedSeller.followers || 0} followers
                  </p>
                </div>
              </div>

              {!isOwner && (
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      if (onOpenChat) {
                        onOpenChat(resolvedSeller);
                      } else if (onMessageSeller && vehicle.ownerUsername) {
                        onMessageSeller(vehicle.ownerUsername);
                      }
                    }}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white hover:bg-gray-50 text-gray-900 border border-gray-200 transition flex items-center gap-1.5 cursor-pointer"
                  >
                    <MessageCircle className="w-3.5 h-3.5 text-gray-600" />
                    <span>Chat</span>
                  </button>

                  {onFollowToggle && (
                    <button
                      type="button"
                      onClick={() => onFollowToggle(resolvedSeller)}
                      disabled={isFollowLoading}
                      className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition flex items-center gap-1 cursor-pointer ${
                        isFollowingSeller
                          ? 'bg-gray-100 hover:bg-gray-200 text-gray-800 border border-gray-200'
                          : 'bg-red-600 hover:bg-red-700 text-white'
                      }`}
                    >
                      {isFollowingSeller ? (
                        <span>Following</span>
                      ) : (
                        <>
                          <UserPlus className="w-3.5 h-3.5" />
                          <span>{sellerFollowsMe ? 'Follow Back' : 'Follow'}</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Vehicle Information */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-xs overflow-hidden">
            <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
              <h2 className="text-sm font-bold text-gray-900">{t.vehicleSpecs}</h2>
            </div>
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2.5 text-xs">
              <div className="flex justify-between border-b border-gray-100 pb-2 items-center">
                <span className="text-gray-500">Stock Number</span>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono font-semibold text-gray-900 bg-gray-100 border border-gray-200 px-2 py-0.5 rounded">
                    #{vehicle.stockNumber || (vehicle.id ? vehicle.id.slice(-8) : 'N/A')}
                  </span>
                  {vehicle.stockNumber && (
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(vehicle.stockNumber!);
                        setCopiedStock(true);
                        setTimeout(() => setCopiedStock(false), 2000);
                      }}
                      className="text-xs text-gray-600 hover:text-gray-900 bg-gray-100 px-2 py-0.5 rounded inline-flex items-center gap-1 cursor-pointer"
                    >
                      {copiedStock ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
                    </button>
                  )}
                </div>
              </div>
              <div className="flex justify-between border-b border-gray-100 pb-2">
                <span className="text-gray-500">{t.vin}</span>
                <span className="font-mono text-gray-900">{vehicle.vin}</span>
              </div>
              {vehicle.ownerUsername && (
                <div
                  className="flex justify-between border-b border-gray-100 pb-2 cursor-pointer hover:text-red-600"
                  onClick={() => onViewProfile && onViewProfile(resolvedSeller)}
                >
                  <span className="text-gray-500">Listed By</span>
                  <span className="font-semibold text-gray-900">@{vehicle.ownerUsername}</span>
                </div>
              )}
              <div className="flex justify-between border-b border-gray-100 pb-2">
                <span className="text-gray-500">{t.odometer}</span>
                <span className="font-semibold text-gray-900 tabular-nums">{(vehicle.odometer || 0).toLocaleString()} mi</span>
              </div>
              <div className="flex justify-between border-b border-gray-100 pb-2">
                <span className="text-gray-500">{t.primaryDamage}</span>
                <span className="font-semibold text-gray-900">{vehicle.primaryDamage}</span>
              </div>
              <div className="flex justify-between border-b border-gray-100 pb-2">
                <span className="text-gray-500">{t.secondaryDamage}</span>
                <span className="font-medium text-gray-900">{vehicle.secondaryDamage || 'N/A'}</span>
              </div>
              <div className="flex justify-between border-b border-gray-100 pb-2">
                <span className="text-gray-500">{t.engine}</span>
                <span className="font-medium text-gray-900">{vehicle.engine}</span>
              </div>
              <div className="flex justify-between border-b border-gray-100 pb-2">
                <span className="text-gray-500">{t.topSpeed}</span>
                <span className="font-medium text-gray-900">{vehicle.topSpeed || 'N/A'}</span>
              </div>
              <div className="flex justify-between border-b border-gray-100 pb-2">
                <span className="text-gray-500">{t.mpg}</span>
                <span className="font-medium text-gray-900">{vehicle.mpg || 'N/A'}</span>
              </div>
              <div className="flex justify-between border-b border-gray-100 pb-2">
                <span className="text-gray-500">Drive</span>
                <span className="font-medium text-gray-900">{vehicle.drive}</span>
              </div>
              <div className="flex justify-between border-b border-gray-100 pb-2">
                <span className="text-gray-500">Transmission</span>
                <span className="font-medium text-gray-900">{vehicle.transmission}</span>
              </div>
              <div className="flex justify-between border-b border-gray-100 pb-2">
                <span className="text-gray-500">{t.keys}</span>
                <span className={`font-semibold ${vehicle.hasKeys ? 'text-green-700' : 'text-red-600'}`}>
                  {vehicle.hasKeys ? 'Yes' : 'No'}
                </span>
              </div>
              <div className="flex justify-between border-b border-gray-100 pb-2 items-center">
                <span className="text-gray-500">Registration Card (RC)</span>
                {vehicle.hasRegistrationCard ? (
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-green-700 bg-green-50 px-2 py-0.5 rounded border border-green-200 inline-flex items-center gap-1">
                      <Check className="w-3 h-3" /> Available
                    </span>
                    {vehicle.rcCardUrl && (
                      <button
                        type="button"
                        onClick={() => setShowRcModal(true)}
                        className="text-xs font-semibold text-gray-900 bg-gray-100 hover:bg-gray-200 px-2 py-0.5 rounded border border-gray-200 cursor-pointer"
                      >
                        View RC
                      </button>
                    )}
                  </div>
                ) : (
                  <span className="font-medium text-gray-600 bg-gray-100 px-2 py-0.5 rounded border border-gray-200">
                    Not Available
                  </span>
                )}
              </div>
              {vehicle.rcCardNumber && (
                <div className="flex justify-between border-b border-gray-100 pb-2">
                  <span className="text-gray-500">RC Number</span>
                  <span className="font-mono font-semibold text-gray-900">{vehicle.rcCardNumber}</span>
                </div>
              )}
            </div>

            {vehicle.description && (
              <div className="px-4 pb-4 pt-1">
                <h3 className="font-semibold text-gray-900 mb-1.5 text-xs">{t.sellerDesc}</h3>
                <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 text-gray-700 text-xs leading-relaxed">
                  {vehicle.description}
                </div>
              </div>
            )}
          </div>

          {/* AI Analysis Section */}
          <div className="rounded-lg shadow-xs border border-gray-200 bg-white overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-gray-700" />
                <h2 className="text-sm font-bold text-gray-900">{t.aiInsight}</h2>
              </div>
              {!analysis && (
                <button
                  type="button"
                  onClick={handleGenerateAnalysis}
                  disabled={isLoadingAnalysis}
                  className="text-xs font-semibold bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg transition disabled:opacity-50 cursor-pointer"
                >
                  {isLoadingAnalysis ? t.analyzing : t.generateReport}
                </button>
              )}
            </div>
            <div className="p-4 text-xs">
              {!analysis && !isLoadingAnalysis && (
                <p className="text-gray-500 text-center py-2">
                  Generate an inspection report for condition insights and repair estimates.
                </p>
              )}
              {isLoadingAnalysis && (
                <div className="animate-pulse space-y-2">
                  <div className="h-3 bg-gray-200 rounded w-3/4" />
                  <div className="h-3 bg-gray-200 rounded w-full" />
                  <div className="h-3 bg-gray-200 rounded w-5/6" />
                </div>
              )}
              {analysis && (
                <div className="text-gray-700 bg-gray-50 p-3 rounded-lg border border-gray-200 leading-relaxed space-y-1.5">
                  {analysis.split('\n').map((line, idx) => {
                    const parts = line.split(/(\*\*.*?\*\*)/g);
                    return (
                      <p key={idx} className="m-0 min-h-[1em]">
                        {parts.map((part, pIdx) =>
                          part.startsWith('**') && part.endsWith('**') && part.length > 4
                            ? <strong key={pIdx}>{part.slice(2, -2)}</strong>
                            : <React.Fragment key={pIdx}>{part}</React.Fragment>
                        )}
                      </p>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Desktop Bidding Card */}
        <div className="hidden lg:block space-y-4">
          {renderBiddingCard()}
        </div>
      </div>

      {/* Bid Confirmation Modal */}
      {showBidModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-lg border border-gray-200">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-red-50 border border-red-200 flex items-center justify-center text-red-600 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">Confirm Your Bid</h3>
                <p className="text-xs text-gray-500">Review your bid before submitting</p>
              </div>
            </div>

            <div className="bg-gray-50 rounded-lg p-4 mb-4 space-y-2.5 border border-gray-200 text-xs">
              <div className="flex justify-between items-center pb-2 border-b border-gray-200">
                <span className="text-gray-500">Vehicle</span>
                <span className="font-semibold text-gray-900 text-right">{vehicle.year} {vehicle.make} {vehicle.model}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-gray-200">
                <span className="text-gray-500">Current Bid</span>
                <span className="text-gray-900 font-semibold tabular-nums">₹{formatPrice(vehicle.currentBid || vehicle.startingPrice)}</span>
              </div>
              <div className="flex justify-between items-center bg-white p-2.5 rounded-lg border border-gray-200">
                <span className="text-gray-900 font-semibold">Your New Bid</span>
                <span className="text-lg font-bold text-red-600 tabular-nums">₹{formatPrice(bidAmount)}</span>
              </div>
              <div className="flex justify-between items-center text-gray-500 pt-1">
                <span>Available Wallet Balance</span>
                <span className="font-semibold text-gray-900 tabular-nums">₹{(currentUser?.deposits || 0).toLocaleString()}</span>
              </div>
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4">
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberOneClickInModal}
                  onChange={(e) => setRememberOneClickInModal(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-600 cursor-pointer"
                />
                <div className="text-xs">
                  <span className="font-semibold text-gray-900 flex items-center gap-1">
                    <Zap className="w-3.5 h-3.5" /> Enable 1-Click Fast Bidding
                  </span>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    Bypass this confirmation popup for future bids.
                  </p>
                </div>
              </label>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowBidModal(false)}
                className="flex-1 py-2.5 px-4 rounded-lg border border-gray-200 font-semibold text-gray-700 hover:bg-gray-50 transition text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmBid}
                className="flex-1 py-2.5 px-4 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold transition text-xs cursor-pointer"
              >
                Confirm & Place Bid
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Direct Sale Shift Modal */}
      {showDirectShiftModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-lg border border-gray-200 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gray-100 border border-gray-200 text-gray-700 flex items-center justify-center shrink-0">
                <Tag className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-900">Shift to Direct Sale</h3>
                <p className="text-xs text-gray-500">Fixed-price 90-day listing</p>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Fixed Asking Price (₹) *
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-gray-500 font-semibold text-sm">₹</span>
                <input
                  type="number"
                  value={newDirectPrice}
                  onChange={(e) => setNewDirectPrice(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-full pl-7 pr-3 py-2 bg-white border border-gray-300 rounded-lg font-bold text-sm text-gray-900 focus:border-red-600 outline-none tabular-nums"
                  placeholder="Enter fixed price"
                />
              </div>
              <p className="text-[11px] text-gray-500 mt-1">Previous starting bid: ₹{formatPrice(vehicle.startingPrice || vehicle.currentBid)}</p>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowDirectShiftModal(false)}
                className="flex-1 py-2.5 rounded-lg border border-gray-200 font-semibold text-gray-700 hover:bg-gray-50 text-xs transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!newDirectPrice || newDirectPrice <= 0) {
                    showToast('error', 'Please enter a valid fixed selling price.');
                    return;
                  }
                  setShowDirectShiftModal(false);
                  if (onConvertToDirectSale) {
                    onConvertToDirectSale(vehicle.id, newDirectPrice);
                  }
                }}
                className="flex-1 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold text-xs transition cursor-pointer"
              >
                Confirm & Shift
              </button>
            </div>
          </div>
        </div>
      )}

      {showVerificationModal && currentUser && (
        <IdentityVerificationModal
          currentUser={currentUser}
          isOpen={true}
          gateReason="bid"
          onClose={() => setShowVerificationModal(false)}
          onVerificationSubmitted={() => {
            setShowVerificationModal(false);
            showToast('success', 'Verification request submitted for review.');
          }}
        />
      )}

      {/* Fullscreen Lightbox */}
      {isLightboxOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-between p-4"
          onClick={() => setIsLightboxOpen(false)}
        >
          <div
            className="w-full max-w-6xl flex items-center justify-between text-white py-1"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2.5">
              <span className="font-semibold text-sm">
                {vehicle.year} {vehicle.make} {vehicle.model}
              </span>
              <span className="bg-white/15 px-2 py-0.5 rounded text-xs font-mono tabular-nums">
                {currentImageIndex + 1} / {galleryImages.length}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setFitMode(fitMode === 'contain' ? 'cover' : 'contain')}
                className="bg-white/15 hover:bg-white/25 text-white text-xs font-medium px-3 py-1.5 rounded-lg cursor-pointer"
              >
                {fitMode === 'contain' ? 'Fit' : 'Fill'}
              </button>
              <button
                type="button"
                onClick={() => setIsLightboxOpen(false)}
                className="p-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white cursor-pointer"
                aria-label="Close lightbox"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div
            className="relative flex-1 w-full max-w-6xl flex items-center justify-center my-auto overflow-hidden p-2"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={mainImage}
              alt="Full Resolution View"
              className={`max-h-[82vh] max-w-[95vw] rounded-lg ${
                fitMode === 'contain' ? 'object-contain' : 'object-cover'
              }`}
            />

            {galleryImages.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={handlePrevImage}
                  className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/60 hover:bg-black/90 text-white flex items-center justify-center cursor-pointer"
                  aria-label="Previous image"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={handleNextImage}
                  className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/60 hover:bg-black/90 text-white flex items-center justify-center cursor-pointer"
                  aria-label="Next image"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </>
            )}
          </div>

          <div
            className="w-full max-w-4xl flex items-center justify-center gap-2 overflow-x-auto py-1"
            onClick={(e) => e.stopPropagation()}
          >
            {galleryImages.map((img, i) => (
              <img
                key={i}
                src={img}
                alt={`thumb-${i}`}
                onClick={() => setMainImage(img)}
                className={`h-12 w-16 object-cover rounded-lg border-2 cursor-pointer transition ${
                  mainImage === img ? 'border-red-600' : 'border-white/20 opacity-60 hover:opacity-100'
                }`}
              />
            ))}
          </div>
        </div>
      )}

      {/* RC Card Viewer Modal */}
      {showRcModal && vehicle.rcCardUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
          onClick={() => setShowRcModal(false)}
        >
          <div
            className="bg-white rounded-lg max-w-2xl w-full p-5 shadow-lg space-y-4 border border-gray-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-gray-700" />
                <h3 className="font-bold text-gray-900 text-sm sm:text-base">
                  Vehicle Registration Certificate (RC)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowRcModal(false)}
                className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 cursor-pointer"
                aria-label="Close RC modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs bg-gray-50 p-3 rounded-lg border border-gray-200">
              <div>
                <span className="text-[11px] text-gray-500 block">Vehicle</span>
                <strong className="text-gray-900">{vehicle.year} {vehicle.make} {vehicle.model}</strong>
              </div>
              <div>
                <span className="text-[11px] text-gray-500 block">RC Status</span>
                <span className="text-green-700 font-semibold">Verified & Uploaded</span>
              </div>
              {vehicle.rcCardNumber && (
                <div>
                  <span className="text-[11px] text-gray-500 block">RC Number</span>
                  <span className="font-mono font-semibold text-gray-900">{vehicle.rcCardNumber}</span>
                </div>
              )}
            </div>

            <div className="rounded-lg overflow-hidden border border-gray-200 bg-gray-950 flex items-center justify-center max-h-[60vh]">
              <img
                src={vehicle.rcCardUrl}
                alt="RC Card Document"
                className="max-h-[58vh] w-auto max-w-full object-contain"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowRcModal(false)}
                className="bg-gray-900 hover:bg-black text-white text-xs font-semibold px-4 py-2 rounded-lg cursor-pointer"
              >
                Close Document
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Engagement Modal */}
      {engagementModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-lg max-w-md w-full overflow-hidden shadow-lg border border-gray-200 flex flex-col max-h-[85vh]">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-gray-50">
              <div className="flex items-center gap-2">
                {engagementModal.type === 'views' && <Eye className="w-4 h-4 text-gray-700" />}
                {engagementModal.type === 'wishlist' && <Bookmark className="w-4 h-4 text-gray-700" />}
                {engagementModal.type === 'likes' && <Heart className="w-4 h-4 text-red-600" />}
                <h3 className="text-sm font-bold text-gray-900">
                  {engagementModal.type === 'views' && 'Viewers'}
                  {engagementModal.type === 'wishlist' && 'Saved to Wishlist'}
                  {engagementModal.type === 'likes' && 'Post Likes'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEngagementModal(null)}
                className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-600 cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1 divide-y divide-gray-100">
              {(() => {
                const list = engagementModal.type === 'views'
                  ? viewersList
                  : engagementModal.type === 'wishlist'
                  ? wishlistUsers
                  : likesList;

                if (!list || list.length === 0) {
                  return (
                    <div className="text-center py-8 px-4">
                      <p className="text-xs font-semibold text-gray-700">No entries recorded yet</p>
                      <p className="text-xs text-gray-500 mt-1">
                        Verified members interacting with this listing appear here.
                      </p>
                    </div>
                  );
                }

                return (
                  <div className="space-y-2">
                    {list.map((u, i) => (
                      <div key={u.userId || i} className="flex items-center justify-between gap-3 py-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <img
                            src={u.avatarUrl || `https://i.pravatar.cc/150?u=${u.userId || i}`}
                            alt={u.username || 'User'}
                            className="w-9 h-9 rounded-full object-cover border border-gray-200 shrink-0"
                          />
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-gray-900 truncate">
                              {u.fullName || u.username || 'AutoBid Member'}
                            </div>
                            <div className="text-[11px] text-gray-500 truncate">
                              @{u.username || 'member'}
                            </div>
                          </div>
                        </div>
                        <span className="text-[11px] text-gray-500 shrink-0">
                          {(() => {
                            if (!u.timestamp) return 'Recorded';
                            const diff = Date.now() - u.timestamp;
                            if (diff < 60000) return 'Just now';
                            if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
                            if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
                            return new Date(u.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                          })()}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>

            <div className="p-3 border-t border-gray-200 bg-gray-50 flex justify-end">
              <button
                type="button"
                onClick={() => setEngagementModal(null)}
                className="px-4 py-2 rounded-lg bg-gray-900 hover:bg-black text-white text-xs font-semibold cursor-pointer"
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