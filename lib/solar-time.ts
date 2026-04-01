// ============================================================
// JOVE — Solar Time System
// Aligns scene timing to real-world sunrise/sunset based on
// the user's location. Falls back gracefully to fixed-hour
// boundaries when location is unavailable.
// ============================================================

// ── TYPES ──────────────────────────────────────────────────

export type SolarCoords = {
  lat: number;
  lng: number;
  cachedAt: number; // ms timestamp
};

export type SolarAnchors = {
  civilDawn: number;   // fractional hour (e.g. 5.5 = 5:30 AM)
  sunrise: number;
  solarNoon: number;
  sunset: number;
  civilDusk: number;
};

export type SceneBoundary = {
  hour: number;
  label: string;
};

// ── CONSTANTS ──────────────────────────────────────────────

const COORDS_CACHE_KEY = 'jove_solar_coords';
const SOLAR_CACHE_PREFIX = 'jove_solar_times_';
const COORDS_TTL = 24 * 60 * 60 * 1000; // 24 hours

// ── FIXED FALLBACK BOUNDARIES ──────────────────────────────
// Exact same boundaries as the original Session 1 schedule.
// Used when location is unavailable.

export const FIXED_BOUNDARIES: SceneBoundary[] = [
  { hour: 0,  label: 'deepNight'  },
  { hour: 5,  label: 'preDawn'    },
  { hour: 6,  label: 'sunrise'    },
  { hour: 8,  label: 'morning'    },
  { hour: 11, label: 'midday'     },
  { hour: 16, label: 'goldenHour' },
  { hour: 19, label: 'dusk'       },
  { hour: 22, label: 'deepNight2' },
];

// ── GEOLOCATION + CACHING ──────────────────────────────────

/** Read cached coordinates from localStorage. Returns null if expired or missing. */
function getCachedCoords(): SolarCoords | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(COORDS_CACHE_KEY);
    if (!raw) return null;
    const parsed: SolarCoords = JSON.parse(raw);
    if (Date.now() - parsed.cachedAt > COORDS_TTL) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Cache coordinates in localStorage. */
function setCachedCoords(lat: number, lng: number): SolarCoords {
  const coords: SolarCoords = { lat, lng, cachedAt: Date.now() };
  try {
    localStorage.setItem(COORDS_CACHE_KEY, JSON.stringify(coords));
  } catch {
    // Storage full or unavailable — continue without caching
  }
  return coords;
}

/**
 * Request geolocation. Non-blocking, resolves to coords or null.
 * Uses cached coordinates if still fresh. Never blocks rendering.
 */
export function requestCoords(): Promise<SolarCoords | null> {
  // Try cache first
  const cached = getCachedCoords();
  if (cached) return Promise.resolve(cached);

  // No cache — try browser geolocation
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = setCachedCoords(pos.coords.latitude, pos.coords.longitude);
        resolve(coords);
      },
      () => {
        // Permission denied or error — fail silently
        resolve(null);
      },
      { timeout: 8000, maximumAge: COORDS_TTL },
    );
  });
}

// ── SOLAR CALCULATION ──────────────────────────────────────
// Standard solar position algorithm.
// Inputs: latitude, longitude, Date (local).
// Outputs: fractional hours (local time) for each event.
// No external API or dependency required.

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/** Day of year (1-366) for a given Date. */
function dayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

/**
 * Calculate solar declination (degrees) for a given day of year.
 * Uses the approximate formula from the Astronomical Almanac.
 */
function solarDeclination(doy: number): number {
  return -23.44 * Math.cos(DEG * (360 / 365) * (doy + 10));
}

/**
 * Equation of time (minutes) — accounts for Earth's orbital eccentricity
 * and axial tilt causing clock time to drift from solar time.
 */
function equationOfTime(doy: number): number {
  const B = DEG * (360 / 365) * (doy - 81);
  return 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
}

/**
 * Calculate the hour angle for a given solar depression angle.
 * depression = 0 for geometric sunrise/sunset.
 * depression = 0.833 for standard sunrise/sunset (refraction + solar disk).
 * depression = 6 for civil twilight.
 * Returns NaN if the event doesn't occur (polar day/night).
 */
function hourAngle(lat: number, declination: number, depression: number): number {
  const latRad = lat * DEG;
  const decRad = declination * DEG;
  const cosH = (Math.cos((90 + depression) * DEG) - Math.sin(latRad) * Math.sin(decRad))
             / (Math.cos(latRad) * Math.cos(decRad));
  if (cosH < -1 || cosH > 1) return NaN; // no event
  return Math.acos(cosH) * RAD;
}

/**
 * Calculate solar anchors for a given date and coordinates.
 * All times returned as fractional hours in LOCAL time.
 * Returns null if calculation fails (extreme latitudes).
 */
export function calculateSolarAnchors(lat: number, lng: number, date: Date): SolarAnchors | null {
  const doy = dayOfYear(date);
  const decl = solarDeclination(doy);
  const eot = equationOfTime(doy);

  // Solar noon in UTC minutes from midnight
  // Standard meridian offset: timezone offset gives us local→UTC shift
  const tzOffsetMinutes = date.getTimezoneOffset(); // minutes, positive = west of UTC
  const solarNoonUTC = 720 - (lng * 4) - eot; // minutes from midnight UTC
  const solarNoonLocal = solarNoonUTC + (-tzOffsetMinutes); // convert to local minutes

  const solarNoon = solarNoonLocal / 60; // fractional hour

  // Hour angles
  const haSunrise = hourAngle(lat, decl, 0.833);  // standard sunrise/sunset
  const haCivil = hourAngle(lat, decl, 6);         // civil twilight

  // If any critical angle is NaN, we can't compute solar times
  if (isNaN(haSunrise) || isNaN(haCivil)) return null;

  // Convert hour angles to fractional hours (offset from solar noon)
  const sunriseOffset = haSunrise / 15; // degrees to hours
  const civilOffset = haCivil / 15;

  const sunrise = solarNoon - sunriseOffset;
  const sunset = solarNoon + sunriseOffset;
  const civilDawn = solarNoon - civilOffset;
  const civilDusk = solarNoon + civilOffset;

  // Clamp to 0–24 range
  const clamp = (h: number) => ((h % 24) + 24) % 24;

  return {
    civilDawn: clamp(civilDawn),
    sunrise: clamp(sunrise),
    solarNoon: clamp(solarNoon),
    sunset: clamp(sunset),
    civilDusk: clamp(civilDusk),
  };
}

// ── DAILY SOLAR CACHE ──────────────────────────────────────

/** Get cache key for a given local date string. */
function solarCacheKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${SOLAR_CACHE_PREFIX}${y}-${m}-${d}`;
}

/** Read cached solar anchors for today. Returns null if missing. */
function getCachedSolarAnchors(date: Date): SolarAnchors | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(solarCacheKey(date));
    if (!raw) return null;
    return JSON.parse(raw) as SolarAnchors;
  } catch {
    return null;
  }
}

/** Cache solar anchors for a given date. */
function setCachedSolarAnchors(date: Date, anchors: SolarAnchors): void {
  try {
    localStorage.setItem(solarCacheKey(date), JSON.stringify(anchors));
  } catch {
    // Storage unavailable
  }
}

/**
 * Get solar anchors for today, using cache when possible.
 * Computes once per day per coordinate set.
 */
export function getSolarAnchorsForToday(coords: SolarCoords): SolarAnchors | null {
  const now = new Date();
  const cached = getCachedSolarAnchors(now);
  if (cached) return cached;

  const anchors = calculateSolarAnchors(coords.lat, coords.lng, now);
  if (anchors) {
    setCachedSolarAnchors(now, anchors);
  }
  return anchors;
}

// ── MAP SCENES TO SOLAR ANCHORS ────────────────────────────
// Converts solar anchors into scene boundaries that replace
// the fixed-hour schedule. Preserves all scene identities —
// only changes WHEN they occur, not WHAT they look like.

/**
 * Build solar-relative scene boundaries from solar anchors.
 *
 * Mapping:
 *   Deep Night:   civilDusk → civilDawn (overnight)
 *   Pre-Dawn:     civilDawn → sunrise
 *   Sunrise:      sunrise → sunrise + 40min transition
 *   Morning:      after sunrise transition → midday start
 *   Midday:       around solar noon (±spread)
 *   Golden Hour:  pre-sunset window → sunset
 *   Dusk:         sunset → civilDusk
 *   Deep Night 2: civilDusk → wrap (same visual as Deep Night)
 */
export function buildSolarBoundaries(anchors: SolarAnchors): SceneBoundary[] {
  const { civilDawn, sunrise, solarNoon, sunset, civilDusk } = anchors;

  // Sunrise transition window: 40 minutes after sunrise
  const sunriseEnd = sunrise + 40 / 60;

  // Golden hour starts ~50 minutes before sunset
  const goldenStart = sunset - 50 / 60;

  // Morning ends / Midday starts: midpoint between sunriseEnd and goldenStart
  // with a bias toward solar noon
  const morningEnd = solarNoon - (solarNoon - sunriseEnd) * 0.4;

  // Normalize all to 0–24
  const clamp = (h: number) => ((h % 24) + 24) % 24;

  return [
    { hour: 0,                       label: 'deepNight'  },
    { hour: clamp(civilDawn),        label: 'preDawn'    },
    { hour: clamp(sunrise),          label: 'sunrise'    },
    { hour: clamp(sunriseEnd),       label: 'morning'    },
    { hour: clamp(morningEnd),       label: 'midday'     },
    { hour: clamp(goldenStart),      label: 'goldenHour' },
    { hour: clamp(sunset),           label: 'dusk'       },
    { hour: clamp(civilDusk),        label: 'deepNight2' },
  ];
}

// ── GLOBAL STATE ───────────────────────────────────────────
// Holds the currently active scene boundaries.
// Initialized to fixed fallback. Updated when solar data arrives.

let _activeBoundaries: SceneBoundary[] = FIXED_BOUNDARIES;
let _solarAnchors: SolarAnchors | null = null;
let _initialized = false;
let _initPromise: Promise<void> | null = null;

/** Get the currently active scene boundaries. */
export function getActiveBoundaries(): SceneBoundary[] {
  return _activeBoundaries;
}

/** Get current solar anchors (null if using fixed fallback). */
export function getCurrentSolarAnchors(): SolarAnchors | null {
  return _solarAnchors;
}

/** Whether the solar system has been initialized this session. */
export function isSolarInitialized(): boolean {
  return _initialized;
}

/**
 * Initialize the solar time system.
 * - Requests geolocation (non-blocking)
 * - Calculates solar anchors if coords available
 * - Updates active boundaries
 * - Falls back to fixed boundaries silently
 *
 * Safe to call multiple times — deduplicates.
 * Returns immediately if already initialized.
 */
export function initSolarTime(): Promise<void> {
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    try {
      const coords = await requestCoords();
      if (coords) {
        const anchors = getSolarAnchorsForToday(coords);
        if (anchors) {
          _solarAnchors = anchors;
          _activeBoundaries = buildSolarBoundaries(anchors);
        }
      }
      // If coords or anchors unavailable, _activeBoundaries stays as FIXED_BOUNDARIES
    } catch {
      // Any error — silently stay on fixed boundaries
    } finally {
      _initialized = true;
    }
  })();

  return _initPromise;
}

/**
 * Check if the date has changed since last solar calculation.
 * If so, recompute solar anchors for the new day.
 * Call this periodically (e.g. on each scene tick).
 */
let _lastComputedDate = '';

export function checkDayRollover(): void {
  const now = new Date();
  const today = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;

  if (today === _lastComputedDate) return;
  _lastComputedDate = today;

  // If we don't have coords, nothing to recompute
  const coords = getCachedCoords();
  if (!coords) return;

  const anchors = getSolarAnchorsForToday(coords);
  if (anchors) {
    _solarAnchors = anchors;
    _activeBoundaries = buildSolarBoundaries(anchors);
  }
}
