'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import SceneBackground from '@/components/home/SceneBackground';
import Logo from '@/components/ui/Logo';
import StreakBadge from '@/components/ui/StreakBadge';
import CaptureSheet from '@/components/capture/CaptureSheet';
import { calculateStreak } from '@/lib/streak';
import {
  getGreeting,
  getSceneForHour,
  formatTime,
  COLORS,
} from '@/lib/design-system';
import { PULSE_CHECK_DEFAULT_DAYS } from '@/lib/constants';
import type {
  DealRow,
  MeetingRow,
  SignalRow,
  StreakLogRow,
  UserRow,
} from '@/lib/types';

// ── TYPES ──────────────────────────────────────────────────
interface HomeData {
  user:          UserRow | null;
  meetings:      MeetingRow[];
  urgentDeals:   DealRow[];
  allDeals:      DealRow[];
  recentSignal:  SignalRow | null;
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

// ── INTELLIGENCE LINES ───────────────────────────────────
interface IntelLine {
  dot:   string;  // color
  text:  string;
  blink: boolean;
}

function buildIntelLines(data: HomeData): IntelLine[] {
  const lines: IntelLine[] = [];

  // Line 1 — most recent signal or most recently updated deal
  if (data.recentSignal) {
    lines.push({
      dot:   COLORS.amber,
      text:  data.recentSignal.content,
      blink: false,
    });
  } else if (data.allDeals.length > 0) {
    const d = data.allDeals[0];
    lines.push({
      dot:   COLORS.amber,
      text:  `${d.name} · ${d.stage}`,
      blink: false,
    });
  } else {
    lines.push({
      dot:   'rgba(240,235,224,0.2)',
      text:  'Capture your first signal with the + button below.',
      blink: false,
    });
  }

  // Line 2 — most urgent stale deal
  if (data.urgentDeals.length > 0) {
    const d    = data.urgentDeals[0];
    const days = Math.floor(
      (Date.now() - new Date(d.last_activity_at).getTime())
      / (1000 * 60 * 60 * 24)
    );
    lines.push({
      dot:   COLORS.red,
      text:  `${d.name} — ${days} days since last activity.`,
      blink: true,
    });
  } else if (data.allDeals.length > 1) {
    const d    = data.allDeals[1];
    const days = Math.floor(
      (Date.now() - new Date(d.last_activity_at).getTime())
      / (1000 * 60 * 60 * 24)
    );
    lines.push({
      dot:   COLORS.amber,
      text:  `${d.name} — ${days} days since last activity.`,
      blink: false,
    });
  } else {
    lines.push({
      dot:   'rgba(240,235,224,0.2)',
      text:  'Add your deals via the Deals button below.',
      blink: false,
    });
  }

  // Line 3 — next meeting or deal/account count
  const now      = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(23, 59, 59, 999);

  const upcoming = data.meetings.find(m => {
    const mt = new Date(m.scheduled_at);
    return mt > now && mt < tomorrow;
  });

  if (upcoming) {
    const mt   = new Date(upcoming.scheduled_at);
    const h    = mt.getHours();
    const m    = mt.getMinutes().toString().padStart(2, '0');
    const h12  = h % 12 || 12;
    const ap   = h < 12 ? 'am' : 'pm';
    lines.push({
      dot:   'rgba(240,235,224,0.26)',
      text:  `${upcoming.title} · ${h12}:${m}${ap}`,
      blink: false,
    });
  } else {
    const dealCount    = data.allDeals.length;
    const accountCount = data.accountCount;
    if (dealCount > 0) {
      lines.push({
        dot:   'rgba(240,235,224,0.26)',
        text:  `${dealCount} active deal${dealCount !== 1 ? 's' : ''} across ${accountCount} account${accountCount !== 1 ? 's' : ''}.`,
        blink: false,
      });
    } else {
      lines.push({
        dot:   'rgba(240,235,224,0.26)',
        text:  'No meetings today. Good time to log a capture.',
        blink: false,
      });
    }
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

  const h     = new Date().getHours();
  const scene = getSceneForHour(h);

  // Text color adapts to sky brightness
  const textPrimary   = scene.lightText
    ? 'rgba(252,246,234,0.94)'
    : 'rgba(26,20,16,0.90)';
  const textSecondary = scene.lightText
    ? 'rgba(240,235,224,0.44)'
    : 'rgba(26,20,16,0.44)';

  // ── DYNAMIC THEME-COLOR (iOS status bar) ────────────────
  useEffect(() => {
    const skyTop = scene.sky[0];
    let meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = skyTop;
    return () => { meta!.content = '#F7F3EC'; };
  }, [scene.sky]);

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
          .select('id, name, stage, last_activity_at, snoozed_until, intel_score, momentum_score, signal_velocity, next_action, account_id, user_id')
          .eq('user_id', authUser.id)
          .not('stage', 'in', '("Closed Won","Closed Lost")')
          .lt('last_activity_at', cutoff.toISOString())
          .or(`snoozed_until.is.null,snoozed_until.lt.${now.toISOString()}`)
          .order('last_activity_at', { ascending: true })
          .limit(5),

        supabase
          .from('deals')
          .select('id, name, stage, last_activity_at, snoozed_until, intel_score, momentum_score, signal_velocity, next_action, account_id, user_id')
          .eq('user_id', authUser.id)
          .not('stage', 'in', '("Closed Won","Closed Lost")')
          .order('last_activity_at', { ascending: false })
          .limit(10),

        supabase
          .from('signals')
          .select('id, content, signal_type, deal_id, created_at')
          .eq('user_id', authUser.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),

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
      ]);

      setData({
        user:         userRes.data as UserRow | null,
        meetings:     (meetingsRes.data ?? []) as MeetingRow[],
        urgentDeals:  (urgentDealsRes.data ?? []) as DealRow[],
        allDeals:     (allDealsRes.data ?? []) as DealRow[],
        recentSignal: (signalRes.data ?? null) as SignalRow | null,
        streakLogs:   (streakRes.data ?? []) as StreakLogRow[],
        accountCount: accountCountRes.count ?? 0,
      });

      setDebriefMeetings((debriefRes.data ?? []) as MeetingRow[]);

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

  // ── LOGO BLOOM + MILESTONE LISTENER ──────────────────────
  const [logoMilestone, setLogoMilestone] = useState(false);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'jove_bloom_trigger') {
        setLogoBloom(true);
        setTimeout(() => setLogoBloom(false), 800);
      }
      if (e.key === 'jove_milestone_trigger') {
        setLogoMilestone(true);
        setTimeout(() => setLogoMilestone(false), 2000);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // ── DERIVED VALUES ─────────────────────────────────────
  const streak = data ? calculateStreak(data.streakLogs) : null;

  const todayMeetingCount = data?.meetings.filter(m => {
    const mt  = new Date(m.scheduled_at);
    const tod = new Date();
    return mt.toDateString() === tod.toDateString();
  }).length ?? 0;

  const intelLines      = data ? buildIntelLines(data) : [];

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

  // Entrance animation values
  const anim = (delay: number) => ({
    opacity:    visible ? 1 : 0,
    transform:  visible ? 'translateY(0)' : 'translateY(12px)',
    transition: `opacity 0.65s ease ${delay}s, transform 0.65s ease ${delay}s`,
  });

  // ── RENDER ─────────────────────────────────────────────
  return (
    <div
      className="relative overflow-hidden"
      style={{
        width:     '100%',
        minHeight: '100dvh',
        height:    '100dvh',
        fontFamily:"'DM Sans', sans-serif",
      }}
    >
      <SceneBackground />

      {/* ── SUN PULSE KEYFRAME ──────────────────────── */}
      <style>{`
        @keyframes sunPing {
          0% { transform: translate(-50%,-50%) scale(1); opacity: 0.6; }
          100% { transform: translate(-50%,-50%) scale(2.2); opacity: 0; }
        }
      `}</style>

      {/* ── SUN TAP TARGET + BREATHING GLOW ─────────── */}
      {scene.sun.opacity > 0 ? (
        <>
          {/* Breathing glow behind sun */}
          <div
            style={{
              position:     'absolute',
              left:         '50%',
              top:          `${scene.sun.top}%`,
              transform:    'translate(-50%, -50%)',
              width:        110,
              height:       110,
              borderRadius: '50%',
              background:   'radial-gradient(circle, rgba(248,190,64,0.18), transparent 68%)',
              animation:    'orbGlow 5s ease-in-out infinite',
              zIndex:       4,
              pointerEvents:'none',
            }}
          />

          {/* Clickable sun overlay */}
          <div
            onClick={() => router.push('/briefing')}
            style={{
              position:     'absolute',
              left:         '50%',
              top:          `${scene.sun.top}%`,
              transform:    'translate(-50%, -50%)',
              width:        80,
              height:       80,
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

          {/* In-progress pulse ring */}
          {isInProgress && (
            <div
              style={{
                position:     'absolute',
                left:         '50%',
                top:          `${scene.sun.top}%`,
                transform:    'translate(-50%, -50%)',
                width:        90,
                height:       90,
                borderRadius: '50%',
                border:       '1.5px solid rgba(248,190,64,0.4)',
                animation:    'sunPing 2s ease-out infinite',
                zIndex:       4,
                pointerEvents:'none',
              }}
            />
          )}
        </>
      ) : (
        /* ── NIGHT FALLBACK TAP TARGET ─────────────── */
        <div
          onClick={() => router.push('/briefing')}
          style={{
            position:     'absolute',
            left:         '50%',
            top:          '75%',
            transform:    'translate(-50%, -50%)',
            width:        64,
            height:       64,
            borderRadius: '50%',
            background:   'rgba(180,200,255,0.06)',
            border:       '0.5px solid rgba(180,200,255,0.12)',
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

      <div
        className="absolute inset-0 flex flex-col"
        style={{ zIndex: 10 }}
      >

        {/* ── TOP BAR ──────────────────────────────── */}
        <div
          className="flex items-start justify-between"
          style={{ padding: '50px 22px 0', ...anim(0.06) }}
        >
          {/* Logo — taps to settings */}
          <div
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
              borderRadius:   18,
              background:     scene.lightText
                ? 'transparent'
                : 'rgba(255,255,255,0.07)',
              backdropFilter: scene.lightText ? 'none' : 'blur(8px)',
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

        {/* ── DEBRIEF PROMPT CARD ──────────────────── */}
        {debriefMeeting && (
          <div style={{
            padding:    '0 22px',
            marginBottom: 10,
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
        <div style={{ padding: '0 26px', ...anim(0.34) }}>
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
                  style={{
                    display:      'flex',
                    alignItems:   'flex-start',
                    gap:          10,
                    marginBottom: 9,
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

        {/* ── BOTTOM ROW ───────────────────────────── */}
        <div
          style={{
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'space-between',
            padding:        '20px 26px 44px',
            ...anim(0.42),
          }}
        >
          {/* Capture button — amber circle */}
          <button
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

          {/* Streak badge — center */}
          {streak && streak.currentStreak > 0 && (
            <StreakBadge days={streak.currentStreak} light />
          )}

          {/* Deals pill */}
          <button
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
            <span style={{
              fontFamily: "'Cormorant Garamond', serif",
              fontSize:   15,
              fontWeight: 400,
              color:      'rgba(240,235,224,0.78)',
            }}>
              Deals
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
            setHomeRefreshKey((k) => k + 1);
          }}
          initialMode={captureInitialMode ?? undefined}
          initialText={captureInitialText || undefined}
        />
      )}
    </div>
  );
}
