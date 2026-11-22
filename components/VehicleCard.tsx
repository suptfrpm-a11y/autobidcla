import React, { useEffect, useState } from 'react';
import { Car, Check, Clock } from 'lucide-react';
import { Vehicle, VehicleStatus } from '../types';

interface VehicleCardProps {
  vehicle: Vehicle;
  onClick: (vehicle: Vehicle) => void;
  currentUser?: any;
  t?: any;
}

export const VehicleCard: React.FC<VehicleCardProps> = ({
  vehicle,
  onClick,
  currentUser,
  t = {} as any,
}) => {
  const [timeLeft, setTimeLeft] = useState<string>('');
  const [displayStatus, setDisplayStatus] = useState<string>(vehicle.status);
  const [statusTone, setStatusTone] = useState<'live' | 'success' | 'neutral'>('neutral');
  const [isUpcomingState, setIsUpcomingState] = useState<boolean>(false);
  const [imgError, setImgError] = useState<boolean>(false);

  useEffect(() => {
    const isOwner = Boolean(
      currentUser && currentUser.id && vehicle.ownerId === currentUser.id
    );

    const formatDiff = (diffMs: number) => {
      if (diffMs <= 0) return '0m';
      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);
      const pad = (n: number) => n.toString().padStart(2, '0');

      if (hours > 24) {
        const days = Math.floor(hours / 24);
        const remH = hours % 24;
        return `${days}d ${remH}h`;
      }
      if (hours > 0) {
        return `${hours}h ${pad(minutes)}m`;
      }
      return `${pad(minutes)}m ${pad(seconds)}s`;
    };

    const updateStatus = () => {
      const now = Date.now();
      const isUpcoming =
        (vehicle.startTime && vehicle.startTime > now) ||
        vehicle.status === VehicleStatus.UPCOMING;
      setIsUpcomingState(isUpcoming);

      if (vehicle.status === VehicleStatus.BLACKLISTED || vehicle.isBlacklisted) {
        setDisplayStatus('Blacklisted');
        setStatusTone('neutral');
        setTimeLeft('Expired');
        return;
      }

      if (vehicle.listingType === 'direct' || vehicle.status === VehicleStatus.DIRECT_SALE) {
        setDisplayStatus(isOwner ? 'My Listing' : 'Direct Sale');
        setStatusTone('neutral');
        const expiry =
          vehicle.expiresAt || vehicle.endTime || now + 90 * 24 * 60 * 60 * 1000;
        const diffMs = expiry - now;
        if (diffMs <= 0) {
          setTimeLeft('Expired');
        } else {
          const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
          setTimeLeft(
            days > 0
              ? `${days}d left`
              : `${Math.floor(diffMs / (1000 * 60 * 60))}h left`
          );
        }
        return;
      }

      if (vehicle.status === VehicleStatus.SOLD) {
        if (vehicle.userBidStatus === 'won') {
          setDisplayStatus(t?.won || 'Won');
          setStatusTone('success');
        } else if (vehicle.userBidStatus === 'lost') {
          setDisplayStatus(t?.lost || 'Lost');
          setStatusTone('neutral');
        } else {
          setDisplayStatus(t?.sold || 'Sold');
          setStatusTone('neutral');
        }
        setTimeLeft(t?.ended || 'Ended');
        return;
      }

      if (isUpcoming) {
        setStatusTone('neutral');
        setDisplayStatus(isOwner ? 'My Upcoming' : 'Upcoming');
        const startDiff = (vehicle.startTime || now) - now;
        if (startDiff > 0) {
          setTimeLeft(`Starts ${formatDiff(startDiff)}`);
        } else {
          setTimeLeft('Starting soon');
        }
        return;
      }

      const endDiff = vehicle.endTime - now;
      if (endDiff <= 0) {
        setDisplayStatus(
          vehicle.userBidStatus === 'won'
            ? 'Won'
            : vehicle.userBidStatus === 'lost'
            ? 'Lost'
            : 'Ended'
        );
        setStatusTone(vehicle.userBidStatus === 'won' ? 'success' : 'neutral');
        setTimeLeft('Ended');
        return;
      }

      setStatusTone('live');
      setDisplayStatus(isOwner ? 'My Live' : 'Live');
      setTimeLeft(formatDiff(endDiff));
    };

    updateStatus();
    const timer = setInterval(updateStatus, 1000);
    return () => clearInterval(timer);
  }, [vehicle, currentUser?.id, t]);

  const coverImg =
    vehicle.images && vehicle.images.length > 0
      ? vehicle.coverImageIndex !== undefined && vehicle.images[vehicle.coverImageIndex]
        ? vehicle.images[vehicle.coverImageIndex]
        : vehicle.images[0]
      : '';

  const priceAmount =
    vehicle.directPrice || vehicle.currentBid || vehicle.startingPrice || 0;
  const priceLabel =
    vehicle.listingType === 'direct' || vehicle.status === VehicleStatus.DIRECT_SALE
      ? 'Price'
      : isUpcomingState
      ? 'Starting'
      : 'Current bid';

  return (
    <article
      onClick={() => onClick(vehicle)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(vehicle);
        }
      }}
      className="bg-white rounded-2xl overflow-hidden flex flex-col cursor-pointer h-full border border-slate-200/85 hover:border-slate-300 hover:-translate-y-0.5 hover:shadow-md transition-all duration-200 group focus-visible:outline-2 focus-visible:outline-red-600"
    >
      {/* Image */}
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-slate-100">
        {coverImg && !imgError ? (
          <img
            src={coverImg}
            alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
            className="w-full h-full object-cover object-center transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-slate-100 to-slate-200 flex flex-col items-center justify-center gap-1.5 text-slate-400">
            <Car className="w-7 h-7" />
            <span className="text-[11px] font-medium text-slate-500">
              {vehicle.year} {vehicle.make}
            </span>
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-slate-950/60 to-transparent pointer-events-none" />
        <div className="absolute bottom-2.5 right-2.5 text-[11px] font-medium text-white tabular-nums bg-slate-950/70 backdrop-blur-xs px-2 py-0.5 rounded-lg">
          {(vehicle.odometer || 0).toLocaleString()} mi
        </div>
      </div>

      {/* Body */}
      <div className="p-3.5 flex-1 flex flex-col gap-1.5">
        {/* Clean 1-line status + RC verification */}
        <div className="flex items-center justify-between gap-2 text-xs">
          <span
            className={`font-semibold truncate ${
              statusTone === 'live'
                ? 'text-red-600'
                : statusTone === 'success'
                ? 'text-emerald-700'
                : 'text-slate-500'
            }`}
          >
            {displayStatus}
          </span>
          {vehicle.hasRegistrationCard && (
            <span className="inline-flex items-center gap-1 text-emerald-700 font-medium shrink-0">
              <Check className="w-3.5 h-3.5" />
              <span>RC</span>
            </span>
          )}
        </div>

        {/* Vehicle Title */}
        <h3 className="text-[15px] font-semibold text-slate-900 leading-snug group-hover:text-red-600 transition-colors truncate">
          {vehicle.year} {vehicle.make} {vehicle.model}
        </h3>

        {/* Clean Unboxed Metadata */}
        <div className="text-xs text-slate-500 truncate">
          <span className="font-mono text-[11px]">#{vehicle.stockNumber || (vehicle.id ? vehicle.id.slice(-8) : 'N/A')}</span>
          <span aria-hidden="true"> · </span>
          <span>{vehicle.primaryDamage || 'Inspected'}</span>
        </div>

        <div className="text-xs text-slate-500 truncate">{vehicle.location}</div>

        {/* Footer: Price & Time */}
        <div className="mt-auto pt-2.5 border-t border-slate-100 flex items-end justify-between gap-2">
          <div>
            <div className="text-[11px] text-slate-500">{priceLabel}</div>
            <div className="text-[15px] font-bold text-slate-900 tabular-nums">
              ₹{priceAmount.toLocaleString()}
            </div>
          </div>

          <div className="flex items-center gap-1 text-xs font-medium text-slate-600 tabular-nums shrink-0">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <span className={statusTone === 'live' ? 'text-red-600 font-semibold' : ''}>
              {timeLeft}
            </span>
          </div>
        </div>
      </div>
    </article>
  );
};