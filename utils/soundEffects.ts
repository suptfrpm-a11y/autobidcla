/**
 * AutoBid Real-Time Sound Effects Engine
 * Uses Web Audio API for zero-latency, millisecond-fast click sounds
 * when bids are placed locally or received from other users in real time.
 */

let audioCtx: AudioContext | null = null;

const getAudioContext = (): AudioContext | null => {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
};

// Auto-unlock AudioContext on first user interaction
if (typeof window !== 'undefined') {
  const unlockAudio = () => {
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    window.removeEventListener('pointerdown', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
  };
  window.addEventListener('pointerdown', unlockAudio, { passive: true });
  window.addEventListener('keydown', unlockAudio, { passive: true });
}

/**
 * Plays a snappy, crisp mechanical click sound for bid placement.
 * Ideal for millisecond multi-user rapid bidding.
 */
export const playBidClickSound = (pitchVariation = 0): void => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    // Base click frequency around 1100 Hz, with optional pitch variation for rapid-fire bids
    const baseFreq = 1100 + pitchVariation;
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(180, now + 0.035);

    // Fast click transient envelope
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.45, now + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.045);
  } catch (err) {
    console.warn('[SoundEffects] Click playback error:', err);
  }
};

/**
 * Plays a slightly higher-toned crisp click when the current user's bid is successfully placed.
 */
export const playUserBidPlacedSound = (): void => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    
    // First snap click
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(1400, now);
    osc1.frequency.exponentialRampToValueAtTime(350, now + 0.03);
    gain1.gain.setValueAtTime(0.4, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.04);

    // Follow-up micro-tap at 25ms for a satisfying double-click mechanical sensation
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(1800, now + 0.025);
    osc2.frequency.exponentialRampToValueAtTime(600, now + 0.06);
    gain2.gain.setValueAtTime(0.001, now);
    gain2.gain.setValueAtTime(0.3, now + 0.025);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.065);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.025);
    osc2.stop(now + 0.07);
  } catch (err) {
    console.warn('[SoundEffects] User bid sound error:', err);
  }
};

/**
 * Plays distinct concurrent click sounds when multiple bids arrive within milliseconds.
 */
export const playMultiUserRapidClick = (index = 0): void => {
  const variation = ((index % 5) - 2) * 90; // Subtle pitch variation so simultaneous clicks are distinct
  playBidClickSound(variation);
};
