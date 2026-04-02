// ============================================================
// JOVE — Design System
// Session 2 — Single source of truth for all visual constants.
// Import from here in every component. Never hardcode these values.
// ============================================================

// ── COLORS ──────────────────────────────────────────────────
// These match the jove-* tokens in tailwind.config.ts exactly.
// Use Tailwind classes in components. Use these constants in
// inline styles and dynamic values only.

export const COLORS = {
  // Light surfaces
  cream:       '#F7F3EC',
  white:       '#FFFFFF',
  ink:         '#1A1410',
  inkMid:      'rgba(26,20,16,0.52)',
  inkLight:    'rgba(26,20,16,0.3)',

  // Dark surfaces
  bg:          '#0D0F12',
  card:        '#1A1E28',
  cardBorder:  'rgba(255,255,255,0.06)',
  textPrimary: '#F0EBE0',
  textMid:     'rgba(240,235,224,0.52)',
  textLight:   'rgba(240,235,224,0.28)',

  // Accents
  amber:       '#E8A030',
  amberLight:  '#F0C060',
  amberGlow:   'rgba(232,160,48,0.88)',
  amberDim:    'rgba(232,160,48,0.6)',
  teal:        '#38B8C8',
  green:       '#48C878',
  red:         '#E05840',
} as const;

// ── FONTS ───────────────────────────────────────────────────
export const FONTS = {
  serif: "'Cormorant Garamond', serif",
  sans:  "'DM Sans', sans-serif",
} as const;

// ── DAY INTENSITY ────────────────────────────────────────────
// Used by the home screen orb.
// total = today's meeting count + urgent deals count.
export function getDayIntensity(total: number) {
  if (total <= 1) return {
    color: COLORS.green,
    glow:  'rgba(72,200,120,0.38)',
    label: 'Light',
  };
  if (total <= 3) return {
    color: COLORS.amber,
    glow:  'rgba(232,160,48,0.40)',
    label: 'Moderate',
  };
  return {
    color: COLORS.red,
    glow:  'rgba(224,88,64,0.40)',
    label: 'Demanding',
  };
}

// ── ZEN SCENE ───────────────────────────────────────────────
// Time-of-day scene configuration.
// Returns sky gradient, water gradient, sun position,
// star opacity, mountain colors, and haze color
// based on the current hour (0–23).

export type SceneConfig = {
  sky:    string[];   // gradient stops top to bottom
  water:  string[];   // gradient stops top to bottom
  sun: {
    top: number;      // percent from top of screen
    opacity: number;
  };
  moon:   boolean;    // show moon — night only
  stars:  number;     // 0–1 opacity
  mf:     string;     // far mountain color
  mn:     string;     // near mountain color
  haze:   string;     // horizon haze color (rgba)
  lightText: boolean; // true = bright text (dark sky), false = dark text (bright sky)
};

export function getSceneForHour(h: number): SceneConfig {

  // ── DEEP NIGHT (10pm – 5am) ──────────────────────────────
  if (h >= 22 || h < 5) return {
    sky: [
      '#020408 0%', '#03060c 7%', '#040810 13%', '#060a14 19%',
      '#070c18 25%', '#080e1c 31%', '#091020 36%', '#0a1224 41%',
      '#0b1428 46%', '#0c1630 52%', '#0d1836 58%', '#0e1a3a 63%',
      '#0f1c3e 68%', '#101e42 72%',
    ],
    water: ['#101e42 0%','#0d1a38 15%','#0a1530 30%','#08111e 55%','#060c14 80%','#04090e 100%'],
    sun:   { top: 110, opacity: 0 },
    moon:  true,
    stars: 1.0,
    mf: '#0e1a2c', mn: '#091420',
    haze: 'transparent',
    lightText: true,
  };

  // ── PRE-DAWN (5am – 6am) ─────────────────────────────────
  if (h < 6) return {
    sky: [
      '#04060c 0%', '#070811 3.3%', '#090916 6.7%', '#0e0c1c 10%',
      '#130d1d 13.3%', '#180e1e 16.7%', '#1e1020 20%', '#271125 22.7%',
      '#2e1326 25.3%', '#361424 28%', '#401624 30.7%', '#491822 33.3%',
      '#541a1d 36%', '#601a1a 38.7%', '#6c1e19 41.3%', '#782317 44%',
      '#852818 46.7%', '#922e18 49.3%', '#a03418 52%', '#ad3c1a 54%',
      '#ba461d 56%', '#c85020 58%', '#d05c22 60%', '#d86a25 62%',
      '#e07828 64%', '#e5852d 66%', '#ea9232 68%', '#f0a037 70%',
      '#f5b042 72%', '#f8b848 73%',
    ],
    water: ['#6a8898 0%','#587888 15%','#406070 30%','#2e4c5a 55%','#1e3848 80%','#142830 100%'],
    sun:   { top: 62, opacity: 1 },
    moon:  false,
    stars: 0.4,
    mf: '#7a5838', mn: '#5a3c22',
    haze: 'transparent',
    lightText: true,
  };

  // ── SUNRISE (6am – 8am) ──────────────────────────────────
  if (h < 8) return {
    sky: [
      '#6888a8 0%', '#7090b4 4%', '#7898bc 8%', '#82a4c4 12%',
      '#8eb0c8 16%', '#9abccc 20%', '#a6c4cc 24%', '#b2cacc 27%',
      '#becccc 30%', '#caccbc 33%', '#d2c8ac 36%', '#d8c29a 39%',
      '#debb88 42%', '#e4b674 45%', '#e8b462 48%', '#ecb654 51%',
      '#f0ba4c 54%', '#f4c046 57%', '#f8c844 60%', '#fcd044 63%',
      '#fed848 66%',
    ],
    water: ['#72b4c8 0%','#5aa2b8 15%','#4290a8 30%','#2e7890 55%','#1c5e78 80%','#104868 100%'],
    sun:   { top: 62, opacity: 1 },
    moon:  false,
    stars: 0.0,
    mf: '#a08868', mn: '#786040',
    haze: 'transparent',
    lightText: false,
  };

  // ── MORNING (8am – 11am) ─────────────────────────────────
  if (h < 11) return {
    sky: [
      '#3a88cc 0%', '#4c98d8 8%', '#5ea8e0 16%', '#70b8e8 24%',
      '#82c6ee 32%', '#94d0f2 40%', '#a6d8f4 48%', '#b8e0f6 56%',
      '#c8e8f8 64%', '#d8eefa 72%', '#e6f4fc 80%',
    ],
    water: ['#52aac4 0%','#3e98b4 15%','#2c86a4 30%','#1a6e8e 55%','#0c587a 80%','#084468 100%'],
    sun:   { top: 40, opacity: 1 },
    moon:  false,
    stars: 0.0,
    mf: '#8a7868', mn: '#605040',
    haze: 'transparent',
    lightText: false,
  };

  // ── MIDDAY (11am – 4pm) ──────────────────────────────────
  if (h < 16) return {
    sky: [
      '#2070b8 0%', '#3080c4 8%', '#4090ce 16%', '#50a0d8 24%',
      '#60aede 32%', '#70bae4 40%', '#82c6ea 48%', '#94d0ee 56%',
      '#a6d8f2 64%', '#b8e2f6 72%', '#ccecfa 80%',
    ],
    water: ['#3ea4c0 0%','#2c90b0 15%','#1c7c9e 30%','#0c668a 55%','#065276 80%','#044064 100%'],
    sun:   { top: 36, opacity: 1 },
    moon:  false,
    stars: 0.0,
    mf: '#806c5e', mn: '#584438',
    haze: 'transparent',
    lightText: false,
  };

  // ── GOLDEN HOUR (4pm – 7pm) ──────────────────────────────
  if (h < 19) return {
    sky: [
      '#0f0618 0%', '#13061c 2.7%', '#170721 5.3%', '#1c0826 8%',
      '#220928 10.7%', '#2a0a2b 13.3%', '#2e0c2a 16%', '#330d29 18.7%',
      '#380e27 21.3%', '#3e1024 24%', '#451122 26.7%', '#4c121f 29.3%',
      '#54141c 32%', '#5e1418 34%', '#691514 36%', '#741c14 38%',
      '#7f1c13 39.7%', '#8a1d11 41.3%', '#961e10 43%', '#a0230f 44.7%',
      '#aa290e 46.3%', '#b4300e 48%', '#bc380e 49.3%', '#c4400f 50.7%',
      '#cc4a0f 52%', '#d15110 53.3%', '#d65811 54.7%', '#dc6011 56%',
      '#e06713 57.3%', '#e46f15 58.7%', '#e87817 60%', '#eb8119 61.3%',
      '#ee8a1b 62.7%', '#f2931e 64%', '#f39c21 65.3%', '#f6a524 66.7%',
      '#f8ae27 68%', '#f9b52b 69.3%', '#fabc2f 70.7%', '#fcc434 72%',
    ],
    water: ['#d07030 0%','#b85a20 15%','#984414 30%','#7a300a 55%','#5c2006 80%','#3e1202 100%'],
    sun:   { top: 62, opacity: 1 },
    moon:  false,
    stars: 0.0,
    mf: '#a07438', mn: '#785018',
    haze: 'transparent',
    lightText: true,
  };

  // ── DUSK (7pm – 10pm) ────────────────────────────────────
  if (h < 22) return {
    sky: [
      '#08040e 0%', '#0e0618 5%', '#160818 10%', '#200a1a 15%',
      '#2c0c1c 20%', '#3e101e 25%', '#52121c 30%', '#661618 35%',
      '#7c1a16 39%', '#921e14 43%', '#a62a12 47%', '#b83610 51%',
      '#c64610 55%', '#d25a12 59%', '#da6c14 63%', '#e07c18 66%',
    ],
    water: ['#cc6c20 0%','#aa5214 12%','#883c0c 25%','#6a2a06 45%','#4c1a02 65%','#320e00 85%','#200800 100%'],
    sun:   { top: 62, opacity: 1 },
    moon:  false,
    stars: 0.2,
    mf: '#6e3414', mn: '#4a1c06',
    haze: 'transparent',
    lightText: true,
  };

  // ── LATE NIGHT (fallback — same as deep night) ───────────
  return {
    sky: [
      '#020408 0%', '#03060c 7%', '#040810 13%', '#060a14 19%',
      '#070c18 25%', '#080e1c 31%', '#091020 36%', '#0a1224 41%',
      '#0b1428 46%', '#0c1630 52%', '#0d1836 58%', '#0e1a3a 63%',
      '#0f1c3e 68%', '#101e42 72%',
    ],
    water: ['#101e42 0%','#0d1a38 15%','#0a1530 30%','#08111e 55%','#060c14 80%','#04090e 100%'],
    sun:   { top: 110, opacity: 0 },
    moon:  true,
    stars: 1.0,
    mf: '#0e1a2c', mn: '#091420',
    haze: 'transparent',
    lightText: true,
  };
}

// ── GREETING ────────────────────────────────────────────────
export function getGreeting(h: number): string {
  if (h >= 5 && h < 12) return 'Good morning,';
  if (h < 17) return 'Good afternoon,';
  if (h < 21) return 'Good evening,';
  return 'Working late,';
}

// ── TIME FORMAT ──────────────────────────────────────────────
export function formatTime(): string {
  const now  = new Date();
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const h    = now.getHours();
  const m    = now.getMinutes().toString().padStart(2, '0');
  const h12  = h % 12 || 12;
  const ap   = h < 12 ? 'am' : 'pm';
  return `${days[now.getDay()]}  ${h12}:${m}${ap}`;
}

// ── STAGE BADGE STYLES ───────────────────────────────────────
// Used by Deals page and Deal Drawer.
export type StageBadgeStyle = {
  bg:     string;
  color:  string;
  border: string;
};

export const STAGE_STYLES: Record<string, StageBadgeStyle> = {
  Prospect:    { bg: 'rgba(175,172,162,0.09)', color: 'rgba(195,192,182,0.7)',  border: 'rgba(175,172,162,0.2)'  },
  Discovery:   { bg: 'rgba(56,184,200,0.11)',  color: '#48B4C4',                border: 'rgba(56,184,200,0.24)'  },
  POC:         { bg: 'rgba(110,76,210,0.13)',  color: '#9076D8',                border: 'rgba(110,76,210,0.26)'  },
  Proposal:    { bg: 'rgba(232,160,48,0.11)',  color: '#E8A030',                border: 'rgba(232,160,48,0.26)'  },
  Negotiation: { bg: 'rgba(224,120,48,0.11)',  color: '#E07830',                border: 'rgba(224,120,48,0.26)'  },
  'Closed Won':  { bg: 'rgba(72,200,120,0.12)', color: '#48C878',              border: 'rgba(72,200,120,0.28)'  },
  'Closed Lost': { bg: 'rgba(224,88,64,0.1)',   color: '#E05840',              border: 'rgba(224,88,64,0.22)'   },
};

// ── SESSION 12: UNIVERSAL STATUS STYLES ──────────────────────
// Domain-neutral status display for Items.
// Used wherever Items or mapped deal stages are shown to non-sales users.
import type { UniversalItemStatus } from '@/lib/types';

export type UniversalStatusStyle = {
  label: string;
  color: string;
  bg: string;
  border: string;
};

export const UNIVERSAL_STATUS_STYLES: Record<UniversalItemStatus, UniversalStatusStyle> = {
  active: {
    label:  'Active',
    color:  COLORS.green,
    bg:     'rgba(72,200,120,0.1)',
    border: 'rgba(72,200,120,0.25)',
  },
  in_progress: {
    label:  'In Progress',
    color:  COLORS.teal,
    bg:     'rgba(56,184,200,0.1)',
    border: 'rgba(56,184,200,0.25)',
  },
  waiting: {
    label:  'Waiting',
    color:  COLORS.amber,
    bg:     'rgba(232,160,48,0.1)',
    border: 'rgba(232,160,48,0.25)',
  },
  blocked: {
    label:  'Blocked',
    color:  COLORS.red,
    bg:     'rgba(224,88,64,0.1)',
    border: 'rgba(224,88,64,0.22)',
  },
  completed: {
    label:  'Completed',
    color:  'rgba(240,235,224,0.28)',
    bg:     'rgba(240,235,224,0.04)',
    border: 'rgba(240,235,224,0.1)',
  },
  archived: {
    label:  'Archived',
    color:  'rgba(240,235,224,0.20)',
    bg:     'rgba(240,235,224,0.03)',
    border: 'rgba(240,235,224,0.08)',
  },
};

// ── DAYS INDICATOR COLOR ─────────────────────────────────────
// Used by deal rows to color the days-since-last-activity value.
export function getDaysColor(days: number, light = false): string {
  if (days > 14) return COLORS.red;
  if (days > 7)  return COLORS.amber;
  return light ? COLORS.inkLight : COLORS.textLight;
}

// ── RELATIONSHIP TEMPERATURE ─────────────────────────────────
export const TEMPERATURE_COLORS: Record<string, string> = {
  hot:     COLORS.green,
  warm:    COLORS.amber,
  neutral: COLORS.textLight,
  cool:    COLORS.amberDim,
  cold:    COLORS.red,
};

// ── STREAK COLORS ────────────────────────────────────────────
export function getStreakArcPercent(days: number): number {
  // Arc fills based on progress toward next milestone
  const milestones = [5, 10, 20, 30, 50, 100];
  const next = milestones.find(m => m > days) ?? 100;
  const prev = milestones[milestones.indexOf(next) - 1] ?? 0;
  return Math.min(((days - prev) / (next - prev)) * 100, 100);
}

// ── ANIMATION DURATIONS (ms) ─────────────────────────────────
export const ANIMATION = {
  breathDuration:       5000,
  orbPulseDuration:     5000,
  logoBloomDuration:    1000,
  milestoneGlowDuration:2000,
  sheetSlideDuration:    320,
  fadeUpDuration:        450,
  orbColorTransition:    800,
} as const;

// ── SESSION 14C: INTERACTION TIMING TOKENS ───────────────────
// Global timing constants. Every component imports from here.
// No custom timings per component.

export const TIMING = {
  /** 150ms — tap feedback, button hover, small interactions */
  FAST: 150,
  /** 200ms — overlay transitions, sheet slides, standard actions */
  STANDARD: 200,
  /** 280ms — major transitions, surface reveals */
  SLOW: 280,
} as const;

export const EASING = {
  /** Primary motion curve — smooth deceleration */
  standard: 'cubic-bezier(.32,.72,0,1)',
  /** Simple ease for opacity / color */
  gentle: 'ease',
} as const;

/** Close delay = STANDARD duration + 40ms buffer for animation completion */
export const CLOSE_DELAY = TIMING.STANDARD + 40; // 240ms

// ── PRE-BUILT TRANSITION STRINGS ─────────────────────────────
// Use these directly in inline style `transition` props.

export const TRANSITIONS = {
  /** Overlay backdrop: blur + background */
  overlay: `background ${TIMING.STANDARD}ms ${EASING.gentle}, backdrop-filter ${TIMING.STANDARD}ms ${EASING.gentle}, -webkit-backdrop-filter ${TIMING.STANDARD}ms ${EASING.gentle}`,
  /** Bottom sheet slide + opacity */
  sheet: `transform ${TIMING.STANDARD}ms ${EASING.standard}, opacity ${TIMING.STANDARD}ms ${EASING.gentle}`,
  /** Button / small element hover & active */
  button: `background ${TIMING.FAST}ms ${EASING.gentle}, border-color ${TIMING.FAST}ms ${EASING.gentle}, color ${TIMING.FAST}ms ${EASING.gentle}, opacity ${TIMING.FAST}ms ${EASING.gentle}`,
  /** Row items — border + opacity */
  row: `border-color ${TIMING.FAST}ms ${EASING.gentle}, opacity ${TIMING.STANDARD}ms ${EASING.gentle}`,
  /** Surface-level reveals */
  surface: `opacity ${TIMING.SLOW}ms ${EASING.standard}, transform ${TIMING.SLOW}ms ${EASING.standard}`,
  /** Toggle switches */
  toggle: `background ${TIMING.STANDARD}ms ${EASING.gentle}, left ${TIMING.STANDARD}ms ${EASING.gentle}`,
  /** Filter pills / chips */
  chip: `all ${TIMING.FAST}ms ${EASING.gentle}`,
  /** Toast entry/exit */
  toast: `opacity ${TIMING.STANDARD}ms ${EASING.gentle}, transform ${TIMING.STANDARD}ms ${EASING.gentle}`,
} as const;

// ── TAP FEEDBACK ─────────────────────────────────────────────
// Apply via CSS class .jove-tap (see globals.css) for :active state.
// For programmatic use:
export const TAP_SCALE = 'scale(0.98)';
export const TAP_SCALE_SUBTLE = 'scale(0.99)';

// ── MICRO-INTERACTION MOTION RULES ───────────────────────────
// System-wide rules for how elements enter, exit, and respond.
export const MICRO = {
  /** Task completion — fade + slight upward drift */
  completion: { opacity: 0, transform: 'translateY(-4px)', transition: `all ${TIMING.STANDARD}ms ${EASING.standard}` },
  /** Element removal — fade + slight shrink */
  removal: { opacity: 0, transform: 'scale(0.97)', transition: `all ${TIMING.STANDARD}ms ${EASING.standard}` },
  /** Element addition — fade in + subtle rise */
  addition: { opacity: 0, transform: 'translateY(6px)' },
  /** Element addition target state */
  additionVisible: { opacity: 1, transform: 'translateY(0)', transition: `all ${TIMING.STANDARD}ms ${EASING.standard}` },
  /** Focus / highlight — subtle scale */
  focus: { transform: 'scale(1.02)', transition: `transform ${TIMING.FAST}ms ${EASING.standard}` },
} as const;

// ── LOADING STATES ────────────────────────────────────────────
export const LOADING = {
  /** Show loading indicator after this many ms */
  threshold: 300,
  /** Standard spinner styles */
  spinner: {
    width: 24,
    height: 24,
    border: `2px solid rgba(232,160,48,0.2)`,
    borderTopColor: COLORS.amber,
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  } as const,
} as const;

// ── SESSION 14E: EMOTIONAL LAYER ─────────────────────────────
// Reward, momentum, and subtle reinforcement tokens.

/** Completion reward: warm glow that fades after task done */
export const COMPLETION_REWARD = {
  /** Warm amber glow behind completed row */
  glow: `0 0 12px rgba(232,160,48,0.15), 0 0 4px rgba(72,200,120,0.10)`,
  /** Background warmth flash */
  bgFlash: 'rgba(232,160,48,0.06)',
  /** Duration of reward state before removal */
  holdMs: 400,
  /** Fade out after hold */
  fadeMs: 300,
} as const;

/** Momentum energy — increases with activity */
export const MOMENTUM = {
  /** Threshold: completions in session to trigger "active" feel */
  activeThreshold: 2,
  /** Threshold for "on fire" feel */
  fireThreshold: 4,
  /** Base transition speed multiplier at rest */
  baseSpeed: 1.0,
  /** Speed multiplier when momentum is active */
  activeSpeed: 1.12,
  /** Speed multiplier when on fire */
  fireSpeed: 1.2,
} as const;

/** Empty state messages — calm, positive, grounded */
// Session 6: Compressed messages — shorter, scannable.
export const EMPTY_MESSAGES = {
  allClear: [
    'All clear.',
    'Nothing urgent.',
    'Caught up.',
    'Clear ahead.',
  ],
  returnPrompt: [
    'Welcome back.',
    'Ready when you are.',
    'Picked up where you left off.',
  ],
  /** Get a deterministic-feeling but varied message */
  get: (list: readonly string[]) => {
    const hour = new Date().getHours();
    return list[hour % list.length];
  },
} as const;

/** Return incentive — what changed since last visit */
export const RETURN_LABELS = {
  upToDate: 'Up to date.',
  thingsToCheck: (n: number) => n === 1 ? '1 to check' : `${n} to check`,
  progress: (n: number) => n === 1 ? '1 moved forward' : `${n} moved forward`,
} as const;

// SESSION 2 + 14C + 14E COMPLETE
