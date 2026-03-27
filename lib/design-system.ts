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
  if (h >= 22 || h < 5) return {
    sky:   ['#060a12','#0a1020','#0e1830','#121e3e','#162248','#1a2650'],
    water: ['#0a1620','#060e18','#040a12'],
    sun:   { top: 82, opacity: 0 },
    moon:  true,
    stars: 1,
    mf: '#1a2a3a', mn: '#10202e',
    haze: 'rgba(40,70,160,0.08)',
    lightText: true,
  };
  if (h < 6) return {
    sky:   ['#0c1428','#18243c','#3a2c30','#6a3c28','#b86038','#e0904c','#f4c06a'],
    water: ['#6a9ab8','#4c7ea0','#2e6080'],
    sun:   { top: 66, opacity: 0.9 },
    moon:  false,
    stars: 0.5,
    mf: '#a07858', mn: '#7a5838',
    haze: 'rgba(240,160,70,0.22)',
    lightText: true,
  };
  if (h < 8) return {
    sky:   ['#a0c0e0','#c8d8f0','#e8d0b0','#f8c870','#fce894','#fef4b0'],
    water: ['#74b4cc','#50a0ba','#2e6478'],
    sun:   { top: 61, opacity: 1 },
    moon:  false,
    stars: 0.12,
    mf: '#b08c6a', mn: '#886244',
    haze: 'rgba(248,192,80,0.2)',
    lightText: false,
  };
  if (h < 11) return {
    sky:   ['#6ab2e8','#94c8f4','#b8d8f6','#d8ecfa','#eaf4fc'],
    water: ['#50a8c4','#3e90b4','#205888'],
    sun:   { top: 18, opacity: 0.58 },
    moon:  false,
    stars: 0,
    mf: '#9c8e7a', mn: '#746860',
    haze: 'rgba(180,220,255,0.1)',
    lightText: false,
  };
  if (h < 16) return {
    sky:   ['#54a2de','#7ab6ea','#9ec8f2','#c0d8f6','#e0eefa'],
    water: ['#42a2c0','#3082ae','#185086'],
    sun:   { top: 14, opacity: 0.45 },
    moon:  false,
    stars: 0,
    mf: '#948878', mn: '#6c6050',
    haze: 'rgba(160,210,255,0.07)',
    lightText: false,
  };
  if (h < 19) return {
    sky:   ['#221428','#4a2030','#7a3828','#b45828','#d47838','#f4b858','#f8cc6c'],
    water: ['#b07030','#8a5222','#4a280c'],
    sun:   { top: 62, opacity: 1 },
    moon:  false,
    stars: 0,
    mf: '#bc8a54', mn: '#8a6032',
    haze: 'rgba(248,152,50,0.26)',
    lightText: true,
  };
  // dusk 19–22
  return {
    sky:   ['#140a20','#2a0e22','#7e2430','#c25838','#e09050'],
    water: ['#7c4224','#5c2c14','#281006'],
    sun:   { top: 71, opacity: 0.44 },
    moon:  false,
    stars: 0.18,
    mf: '#824224', mn: '#5a2c10',
    haze: 'rgba(190,72,32,0.18)',
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
