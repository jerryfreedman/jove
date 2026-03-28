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
      '#03060e',
      '#060a14',
      '#080d1a',
      '#0a1020',
      '#0c1428',
      '#0e1830',
      '#101c38',
      '#121e3e',
    ],
    water: ['#0a1620', '#07101a', '#050c14', '#040a12'],
    sun:   { top: 110, opacity: 0 },
    moon:  true,
    stars: 1,
    mf: '#111e2e', mn: '#0b1520',
    haze: 'rgba(30,60,140,0.07)',
    lightText: true,
  };

  // ── PRE-DAWN (5am – 6am) ─────────────────────────────────
  if (h < 6) return {
    sky: [
      '#080e1e',
      '#0f1a30',
      '#1e2840',
      '#3a2c34',
      '#5a3428',
      '#7a4428',
      '#a05830',
      '#c47038',
      '#e08840',
      '#f4a050',
      '#f8b860',
    ],
    water: ['#7a9ab0', '#5a82a0', '#3e6888', '#2a5070'],
    sun:   { top: 64, opacity: 0.85 },
    moon:  false,
    stars: 0.45,
    mf: '#8a6848', mn: '#6a4c30',
    haze: 'rgba(240,150,60,0.2)',
    lightText: true,
  };

  // ── SUNRISE (6am – 8am) ──────────────────────────────────
  if (h < 8) return {
    sky: [
      '#7090b0',
      '#90aac8',
      '#b0c0d8',
      '#ccd0d8',
      '#ddc8a8',
      '#ecc080',
      '#f8c860',
      '#fcd870',
      '#feeA88',
    ],
    water: ['#7ab8cc', '#58a4bc', '#3a8aaa', '#226888'],
    sun:   { top: 60, opacity: 1 },
    moon:  false,
    stars: 0.1,
    mf: '#a88c6a', mn: '#806244',
    haze: 'rgba(248,188,72,0.22)',
    lightText: false,
  };

  // ── MORNING (8am – 11am) ─────────────────────────────────
  if (h < 11) return {
    sky: [
      '#4898d8',
      '#62aae0',
      '#7cbce8',
      '#96ccf0',
      '#aed8f4',
      '#c4e4f8',
      '#d8eefa',
      '#e8f4fc',
    ],
    water: ['#5ab0c8', '#44a0bc', '#2e88aa', '#186888'],
    sun:   { top: 16, opacity: 0.55 },
    moon:  false,
    stars: 0,
    mf: '#908070', mn: '#686050',
    haze: 'rgba(170,215,250,0.1)',
    lightText: false,
  };

  // ── MIDDAY (11am – 4pm) ──────────────────────────────────
  if (h < 16) return {
    sky: [
      '#3888cc',
      '#4e9ad6',
      '#64ace0',
      '#7abcea',
      '#90caf0',
      '#a8d6f4',
      '#bce0f8',
      '#d0eafc',
    ],
    water: ['#48a8c4', '#3494b4', '#2080a4', '#0c6088'],
    sun:   { top: 12, opacity: 0.42 },
    moon:  false,
    stars: 0,
    mf: '#887870', mn: '#605848',
    haze: 'rgba(150,205,252,0.07)',
    lightText: false,
  };

  // ── GOLDEN HOUR (4pm – 7pm) ──────────────────────────────
  if (h < 19) return {
    sky: [
      '#180a20',
      '#2a1030',
      '#481830',
      '#6e2430',
      '#942e2a',
      '#b84028',
      '#cc5820',
      '#de7228',
      '#eca030',
      '#f8c040',
      '#fcd050',
    ],
    water: ['#c07840', '#a05e28', '#784214', '#501e04'],
    sun:   { top: 60, opacity: 1 },
    moon:  false,
    stars: 0,
    mf: '#a87840', mn: '#7a5220',
    haze: 'rgba(248,148,44,0.28)',
    lightText: true,
  };

  // ── DUSK (7pm – 10pm) ────────────────────────────────────
  if (h < 22) return {
    sky: [
      '#0e0618',
      '#180a20',
      '#280c22',
      '#401020',
      '#601820',
      '#881e22',
      '#aa2e24',
      '#c04420',
      '#d0601e',
      '#dc7a28',
      '#e49030',
    ],
    water: ['#904030', '#6e2c1a', '#4c1808', '#2c0804'],
    sun:   { top: 70, opacity: 0.5 },
    moon:  false,
    stars: 0.2,
    mf: '#6e3818', mn: '#4a2008',
    haze: 'rgba(180,64,24,0.2)',
    lightText: true,
  };

  // Fallback — should never hit but TypeScript requires it
  return {
    sky: ['#060a12', '#0a1020', '#121e3e'],
    water: ['#0a1620', '#060e18', '#040a12'],
    sun:   { top: 110, opacity: 0 },
    moon:  true,
    stars: 1,
    mf: '#111e2e', mn: '#0b1520',
    haze: 'rgba(30,60,140,0.07)',
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

// SESSION 2 COMPLETE
