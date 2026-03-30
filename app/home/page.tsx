'use client';

import { useState, useEffect, useCallback, useRef, useReducer, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import SceneBackground from '@/components/home/SceneBackground';
import AmbientBird from '@/components/home/AmbientBird';
import Logo from '@/components/ui/Logo';
import StreakBadge from '@/components/ui/StreakBadge';
import CaptureSheet from '@/components/capture/CaptureSheet';
import SpotlightTour, { TourStop } from '@/components/onboarding/SpotlightTour';
import CalendarImportPrompt from '@/components/onboarding/CalendarImportPrompt';
import { calculateStreak } from '@/lib/streak';
import {
  saveInteraction,
  triggerExtraction,
  updateStreak,
} from '@/lib/capture-utils';
import {
  getGreeting,
  getSceneForHour,
  formatTime,
  COLORS,
} from '@/lib/design-system';
import { PULSE_CHECK_DEFAULT_DAYS, SCENE_HORIZON_PERCENT } from '@/lib/constants';
import type {
  DealRow,
  MeetingRow,
  SignalRow,
  StreakLogRow,
  UserRow,
} from '@/lib/types';

// ── TYPES ──────────────────────────────────────────────────
type DealWithAccount = DealRow & { accounts: { name: string } | null };

interface HomeData {
  user:          UserRow | null;
  meetings:      MeetingRow[];
  urgentDeals:   DealWithAccount[];
  allDeals:      DealWithAccount[];
  signals:       SignalRow[];
  streakLogs:    StreakLogRow[];
  accountCount:  number;
}

interface WeatherData {
  emoji:     string;
  temp:      number;
  condition: string;
}

// ── WEATHER HELPER ────────────────────────────────────────
function getWeatherEmoji(code: number): { emoji: string; condition: string } {
  if (code === 0)                    return { emoji: '☀️',  condition: 'Clear' };
  if (code <= 3)                     return { emoji: '⛅️', condition: 'Partly cloudy' };
  if (code <= 48)                    return { emoji: '🌫',  condition: 'Foggy' };
  if (code <= 67)                    return { emoji: '🌧',  condition: 'Rainy' };
  if (code <= 77)                    return { emoji: '❄️',  condition: 'Snow' };
  if (code <= 82)                    return { emoji: '🌦',  condition: 'Showers' };
  return                                    { emoji: '⛈',  condition: 'Stormy' };
}

// ── FIRST NAME HELPER ─────────────────────────────────────
function getFirstName(user: UserRow | null): string {
  if (!user) return '';
  if (user.full_name) return user.full_name.split(' ')[0];
  if (user.email)     return user.email.split('@')[0];
  return '';
}

// ── HELPERS ───────────────────────────────────────────────
function getDaysSinceActivity(deal: DealRow): number {
  return Math.floor(
    (Date.now() - new Date(deal.last_activity_at).getTime()) / (1000 * 60 * 60 * 24)
  );
}

// ── INTELLIGENCE LINES ───────────────────────────────────
interface IntelLine {
  dot:   string;
  text:  string;
  blink: boolean;
  glow:  boolean;
  route: string;
}

function buildIntelLines(data: HomeData, pulseThreshold: number): IntelLine[] {
  const lines: IntelLine[] = [];
  const allActive = data.allDeals;

  // Line 1 — Urgency signal: most stale active deal
  if (allActive.length > 0) {
    let stalestDeal = allActive[0];
    let stalestDays = getDaysSinceActivity(allActive[0]);
    for (const d of allActive) {
      const days = getDaysSinceActivity(d);
      if (days > stalestDays) {
        stalestDays = days;
        stalestDeal = d;
      }
    }
    const accountLabel = stalestDeal.accounts?.name || stalestDeal.name;
    const daysUntil = pulseThreshold - stalestDays;

    const staleDealRoute = stalestDeal.id ? `/deals/${stalestDeal.id}` : '/deals';

    if (stalestDays >= pulseThreshold) {
      lines.push({
        dot:   COLORS.red,
        text:  `${accountLabel} — overdue for a touchpoint`,
        blink: true,
        glow:  true,
        route: staleDealRoute,
      });
    } else if (daysUntil <= 3) {
      lines.push({
        dot:   COLORS.red,
        text:  `${accountLabel} — at risk in ${daysUntil} day${daysUntil !== 1 ? 's' : ''}`,
        blink: true,
        glow:  true,
        route: staleDealRoute,
      });
    } else {
      lines.push({
        dot:   'rgba(240,235,224,0.26)',
        text:  `${accountLabel} — ${stalestDays} days since last activity`,
        blink: false,
        glow:  false,
        route: staleDealRoute,
      });
    }
  } else {
    lines.push({
      dot:   'rgba(240,235,224,0.2)',
      text:  'Capture your first signal with the + button below.',
      blink: false,
      glow:  false,
      route: '/deals',
    });
  }

  // Line 2 — Positive signal or pipeline context
  const positiveTypes = ['positive_sentiment', 'next_step_agreed', 'champion_identified', 'budget_mentioned'];
  const positiveSignal = data.signals.find(s => positiveTypes.includes(s.signal_type));

  if (positiveSignal) {
    const signalLabels: Record<string, string> = {
      positive_sentiment:  'positive signal',
      next_step_agreed:    'next step agreed',
      champion_identified: 'champion identified',
      budget_mentioned:    'budget mentioned',
    };
    const label = signalLabels[positiveSignal.signal_type] || positiveSignal.signal_type;
    const matchedDeal = positiveSignal.deal_id
      ? allActive.find(d => d.id === positiveSignal.deal_id)
      : null;
    const dealLabel = matchedDeal
      ? (matchedDeal.accounts?.name || matchedDeal.name)
      : null;

    const signalDealRoute = positiveSignal.deal_id ? `/deals/${positiveSignal.deal_id}` : '/deals';

    lines.push({
      dot:   COLORS.green,
      text:  dealLabel
        ? `${dealLabel} — ${label}, momentum increasing`
        : `${label} — momentum increasing`,
      blink: false,
      glow:  false,
      route: signalDealRoute,
    });
  } else {
    const dealCount = allActive.length;
    lines.push({
      dot:   'rgba(240,235,224,0.26)',
      text:  `${dealCount} active deal${dealCount !== 1 ? 's' : ''} in pipeline`,
      blink: false,
      glow:  false,
      route: '/deals',
    });
  }

  // Line 3 — Meetings or capture prompt
  const todayMeetings = data.meetings.filter(m => {
    const mt = new Date(m.scheduled_at);
    return mt.toDateString() === new Date().toDateString();
  });

  if (todayMeetings.length > 0) {
    lines.push({
      dot:   'rgba(240,235,224,0.26)',
      text:  `${todayMeetings.length} meeting${todayMeetings.length !== 1 ? 's' : ''} today — tap sun to prep`,
      blink: false,
      glow:  false,
      route: '/briefing',
    });
  } else {
    lines.push({
      dot:   'rgba(240,235,224,0.26)',
      text:  'No meetings today — good time to capture',
      blink: false,
      glow:  false,
      route: '/briefing',
    });
  }

  return lines;
}

// ── COMPONENT ─────────────────────────────────────────────
export default function HomePage() {
  const router   = useRouter();
  const supabase = createClient();

  const [data, setData]       = useState<HomeData | null>(null);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [time, setTime]       = useState(formatTime());
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [showCapture, setShowCapture] = useState(false);
  const [captureInitialMode, setCaptureInitialMode] = useState<'debrief' | null>(null);
  const [captureInitialText, setCaptureInitialText] = useState('');
  const [homeRefreshKey, setHomeRefreshKey] = useState(0);
  const [logoBloom, setLogoBloom] = useState(false);
  const [debriefMeetings, setDebriefMeetings] = useState<MeetingRow[]>([]);
  const [debriefDismissed, setDebriefDismissed] = useState(false);

  // ── BIRD INTERACTION STATE ──────────────────────────────────
  const [birdModalOpen, setBirdModalOpen] = useState(false);
  const [birdModalInput, setBirdModalInput] = useState('');
  const [birdModalSaving, setBirdModalSaving] = useState(false);
  const [birdDealGate, setBirdDealGate] = useState(false);
  const [birdPulseTrigger, setBirdPulseTrigger] = useState(0);
  const birdPositionRef = useRef({ x: 0, y: 0 });
  const birdHitboxRef = useRef<HTMLDivElement>(null);
  const birdModalInputRef = useRef<HTMLTextAreaElement>(null);

  // Session memory: promptKeys already answered via bird this session.
  // Primary logic: gap resolved in data → question disappears naturally.
  // Safety net: answered this session → skip even if gap still shows in data.
  const birdAnsweredRef = useRef<Set<string>>((() => {
    try {
      const stored = sessionStorage.getItem('jove_bird_answered');
      if (stored) {
        return new Set<string>(JSON.parse(stored) as string[]);
      }
    } catch { /* corrupt data — start fresh */ }
    return new Set<string>();
  })());
  // Counter to force birdQuestion useMemo to recompute after a submit
  // (refs alone don't trigger re-render, so useMemo wouldn't see the ref change).
  const [birdAnsweredCount, setBirdAnsweredCount] = useState(0);

  // ── DO THIS FIRST STATE ────────────────────────────────────
  const [doThisFirst, setDoThisFirst] = useState<{
    loading: boolean;
    loaded: boolean;
    suggestion: string | null;
    dealLabel: string | null;
    dealId: string | null;
  }>({ loading: false, loaded: false, suggestion: null, dealLabel: null, dealId: null });

  // ── ACTION OVERLAY STATE ────────────────────────────────
  const [actionOverlayOpen, setActionOverlayOpen] = useState(false);
  const [actionInput, setActionInput] = useState('');
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [actionAcknowledged, setActionAcknowledged] = useState(false);
  const actionInputRef = useRef<HTMLTextAreaElement>(null);

  // ── FEEDBACK BANNER STATE ──────────────────────────────
  const [feedbackText, setFeedbackText] = useState<string | null>(null);
  const [feedbackVisible, setFeedbackVisible] = useState(false);

  // ── BIRD REACTION TRIGGER ────────────────────────────
  const [birdReactionTrigger, setBirdReactionTrigger] = useState(0);
  // Stable ref: labels the source of the next reaction increment ('save' | 'ambient')
  const birdReactionSourceRef = useRef<'save' | 'ambient'>('ambient');
  const prevSignalCountForBirdRef = useRef<number>(0);

  // ── SIGNAL PULSE STATE ──────────────────────────────────
  const [showSignalPulse, setShowSignalPulse] = useState(false);
  // (Zen capture moment removed — save-confirmed feedback is per-path only)
  const prevSignalCountForPulseRef = useRef<number | null>(null);

  // Track signal count before capture to diff after re-fetch
  const preCaptureSignalCountRef = useRef<number | null>(null);

  // Guard: track which interaction IDs have already been retried this session
  const retriedInteractionIdsRef = useRef<Set<string>>(new Set());

  // ── FIRST VISIT OVERLAY STATE ────────────────────────────
  const [firstVisitVisible, setFirstVisitVisible] = useState(
    () => typeof window !== 'undefined'
      ? localStorage.getItem('jove_first_visit_shown') !== 'true'
      : false
  );
  const [firstVisitOpacity, setFirstVisitOpacity] = useState(1);

  // ── TOUR & CALENDAR PROMPT STATE ─────────────────────────
  const [showTour, setShowTour] = useState(false);
  const [showCalendarPrompt, setShowCalendarPrompt] = useState(false);

  // ── TOUR REFS ────────────────────────────────────────────
  const sunRef     = useRef<HTMLDivElement>(null);
  const captureRef = useRef<HTMLButtonElement>(null);
  const dealsRef   = useRef<HTMLButtonElement>(null);
  const logoRef    = useRef<HTMLDivElement>(null);

  const h     = new Date().getHours();
  const scene = getSceneForHour(h);

  // ── FIRST VISIT OVERLAY FADE ─────────────────────────────
  useEffect(() => {
    if (!firstVisitVisible) return;

    const fadeTimer = setTimeout(() => {
      setFirstVisitOpacity(0);
    }, 100);

    const hideTimer = setTimeout(() => {
      setFirstVisitVisible(false);
      localStorage.setItem('jove_first_visit_shown', 'true');
      // Fire tour directly from here — do NOT use a separate
      // useEffect that checks the flag, because the flag is not
      // set yet when that useEffect runs on mount.
      if (localStorage.getItem('jove_tour_complete') !== 'true') {
        setTimeout(() => setShowTour(true), 1400);
      }
    }, 900);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, [firstVisitVisible]);

  // ── RETURNING USER TOUR (overlay already shown, tour not complete) ──
  useEffect(() => {
    if (localStorage.getItem('jove_first_visit_shown') !== 'true') return;
    if (localStorage.getItem('jove_tour_complete') === 'true') return;
    const timer = setTimeout(() => setShowTour(true), 1400);
    return () => clearTimeout(timer);
  }, []);

  // Sync body background with sky top color so the area behind
  // the iOS status bar shows the correct color.
  useEffect(() => {
    const topColor = scene.sky[0].split(' ')[0];
    document.body.style.backgroundColor = topColor;
    // Also update meta theme-color so iOS status bar
    // tint matches the sky rather than the static dark default
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', topColor);
    return () => {
      document.body.style.backgroundColor = '#060a12';
      if (meta) meta.setAttribute('content', '#060a12');
    };
  }, [scene]);

  // Sun/moon tap target: centered on the actual visual center of the sun or moon.
  //
  // Clipped suns (pre-dawn/sunrise/golden-hour/dusk): sun center is exactly
  //   at SCENE_HORIZON_PERCENT (62%) from top, horizontally centered at 50%.
  // In-sky suns (morning/midday): sun center is at scene.sun.top%, left 50%.
  // Night (deep night/night): moon is at top 12%, left 68%.
  //
  // The tap target uses translate(-50%, -50%) to center itself on these points.
  const isNight = scene.moon;
  const isClippedSun = scene.sun.top >= 60 && scene.sun.opacity > 0;

  const sunCenterTop = isNight
    ? '12%'
    : isClippedSun
      ? `${SCENE_HORIZON_PERCENT}%`
      : `${scene.sun.top}%`;

  const sunCenterLeft = isNight ? '68%' : '50%';

  // Text color adapts to sky brightness
  const textPrimary   = scene.lightText
    ? 'rgba(252,246,234,0.94)'
    : 'rgba(26,20,16,0.90)';
  const textSecondary = scene.lightText
    ? 'rgba(240,235,224,0.44)'
    : 'rgba(26,20,16,0.44)';

  // Theme-color is now static (#060a12) — black-translucent handles transparency.

  // ── OFFLINE DETECTION ──────────────────────────────────
  useEffect(() => {
    const handleOnline  = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    if (!navigator.onLine) setIsOffline(true);
    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // ── CLOCK ──────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => setTime(formatTime()), 60000);
    return () => clearInterval(interval);
  }, []);


  // ── BIRD HITBOX TRACKING ────────────────────────────────
  useEffect(() => {
    let rafId: number;
    const track = () => {
      const el = birdHitboxRef.current;
      if (el) {
        // Bird SVG is 32x14 — center at (x+16, y+7)
        const cx = birdPositionRef.current.x + 16;
        const cy = birdPositionRef.current.y + 7;
        el.style.transform = `translate(${cx - 22}px, ${cy - 22}px)`;
      }
      rafId = requestAnimationFrame(track);
    };
    rafId = requestAnimationFrame(track);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // ── GLOBAL CAPTURE PULSE ON RETURN ────────────────────
  useEffect(() => {
    const pending = localStorage.getItem('jove_pulse_pending');
    if (pending) {
      const ts = parseInt(pending, 10);
      if (Date.now() - ts < 15000) {
        setTimeout(() => {
          setShowSignalPulse(true);
          setTimeout(() => setShowSignalPulse(false), 900);
        }, 600);
      }
      localStorage.removeItem('jove_pulse_pending');
    }
  }, []);

  // ── WEATHER ────────────────────────────────────────────
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(async pos => {
      try {
        const { latitude: lat, longitude: lon } = pos.coords;
        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&temperature_unit=fahrenheit&timezone=auto`
        );
        const json = await res.json();
        const code = json.current.weather_code as number;
        const temp = Math.round(json.current.temperature_2m as number);
        const { emoji, condition } = getWeatherEmoji(code);
        setWeather({ emoji, temp, condition });
      } catch {
        // Weather is optional — fail silently
      }
    }, () => {
      // Geolocation denied — fail silently
    });
  }, []);

  // ── DATA FETCH ─────────────────────────────────────────
  const fetchHomeData = useCallback(async () => {
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) { router.push('/'); return; }

      const now      = new Date();
      const todayStr = now.toISOString().split('T')[0];
      const cutoff   = new Date();
      cutoff.setDate(cutoff.getDate() - PULSE_CHECK_DEFAULT_DAYS);

      // Parallel queries for speed
      const [
        userRes,
        meetingsRes,
        urgentDealsRes,
        allDealsRes,
        signalRes,
        streakRes,
        accountCountRes,
        debriefRes,
        stuckInteractionsRes,
      ] = await Promise.all([
        supabase
          .from('users')
          .select('*')
          .eq('id', authUser.id)
          .single(),

        supabase
          .from('meetings')
          .select('id, title, scheduled_at, deal_id, attendees, debrief_completed, debrief_prompted_at')
          .eq('user_id', authUser.id)
          .gte('scheduled_at', todayStr)
          .order('scheduled_at', { ascending: true })
          .limit(10),

        supabase
          .from('deals')
          .select('id, name, stage, last_activity_at, snoozed_until, intel_score, momentum_score, signal_velocity, next_action, account_id, user_id, accounts(name)')
          .eq('user_id', authUser.id)
          .not('stage', 'in', '("Closed Won","Closed Lost")')
          .lt('last_activity_at', cutoff.toISOString())
          .or(`snoozed_until.is.null,snoozed_until.lt.${now.toISOString()}`)
          .order('last_activity_at', { ascending: true })
          .limit(5),

        supabase
          .from('deals')
          .select('id, name, stage, last_activity_at, snoozed_until, intel_score, momentum_score, signal_velocity, next_action, account_id, user_id, accounts(name)')
          .eq('user_id', authUser.id)
          .not('stage', 'in', '("Closed Won","Closed Lost")')
          .order('last_activity_at', { ascending: false })
          .limit(10),

        supabase
          .from('signals')
          .select('id, content, signal_type, deal_id, created_at')
          .eq('user_id', authUser.id)
          .order('created_at', { ascending: false })
          .limit(20),

        supabase
          .from('streak_log')
          .select('id, log_date, capture_count, user_id')
          .eq('user_id', authUser.id)
          .gte('log_date', new Date(Date.now() - 120 * 24 * 60 * 60 * 1000)
            .toISOString().split('T')[0])
          .order('log_date', { ascending: false }),

        supabase
          .from('accounts')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', authUser.id),

        supabase
          .from('meetings')
          .select('*')
          .eq('user_id', authUser.id)
          .eq('debrief_completed', false)
          .is('debrief_prompted_at', null)
          .lt('scheduled_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
          .order('scheduled_at', { ascending: false })
          .limit(1),

        // Stuck interactions: failed OR processing > 2 min old, but not < 30s old
        supabase
          .from('interactions')
          .select('id, user_id, extraction_status, created_at')
          .eq('user_id', authUser.id)
          .or('extraction_status.eq.failed,extraction_status.eq.processing')
          .lt('created_at', new Date(Date.now() - 30 * 1000).toISOString())
          .order('created_at', { ascending: false })
          .limit(5),
      ]);

      const activeDeals = (allDealsRes.data ?? []) as unknown as DealWithAccount[];

      setData({
        user:         userRes.data as UserRow | null,
        meetings:     (meetingsRes.data ?? []) as MeetingRow[],
        urgentDeals:  (urgentDealsRes.data ?? []) as unknown as DealWithAccount[],
        allDeals:     activeDeals,
        signals:      (signalRes.data ?? []) as SignalRow[],
        streakLogs:   (streakRes.data ?? []) as StreakLogRow[],
        accountCount: accountCountRes.count ?? 0,
      });

      setDebriefMeetings((debriefRes.data ?? []) as MeetingRow[]);

      // ── SILENT EXTRACTION RETRY ──────────────────────────
      // Re-fire extraction for the most recent stuck interaction (fire-and-forget)
      const stuckInteractions = (stuckInteractionsRes.data ?? []) as Array<{
        id: string;
        user_id: string;
        extraction_status: string;
        created_at: string;
      }>;

      const twoMinAgo = Date.now() - 2 * 60 * 1000;
      // Filter: failed (any age past 30s) OR processing older than 2 min
      const eligible = stuckInteractions.filter(si => {
        if (retriedInteractionIdsRef.current.has(si.id)) return false;
        if (si.extraction_status === 'failed') return true;
        // processing + older than 2 minutes
        return new Date(si.created_at).getTime() < twoMinAgo;
      });

      if (eligible.length > 0) {
        const mostRecent = eligible[0]; // already ordered desc by created_at
        retriedInteractionIdsRef.current.add(mostRecent.id);
        // Fire-and-forget — do not await, do not block render
        triggerExtraction(mostRecent.id, mostRecent.user_id);
      }

    } catch (err) {
      console.error('Home data fetch error:', err);
      setFetchError(true);
    } finally {
      setLoading(false);
      setTimeout(() => setVisible(true), 80);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchHomeData();
  }, [fetchHomeData, homeRefreshKey]);

  // ── HERO GATE STATE — tracks whether pre-fetch gate passed ──
  const [heroGatePassed, setHeroGatePassed] = useState(false);

  // ── DO THIS FIRST — INDEPENDENT ASYNC FETCH ─────────────
  useEffect(() => {
    if (!data) return;
    const activeDeals = data.allDeals;

    if (activeDeals.length === 0) {
      setDoThisFirst({ loading: false, loaded: true, suggestion: null, dealLabel: null, dealId: null });
      setHeroGatePassed(false);
      return;
    }

    // ── LAYER 1: PRE-FETCH GATE (importance only) ──────────
    const userPulseThreshold = data.user?.pulse_check_days ?? PULSE_CHECK_DEFAULT_DAYS;

    // Condition A — Overdue deal
    const conditionA = activeDeals.some(
      d => getDaysSinceActivity(d) >= userPulseThreshold
    );

    // Condition B — Recent meaningful signal on active deal
    const meaningfulTypes = new Set([
      'champion_identified', 'budget_mentioned', 'next_step_agreed',
      'competitor_mentioned', 'timeline_mentioned', 'risk_identified',
    ]);
    const lastHeroShownRaw = localStorage.getItem('jove_last_hero_shown');
    const lastHeroShownTs = lastHeroShownRaw ? parseInt(lastHeroShownRaw, 10) : 0;
    const activeDealIds = new Set(activeDeals.map(d => d.id));

    const conditionB = data.signals.some(s => {
      if (!meaningfulTypes.has(s.signal_type)) return false;
      if (!s.deal_id || !activeDealIds.has(s.deal_id)) return false;
      const signalTs = new Date(s.created_at).getTime();
      return lastHeroShownTs === 0 || signalTs > lastHeroShownTs;
    });

    // Condition C — Upcoming meeting today (not already ended)
    const nowMs = Date.now();
    const oneHourAgo = nowMs - 60 * 60 * 1000;
    const conditionC = data.meetings.some(m => {
      const mt = new Date(m.scheduled_at);
      if (mt.toDateString() !== new Date().toDateString()) return false;
      return mt.getTime() > oneHourAgo;
    });

    // Cooldown override: block if last shown < 4 hours ago AND Condition B is false
    const fourHoursMs = 4 * 60 * 60 * 1000;
    const cooldownActive = lastHeroShownTs > 0 && (nowMs - lastHeroShownTs) < fourHoursMs;
    const blockedByCooldown = cooldownActive && !conditionB;

    const anyConditionMet = conditionA || conditionB || conditionC;
    const gateOpen = anyConditionMet && !blockedByCooldown;

    if (!gateOpen) {
      // Gate blocks — do not fetch, do not render hero or empty state
      setDoThisFirst({ loading: false, loaded: true, suggestion: null, dealLabel: null, dealId: null });
      setHeroGatePassed(false);
      return;
    }

    setHeroGatePassed(true);
    // ── END LAYER 1 ────────────────────────────────────────

    let cancelled = false;
    const fetchDoThisFirst = async () => {
      setDoThisFirst(prev => ({ ...prev, loading: true }));
      try {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (!authUser || cancelled) return;

        const dtfContext = activeDeals.map(d => {
          const acct = d.accounts?.name;
          const days = getDaysSinceActivity(d);
          const base = acct ? `${d.name} at ${acct}` : d.name;
          return `${base} (${d.stage}, ${days}d since activity)`;
        }).join('; ');

        const dtfRes = await fetch('/api/do-this-first', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ context: dtfContext, userId: authUser.id }),
        });
        if (cancelled) return;
        const dtfJson = await dtfRes.json();
        const suggestion = dtfJson.suggestion;

        if (suggestion && typeof suggestion === 'string' && suggestion.trim()) {
          // ── LAYER 2: POST-FETCH SUPPRESSION (repetition only) ──
          const normalizedSuggestion = suggestion.trim().toLowerCase();
          const acknowledged = sessionStorage.getItem('jove_action_acknowledged');
          if (acknowledged === normalizedSuggestion) {
            // User already acted on this exact suggestion this session
            if (!cancelled) {
              setDoThisFirst({ loading: false, loaded: true, suggestion: null, dealLabel: null, dealId: null });
            }
            return;
          }
          // ── END LAYER 2 ──────────────────────────────────────

          const lowerSuggestion = suggestion.toLowerCase();
          const matchedDeal = activeDeals.find(d => {
            if (d.name && lowerSuggestion.includes(d.name.toLowerCase())) return true;
            const accountName = d.accounts?.name;
            if (accountName && lowerSuggestion.includes(accountName.toLowerCase())) return true;
            return false;
          });
          if (!cancelled) {
            setDoThisFirst({
              loading: false,
              loaded: true,
              suggestion: suggestion.trim(),
              dealLabel: matchedDeal ? (matchedDeal.accounts?.name || matchedDeal.name) : null,
              dealId: matchedDeal ? matchedDeal.id : null,
            });
            // Update localStorage timestamps after successful render decision
            localStorage.setItem('jove_last_hero_shown', Date.now().toString());
            localStorage.setItem('jove_last_hero_suggestion', suggestion.trim().toLowerCase());
          }
        } else if (!cancelled) {
          setDoThisFirst({ loading: false, loaded: true, suggestion: null, dealLabel: null, dealId: null });
        }
      } catch {
        if (!cancelled) {
          setDoThisFirst({ loading: false, loaded: true, suggestion: null, dealLabel: null, dealId: null });
        }
      }
    };

    fetchDoThisFirst();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // ── POST-CAPTURE FEEDBACK FROM REAL EXTRACTION ─────────
  useEffect(() => {
    if (preCaptureSignalCountRef.current === null || !data) return;

    const prevCount = preCaptureSignalCountRef.current;
    const newCount = data.signals.length;
    const newSignals = data.signals.slice(0, Math.max(0, newCount - prevCount));

    // Reset ref so this only fires once per capture
    preCaptureSignalCountRef.current = null;

    if (newSignals.length > 0) {
      // Derive feedback from actual extracted signal types
      const signalLabels: Record<string, string> = {
        champion_identified: 'Champion identified',
        budget_mentioned:    'Budget mentioned — momentum increasing',
        positive_sentiment:  'Positive signal detected',
        next_step_agreed:    'Next step agreed',
        risk_flag:           'Risk flag raised',
        competitor_mentioned:'Competitor mentioned',
      };

      const firstSignal = newSignals[0];
      const label = signalLabels[firstSignal.signal_type] || firstSignal.signal_type;

      // Try to match signal to a deal for account context
      const matchedDeal = firstSignal.deal_id
        ? data.allDeals.find(d => d.id === firstSignal.deal_id)
        : null;
      const accountLabel = matchedDeal
        ? (matchedDeal.accounts?.name || matchedDeal.name)
        : null;

      let fb: string;
      if (newSignals.length === 1) {
        fb = accountLabel ? `${label} at ${accountLabel}` : label;
      } else {
        fb = accountLabel
          ? `${newSignals.length} signals captured — ${accountLabel} updated`
          : `${newSignals.length} signals captured — deal updated`;
      }

      // ── SYSTEM LEARNED: feedback banner only ──
      setFeedbackText(fb);
      setFeedbackVisible(true);
      setTimeout(() => setFeedbackVisible(false), 3500);
      setTimeout(() => setFeedbackText(null), 4100);
    }
    // else: no new signals — silence is correct; soar + pulse already confirmed save
  }, [data]);

  // ── SESSION ACKNOWLEDGMENT CHECK ──────────────────────────
  useEffect(() => {
    if (!doThisFirst.loaded || !doThisFirst.suggestion) return;
    const stored = sessionStorage.getItem('jove_action_acknowledged');
    const key = doThisFirst.suggestion.trim().toLowerCase();
    if (stored === key) {
      setActionAcknowledged(true);
    }
  }, [doThisFirst.loaded, doThisFirst.suggestion]);

  // ── LOGO BLOOM + MILESTONE LISTENER ──────────────────────
  const [logoMilestone, setLogoMilestone] = useState(false);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'jove_bloom_trigger') {
        setLogoBloom(true);
        setTimeout(() => setLogoBloom(false), 800);
        // Bird reacts to cross-tab capture / Save to Jove
        setBirdReactionTrigger(k => k + 1);
      }
      if (e.key === 'jove_milestone_trigger') {
        setLogoMilestone(true);
        setTimeout(() => setLogoMilestone(false), 2000);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // ── BIRD/PULSE SIGNAL COUNT TRACKING ─────────────────
  // (Second bird reaction and second signal pulse removed —
  //  save-confirmed moment handles these; system-learned moment
  //  uses feedback banner only.)
  useEffect(() => {
    prevSignalCountForBirdRef.current = data?.signals.length ?? 0;
    prevSignalCountForPulseRef.current = data?.signals.length ?? 0;
  }, [data?.signals.length]);

  // ── DERIVED VALUES ─────────────────────────────────────
  const streak = data ? calculateStreak(data.streakLogs) : null;

  const todayMeetingCount = data?.meetings.filter(m => {
    const mt  = new Date(m.scheduled_at);
    const tod = new Date();
    return mt.toDateString() === tod.toDateString();
  }).length ?? 0;

  // ── BIRD QUESTION GENERATION ────────────────────────────
  // Priority hierarchy targets the gap whose answer compounds the most:
  //   1. Future meeting intent  → shapes prep brief, smart questions, draft emails
  //   2. Post-meeting debrief   → highest signal density while memory is fresh
  //   3. Stale deal gap-fill    → targets specific missing signal (champion > next step > budget)
  //   4. Open fallback          → captures ideas, early-stage thinking
  const birdQuestion = useMemo(() => {
    if (!data) return { text: "What's on your mind?", dealId: null as string | null, promptKey: `fallback:${new Date().toDateString()}` };

    const answered = birdAnsweredRef.current;
    const now = new Date();
    const twoDaysOut = new Date(now);
    twoDaysOut.setDate(twoDaysOut.getDate() + 2);
    twoDaysOut.setHours(0, 0, 0, 0);

    // ── P1: FUTURE MEETING INTENT ─────────────────────────
    // Upcoming meeting in next 48h — ask what they want from it.
    // This answer directly enriches the prep brief and draft artifacts.
    const upcoming = data.meetings.filter(m => {
      const mt = new Date(m.scheduled_at);
      return mt > now && mt < twoDaysOut;
    });

    for (const meeting of upcoming) {
      const promptKey = `meeting_goal:${meeting.id}`;
      if (answered.has(promptKey)) continue;
      const text = `What's your goal for ${meeting.title}?`;
      const dealId = meeting.deal_id ?? null;
      return { text, dealId, promptKey };
    }

    // ── P2: POST-MEETING DEBRIEF ──────────────────────────
    // Meeting ended in last 2 hours, no debrief yet — fresh recall = richest extraction.
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const recentUnDebriefed = data.meetings.filter(m => {
      const mt = new Date(m.scheduled_at);
      return mt < now && mt > twoHoursAgo && !m.debrief_completed;
    });

    for (const meeting of recentUnDebriefed) {
      const promptKey = `meeting_debrief:${meeting.id}`;
      if (answered.has(promptKey)) continue;
      const text = `How did ${meeting.title} go?`;
      const dealId = meeting.deal_id ?? null;
      return { text, dealId, promptKey };
    }

    // ── P3: STALE DEAL GAP-FILL ──────────────────────────
    // Walk deals from stalest to freshest, skip already-answered, ask about first gap.
    const sortedDeals = [...data.allDeals].sort(
      (a, b) => new Date(a.last_activity_at).getTime() - new Date(b.last_activity_at).getTime(),
    );

    for (const deal of sortedDeals) {
      const name = deal.accounts?.name || deal.name;
      const dealSignals = data.signals.filter(s => s.deal_id === deal.id);
      const signalTypes = new Set(dealSignals.map(s => s.signal_type));

      // Target the highest-value missing signal for this deal
      if (!signalTypes.has('champion_identified')) {
        const promptKey = `deal_champion:${deal.id}`;
        if (!answered.has(promptKey)) {
          return { text: `Who's your champion at ${name}?`, dealId: deal.id, promptKey };
        }
      }
      if (!deal.next_action) {
        const promptKey = `deal_next_step:${deal.id}`;
        if (!answered.has(promptKey)) {
          return { text: `What's the next step on ${name}?`, dealId: deal.id, promptKey };
        }
      }
      if (!signalTypes.has('budget_mentioned')) {
        const promptKey = `deal_budget:${deal.id}`;
        if (!answered.has(promptKey)) {
          return { text: `Any budget context on ${name}?`, dealId: deal.id, promptKey };
        }
      }

      // Check if deal is stale (overdue for touchpoint)
      const userPulseThreshold = data.user?.pulse_check_days ?? PULSE_CHECK_DEFAULT_DAYS;
      if (getDaysSinceActivity(deal) >= userPulseThreshold) {
        const promptKey = `deal_stale:${deal.id}`;
        if (!answered.has(promptKey)) {
          return { text: `Anything new on ${name}?`, dealId: deal.id, promptKey };
        }
      }
    }

    // ── P4: OPEN FALLBACK ────────────────────────────────
    const fallbackKey = `fallback:${new Date().toDateString()}`;
    return { text: "What's on your mind?", dealId: null as string | null, promptKey: fallbackKey };
  }, [data, birdAnsweredCount]);

  // ── BIRD CAPTURE HANDLER ──────────────────────────────────
  // Core bird save logic — accepts explicit dealId
  const executeBirdSave = async (finalDealId: string | null) => {
    if (!birdModalInput.trim() || birdModalSaving || !data?.user) return;
    setBirdModalSaving(true);

    // Capture the promptKey before any async work — useMemo may recompute
    const currentPromptKey = birdQuestion.promptKey;

    try {
      const result = await saveInteraction(supabase, {
        userId: data.user.id,
        dealId: finalDealId,
        type: 'note',
        rawContent: (birdQuestion.text && birdModalInput.trim())
          ? '[Bird question: ' + birdQuestion.text + '] ' + birdModalInput.trim()
          : birdModalInput,
      });

      if (result?.id) {
        triggerExtraction(result.id, data.user.id);
      }

      await updateStreak(supabase, data.user.id);

      // ── PERSIST PROMPT KEY — only after save succeeds ──────
      birdAnsweredRef.current.add(currentPromptKey);
      sessionStorage.setItem(
        'jove_bird_answered',
        JSON.stringify(Array.from(birdAnsweredRef.current))
      );
      setBirdAnsweredCount(c => c + 1);
    } catch (err) {
      console.error('Bird capture error:', err);
    }

    // Close modal immediately
    setBirdModalOpen(false);
    setBirdModalInput('');
    setBirdModalSaving(false);
    setBirdDealGate(false);

    // Clear pending pulse flag (prevent double-fire on next mount)
    localStorage.removeItem('jove_pulse_pending');

    // ── SAVE CONFIRMED: bird reaction + one sun pulse ──
    setBirdPulseTrigger(k => k + 1);
    birdReactionSourceRef.current = 'save';
    setBirdReactionTrigger(k => k + 1);
    setShowSignalPulse(true);
    setTimeout(() => setShowSignalPulse(false), 900);

    // Snapshot signal count for post-capture feedback
    preCaptureSignalCountRef.current = data?.signals.length ?? 0;

    // Delayed re-fetch to let extraction complete
    setTimeout(() => setHomeRefreshKey(k => k + 1), 3000);
  };

  const handleBirdSubmit = async () => {
    if (!birdModalInput.trim() || birdModalSaving || !data?.user) return;

    // Soft gate: no deal and active deals exist — ask before saving
    if (!birdQuestion.dealId && data.allDeals.length > 0) {
      setBirdDealGate(true);
      return;
    }

    executeBirdSave(birdQuestion.dealId);
  };

  const pulseThreshold  = data?.user?.pulse_check_days ?? PULSE_CHECK_DEFAULT_DAYS;
  const atRiskCount     = data
    ? data.allDeals.filter(d => getDaysSinceActivity(d) >= pulseThreshold).length
    : 0;
  const intelLines      = data ? buildIntelLines(data, pulseThreshold) : [];
  const richnessLevel   = Math.min((data?.signals.length ?? 0) / 12, 1);

  // ── SUN IMMINENT / IN-PROGRESS STATE ─────────────────
  const now = new Date();
  const isImminent = (data?.meetings ?? []).some(m => {
    const mt = new Date(m.scheduled_at);
    const diff = mt.getTime() - now.getTime();
    return diff > 0 && diff < 60 * 60 * 1000;
  });
  const isInProgress = (data?.meetings ?? []).some(m => {
    const mt = new Date(m.scheduled_at);
    const end = new Date(mt.getTime() + 90 * 60 * 1000);
    return now >= mt && now <= end;
  });
  const firstName       = getFirstName(data?.user ?? null);
  const greeting        = getGreeting(h);

  // ── DEBRIEF HANDLERS ──────────────────────────────────────
  const debriefMeeting = (!debriefDismissed && debriefMeetings.length > 0)
    ? debriefMeetings[0]
    : null;

  const handleDebriefNow = async (meeting: MeetingRow) => {
    await supabase
      .from('meetings')
      .update({ debrief_prompted_at: new Date().toISOString() })
      .eq('id', meeting.id);
    setDebriefMeetings(prev => prev.filter(m => m.id !== meeting.id));
    setCaptureInitialMode('debrief');
    setCaptureInitialText(
      `Meeting: ${meeting.title}\nAttendees: ${meeting.attendees ?? ''}\n`
    );
    setShowCapture(true);
  };

  const handleDebriefDismiss = async (meeting: MeetingRow) => {
    await supabase
      .from('meetings')
      .update({ debrief_prompted_at: new Date().toISOString() })
      .eq('id', meeting.id);
    setDebriefDismissed(true);
    setDebriefMeetings(prev => prev.filter(m => m.id !== meeting.id));
  };

  // ── ACTION OVERLAY HELPERS ──────────────────────────────
  const matchedDeal = doThisFirst.dealId
    ? data?.allDeals.find(d => d.id === doThisFirst.dealId) ?? null
    : null;

  const handleActionOverlayOpen = () => {
    if (!doThisFirst.suggestion || actionOverlayOpen) return;
    setActionInput('');
    setActionSubmitting(false);
    setActionOverlayOpen(true);
    setTimeout(() => actionInputRef.current?.focus(), 250);
  };

  const acknowledgeAction = () => {
    if (!doThisFirst.suggestion) return;
    const key = doThisFirst.suggestion.trim().toLowerCase();
    sessionStorage.setItem('jove_action_acknowledged', key);
    setActionAcknowledged(true);
  };

  const handleActionSubmit = async () => {
    if (!actionInput.trim() || actionSubmitting || !data?.user) return;
    setActionSubmitting(true);

    // Capture pre-submission staleness for feedback
    const dealWasStale = matchedDeal
      ? getDaysSinceActivity(matchedDeal) >= pulseThreshold
      : false;
    const dealName = matchedDeal
      ? (matchedDeal.accounts?.name || matchedDeal.name)
      : null;

    try {
      const result = await saveInteraction(supabase, {
        userId: data.user.id,
        dealId: doThisFirst.dealId,
        type: 'debrief',
        rawContent: actionInput,
      });

      if (result?.id) {
        triggerExtraction(result.id, data.user.id);
      }

      await updateStreak(supabase, data.user.id);
    } catch (err) {
      console.error('Action capture error:', err);
    }

    // Always close overlay + acknowledge regardless of extraction outcome
    setActionOverlayOpen(false);
    acknowledgeAction();

    // Signal pulse — immediate environment feedback on action capture
    setShowSignalPulse(true);
    setTimeout(() => setShowSignalPulse(false), 900);
    // Clear pending pulse flag (prevent double-fire on next mount)
    localStorage.removeItem('jove_pulse_pending');

    // Show feedback banner
    const fb = dealWasStale
      ? dealName
        ? `Touchpoint logged — ${dealName} risk reduced`
        : 'Touchpoint logged — risk reduced'
      : dealName
        ? `Signal captured — ${dealName} updated`
        : 'Signal captured — intelligence updated';
    setFeedbackText(fb);
    setFeedbackVisible(true);
    setTimeout(() => setFeedbackVisible(false), 2500);
    setTimeout(() => setFeedbackText(null), 3100);
  };

  const handleActionSkip = () => {
    setActionOverlayOpen(false);
    acknowledgeAction();
  };

  // Entrance animation values
  const anim = (delay: number) => ({
    opacity:    visible ? 1 : 0,
    transform:  visible ? 'translateY(0)' : 'translateY(12px)',
    transition: `opacity 0.65s ease ${delay}s, transform 0.65s ease ${delay}s`,
  });

  // ── RENDER ─────────────────────────────────────────────
  return (
    <div
      className="relative"
      style={{
        width:     '100%',
        minHeight: '100dvh',
        height:    '100dvh',
        fontFamily:"'DM Sans', sans-serif",
        overflow:  'hidden',
      }}
    >
      <SceneBackground />
      <AmbientBird signalCount={data?.signals.length ?? 0} reactionTrigger={birdReactionTrigger} reactionSourceRef={birdReactionSourceRef} positionRef={birdPositionRef} pulseTrigger={birdPulseTrigger} />

      {/* ── BIRD TAP HITBOX ──────────────────────────── */}
      <div
        ref={birdHitboxRef}
        onClick={() => {
          if (!birdModalOpen) {
            setBirdModalInput('');
            setBirdModalOpen(true);
            setTimeout(() => birdModalInputRef.current?.focus(), 200);
          }
        }}
        style={{
          position:     'fixed',
          top:          0,
          left:         0,
          width:        44,
          height:       44,
          borderRadius: '50%',
          zIndex:       23,
          pointerEvents:'auto',
          cursor:       'pointer',
          willChange:   'transform',
          WebkitTapHighlightColor: 'transparent',
        }}
        aria-label="Tap bird to capture"
      />

      {/* ── SUN PULSE KEYFRAMES ─────────────────────── */}
      <style>{`
        @keyframes sunPing {
          0% { transform: translate(-50%,-50%) scale(1); opacity: 0.6; }
          100% { transform: translate(-50%,-50%) scale(2.2); opacity: 0; }
        }
        @keyframes signalPulse {
          0% { transform: translate(-50%,-50%) scale(1); opacity: 0.65; }
          100% { transform: translate(-50%,-50%) scale(1.4); opacity: 0; }
        }
        /* (Zen keyframes removed — overlay no longer used) */
      `}</style>

      {/* ── WARM TINT LAYER (additive, gradient-based) ── */}
      {richnessLevel > 0 && (
        <div
          style={{
            position:       'fixed',
            inset:          0,
            pointerEvents:  'none',
            zIndex:         1,
            background:     `radial-gradient(circle at ${sunCenterLeft} ${sunCenterTop}, rgba(232,160,48,${richnessLevel * 0.03}) 0%, transparent 60%)`,
            transition:     'opacity 1.2s ease',
          }}
        />
      )}

      {/* ── SIGNAL PULSE RING ───────────────────────── */}
      {showSignalPulse && (
        <div
          style={{
            position:       'absolute',
            left:           sunCenterLeft,
            top:            sunCenterTop,
            transform:      'translate(-50%, -50%)',
            width:          140,
            height:         140,
            borderRadius:   '50%',
            background:     'radial-gradient(circle, rgba(248,190,64,0.40), transparent 70%)',
            animation:      'signalPulse 900ms ease-out forwards',
            zIndex:         21,
            pointerEvents:  'none',
          }}
        />
      )}

      {/* (Zen capture overlay removed — save-confirmed is per-path,
           system-learned uses feedback banner only) */}

      {/* ── SUN TAP TARGET + BREATHING GLOW ─────────── */}
      {scene.sun.opacity > 0 ? (
        <>
          {/* Breathing glow behind sun — orbGlow only animates opacity, so translate is safe */}
          <div
            style={{
              position:     'absolute',
              left:         sunCenterLeft,
              top:          sunCenterTop,
              transform:    'translate(-50%, -50%)',
              width:        110,
              height:       110,
              borderRadius: '50%',
              background:   'radial-gradient(circle, rgba(248,190,64,0.18), transparent 68%)',
              animation:    'orbGlow 5s ease-in-out infinite',
              zIndex:       14,
              pointerEvents:'none',
            }}
          />

          {/* Clickable sun overlay — uses calc() for centering because the
              breath animation's transform (scale) would override translate(-50%,-50%). */}
          <div
            ref={sunRef}
            onClick={() => router.push('/briefing')}
            style={{
              position:     'absolute',
              left:         `calc(${sunCenterLeft} - 50px)`,
              top:          `calc(${sunCenterTop} - 50px)`,
              width:        100,
              height:       100,
              borderRadius: '50%',
              cursor:       'pointer',
              zIndex:       15,
              display:      'flex',
              alignItems:   'center',
              justifyContent:'center',
              animation:    isImminent
                ? 'breath 2.5s ease-in-out infinite'
                : 'breath 5s ease-in-out infinite',
              WebkitTapHighlightColor: 'transparent',
            }}
            aria-label={`${todayMeetingCount} meeting${todayMeetingCount !== 1 ? 's' : ''} today. Tap for briefing.`}
          >
          </div>

          {/* In-progress pulse ring — sunPing keyframes include translate(-50%,-50%), so safe */}
          {isInProgress && (
            <div
              style={{
                position:     'absolute',
                left:         sunCenterLeft,
                top:          sunCenterTop,
                transform:    'translate(-50%, -50%)',
                width:        90,
                height:       90,
                borderRadius: '50%',
                border:       '1.5px solid rgba(248,190,64,0.4)',
                animation:    'sunPing 2s ease-out infinite',
                zIndex:       14,
                pointerEvents:'none',
              }}
            />
          )}
        </>
      ) : (
        /* ── NIGHT FALLBACK TAP TARGET (matches moon at 68%/12%) ──
           No breath animation here, so translate(-50%,-50%) is safe. */
        <div
          ref={sunRef}
          onClick={() => router.push('/briefing')}
          style={{
            position:     'absolute',
            left:         `calc(${sunCenterLeft} - 40px)`,
            top:          `calc(${sunCenterTop} - 40px)`,
            width:        80,
            height:       80,
            borderRadius: '50%',
            cursor:       'pointer',
            zIndex:       15,
            WebkitTapHighlightColor: 'transparent',
          }}
          aria-label="Tap for briefing"
        />
      )}

      {/* ── OFFLINE BANNER ─────────────────────────── */}
      <div style={{
        position:   'absolute',
        top:        0,
        left:       0,
        right:      0,
        zIndex:     50,
        height:     isOffline ? 28 : 0,
        overflow:   'hidden',
        transition: 'height 0.3s ease',
      }}>
        <div style={{
          height:      28,
          background:  'rgba(224,88,64,0.9)',
          display:     'flex',
          alignItems:  'center',
          justifyContent: 'center',
        }}>
          <span style={{
            fontSize:   10,
            fontWeight: 400,
            color:      '#FFFFFF',
            fontFamily: "'DM Sans', sans-serif",
          }}>
            You&apos;re offline — some features unavailable.
          </span>
        </div>
      </div>

      {/* ── TOP BAR (z:30 — above bird) ─────────── */}
      <div
        style={{
          position:      'absolute',
          top:           0,
          left:          0,
          right:         0,
          zIndex:        30,
          pointerEvents: 'none',
        }}
      >
        <div
          className="flex items-start justify-between"
          style={{ paddingTop: 'env(safe-area-inset-top)', paddingLeft: 22, paddingRight: 22, pointerEvents: 'auto', ...anim(0.06) }}
        >
          {/* Logo — taps to settings */}
          <div
            ref={logoRef}
            style={{
              transition: logoMilestone
                ? 'box-shadow 2s ease, transform 2s ease'
                : 'box-shadow 0.4s ease, transform 0.4s ease',
              borderRadius: 12,
              ...(logoMilestone
                ? {
                    boxShadow: '0 0 24px 12px rgba(232,160,48,0.4)',
                    transform: 'scale(1.2)',
                  }
                : logoBloom
                  ? {
                      boxShadow: '0 0 24px rgba(232,160,48,0.5)',
                      transform: 'scale(1.15)',
                    }
                  : {
                      boxShadow: 'none',
                      transform: 'scale(1)',
                    }),
            }}
          >
            <Logo light={scene.lightText} showWordmark size={30} />
          </div>

          {/* Time + weather pill */}
          <div
            style={{
              background:     'rgba(0,0,0,0.18)',
              backdropFilter: 'blur(6px)',
              borderRadius:   12,
              padding:        '5px 10px',
              textAlign:      'right',
            }}
          >
            <div style={{
              fontSize:   10,
              fontWeight: 300,
              color:      'rgba(255,248,230,0.48)',
            }}>
              {time}
            </div>
            {weather && data?.user?.weather_enabled !== false && (
              <div style={{
                fontSize:   11,
                fontWeight: 300,
                color:      'rgba(255,248,230,0.52)',
                marginTop:  2,
              }}>
                {weather.emoji}  {weather.temp}°F · {weather.condition}
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        className="absolute inset-0 flex flex-col"
        style={{ zIndex: 20, pointerEvents: 'none' }}
      >
        {/* Top bar spacer */}
        <div style={{ paddingTop: 'calc(env(safe-area-inset-top) + 44px)' }} />

        {/* ── GREETING ─────────────────────────────── */}
        <div
          style={{
            textAlign:  'center',
            padding:    '0 32px',
            marginTop:  28,
            ...anim(0.14),
          }}
        >
          <div
            style={{
              display:        'inline-block',
              padding:        '6px 20px 10px',
            }}
          >
            <div style={{
              fontFamily:   "'Cormorant Garamond', serif",
              fontSize:     14,
              fontWeight:   300,
              color:        textSecondary,
              marginBottom: 3,
            }}>
              {greeting}
            </div>
            <div style={{
              fontFamily:   "'Cormorant Garamond', serif",
              fontSize:     44,
              fontWeight:   300,
              color:        textPrimary,
              lineHeight:   1.05,
              letterSpacing:'-0.5px',
              textShadow:   scene.lightText
                ? '0 1px 0 rgba(0,0,0,0.2), 0 2px 20px rgba(0,0,0,0.18)'
                : '0 1px 2px rgba(255,255,255,0.3)',
            }}>
              {loading ? '' : firstName || 'there'}.
            </div>
          </div>
        </div>

        {/* ── DO THIS FIRST HERO CARD ────────────────── */}
        {!loading && doThisFirst.loaded && doThisFirst.suggestion && !actionAcknowledged && (
          <div
            style={{
              padding:   '0 22px',
              marginTop: 14,
              pointerEvents: 'auto',
              ...anim(0.28),
            }}
          >
            <div
              onClick={handleActionOverlayOpen}
              style={{
                background:     'rgba(232,160,48,0.06)',
                backdropFilter: 'blur(16px)',
                borderRadius:   16,
                padding:        '14px 16px',
                border:         '0.5px solid rgba(232,160,48,0.22)',
                cursor:         'pointer',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <div style={{
                fontSize:      9,
                fontWeight:    700,
                letterSpacing: '2px',
                textTransform: 'uppercase',
                color:         COLORS.amber,
                marginBottom:  8,
              }}>
                Do this first
              </div>
              <div style={{
                fontFamily:   "'Cormorant Garamond', serif",
                fontSize:     18,
                fontWeight:   400,
                color:        'rgba(252,246,234,0.88)',
                lineHeight:   1.4,
                marginBottom: doThisFirst.dealLabel ? 10 : 4,
              }}>
                {doThisFirst.suggestion}
              </div>
              {doThisFirst.dealLabel && (
                <div style={{
                  display:      'inline-block',
                  fontSize:     10,
                  fontWeight:   500,
                  color:        COLORS.amber,
                  background:   'rgba(232,160,48,0.10)',
                  borderRadius: 6,
                  padding:      '3px 8px',
                  marginBottom: 4,
                }}>
                  {doThisFirst.dealLabel}
                </div>
              )}
              <div style={{
                fontSize:   11,
                fontWeight: 300,
                color:      'rgba(240,235,224,0.32)',
                marginTop:  4,
              }}>
                Tap to act →
              </div>
            </div>
          </div>
        )}

        {/* ── DO THIS FIRST EMPTY STATE ─────────────────── */}
        {!loading && doThisFirst.loaded && !doThisFirst.suggestion && !actionAcknowledged && heroGatePassed && data && (
          <div
            style={{
              padding:   '0 22px',
              marginTop: 14,
              pointerEvents: 'auto',
              ...anim(0.28),
            }}
          >
            <div
              style={{
                background:     'rgba(0,0,0,0.14)',
                backdropFilter: 'blur(16px)',
                borderRadius:   16,
                padding:        '14px 16px',
                border:         '0.5px solid rgba(240,235,224,0.05)',
                opacity:        0.45,
              }}
            >
              <div style={{
                fontSize:      9,
                fontWeight:    700,
                letterSpacing: '2px',
                textTransform: 'uppercase',
                color:         'rgba(240,235,224,0.36)',
                marginBottom:  8,
              }}>
                Do this first
              </div>
              <div style={{
                fontSize:   13,
                fontWeight: 300,
                color:      'rgba(240,235,224,0.44)',
              }}>
                Capture something to generate your first priority.
              </div>
            </div>
          </div>
        )}

        {/* ── ERROR STATE ─────────────────────────── */}
        {fetchError && !data && (
          <div
            style={{
              flex:           1,
              display:        'flex',
              flexDirection:  'column',
              alignItems:     'center',
              justifyContent: 'center',
              gap:            12,
              pointerEvents:  'auto',
              ...anim(0.23),
            }}
          >
            <div style={{
              fontFamily:   "'Cormorant Garamond', serif",
              fontSize:     20,
              fontWeight:   300,
              color:        textPrimary,
              textAlign:    'center',
            }}>
              Couldn&apos;t load your data.
            </div>
            <button
              onClick={() => {
                setFetchError(false);
                setLoading(true);
                setHomeRefreshKey(k => k + 1);
              }}
              style={{
                background:    'none',
                border:        'none',
                cursor:        'pointer',
                fontSize:      13,
                fontWeight:    400,
                color:         textSecondary,
                fontFamily:    "'DM Sans', sans-serif",
                padding:       '8px 16px',
              }}
            >
              Tap to retry.
            </button>
          </div>
        )}

        {/* ── SPACER — replaces the old flex:1 orb container */}
        {!(fetchError && !data) && (
          <div style={{ flex: 1 }} />
        )}

        {/* ── FEEDBACK BANNER (warm, subtle — secondary to zen overlay) ── */}
        {feedbackText && (
          <div
            style={{
              padding:    '0 22px',
              marginBottom: 10,
              opacity:    feedbackVisible ? 1 : 0,
              transform:  feedbackVisible ? 'translateY(0)' : 'translateY(6px)',
              transition: 'opacity 0.5s ease, transform 0.5s ease',
            }}
          >
            <div style={{
              background:     'rgba(248,200,80,0.06)',
              backdropFilter: 'blur(16px)',
              borderRadius:   12,
              padding:        '10px 16px',
              border:         '0.5px solid rgba(248,200,80,0.15)',
              textAlign:      'center',
            }}>
              <div style={{
                fontSize:   12,
                fontWeight: 400,
                color:      'rgba(248,200,80,0.7)',
                lineHeight: 1.4,
                letterSpacing: '0.01em',
              }}>
                {feedbackText}
              </div>
            </div>
          </div>
        )}

        {/* ── DEBRIEF PROMPT CARD ──────────────────── */}
        {debriefMeeting && (
          <div style={{
            padding:    '0 22px',
            marginBottom: 10,
            pointerEvents: 'auto',
            ...anim(0.30),
          }}>
            <div style={{
              background:     'rgba(0,0,0,0.36)',
              backdropFilter: 'blur(16px)',
              borderRadius:   16,
              padding:        '14px 16px',
              border:         '0.5px solid rgba(240,235,224,0.1)',
              position:       'relative',
            }}>
              {/* Dismiss button */}
              <button
                onClick={() => handleDebriefDismiss(debriefMeeting)}
                style={{
                  position:   'absolute',
                  top:        10,
                  right:      12,
                  background: 'none',
                  border:     'none',
                  color:      'rgba(240,235,224,0.36)',
                  fontSize:   16,
                  cursor:     'pointer',
                  padding:    0,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
              {/* Status dot + label */}
              <div style={{
                display:    'flex',
                alignItems: 'center',
                gap:        7,
                marginBottom: 8,
              }}>
                <div style={{
                  width:        6,
                  height:       6,
                  borderRadius: '50%',
                  background:   COLORS.amber,
                  flexShrink:   0,
                }} />
                <span style={{
                  fontSize:      9,
                  fontWeight:    700,
                  letterSpacing: '2px',
                  textTransform: 'uppercase',
                  color:         COLORS.amber,
                }}>
                  Debrief ready
                </span>
              </div>
              {/* Meeting title */}
              <div style={{
                fontFamily:   "'Cormorant Garamond', serif",
                fontSize:     18,
                fontWeight:   400,
                color:        'rgba(252,246,234,0.92)',
                marginBottom: 4,
              }}>
                {debriefMeeting.title}
              </div>
              {/* How did it go */}
              <div style={{
                fontSize:     13,
                fontWeight:   300,
                color:        'rgba(240,235,224,0.44)',
                marginBottom: 12,
              }}>
                How did it go?
              </div>
              {/* Debrief Now button */}
              <button
                onClick={() => handleDebriefNow(debriefMeeting)}
                style={{
                  padding:       '9px 18px',
                  borderRadius:  9,
                  border:        '0.5px solid rgba(232,160,48,0.5)',
                  background:    'rgba(232,160,48,0.15)',
                  color:         COLORS.amber,
                  fontSize:      10,
                  fontWeight:    700,
                  letterSpacing: '1.5px',
                  textTransform: 'uppercase',
                  cursor:        'pointer',
                  fontFamily:    "'DM Sans', sans-serif",
                }}
              >
                Debrief Now →
              </button>
            </div>
          </div>
        )}

        {/* ── THREE INTELLIGENCE LINES ─────────────── */}
        <div style={{ padding: '0 26px', pointerEvents: 'auto', ...anim(0.34) }}>
          {loading
            ? Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  style={{
                    height:       14,
                    borderRadius: 7,
                    background:   'rgba(240,235,224,0.08)',
                    marginBottom: 12,
                    width:        i === 2 ? '60%' : '90%',
                  }}
                />
              ))
            : intelLines.map((line, i) => (
                <div
                  key={i}
                  role="button"
                  tabIndex={0}
                  onClick={() => router.push(line.route)}
                  onKeyDown={(e) => { if (e.key === 'Enter') router.push(line.route); }}
                  style={{
                    display:      'flex',
                    alignItems:   'flex-start',
                    gap:          10,
                    marginBottom: 1,
                    minHeight:    44,
                    paddingTop:   4,
                    paddingBottom:4,
                    cursor:       'pointer',
                    WebkitTapHighlightColor: 'transparent',
                    transition:   'opacity 0.12s ease, transform 0.12s ease',
                  }}
                  onPointerDown={(e) => {
                    const el = e.currentTarget;
                    el.style.opacity = '0.7';
                    el.style.transform = 'scale(0.98)';
                  }}
                  onPointerUp={(e) => {
                    const el = e.currentTarget;
                    el.style.opacity = '1';
                    el.style.transform = 'scale(1)';
                  }}
                  onPointerCancel={(e) => {
                    const el = e.currentTarget;
                    el.style.opacity = '1';
                    el.style.transform = 'scale(1)';
                  }}
                >
                  <div style={{
                    width:        6,
                    height:       6,
                    borderRadius: '50%',
                    background:   line.dot,
                    flexShrink:   0,
                    marginTop:    5,
                    animation:    line.blink
                      ? 'dotBlink 3s ease-in-out infinite'
                      : 'none',
                    boxShadow:    line.glow
                      ? `0 0 6px 2px ${line.dot}`
                      : 'none',
                  }} />
                  <div style={{
                    fontSize:   13,
                    fontWeight: 300,
                    color:      'rgba(240,235,224,0.72)',
                    lineHeight: 1.46,
                    textShadow: '0 1px 4px rgba(0,0,0,0.28)',
                  }}>
                    {line.text}
                  </div>
                </div>
              ))
          }
        </div>

        {/* Bottom row spacer */}
        <div style={{ height: 122, flexShrink: 0 }} />

      </div>

      {/* ── BOTTOM ROW (z:30 — above bird) ─────── */}
      <div
        style={{
          position:      'absolute',
          bottom:        0,
          left:          0,
          right:         0,
          zIndex:        30,
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'space-between',
            padding:        '20px 26px 44px',
            pointerEvents:  'auto',
            ...anim(0.42),
          }}
        >
          {/* Capture button — amber circle */}
          <button
            ref={captureRef}
            onClick={() => setShowCapture(true)}
            style={{
              width:        58,
              height:       58,
              borderRadius: '50%',
              background:   'linear-gradient(135deg, #C87820, #E09838)',
              border:       'none',
              display:      'flex',
              alignItems:   'center',
              justifyContent:'center',
              cursor:       'pointer',
              boxShadow:    '0 6px 26px rgba(200,120,32,0.36), 0 2px 0 rgba(255,220,140,0.18) inset',
              animation:    'breath 4s ease-in-out infinite',
              flexShrink:   0,
            }}
            aria-label="Capture"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <line x1="10" y1="3" x2="10" y2="17"
                stroke="white" strokeWidth="2.2" strokeLinecap="round"/>
              <line x1="3" y1="10" x2="17" y2="10"
                stroke="white" strokeWidth="2.2" strokeLinecap="round"/>
            </svg>
          </button>

          {/* Deals pill */}
          <button
            ref={dealsRef}
            onClick={() => router.push('/deals')}
            style={{
              display:        'flex',
              alignItems:     'center',
              gap:            8,
              cursor:         'pointer',
              background:     'rgba(240,235,224,0.1)',
              border:         '0.5px solid rgba(240,235,224,0.18)',
              borderRadius:   26,
              padding:        '11px 20px',
              backdropFilter: 'blur(12px)',
              boxShadow:      '0 2px 12px rgba(0,0,0,0.18)',
            }}
            aria-label="Open deals"
          >
            {atRiskCount > 0 && (
              <div style={{
                width:        6,
                height:       6,
                borderRadius: '50%',
                background:   COLORS.red,
                boxShadow:    `0 0 6px 2px ${COLORS.red}`,
                flexShrink:   0,
              }} />
            )}
            <span style={{
              fontFamily: "'Cormorant Garamond', serif",
              fontSize:   15,
              fontWeight: 400,
              color:      'rgba(240,235,224,0.78)',
            }}>
              {atRiskCount > 0 ? `Deals · ${atRiskCount} at risk` : 'Deals'}
            </span>
            <span style={{
              fontSize: 14,
              color:    'rgba(240,235,224,0.36)',
            }}>
              ›
            </span>
          </button>
        </div>
      </div>

      {/* ── SPOTLIGHT TOUR ─────────────────────── */}
      {showTour && (
        <SpotlightTour
          stops={[
            {
              ref:      sunRef as React.RefObject<HTMLElement>,
              copy:     'What to do first. Tap every morning.',
              position: 'below',
            },
            {
              ref:      captureRef as React.RefObject<HTMLElement>,
              copy:     'Feed the system. Every capture makes your intelligence sharper.',
              position: 'above',
            },
            {
              ref:      dealsRef as React.RefObject<HTMLElement>,
              copy:     'Risk and leverage. See what needs your attention now.',
              position: 'above',
            },
            {
              ref:      logoRef as React.RefObject<HTMLElement>,
              copy:     'Profile and preferences.',
              position: 'below',
            },
          ]}
          storageKey="jove_tour_complete"
          onComplete={() => {
            setShowTour(false);
            if (localStorage.getItem('jove_calendar_prompted') !== 'true') {
              setShowCalendarPrompt(true);
            }
          }}
          delayMs={0}
        />
      )}

      {/* ── CALENDAR IMPORT PROMPT ────────────── */}
      {showCalendarPrompt && (
        <CalendarImportPrompt
          onImport={() => {
            localStorage.setItem('jove_calendar_prompted', 'true');
            setShowCalendarPrompt(false);
            router.push('/meetings?import=true');
          }}
          onSkip={() => {
            localStorage.setItem('jove_calendar_prompted', 'true');
            setShowCalendarPrompt(false);
          }}
        />
      )}

      {/* ── FIRST VISIT OVERLAY ───────────────── */}
      {firstVisitVisible && (
        <div style={{
          position:       'fixed',
          inset:          0,
          zIndex:         200,
          background:     '#060a12',
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          opacity:        firstVisitOpacity,
          transition:     'opacity 0.7s ease',
          pointerEvents:  firstVisitOpacity < 1 ? 'none' : 'auto',
        }}>
          <Logo light size={48} showWordmark />
        </div>
      )}

      {/* ── CAPTURE SHEET ────────────────────────── */}
      {showCapture && data?.user && (
        <CaptureSheet
          onClose={() => {
            setShowCapture(false);
            setCaptureInitialMode(null);
            setCaptureInitialText('');
          }}
          userId={data.user.id}
          activeDeals={data.allDeals ?? []}
          onCaptureComplete={() => {
            // ── SAVE CONFIRMED: CaptureSheet shows "Got it." — no extra layers here ──
            // Snapshot current signal count before re-fetch
            preCaptureSignalCountRef.current = data?.signals.length ?? 0;
            // Clear pending pulse flag (prevent double-fire on next mount)
            localStorage.removeItem('jove_pulse_pending');
            // Delay re-fetch to give extraction time to complete
            setTimeout(() => {
              setHomeRefreshKey((k) => k + 1);
            }, 3000);
          }}
          initialMode={captureInitialMode ?? undefined}
          initialText={captureInitialText || undefined}
        />
      )}

      {/* ── BIRD CAPTURE MODAL ──────────────────────── */}
      {birdModalOpen && (
        <>
          {/* Backdrop — tap to dismiss */}
          <div
            onClick={() => {
              setBirdModalOpen(false);
              setBirdModalInput('');
              setBirdDealGate(false);
            }}
            style={{
              position:       'fixed',
              inset:          0,
              zIndex:         290,
              background:     'rgba(13,15,18,0.6)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
            }}
          />

          {/* Modal — centered on screen */}
          <div
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setBirdModalOpen(false);
                setBirdModalInput('');
                setBirdDealGate(false);
              }
            }}
            style={{
              position:       'fixed',
              top:            '50%',
              left:           '50%',
              transform:      'translate(-50%, -50%)',
              zIndex:         300,
              width:          'calc(100% - 48px)',
              maxWidth:       340,
              background:     '#0f1420',
              borderRadius:   18,
              border:         '0.5px solid rgba(232,160,48,0.18)',
              padding:        '22px 20px 18px',
              fontFamily:     "'DM Sans', sans-serif",
            }}
          >
            {/* Question */}
            <div style={{
              fontFamily:   "'Cormorant Garamond', serif",
              fontSize:     18,
              fontWeight:   400,
              color:        'rgba(252,246,234,0.88)',
              lineHeight:   1.4,
              marginBottom: 14,
            }}>
              {birdQuestion.text}
            </div>

            {/* Input + Submit — hidden when deal gate is active */}
            {!birdDealGate && (
              <>
                <textarea
                  ref={birdModalInputRef}
                  value={birdModalInput}
                  onChange={(e) => setBirdModalInput(e.target.value)}
                  placeholder="Type anything..."
                  style={{
                    width:        '100%',
                    background:   'rgba(16,20,30,0.6)',
                    border:       '0.5px solid rgba(232,160,48,0.22)',
                    borderRadius: 12,
                    padding:      '12px 14px',
                    fontFamily:   "'DM Sans', sans-serif",
                    fontSize:     14,
                    fontWeight:   300,
                    color:        'rgba(252,246,234,0.92)',
                    outline:      'none',
                    resize:       'none',
                    minHeight:    80,
                    lineHeight:   1.6,
                    marginBottom: 12,
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = 'rgba(232,160,48,0.44)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = 'rgba(232,160,48,0.22)';
                  }}
                />

                {/* Submit button */}
                <button
                  onClick={handleBirdSubmit}
                  disabled={!birdModalInput.trim() || birdModalSaving}
                  style={{
                    width:           '100%',
                    padding:         '12px 0',
                    borderRadius:    10,
                    border:          'none',
                    background:      birdModalInput.trim() && !birdModalSaving
                      ? 'linear-gradient(135deg, #C87820, #E09838)'
                      : 'rgba(255,255,255,0.06)',
                    color:           birdModalInput.trim() && !birdModalSaving
                      ? 'white'
                      : 'rgba(240,235,224,0.36)',
                    fontSize:        12,
                    fontWeight:      600,
                    cursor:          birdModalInput.trim() && !birdModalSaving
                      ? 'pointer'
                      : 'default',
                    fontFamily:      "'DM Sans', sans-serif",
                    transition:      'all 0.2s ease',
                    boxShadow:       birdModalInput.trim() && !birdModalSaving
                      ? '0 4px 14px rgba(200,120,32,0.28)'
                      : 'none',
                  }}
                >
                  {birdModalSaving ? 'Saving...' : 'Save \u2192'}
                </button>
              </>
            )}

            {/* ── BIRD DEAL ASSIGNMENT GATE ── */}
            {birdDealGate && data && (
              <>
                <p
                  style={{
                    fontSize:     13,
                    fontWeight:   300,
                    color:        'rgba(240,235,224,0.5)',
                    marginBottom: 12,
                    fontFamily:   "'DM Sans', sans-serif",
                  }}
                >
                  Add to a deal?
                </p>

                <div
                  style={{
                    maxHeight:  180,
                    overflowY:  'auto',
                    marginBottom: 12,
                  }}
                >
                  {data.allDeals.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => executeBirdSave(d.id)}
                      style={{
                        width:        '100%',
                        display:      'block',
                        textAlign:    'left',
                        background:   'rgba(16,20,30,0.6)',
                        border:       '0.5px solid rgba(232,160,48,0.15)',
                        borderRadius: 10,
                        padding:      '10px 14px',
                        marginBottom: 5,
                        cursor:       'pointer',
                        fontFamily:   "'DM Sans', sans-serif",
                        transition:   'border-color 0.15s',
                      }}
                    >
                      <span
                        style={{
                          fontSize:   13,
                          fontWeight: 400,
                          color:      'rgba(252,246,234,0.88)',
                        }}
                      >
                        {d.name}
                      </span>
                      {d.accounts?.name && (
                        <span
                          style={{
                            fontSize:   12,
                            fontWeight: 300,
                            color:      'rgba(240,235,224,0.45)',
                            marginLeft: 6,
                          }}
                        >
                          &middot; {d.accounts.name}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => executeBirdSave(null)}
                  style={{
                    width:      '100%',
                    padding:    '8px 0',
                    background: 'none',
                    border:     'none',
                    color:      'rgba(240,235,224,0.36)',
                    fontSize:   12,
                    fontWeight: 400,
                    cursor:     'pointer',
                    fontFamily: "'DM Sans', sans-serif",
                  }}
                >
                  Skip &mdash; save without a deal
                </button>
              </>
            )}
          </div>
        </>
      )}

      {/* ── ACTION CAPTURE OVERLAY ────────────────── */}
      {actionOverlayOpen && (
        <>
          {/* Backdrop */}
          <div
            onClick={handleActionSkip}
            style={{
              position:     'fixed',
              inset:        0,
              zIndex:       290,
              background:   'rgba(4,8,14,0.72)',
              backdropFilter: 'blur(10px)',
              transition:   'opacity 0.2s ease',
            }}
          />

          {/* Sheet */}
          <div
            style={{
              position:     'fixed',
              bottom:       0,
              left:         '50%',
              transform:    'translateX(-50%) translateY(0)',
              transition:   'transform 0.32s cubic-bezier(.32,.72,0,1)',
              zIndex:       300,
              width:        '100%',
              maxWidth:     '100%',
              background:   '#0f1420',
              borderTop:    '0.5px solid rgba(232,160,48,0.2)',
              borderRadius: '22px 22px 0 0',
              paddingBottom: 44,
              fontFamily:   "'DM Sans', sans-serif",
            }}
          >
            {/* Handle */}
            <div style={{
              width:        36,
              height:       4,
              borderRadius: 2,
              background:   'rgba(240,235,224,0.15)',
              margin:       '14px auto 0',
            }} />

            <div style={{ padding: '16px 18px 0' }}>
              {/* Action context — read-only */}
              <div style={{
                fontSize:      9,
                fontWeight:    700,
                letterSpacing: '2px',
                textTransform: 'uppercase',
                color:         COLORS.amber,
                marginBottom:  8,
              }}>
                Do this first
              </div>
              <div style={{
                fontFamily:   "'Cormorant Garamond', serif",
                fontSize:     18,
                fontWeight:   400,
                color:        'rgba(252,246,234,0.92)',
                lineHeight:   1.4,
                marginBottom: 10,
              }}>
                {doThisFirst.suggestion}
              </div>

              {/* Deal context if matched */}
              {matchedDeal && (
                <div style={{
                  background:   'rgba(240,235,224,0.04)',
                  borderRadius: 10,
                  padding:      '10px 12px',
                  marginBottom: 14,
                  borderLeft:   `2px solid rgba(232,160,48,0.3)`,
                }}>
                  <div style={{
                    fontSize:     11,
                    fontWeight:   500,
                    color:        COLORS.amber,
                    marginBottom: 4,
                  }}>
                    {matchedDeal.accounts?.name || matchedDeal.name} · {matchedDeal.stage}
                  </div>
                  {matchedDeal.next_action && (
                    <div style={{
                      fontSize:     12,
                      fontWeight:   300,
                      color:        'rgba(240,235,224,0.56)',
                      lineHeight:   1.4,
                      marginBottom: data?.signals.find(s => s.deal_id === matchedDeal.id) ? 4 : 0,
                    }}>
                      Next: {matchedDeal.next_action}
                    </div>
                  )}
                  {(() => {
                    const recentSignal = data?.signals.find(s => s.deal_id === matchedDeal.id);
                    if (!recentSignal) return null;
                    const signalTypeLabels: Record<string, string> = {
                      champion_identified: 'Champion identified',
                      budget_mentioned:    'Budget mentioned',
                      positive_sentiment:  'Positive signal',
                      next_step_agreed:    'Next step agreed',
                      risk_flag:           'Risk flag',
                      competitor_mentioned:'Competitor mentioned',
                    };
                    const label = signalTypeLabels[recentSignal.signal_type] || recentSignal.signal_type;
                    return (
                      <div style={{
                        fontSize:   11,
                        fontWeight: 300,
                        color:      'rgba(240,235,224,0.40)',
                        lineHeight: 1.4,
                      }}>
                        Latest: {label}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Input */}
              <textarea
                ref={actionInputRef}
                value={actionInput}
                onChange={(e) => setActionInput(e.target.value)}
                placeholder="What happened or what did you do?"
                style={{
                  width:        '100%',
                  background:   'rgba(16,20,30,0.6)',
                  border:       '0.5px solid rgba(232,160,48,0.22)',
                  borderRadius: 14,
                  padding:      '14px 16px',
                  fontFamily:   "'DM Sans', sans-serif",
                  fontSize:     14,
                  fontWeight:   300,
                  color:        'rgba(252,246,234,0.92)',
                  outline:      'none',
                  resize:       'none',
                  minHeight:    100,
                  lineHeight:   1.65,
                  marginBottom: 12,
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = 'rgba(232,160,48,0.44)';
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = 'rgba(232,160,48,0.22)';
                }}
              />

              {/* Submit button */}
              <button
                onClick={handleActionSubmit}
                disabled={!actionInput.trim() || actionSubmitting}
                style={{
                  width:           '100%',
                  padding:         '14px 0',
                  borderRadius:    12,
                  border:          'none',
                  background:      actionInput.trim() && !actionSubmitting
                    ? 'linear-gradient(135deg, #C87820, #E09838)'
                    : 'rgba(255,255,255,0.06)',
                  color:           actionInput.trim() && !actionSubmitting
                    ? 'white'
                    : 'rgba(240,235,224,0.36)',
                  fontSize:        11,
                  fontWeight:      700,
                  letterSpacing:   '2px',
                  textTransform:   'uppercase',
                  cursor:          actionInput.trim() && !actionSubmitting
                    ? 'pointer'
                    : 'default',
                  fontFamily:      "'DM Sans', sans-serif",
                  transition:      'all 0.2s ease',
                  boxShadow:       actionInput.trim() && !actionSubmitting
                    ? '0 4px 18px rgba(200,120,32,0.3)'
                    : 'none',
                  marginBottom:    10,
                }}
              >
                {actionSubmitting ? 'Saving...' : 'Log it →'}
              </button>

              {/* Skip */}
              <button
                onClick={handleActionSkip}
                style={{
                  width:      '100%',
                  padding:    '10px 0',
                  background: 'none',
                  border:     'none',
                  color:      'rgba(240,235,224,0.36)',
                  fontSize:   12,
                  fontWeight: 400,
                  cursor:     'pointer',
                  fontFamily: "'DM Sans', sans-serif",
                }}
              >
                Skip for now
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
