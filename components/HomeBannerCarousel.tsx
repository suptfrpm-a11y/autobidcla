import React, { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, X, ArrowRight, Car } from 'lucide-react';
import { db, collection, onSnapshot } from '../firebase';
import { ContentBanner, CarouselSlide } from '../types';
import heroLiveAuctionImg from '../src/assets/images/hero_live_auction_1795104025138.jpg';
import heroSellVehicleImg from '../src/assets/images/hero_sell_vehicle_1795104024672.jpg';
import heroMarketIntelImg from '../src/assets/images/hero_market_intel_1795104024336.jpg';

interface HomeBannerCarouselProps {
  onNavigate?: (view: any) => void;
}

const DEFAULT_FALLBACK_SLIDES: CarouselSlide[] = [
  {
    id: 'default_live_auctions',
    title: 'AutoBid Premier Live Auctions',
    subtitle:
      'Bid on authenticated luxury supercars, verified trade vehicles, and inspected daily drivers in real time.',
    imageUrl: heroLiveAuctionImg,
    targetUrl: '/auctions',
    badge: 'Live Auctions Daily',
    ctaText: 'Explore Live Auctions',
  },
  {
    id: 'default_sell_vehicle',
    title: 'Zero Seller Listing Fees This Weekend',
    subtitle:
      'List your vehicle with instant RC verification and direct buyer reach across live auction or fixed-price sale.',
    imageUrl: heroSellVehicleImg,
    targetUrl: '/sell',
    badge: 'Seller Promotion',
    ctaText: 'Sell Your Vehicle',
  },
  {
    id: 'default_stock_intel',
    title: 'Unlock Stock Insights & Valuation Intel',
    subtitle:
      'Access stock-number lookup, inventory provenance, and algorithmic pricing before placing your next bid.',
    imageUrl: heroMarketIntelImg,
    targetUrl: '/wallet',
    badge: 'Market Intelligence',
    ctaText: 'Open Wallet & Services',
  },
];

function resolveReliableBannerImage(url?: string, index = 0): string {
  const localPool = [heroLiveAuctionImg, heroSellVehicleImg, heroMarketIntelImg];
  if (!url || url.includes('unsplash.com') || url.includes('placeholder.com') || url.includes('picsum.photos')) {
    return localPool[index % localPool.length];
  }
  return url;
}

export const HomeBannerCarousel: React.FC<HomeBannerCarouselProps> = ({ onNavigate }) => {
  const [banners, setBanners] = useState<ContentBanner[]>([]);
  const [currentSlideIndex, setCurrentSlideIndex] = useState<number>(0);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [isDismissed, setIsDismissed] = useState<boolean>(false);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const touchStartXRef = useRef<number | null>(null);

  // Load active banners from Firestore and server API
  useEffect(() => {
    let unsub: (() => void) | null = null;

    const fetchServerActiveBanners = () => {
      fetch('/api/banners/active')
        .then((res) => res.json())
        .then((data) => {
          if (data.success && Array.isArray(data.banners)) {
            setBanners(data.banners);
          }
        })
        .catch(() => {});
    };

    fetchServerActiveBanners();

    try {
      unsub = onSnapshot(
        collection(db, 'content_banners'),
        (snap) => {
          if (!snap.empty) {
            const list: ContentBanner[] = [];
            snap.forEach((d) => {
              const data = d.data() as ContentBanner;
              if (data.isActive !== false) {
                list.push({ id: d.id, ...data });
              }
            });
            list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            setBanners(list);
          } else {
            fetchServerActiveBanners();
          }
        },
        () => {
          fetchServerActiveBanners();
        }
      );
    } catch {
      fetchServerActiveBanners();
    }

    const pollInterval = setInterval(fetchServerActiveBanners, 8000);

    return () => {
      if (unsub) unsub();
      clearInterval(pollInterval);
    };
  }, []);

  const activeSlides: CarouselSlide[] = React.useMemo(() => {
    if (!banners || banners.length === 0) return DEFAULT_FALLBACK_SLIDES;

    const slidesList: CarouselSlide[] = [];
    banners.forEach((b) => {
      if (b.isActive === false) return;
      if (b.isCarousel && b.slides && b.slides.length > 0) {
        b.slides.forEach((s, idx) =>
          slidesList.push({
            ...s,
            imageUrl: resolveReliableBannerImage(s.imageUrl, idx),
          })
        );
      } else {
        slidesList.push({
          id: b.id,
          title: b.title,
          subtitle: b.subtitle,
          imageUrl: resolveReliableBannerImage(b.imageUrl, slidesList.length),
          targetUrl: b.targetUrl || '/auctions',
          badge: b.badge || 'Featured Announcement',
          ctaText: b.ctaText || 'Explore Auctions',
        });
      }
    });

    return slidesList.length > 0 ? slidesList : DEFAULT_FALLBACK_SLIDES;
  }, [banners]);

  useEffect(() => {
    if (currentSlideIndex >= activeSlides.length) {
      setCurrentSlideIndex(0);
    }
  }, [activeSlides.length, currentSlideIndex]);

  useEffect(() => {
    if (isPaused || activeSlides.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentSlideIndex((prev) => (prev + 1) % activeSlides.length);
    }, 5500);
    return () => clearInterval(interval);
  }, [isPaused, activeSlides.length]);

  if (isDismissed || activeSlides.length === 0) return null;

  const currentSlide = activeSlides[currentSlideIndex] || activeSlides[0];
  const slideKey = String(currentSlide.id || currentSlideIndex);
  const isExternalLink = Boolean(currentSlide.targetUrl?.startsWith('http'));
  const cleanCtaText = (currentSlide.ctaText || 'Explore More').replace(/\s*[→➜]\s*$/, '');
  const cleanBadgeText = (currentSlide.badge || '').replace(/^[\u{1F300}-\u{1FAFF}\u2600-\u27BF]+\s*/u, '');

  const handleInternalClick = (e: React.MouseEvent, targetUrl?: string) => {
    e.stopPropagation();
    if (!targetUrl || !onNavigate) return;
    if (targetUrl.includes('sell')) onNavigate('sell');
    else if (targetUrl.includes('wallet')) onNavigate('wallet');
    else if (targetUrl.includes('stock')) onNavigate('stock');
    else if (targetUrl.includes('search')) onNavigate('search');
    else onNavigate('home');
  };

  const goToPrev = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setCurrentSlideIndex((prev) => (prev - 1 + activeSlides.length) % activeSlides.length);
  };

  const goToNext = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setCurrentSlideIndex((prev) => (prev + 1) % activeSlides.length);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0]?.clientX ?? null;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartXRef.current === null || activeSlides.length <= 1) return;
    const endX = e.changedTouches[0]?.clientX ?? touchStartXRef.current;
    const diff = endX - touchStartXRef.current;
    touchStartXRef.current = null;
    if (Math.abs(diff) > 45) {
      if (diff > 0) goToPrev();
      else goToNext();
    }
  };

  return (
    <section
      aria-label="Featured Marketplace Announcements"
      className="relative mb-6 rounded-2xl sm:rounded-3xl overflow-hidden border border-slate-200/90 shadow-[0_14px_34px_-14px_rgba(15,23,42,0.22)] group select-none bg-slate-900"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="relative h-64 sm:h-76 md:h-84 w-full overflow-hidden bg-slate-900">
        {!failedImages[slideKey] && currentSlide.imageUrl ? (
          <img
            key={slideKey}
            src={currentSlide.imageUrl}
            alt={currentSlide.title || 'AutoBid Promotional Banner'}
            referrerPolicy="no-referrer"
            onError={() => setFailedImages((prev) => ({ ...prev, [slideKey]: true }))}
            className="w-full h-full object-cover object-center transition-transform duration-700 ease-out group-hover:scale-[1.02]"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-slate-900 via-slate-800 to-red-950 flex items-center justify-end pr-10">
            <Car className="w-36 h-36 text-white/10" />
          </div>
        )}

        {/* Measured multi-stop legibility scrim */}
        <div className="absolute inset-0 bg-gradient-to-r from-slate-950/90 via-slate-950/55 to-slate-950/20 pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-transparent to-slate-950/15 pointer-events-none" />

        {/* Content Container */}
        <div className="absolute inset-0 z-10 flex flex-col justify-end p-5 sm:p-8 md:p-10 text-white max-w-2xl">
          {cleanBadgeText && (
            <p className="text-[11px] sm:text-xs font-semibold uppercase tracking-[0.12em] text-red-400 mb-1.5">
              {cleanBadgeText}
            </p>
          )}

          <h2 className="text-xl sm:text-3xl md:text-[34px] font-bold tracking-tight leading-[1.15] text-white [text-wrap:balance] line-clamp-2">
            {currentSlide.title}
          </h2>

          {currentSlide.subtitle && (
            <p className="mt-2 text-xs sm:text-sm text-slate-200/95 line-clamp-2 max-w-xl leading-relaxed">
              {currentSlide.subtitle}
            </p>
          )}

          <div className="mt-4 sm:mt-5 flex items-center gap-3 flex-wrap">
            {isExternalLink ? (
              <a
                href={currentSlide.targetUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs sm:text-sm font-semibold transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0 shadow-sm"
              >
                <span>{cleanCtaText}</span>
                <ArrowRight className="w-4 h-4" />
              </a>
            ) : (
              <button
                type="button"
                onClick={(e) => handleInternalClick(e, currentSlide.targetUrl)}
                className="px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs sm:text-sm font-semibold transition-colors cursor-pointer inline-flex items-center gap-2 whitespace-nowrap shrink-0 shadow-sm"
              >
                <span>{cleanCtaText}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Carousel Navigation Arrows */}
        {activeSlides.length > 1 && (
          <>
            <button
              type="button"
              onClick={goToPrev}
              aria-label="Previous banner"
              className="hidden sm:flex absolute left-4 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-white/90 hover:bg-white text-slate-900 border border-white/60 items-center justify-center transition-all cursor-pointer shadow-sm opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={goToNext}
              aria-label="Next banner"
              className="hidden sm:flex absolute right-4 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-white/90 hover:bg-white text-slate-900 border border-white/60 items-center justify-center transition-all cursor-pointer shadow-sm opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </>
        )}

        {/* Carousel Slide Indicator Dots */}
        {activeSlides.length > 1 && (
          <div className="absolute bottom-4 right-4 sm:bottom-5 sm:right-6 z-20 flex items-center gap-2 bg-slate-950/55 backdrop-blur-sm px-3 py-1.5 rounded-full border border-white/10">
            {activeSlides.map((_, idx) => (
              <button
                key={idx}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setCurrentSlideIndex(idx);
                }}
                className={`transition-all rounded-full cursor-pointer ${
                  idx === currentSlideIndex
                    ? 'w-5 h-1.5 bg-red-500'
                    : 'w-1.5 h-1.5 bg-white/60 hover:bg-white'
                }`}
                aria-label={`Go to slide ${idx + 1}`}
              />
            ))}
            <span className="text-[11px] text-white/90 font-medium tabular-nums ml-1">
              {currentSlideIndex + 1}/{activeSlides.length}
            </span>
          </div>
        )}

        {/* Dismiss / Close Button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIsDismissed(true);
          }}
          title="Dismiss banner"
          aria-label="Dismiss banner"
          className="absolute top-3.5 right-3.5 sm:top-4 sm:right-4 z-20 w-8 h-8 rounded-full bg-slate-950/55 hover:bg-slate-950/80 text-white/90 hover:text-white flex items-center justify-center border border-white/15 backdrop-blur-sm cursor-pointer transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </section>
  );
};
