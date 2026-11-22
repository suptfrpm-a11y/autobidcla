import React, { useState, useRef, useCallback, useMemo, useLayoutEffect, useEffect } from 'react';

interface BottomNavProps {
  onNavigate: (page: string) => void;
  activePage: string;
  hasStockAccess?: boolean;
  unreadChatCount?: number;
  walletBalance?: number;
  userAvatarUrl?: string;
}

type NavId = 'home' | 'search' | 'sell' | 'stock' | 'wallet' | 'chat' | 'profile';

interface NavItem {
  id: NavId;
  label: string;
  renderIcon: (isActive: boolean) => React.ReactNode;
}

/* YouTube Liquid-Glass style icons: crisp 2px white outline when inactive, solid white filled glyph when active */
const NAV_ICONS: Record<NavId, (active: boolean) => React.ReactNode> = {
  home: (active) =>
    active ? (
      <svg viewBox="0 0 24 24" className="w-[22px] h-[22px] pointer-events-none" fill="currentColor" aria-hidden="true">
        <path d="M13.85 3.1a1.5 1.5 0 0 1 2.12 0l3.93 3.93a1.5 1.5 0 0 1 0 2.12l-1.76 1.76a1.5 1.5 0 0 1-2.12 0l-.35-.35-5.3 5.3a1.5 1.5 0 0 1-2.12-2.12l5.3-5.3-.35-.35a1.5 1.5 0 0 1 0-2.12L13.85 3.1Z" />
        <path d="M3 18.75A1.75 1.75 0 0 1 4.75 17h10.5a1.75 1.75 0 0 1 0 3.5H4.75A1.75 1.75 0 0 1 3 18.75Z" />
      </svg>
    ) : (
      <svg viewBox="0 0 24 24" className="w-[22px] h-[22px] pointer-events-none" fill="none" stroke="currentColor" strokeWidth={1.95} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m14.5 12.5-8 8a2.119 2.119 0 0 1-3-3l8-8" />
        <path d="m16 16 6-6" />
        <path d="m8 8 6-6" />
        <path d="m9 7 8 8" />
        <path d="m21 11-8-8" />
      </svg>
    ),

  search: (active) =>
    active ? (
      <svg viewBox="0 0 24 24" className="w-[22px] h-[22px] pointer-events-none" fill="none" aria-hidden="true">
        <circle cx="10.75" cy="10.75" r="6.75" fill="currentColor" fillOpacity="0.24" stroke="currentColor" strokeWidth={2.6} />
        <path d="m16 16 4.25 4.25" stroke="currentColor" strokeWidth={2.8} strokeLinecap="round" />
      </svg>
    ) : (
      <svg viewBox="0 0 24 24" className="w-[22px] h-[22px] pointer-events-none" fill="none" stroke="currentColor" strokeWidth={1.95} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7.25" />
        <path d="m20 20-3.85-3.85" />
      </svg>
    ),

  sell: (active) =>
    active ? (
      <svg viewBox="0 0 24 24" className="w-[23px] h-[23px] pointer-events-none" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9.25" fill="currentColor" />
        <path d="M12 8.25v7.5M8.25 12h7.5" stroke="#18181b" strokeWidth={2.3} strokeLinecap="round" />
      </svg>
    ) : (
      <svg viewBox="0 0 24 24" className="w-[23px] h-[23px] pointer-events-none" fill="none" stroke="currentColor" strokeWidth={1.95} strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8.25v7.5M8.25 12h7.5" />
      </svg>
    ),

  stock: (active) =>
    active ? (
      <svg viewBox="0 0 24 24" className="w-[22px] h-[22px] pointer-events-none" fill="currentColor" aria-hidden="true">
        <path d="M11.15 2.42a1.75 1.75 0 0 1 1.7 0l7.25 4.02a1.75 1.75 0 0 1 .9 1.53v8.06a1.75 1.75 0 0 1-.9 1.53l-7.25 4.02a1.75 1.75 0 0 1-1.7 0l-7.25-4.02A1.75 1.75 0 0 1 3 16.03V7.97a1.75 1.75 0 0 1 .9-1.53l7.25-4.02ZM5.7 7.75 12 11.24l6.3-3.49L12 4.26 5.7 7.75Z" />
      </svg>
    ) : (
      <svg viewBox="0 0 24 24" className="w-[22px] h-[22px] pointer-events-none" fill="none" stroke="currentColor" strokeWidth={1.95} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
        <path d="m3.3 7 8.7 5 8.7-5" />
        <path d="M12 22V12" />
      </svg>
    ),

  wallet: (active) =>
    active ? (
      <svg viewBox="0 0 24 24" className="w-[22px] h-[22px] pointer-events-none" fill="currentColor" aria-hidden="true">
        <path d="M4.75 4A2.75 2.75 0 0 0 2 6.75v10.5A2.75 2.75 0 0 0 4.75 20h14.5A2.75 2.75 0 0 0 22 17.25v-1.5a.75.75 0 0 0-.75-.75h-3.5a2.5 2.5 0 0 1 0-5h3.5a.75.75 0 0 0 .75-.75v-1.5A2.75 2.75 0 0 0 19.25 5H5.5a.75.75 0 0 1 0-1.5h12.75a.75.75 0 0 0 0-1.5H4.75ZM17.75 11.5a1 1 0 1 0 0 2h3.5a1 1 0 1 0 0-2h-3.5Z" />
      </svg>
    ) : (
      <svg viewBox="0 0 24 24" className="w-[22px] h-[22px] pointer-events-none" fill="none" stroke="currentColor" strokeWidth={1.95} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
        <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
      </svg>
    ),

  chat: (active) =>
    active ? (
      <svg viewBox="0 0 24 24" className="w-[22px] h-[22px] pointer-events-none" fill="currentColor" aria-hidden="true">
        <path d="M4.75 3.5A2.75 2.75 0 0 0 2 6.25v9.5A2.75 2.75 0 0 0 4.75 18.5h1.9l3.66 2.93a1.1 1.1 0 0 0 1.79-.86V18.5h7.15A2.75 2.75 0 0 0 22 15.75v-9.5A2.75 2.75 0 0 0 19.25 3.5H4.75Z" />
      </svg>
    ) : (
      <svg viewBox="0 0 24 24" className="w-[22px] h-[22px] pointer-events-none" fill="none" stroke="currentColor" strokeWidth={1.95} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15a2 2 0 0 1-2 2H8l-4 3V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" />
      </svg>
    ),

  profile: (active) =>
    active ? (
      <svg viewBox="0 0 24 24" className="w-[22px] h-[22px] pointer-events-none" fill="currentColor" aria-hidden="true">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M12 2.25a9.75 9.75 0 1 0 0 19.5 9.75 9.75 0 0 0 0-19.5ZM12 6.5a3.25 3.25 0 1 0 0 6.5 3.25 3.25 0 0 0 0-6.5Zm-5.12 10.6a7.25 7.25 0 0 0 10.24 0 5.75 5.75 0 0 0-10.24 0Z"
        />
      </svg>
    ) : (
      <svg viewBox="0 0 24 24" className="w-[22px] h-[22px] pointer-events-none" fill="none" stroke="currentColor" strokeWidth={1.95} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9.25" />
        <circle cx="12" cy="9.5" r="3" />
        <path d="M6.8 18.2a6.2 6.2 0 0 1 10.4 0" />
      </svg>
    ),
};

const ALL_NAV_ITEMS: NavItem[] = [
  { id: 'home', label: 'Auctions', renderIcon: NAV_ICONS.home },
  { id: 'search', label: 'Search', renderIcon: NAV_ICONS.search },
  { id: 'sell', label: 'Sell', renderIcon: NAV_ICONS.sell },
  { id: 'stock', label: 'Stock', renderIcon: NAV_ICONS.stock },
  { id: 'wallet', label: 'Wallet', renderIcon: NAV_ICONS.wallet },
  { id: 'chat', label: 'Chat', renderIcon: NAV_ICONS.chat },
  { id: 'profile', label: 'Profile', renderIcon: NAV_ICONS.profile },
];

export const BottomNav: React.FC<BottomNavProps> = ({
  onNavigate,
  activePage,
  hasStockAccess = false,
  unreadChatCount = 0,
  walletBalance,
  userAvatarUrl,
}) => {
  const navRef = useRef<HTMLElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [slotMetrics, setSlotMetrics] = useState<{ left: number; width: number }[]>([]);
  const [avatarError, setAvatarError] = useState(false);

  useEffect(() => {
    setAvatarError(false);
  }, [userAvatarUrl]);

  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubX, setScrubX] = useState<number | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [mouseHoverIndex, setMouseHoverIndex] = useState<number | null>(null);
  const [isStretching, setIsStretching] = useState(false);
  const stretchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevActiveIdxRef = useRef<number>(-1);
  const hoverIndexRef = useRef<number | null>(null);

  const navItems = useMemo(() => {
    if (hasStockAccess) return ALL_NAV_ITEMS;
    return ALL_NAV_ITEMS.filter((item) => item.id !== 'stock');
  }, [hasStockAccess]);

  const ignoreClicksUntilRef = useRef<number>(0);
  const lastNavigatedTimeRef = useRef<number>(0);

  const normalizedActive = useMemo(() => {
    if (activePage === 'detail') return 'home';
    if (
      ['profile', 'settings', 'support', 'admin', 'terms', 'privacy', 'cookies', 'help_center', 'faq', 'help', 'contact'].includes(
        activePage
      )
    ) {
      return 'profile';
    }
    return activePage;
  }, [activePage]);

  const activeIndex = useMemo(
    () => navItems.findIndex((item) => item.id === normalizedActive),
    [navItems, normalizedActive]
  );

  // Trigger subtle liquid-droplet stretch pulse when switching between tabs
  useEffect(() => {
    if (prevActiveIdxRef.current !== -1 && activeIndex !== -1 && prevActiveIdxRef.current !== activeIndex) {
      setIsStretching(true);
      if (stretchTimerRef.current) clearTimeout(stretchTimerRef.current);
      stretchTimerRef.current = setTimeout(() => setIsStretching(false), 220);
    }
    prevActiveIdxRef.current = activeIndex;
    return () => {
      if (stretchTimerRef.current) clearTimeout(stretchTimerRef.current);
    };
  }, [activeIndex]);

  // Measure each slot's exact offsetLeft & width so the liquid lens aligns concentrically inside the capsule
  const measureSlots = useCallback(() => {
    if (!navRef.current) return;
    const metrics = navItems.map((_, idx) => {
      const el = buttonRefs.current[idx];
      if (!el) return { left: 0, width: 0 };
      return { left: el.offsetLeft, width: el.offsetWidth };
    });
    setSlotMetrics(metrics);
  }, [navItems]);

  useLayoutEffect(() => {
    measureSlots();
  }, [measureSlots]);

  useEffect(() => {
    if (!navRef.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measureSlots());
    observer.observe(navRef.current);
    return () => observer.disconnect();
  }, [measureSlots]);

  const triggerHaptic = useCallback((ms = 8) => {
    try {
      if (typeof window !== 'undefined' && 'navigator' in window && navigator.vibrate) {
        navigator.vibrate(ms);
      }
    } catch {
      // Ignore on unsupported browsers
    }
  }, []);

  const navigateTo = useCallback(
    (itemId: string) => {
      const now = Date.now();
      if (now < ignoreClicksUntilRef.current) return;
      if (now - lastNavigatedTimeRef.current < 100) return;
      lastNavigatedTimeRef.current = now;
      triggerHaptic(8);
      onNavigate(itemId);
    },
    [onNavigate, triggerHaptic]
  );

  const computeIndexAndLocalX = useCallback(
    (clientX: number): { index: number; localX: number } => {
      if (!navRef.current) {
        return { index: Math.max(0, activeIndex), localX: 0 };
      }
      const rect = navRef.current.getBoundingClientRect();
      if (rect.width <= 0) return { index: Math.max(0, activeIndex), localX: 0 };
      const localX = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const pct = localX / rect.width;
      const rawIndex = Math.floor(pct * navItems.length);
      const index = Math.max(0, Math.min(navItems.length - 1, rawIndex));
      return { index, localX };
    },
    [activeIndex, navItems.length]
  );

  const gestureRef = useRef<{
    active: boolean;
    pointerId: number | null;
    startX: number;
    startY: number;
    startTime: number;
    hasMoved: boolean;
    startIndex: number;
    captured: boolean;
  }>({
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    startTime: 0,
    hasMoved: false,
    startIndex: 0,
    captured: false,
  });

  const handlePointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const { index } = computeIndexAndLocalX(e.clientX);
    gestureRef.current = {
      active: true,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startTime: Date.now(),
      hasMoved: false,
      startIndex: index,
      captured: false,
    };
    hoverIndexRef.current = index;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const g = gestureRef.current;
    if (!g.active || g.pointerId === null || g.pointerId !== e.pointerId) return;

    const deltaX = e.clientX - g.startX;
    const deltaY = e.clientY - g.startY;

    if (!g.hasMoved && (Math.abs(deltaX) > 6 || Math.abs(deltaY) > 8)) {
      g.hasMoved = true;
      setIsScrubbing(true);
      if (!g.captured && navRef.current) {
        try {
          navRef.current.setPointerCapture(e.pointerId);
          g.captured = true;
        } catch {
          // Ignore
        }
      }
    }

    if (g.hasMoved) {
      const { index, localX } = computeIndexAndLocalX(e.clientX);
      setScrubX(localX);
      if (index !== hoverIndexRef.current) {
        hoverIndexRef.current = index;
        setHoverIndex(index);
        triggerHaptic(6);
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLElement>) => {
    const g = gestureRef.current;
    if (!g.active || g.pointerId === null || g.pointerId !== e.pointerId) return;

    if (g.captured && navRef.current) {
      try {
        if (navRef.current.hasPointerCapture(e.pointerId)) {
          navRef.current.releasePointerCapture(e.pointerId);
        }
      } catch {
        // Ignore
      }
    }

    const deltaX = e.clientX - g.startX;
    const deltaY = e.clientY - g.startY;
    const elapsed = Date.now() - g.startTime;
    const wasScrubbing = g.hasMoved;
    const startIdx = g.startIndex;

    g.active = false;
    g.pointerId = null;
    g.captured = false;

    if (wasScrubbing) {
      ignoreClicksUntilRef.current = Date.now() + 300;
      const isQuickFlick =
        elapsed < 280 && Math.abs(deltaX) > 22 && Math.abs(deltaX) > Math.abs(deltaY) * 0.9;

      if (isQuickFlick && activeIndex >= 0) {
        const step = deltaX > 0 ? 1 : -1;
        const targetIdx = Math.max(0, Math.min(navItems.length - 1, activeIndex + step));
        navigateTo(navItems[targetIdx].id);
      } else if (
        hoverIndexRef.current !== null &&
        hoverIndexRef.current >= 0 &&
        hoverIndexRef.current < navItems.length
      ) {
        navigateTo(navItems[hoverIndexRef.current].id);
      }
    } else if (startIdx >= 0 && startIdx < navItems.length) {
      navigateTo(navItems[startIdx].id);
    }

    setIsScrubbing(false);
    setScrubX(null);
    setHoverIndex(null);
    hoverIndexRef.current = null;
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLElement>) => {
    const g = gestureRef.current;
    if (g.captured && navRef.current) {
      try {
        if (navRef.current.hasPointerCapture(e.pointerId)) {
          navRef.current.releasePointerCapture(e.pointerId);
        }
      } catch {
        // Ignore
      }
    }
    g.active = false;
    g.pointerId = null;
    g.captured = false;
    setIsScrubbing(false);
    setScrubX(null);
    setHoverIndex(null);
    hoverIndexRef.current = null;
  };

  const handleButtonClick = (itemId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigateTo(itemId);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const base = activeIndex >= 0 ? activeIndex : 0;
    const nextIdx =
      e.key === 'ArrowRight'
        ? (base + 1) % navItems.length
        : (base - 1 + navItems.length) % navItems.length;
    buttonRefs.current[nextIdx]?.focus();
    navigateTo(navItems[nextIdx].id);
  };

  // Liquid Glass active oval lens positioning (follows pointer continuously during scrub, springs cleanly to slot on release)
  const targetIndex = isScrubbing && hoverIndex !== null ? hoverIndex : activeIndex;
  const activeSlot = targetIndex >= 0 ? slotMetrics[targetIndex] : undefined;
  const firstSlot = slotMetrics[0];
  const lastSlot = slotMetrics[slotMetrics.length - 1];

  let lensX = activeSlot ? activeSlot.left : 0;
  const lensWidth = activeSlot ? activeSlot.width : 0;

  if (isScrubbing && scrubX !== null && firstSlot && lastSlot && lensWidth > 0) {
    const minCenter = firstSlot.left + firstSlot.width / 2;
    const maxCenter = lastSlot.left + lastSlot.width / 2;
    const clampedCenter = Math.max(minCenter, Math.min(maxCenter, scrubX));
    lensX = clampedCenter - lensWidth / 2;
  }

  const showLens = Boolean(
    (targetIndex >= 0 || (isScrubbing && scrubX !== null)) && lensWidth > 0
  );

  // Subtle floating label preview on scrub or desktop hover
  const previewIndex = isScrubbing ? hoverIndex : mouseHoverIndex;
  const previewSlot = previewIndex !== null ? slotMetrics[previewIndex] : undefined;
  const previewItem = previewIndex !== null ? navItems[previewIndex] : undefined;
  const previewX =
    isScrubbing && lensWidth > 0
      ? lensX + lensWidth / 2
      : previewSlot
      ? previewSlot.left + previewSlot.width / 2
      : 0;

  // Dynamic capsule width scales comfortably for 6 vs 7 icons across all screen sizes
  const capsuleMaxWidth = hasStockAccess ? 'max-w-[490px] sm:max-w-[530px]' : 'max-w-[430px] sm:max-w-[470px]';

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40 pointer-events-none px-3 sm:px-5 flex justify-center"
      style={{ paddingBottom: 'max(14px, env(safe-area-inset-bottom))' }}
    >
      <div
        className={`pointer-events-auto relative w-full ${capsuleMaxWidth} rounded-full bg-[#121215]/80 backdrop-blur-2xl backdrop-saturate-150 border border-white/[0.16] shadow-[inset_0_1px_0.5px_rgba(255,255,255,0.22),inset_0_-1px_0.5px_rgba(255,255,255,0.06),0_18px_42px_-10px_rgba(0,0,0,0.48),0_4px_14px_-2px_rgba(0,0,0,0.22)] select-none`}
      >
        {/* Subtle floating label pill when scrubbing on touch or hovering on desktop */}
        {previewItem && (isScrubbing || previewSlot) && (
          <div
            aria-hidden="true"
            style={{
              transform: `translate3d(${previewX}px, 0, 0) translateX(-50%)`,
              transition: isScrubbing
                ? 'opacity 120ms ease'
                : 'transform 240ms cubic-bezier(0.22, 1, 0.36, 1), opacity 140ms ease',
            }}
            className="absolute -top-10 left-0 px-3 py-1 rounded-full bg-[#141418]/90 backdrop-blur-xl text-white text-[11px] font-medium tracking-tight border border-white/15 shadow-[0_8px_20px_-4px_rgba(0,0,0,0.4)] whitespace-nowrap pointer-events-none flex items-center gap-1.5"
          >
            <span>{previewItem.label}</span>
            {previewItem.id === 'wallet' && typeof walletBalance === 'number' && (
              <span className="text-white/65 tabular-nums">· ₹{walletBalance.toLocaleString()}</span>
            )}
          </div>
        )}

        <nav
          ref={navRef}
          aria-label="Primary Bottom Navigation"
          style={{ touchAction: 'none' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onPointerLeave={() => setMouseHoverIndex(null)}
          onKeyDown={handleKeyDown}
          className="relative w-full h-[58px] sm:h-[62px] p-1.5 flex items-center justify-between touch-none select-none"
        >
          {/* Desktop subtle hover glass halo */}
          <div
            aria-hidden="true"
            style={{
              transform:
                !isScrubbing && mouseHoverIndex !== null && mouseHoverIndex !== activeIndex && slotMetrics[mouseHoverIndex]
                  ? `translate3d(${slotMetrics[mouseHoverIndex].left}px, 0, 0)`
                  : 'translate3d(0, 0, 0)',
              width:
                !isScrubbing && mouseHoverIndex !== null && mouseHoverIndex !== activeIndex && slotMetrics[mouseHoverIndex]
                  ? `${slotMetrics[mouseHoverIndex].width}px`
                  : '0px',
              opacity:
                !isScrubbing && mouseHoverIndex !== null && mouseHoverIndex !== activeIndex && slotMetrics[mouseHoverIndex]
                  ? 1
                  : 0,
              transition:
                'transform 260ms cubic-bezier(0.22, 1, 0.36, 1), width 260ms cubic-bezier(0.22, 1, 0.36, 1), opacity 160ms ease',
            }}
            className="hidden md:block absolute top-1.5 bottom-1.5 left-0 rounded-full bg-white/[0.07] pointer-events-none"
          />

          {/* YouTube Liquid Glass Active Oval Bubble (concentric rounded-full lens inside the capsule) */}
          <div
            aria-hidden="true"
            style={{
              transform: `translate3d(${lensX}px, 0, 0) scaleX(${
                isScrubbing ? 1.07 : isStretching ? 1.08 : 1
              }) scaleY(${isScrubbing ? 1.05 : isStretching ? 0.94 : 1})`,
              width: `${lensWidth}px`,
              opacity: showLens ? 1 : 0,
              transition: isScrubbing
                ? 'opacity 140ms ease, background-color 140ms ease'
                : 'transform 380ms cubic-bezier(0.22, 1.15, 0.36, 1), width 300ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease',
            }}
            className={`absolute top-1.5 bottom-1.5 left-0 rounded-full pointer-events-none border ${
              isScrubbing
                ? 'bg-white/[0.24] border-white/[0.22] shadow-[inset_0_1px_1px_rgba(255,255,255,0.38),0_4px_16px_rgba(0,0,0,0.28)]'
                : 'bg-white/[0.17] border-white/[0.12] shadow-[inset_0_1px_0.5px_rgba(255,255,255,0.28),0_2px_10px_rgba(0,0,0,0.2)]'
            }`}
          />

          {navItems.map((item, index) => {
            const isActive = !isScrubbing && activeIndex === index;
            const isScrubHighlighted = isScrubbing && hoverIndex === index;
            const highlighted = isActive || isScrubHighlighted;

            const buttonTitle =
              item.id === 'wallet' && typeof walletBalance === 'number'
                ? `Wallet (₹${walletBalance.toLocaleString()})`
                : item.label;

            return (
              <button
                key={item.id}
                ref={(el) => {
                  buttonRefs.current[index] = el;
                }}
                type="button"
                style={{ touchAction: 'none' }}
                onClick={(e) => handleButtonClick(item.id, e)}
                onPointerEnter={(e) => {
                  if (e.pointerType === 'mouse') setMouseHoverIndex(index);
                }}
                aria-current={isActive ? 'page' : undefined}
                aria-label={buttonTitle}
                className={`relative z-10 flex-1 min-w-0 h-full rounded-full flex items-center justify-center cursor-pointer focus-visible:outline-2 focus-visible:outline-white/80 transition-colors duration-200 ${
                  highlighted ? 'text-white' : 'text-white/85 hover:text-white'
                }`}
              >
                <div
                  style={{
                    transition: 'transform 300ms cubic-bezier(0.22, 1.2, 0.36, 1)',
                  }}
                  className={`relative flex items-center justify-center ${
                    isScrubHighlighted
                      ? 'scale-[1.18]'
                      : isActive
                      ? 'scale-[1.06]'
                      : 'scale-100'
                  }`}
                >
                  {item.id === 'profile' && userAvatarUrl && !avatarError ? (
                    <img
                      src={userAvatarUrl}
                      alt="Profile"
                      onError={() => setAvatarError(true)}
                      className={`w-[24px] h-[24px] rounded-full object-cover pointer-events-none transition-all duration-200 ${
                        highlighted ? 'ring-2 ring-white' : 'ring-[1.5px] ring-white/75'
                      }`}
                    />
                  ) : (
                    item.renderIcon(highlighted)
                  )}

                  {item.id === 'chat' && unreadChatCount > 0 && (
                    <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-red-600 text-white text-[10px] font-semibold flex items-center justify-center leading-none tabular-nums ring-2 ring-[#1c1c20]">
                      {unreadChatCount > 9 ? '9+' : unreadChatCount}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
};