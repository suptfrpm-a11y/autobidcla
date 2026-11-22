import React from 'react';

export const SkeletonPulse: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`animate-pulse bg-gray-200/80 rounded-lg ${className}`} />
);

export const VehicleCardSkeleton = () => (
  <div className="bg-white rounded-2xl overflow-hidden flex flex-col h-full border border-slate-200 shadow-xs">
    <div className="w-full aspect-[16/10] bg-slate-200 animate-pulse" />
    <div className="p-3.5 flex-1 flex flex-col space-y-2">
      <SkeletonPulse className="h-4 w-3/4" />
      <SkeletonPulse className="h-3 w-1/2" />
      <div className="grid grid-cols-2 gap-2 pt-2">
        <SkeletonPulse className="h-3 w-full" />
        <SkeletonPulse className="h-3 w-full" />
      </div>
      <div className="mt-auto pt-2.5 border-t border-slate-100 flex justify-between items-center">
        <SkeletonPulse className="h-3 w-16" />
        <SkeletonPulse className="h-4 w-20" />
      </div>
    </div>
  </div>
);

export const VehicleDetailSkeleton = () => (
  <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 animate-pulse">
    <SkeletonPulse className="h-9 w-40 mb-6" />

    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <div className="bg-white border border-gray-200 p-3 rounded-lg shadow-xs">
          <div className="h-80 sm:h-96 w-full bg-gray-200 rounded-lg" />
          <div className="flex gap-2 mt-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-16 w-24 bg-gray-200 rounded-lg shrink-0" />
            ))}
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-xs">
          <div className="px-6 py-4 border-b border-gray-200">
            <SkeletonPulse className="h-6 w-1/3" />
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="flex justify-between border-b border-gray-100 pb-2">
                <SkeletonPulse className="h-4 w-1/3" />
                <SkeletonPulse className="h-4 w-1/3" />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="bg-white border border-gray-200 p-6 rounded-lg shadow-xs space-y-4">
          <SkeletonPulse className="h-7 w-3/4" />
          <SkeletonPulse className="h-4 w-1/2" />
          <div className="bg-gray-50 border border-gray-200 p-4 rounded-lg space-y-2">
            <SkeletonPulse className="h-3 w-1/3" />
            <SkeletonPulse className="h-9 w-1/2" />
          </div>
          <SkeletonPulse className="h-11 w-full" />
          <SkeletonPulse className="h-10 w-full" />
        </div>
      </div>
    </div>
  </div>
);

export const DashboardSkeleton = () => (
  <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 animate-pulse">
    <SkeletonPulse className="h-8 w-48 mb-6" />
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="bg-white border border-gray-200 p-4 rounded-lg shadow-xs h-28 flex flex-col justify-between">
          <SkeletonPulse className="h-4 w-1/2" />
          <SkeletonPulse className="h-8 w-2/3" />
          <SkeletonPulse className="h-3 w-1/3" />
        </div>
      ))}
    </div>
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-xs">
      <div className="px-6 py-4 border-b border-gray-200">
        <SkeletonPulse className="h-5 w-1/4" />
      </div>
      <div className="p-6 space-y-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex justify-between items-center py-2 border-b border-gray-100 last:border-0">
            <div className="space-y-2 w-1/2">
              <SkeletonPulse className="h-4 w-2/3" />
              <SkeletonPulse className="h-3 w-1/3" />
            </div>
            <SkeletonPulse className="h-7 w-24" />
          </div>
        ))}
      </div>
    </div>
  </div>
);

export const WalletSkeleton = () => (
  <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6 animate-pulse">
    <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-xs space-y-4">
      <SkeletonPulse className="h-4 w-40" />
      <SkeletonPulse className="h-12 w-56" />
      <div className="flex gap-2 pt-2">
        <SkeletonPulse className="h-10 w-32" />
        <SkeletonPulse className="h-10 w-32" />
        <SkeletonPulse className="h-10 w-32" />
      </div>
    </div>
    <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-xs space-y-4">
      <SkeletonPulse className="h-5 w-48" />
      <SkeletonPulse className="h-12 w-full" />
      <SkeletonPulse className="h-11 w-44" />
    </div>
  </div>
);