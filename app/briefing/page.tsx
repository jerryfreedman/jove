'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { calculateStreak } from '@/lib/streak';
import {
  COLORS,
} from '@/lib/design-system';
import { PULSE_CHECK_DEFAULT_DAYS } from '@/lib/constants';
import type {
  DealRow,
  MeetingRow,
  SignalRow,
  StreakLogRow,
} from '@/lib/types';
import CaptureSheet from '@/components/capture/CaptureSheet';

// ── HELPERS ────────────────────────────────────────────────
function getDaysSince(dateStr: string): number {
  return Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24)
  );
}

function formatMeetingTime(dateStr: string): string {
  const d    = new Date(dateStr);
  const now  = new Date();
  const h    = d.getHours();
  const m    = d.getMinutes().toString().padStart(2, '0');
  const h12  = h % 12 || 12;
  const ap   = h < 12 ? 'am' : 'pm';
  const time = `${h12}:${m} ${ap}`;

  const diffMs   = d.getTime() - now.getTime();
  const diffMins = Math.round(diffMs / 60000);

  if (diffMins < -60)  return `${time} · Completed`;
  if (diffMins < 0)    return `${time} · In progress`;
  if (diffMins < 60)   return `${time} · In ${diffMins} min`;
  const diffHrs = Math.round(diffMins / 60);
  return `${time} · In ${diffHrs}h`;
}

// ── BRIEFING TEXT FOR COPY ─────────────────────────────────
function buildBriefingText(
  meetings: MeetingRow[],
  attentionDeals: DealRow[],
  doThisFirst: string | null,
  accountMap: Record<string, string>
): string {
  const lines: string[] = [`TODAY'S BRIEFING — ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}\n`];

  if (meetings.length > 0) {
    lines.push('MEETINGS');
    for (const m of meetings) {
      lines.push(`• ${m.title} — ${formatMeetingTime(m.scheduled_at)}`);
    }
    lines.push('');
  }

  if (attentionDeals.length > 0) {
    lines.push('NEEDS ATTENTION');
    for (const d of attentionDeals) {
      const days = Math.floor(
        (Date.now() - new Date(d.last_activity_at).getTime()) / (1000 * 60 * 60 * 24)
      );
      lines.push(`• ${d.name} (${accountMap[d.account_id] ?? ''}) — ${days} days silent`);
    }
    lines.push('');
  }

  if (doThisFirst) {
    lines.push('DO THIS FIRST');
    lines.push(doThisFirst);
  }

  return lines.join('\n');
}

// ── COMPONENT ──────────────────────────────────────────────
export default function BriefingPage() {
  const router   = useRouter();
  const supabase = createClient();

  const [userId, setUserId]         = useState<string | null>(null);
  const [meetings, setMeetings]     = useState<MeetingRow[]>([]);
  const [attentionDeals, setAttentionDeals] = useState<DealRow[]>([]);
  const [allActiveDeals, setAllActiveDeals] = useState<DealRow[]>([]);
  const [todaySignals, setTodaySignals]   = useState<SignalRow[]>([]);
  const [streakLogs, setStreakLogs]   = useState<StreakLogRow[]>([]);
  const [accountMap, setAccountMap]   = useState<Record<string, string>>({});
  const [loading, setLoading]         = useState(true);

  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(new Set());
  const [snoozedIds, setSnoozedIds]     = useState<Set<string>>(new Set());

  const [doThisFirst, setDoThisFirst]   = useState<string | null>(null);
  const [doThisLoading, setDoThisLoading] = useState(true);

  const [showCapture, setShowCapture]   = useState(false);
  const [meetingTimes, setMeetingTimes] = useState<Record<string, string>>({});

  const [allClear, setAllClear]         = useState(false);
  const allClearTriggered = useRef(false);

  // ── FETCH DATA ─────────────────────────────────────────
  const fetchData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/'); return; }
    setUserId(user.id);

    const now      = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);
    const cutoff   = new Date();
    cutoff.setDate(cutoff.getDate() - PULSE_CHECK_DEFAULT_DAYS);
    const signalCutoff = new Date();
    signalCutoff.setHours(0, 0, 0, 0);

    const [
      meetingsRes,
      attentionRes,
      allDealsRes,
      signalsRes,
      streakRes,
      accountsRes,
    ] = await Promise.all([
      supabase
        .from('meetings')
        .select('*')
        .eq('user_id', user.id)
        .gte('scheduled_at', todayStart.toISOString())
        .lte('scheduled_at', todayEnd.toISOString())
        .order('scheduled_at', { ascending: true }),

      supabase
        .from('deals')
        .select('*')
        .eq('user_id', user.id)
        .not('stage', 'in', '("Closed Won","Closed Lost")')
        .lt('last_activity_at', cutoff.toISOString())
        .or(`snoozed_until.is.null,snoozed_until.lt.${now.toISOString()}`)
        .order('last_activity_at', { ascending: true })
        .limit(5),

      supabase
        .from('deals')
        .select('*')
        .eq('user_id', user.id)
        .not('stage', 'in', '("Closed Won","Closed Lost")')
        .order('intel_score', { ascending: false }),

      supabase
        .from('signals')
        .select('*')
        .eq('user_id', user.id)
        .gte('created_at', signalCutoff.toISOString())
        .eq('is_duplicate', false),

      supabase
        .from('streak_log')
        .select('*')
        .eq('user_id', user.id)
        .gte('log_date', new Date(Date.now() - 120 * 24 * 60 * 60 * 1000)
          .toISOString().split('T')[0])
        .order('log_date', { ascending: false }),

      supabase
        .from('accounts')
        .select('id, name')
        .eq('user_id', user.id),
    ]);

    const fetchedMeetings     = (meetingsRes.data     ?? []) as MeetingRow[];
    const fetchedAttention    = (attentionRes.data    ?? []) as DealRow[];
    const fetchedAllDeals     = (allDealsRes.data     ?? []) as DealRow[];
    const fetchedSignals      = (signalsRes.data      ?? []) as SignalRow[];
    const fetchedStreakLogs   = (streakRes.data       ?? []) as StreakLogRow[];
    const fetchedAccounts     = (accountsRes.data     ?? []) as { id: string; name: string }[];

    // Build account map
    const aMap: Record<string, string> = {};
    for (const a of fetchedAccounts) aMap[a.id] = a.name;

    setMeetings(fetchedMeetings);
    setAttentionDeals(fetchedAttention);
    setAllActiveDeals(fetchedAllDeals);
    setTodaySignals(fetchedSignals);
    setStreakLogs(fetchedStreakLogs);
    setAccountMap(aMap);

    // Init meeting time displays
    const times: Record<string, string> = {};
    for (const m of fetchedMeetings) {
      times[m.id] = formatMeetingTime(m.scheduled_at);
    }
    setMeetingTimes(times);

    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── CLOCK — update meeting times every 60s ────────────
  useEffect(() => {
    const interval = setInterval(() => {
      setMeetingTimes(() => {
        const updated: Record<string, string> = {};
        for (const meeting of meetings) {
          updated[meeting.id] = formatMeetingTime(meeting.scheduled_at);
        }
        return updated;
      });
    }, 60000);
    return () => clearInterval(interval);
  }, [meetings]);

  // ── DO THIS FIRST — async, cached ───────────────────
  useEffect(() => {
    const today    = new Date().toISOString().split('T')[0];
    const cacheKey = `jove_do_this_first_${today}`;
    const cached   = localStorage.getItem(cacheKey);

    if (cached) {
      setDoThisFirst(cached);
      setDoThisLoading(false);
      return;
    }

    // Wait for main data to load before generating
    if (loading) return;
    if (allActiveDeals.length === 0 && attentionDeals.length === 0) {
      setDoThisFirst(null);
      setDoThisLoading(false);
      return;
    }

    const generate = async () => {
      try {
        const topDeal = attentionDeals[0];
        const topMeeting = meetings[0];

        let context = '';
        if (topDeal) {
          const days = getDaysSince(topDeal.last_activity_at);
          const account = accountMap[topDeal.account_id] ?? 'your account';
          context += `Most urgent deal: "${topDeal.name}" at ${account} — ${days} days inactive, stage: ${topDeal.stage}. `;
        }
        if (topMeeting) {
          context += `Next meeting: "${topMeeting.title}" at ${formatMeetingTime(topMeeting.scheduled_at)}. `;
        }
        if (!context) {
          context = `${allActiveDeals.length} active deals in pipeline.`;
        }

        const response = await fetch('/api/do-this-first', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ context }),
        });

        if (response.ok) {
          const data = await response.json();
          const suggestion = data.suggestion ?? null;
          if (suggestion) {
            localStorage.setItem(cacheKey, suggestion);
            setDoThisFirst(suggestion);
          }
        }
      } catch {
        // Fail silently — this section is optional
      } finally {
        setDoThisLoading(false);
      }
    };

    generate();
  }, [loading, attentionDeals, allActiveDeals, meetings, accountMap]);

  // ── ALL CLEAR CHECK ──────────────────────────────────
  useEffect(() => {
    const remaining = attentionDeals.filter(
      d => !confirmedIds.has(d.id) && !snoozedIds.has(d.id)
    );
    if (
      !loading &&
      attentionDeals.length > 0 &&
      remaining.length === 0 &&
      !allClearTriggered.current
    ) {
      allClearTriggered.current = true;
      setAllClear(true);
      localStorage.setItem('jove_bloom_trigger', String(Date.now()));
    }
  }, [confirmedIds, snoozedIds, attentionDeals, loading]);

  // ── CONFIRM ACTION ───────────────────────────────────
  const handleConfirm = useCallback(async (dealId: string) => {
    setConfirmedIds(prev => { const next = new Set(prev); next.add(dealId); return next; });
    // Update orb on home screen
    localStorage.setItem('jove_bloom_trigger', String(Date.now()));
  }, []);

  // ── SNOOZE ───────────────────────────────────────────
  const handleSnooze = useCallback(async (dealId: string) => {
    if (!userId) return;
    setSnoozedIds(prev => { const next = new Set(prev); next.add(dealId); return next; });
    const snoozedUntil = new Date();
    snoozedUntil.setDate(snoozedUntil.getDate() + 3);
    await supabase
      .from('deals')
      .update({ snoozed_until: snoozedUntil.toISOString() })
      .eq('id', dealId)
      .eq('user_id', userId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // ── DERIVED VALUES ───────────────────────────────────
  const streak = calculateStreak(streakLogs);
  const avgIntelScore = allActiveDeals.length > 0
    ? Math.round(
        allActiveDeals.reduce((sum, d) => sum + (d.intel_score ?? 0), 0) /
        allActiveDeals.length
      )
    : 0;

  const visibleAttentionDeals = attentionDeals.filter(
    d => !confirmedIds.has(d.id) && !snoozedIds.has(d.id)
  );

  // ── SECTION CARD STYLE ───────────────────────────────
  const sectionLabel: React.CSSProperties = {
    fontSize:      9,
    fontWeight:    700,
    letterSpacing: '2.5px',
    textTransform: 'uppercase',
    color:         'rgba(26,20,16,0.28)',
    paddingBottom: 8,
    marginBottom:  14,
    borderBottom:  '0.5px solid rgba(200,160,80,0.2)',
  };

  // ── RENDER ───────────────────────────────────────────
  return (
    <div style={{
      minHeight:    '100vh',
      background:   '#F7F3EC',
      fontFamily:   "'DM Sans', sans-serif",
      maxWidth:     390,
      margin:       '0 auto',
      paddingBottom: 80,
    }}>

      {/* ── HEADER ─────────────────────────────────── */}
      <div style={{
        display:      'flex',
        alignItems:   'center',
        gap:          14,
        padding:      '52px 20px 16px',
        borderBottom: '0.5px solid rgba(200,160,80,0.16)',
        background:   '#F7F3EC',
        position:     'sticky',
        top:          0,
        zIndex:       20,
      }}>
        <button
          onClick={() => router.push('/home')}
          style={{
            width:          34,
            height:         34,
            borderRadius:   '50%',
            background:     'rgba(200,160,80,0.1)',
            border:         '0.5px solid rgba(200,160,80,0.22)',
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            cursor:         'pointer',
            color:          'rgba(26,20,16,0.5)',
            fontSize:       19,
            flexShrink:     0,
          }}
        >
          ‹
        </button>
        <h1 style={{
          flex:       1,
          fontFamily: "'Cormorant Garamond', serif",
          fontSize:   22,
          fontWeight: 400,
          color:      '#1A1410',
          margin:     0,
        }}>
          Today&apos;s Briefing
        </h1>
        <button
          onClick={() => {
            const text = buildBriefingText(
              meetings, visibleAttentionDeals, doThisFirst, accountMap
            );
            navigator.clipboard.writeText(text);
          }}
          style={{
            fontSize:      10,
            fontWeight:    600,
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
            color:         COLORS.amber,
            padding:       '6px 14px',
            borderRadius:  20,
            border:        '0.5px solid rgba(200,120,32,0.26)',
            background:    'transparent',
            cursor:        'pointer',
            fontFamily:    "'DM Sans', sans-serif",
          }}
        >
          Copy
        </button>
      </div>

      <div style={{ padding: '20px 18px 0' }}>

        {/* ── MEETINGS ─────────────────────────────── */}
        {meetings.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={sectionLabel}>Meetings</div>
            {meetings.map(meeting => (
              <div
                key={meeting.id}
                style={{
                  background:   '#FFFFFF',
                  borderLeft:   '3px solid rgba(56,184,200,0.52)',
                  borderRadius: '0 14px 14px 0',
                  padding:      '14px 17px',
                  marginBottom: 10,
                  boxShadow:    '0 2px 10px rgba(26,20,16,0.06)',
                }}
              >
                {/* Time */}
                <div style={{
                  display:      'flex',
                  alignItems:   'center',
                  gap:          7,
                  marginBottom: 7,
                }}>
                  <div style={{
                    width:        6,
                    height:       6,
                    borderRadius: '50%',
                    background:   COLORS.teal,
                    flexShrink:   0,
                  }} />
                  <span style={{
                    fontSize:      10,
                    fontWeight:    600,
                    letterSpacing: '1.5px',
                    textTransform: 'uppercase',
                    color:         'rgba(56,184,200,0.82)',
                  }}>
                    {meetingTimes[meeting.id] ?? formatMeetingTime(meeting.scheduled_at)}
                  </span>
                  {meeting.deal_id && (
                    <span style={{
                      fontSize:      9,
                      fontWeight:    600,
                      letterSpacing: '0.5px',
                      color:         COLORS.teal,
                      background:    'rgba(56,184,200,0.1)',
                      border:        '0.5px solid rgba(56,184,200,0.22)',
                      borderRadius:  20,
                      padding:       '2px 8px',
                      marginLeft:    'auto',
                    }}>
                      Deal linked
                    </span>
                  )}
                </div>

                {/* Title */}
                <div style={{
                  fontFamily:   "'Cormorant Garamond', serif",
                  fontSize:     18,
                  fontWeight:   400,
                  color:        '#1A1410',
                  marginBottom: meeting.attendees ? 5 : 10,
                }}>
                  {meeting.title}
                </div>

                {/* Attendees */}
                {meeting.attendees && (
                  <div style={{
                    fontSize:     12,
                    fontWeight:   300,
                    color:        'rgba(26,20,16,0.44)',
                    marginBottom: 10,
                  }}>
                    {meeting.attendees}
                  </div>
                )}

                {/* Prep Me */}
                <button
                  onClick={() => {
                    if (meeting.deal_id) {
                      router.push(`/deals/${meeting.deal_id}/prep`);
                    } else {
                      router.push(
                        `/prep?title=${encodeURIComponent(meeting.title)}`
                      );
                    }
                  }}
                  style={{
                    padding:       '8px 16px',
                    borderRadius:  9,
                    border:        '0.5px solid rgba(56,184,200,0.4)',
                    background:    'rgba(56,184,200,0.06)',
                    color:         COLORS.teal,
                    fontSize:      10,
                    fontWeight:    700,
                    letterSpacing: '1.5px',
                    textTransform: 'uppercase',
                    cursor:        'pointer',
                    fontFamily:    "'DM Sans', sans-serif",
                  }}
                >
                  Prep Me →
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── NEEDS ATTENTION ──────────────────────── */}
        {!loading && (
          <div style={{ marginBottom: 24 }}>
            <div style={sectionLabel}>Needs Attention</div>

            {/* All clear state */}
            {allClear || visibleAttentionDeals.length === 0 ? (
              <div style={{
                textAlign: 'center',
                padding:   '32px 0 16px',
              }}>
                <p style={{
                  fontFamily:   "'Cormorant Garamond', serif",
                  fontSize:     32,
                  fontWeight:   300,
                  color:        '#1A1410',
                  marginBottom: 6,
                }}>
                  All clear.
                </p>
                <p style={{
                  fontSize:   13,
                  fontWeight: 300,
                  color:      'rgba(26,20,16,0.44)',
                }}>
                  {attentionDeals.length > 0
                    ? 'Every deal has been reviewed.'
                    : 'All deals have confirmed next steps.'}
                </p>
              </div>
            ) : (
              visibleAttentionDeals.map(deal => {
                const days     = getDaysSince(deal.last_activity_at);
                const isUrgent = days > 14;
                const borderColor = isUrgent
                  ? 'rgba(224,88,64,0.56)'
                  : 'rgba(232,160,48,0.48)';
                const dotColor  = isUrgent ? COLORS.red : COLORS.amber;
                const textColor = isUrgent
                  ? 'rgba(224,88,64,0.82)'
                  : 'rgba(232,160,48,0.75)';

                return (
                  <div
                    key={deal.id}
                    style={{
                      background:   '#FFFFFF',
                      borderLeft:   `3px solid ${borderColor}`,
                      borderRadius: '0 14px 14px 0',
                      padding:      '14px 17px',
                      marginBottom: 10,
                      boxShadow:    '0 2px 10px rgba(26,20,16,0.06)',
                      animation:    confirmedIds.has(deal.id)
                        ? 'slideOut 0.3s ease forwards'
                        : 'none',
                    }}
                  >
                    {/* Deal header */}
                    <div style={{
                      display:      'flex',
                      alignItems:   'center',
                      gap:          7,
                      marginBottom: 7,
                    }}>
                      <div style={{
                        width:        6,
                        height:       6,
                        borderRadius: '50%',
                        background:   dotColor,
                        flexShrink:   0,
                        animation:    'dotBlink 2.5s ease-in-out infinite',
                      }} />
                      <span style={{
                        fontSize:      10,
                        fontWeight:    600,
                        letterSpacing: '1.5px',
                        textTransform: 'uppercase',
                        color:         textColor,
                      }}>
                        {accountMap[deal.account_id] ?? ''} · {days} days silent
                      </span>
                      {isUrgent && (
                        <span style={{
                          fontSize:      8,
                          fontWeight:    700,
                          letterSpacing: '1px',
                          textTransform: 'uppercase',
                          background:    'rgba(224,88,64,0.1)',
                          color:         'rgba(224,88,64,0.88)',
                          padding:       '2px 7px',
                          borderRadius:  20,
                          marginLeft:    'auto',
                        }}>
                          urgent
                        </span>
                      )}
                    </div>

                    {/* Deal name */}
                    <div style={{
                      fontFamily:   "'Cormorant Garamond', serif",
                      fontSize:     18,
                      fontWeight:   400,
                      color:        '#1A1410',
                      marginBottom: 5,
                    }}>
                      {deal.name}
                    </div>

                    {/* Stage */}
                    <div style={{
                      fontSize:     12,
                      fontWeight:   300,
                      color:        'rgba(26,20,16,0.44)',
                      marginBottom: 12,
                    }}>
                      {deal.stage} · {deal.next_action ?? 'No next action set'}
                    </div>

                    {/* Action buttons */}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => handleConfirm(deal.id)}
                        style={{
                          flex:          1,
                          padding:       '9px 0',
                          borderRadius:  9,
                          textAlign:     'center',
                          background:    isUrgent
                            ? 'rgba(224,88,64,0.08)'
                            : 'rgba(232,160,48,0.08)',
                          border:        `0.5px solid ${isUrgent
                            ? 'rgba(224,88,64,0.3)'
                            : 'rgba(232,160,48,0.3)'}`,
                          color:         isUrgent ? COLORS.red : COLORS.amber,
                          fontSize:      9,
                          fontWeight:    700,
                          letterSpacing: '1.5px',
                          textTransform: 'uppercase',
                          cursor:        'pointer',
                          fontFamily:    "'DM Sans', sans-serif",
                          transition:    'all 0.2s',
                        }}
                      >
                        ✓  Confirm
                      </button>
                      <button
                        onClick={() => handleSnooze(deal.id)}
                        style={{
                          padding:       '9px 14px',
                          borderRadius:  9,
                          background:    'rgba(26,20,16,0.04)',
                          border:        '0.5px solid rgba(26,20,16,0.1)',
                          color:         'rgba(26,20,16,0.3)',
                          fontSize:      9,
                          fontWeight:    500,
                          letterSpacing: '1px',
                          textTransform: 'uppercase',
                          cursor:        'pointer',
                          fontFamily:    "'DM Sans', sans-serif",
                        }}
                      >
                        Snooze
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ── DO THIS FIRST ─────────────────────────── */}
        <div style={{ marginBottom: 24 }}>
          <div style={sectionLabel}>Do This First</div>
          <div style={{
            background:   '#FFFFFF',
            borderLeft:   '3px solid rgba(232,160,48,0.62)',
            borderRadius: '0 14px 14px 0',
            padding:      '16px 18px',
            boxShadow:    '0 2px 10px rgba(26,20,16,0.06)',
            minHeight:    60,
          }}>
            <div style={{
              fontSize:      9,
              fontWeight:    700,
              letterSpacing: '2px',
              textTransform: 'uppercase',
              color:         COLORS.amber,
              marginBottom:  9,
            }}>
              One thing
            </div>
            {doThisLoading ? (
              <div style={{
                height:       12,
                borderRadius: 6,
                background:   'rgba(26,20,16,0.06)',
                animation:    'shimmer 1.5s ease-in-out infinite',
                width:        '85%',
              }} />
            ) : doThisFirst ? (
              <p style={{
                fontSize:   14,
                fontWeight: 300,
                color:      'rgba(26,20,16,0.52)',
                lineHeight: 1.72,
                margin:     0,
              }}>
                {doThisFirst}
              </p>
            ) : (
              <p style={{
                fontSize:   14,
                fontWeight: 300,
                color:      'rgba(26,20,16,0.36)',
                lineHeight: 1.72,
                margin:     0,
              }}>
                Capture something to generate your first priority.
              </p>
            )}
          </div>
        </div>

        {/* ── INTELLIGENCE STATS ────────────────────── */}
        <div style={{
          display:      'flex',
          border:       '0.5px solid rgba(200,160,80,0.2)',
          borderRadius: 14,
          overflow:     'hidden',
          marginBottom: 20,
        }}>
          {[
            {
              n:     todaySignals.length,
              label: 'New Signals',
              color: todaySignals.length > 0 ? COLORS.amber : undefined,
            },
            {
              n:     avgIntelScore,
              label: 'Intel Score',
              color: undefined,
            },
            {
              n:     `↑${streak.currentStreak}`,
              label: 'Streak',
              color: COLORS.green,
            },
          ].map((stat, i) => (
            <div
              key={stat.label}
              style={{
                flex:        1,
                padding:     '14px 0',
                textAlign:   'center',
                borderRight: i < 2
                  ? '0.5px solid rgba(200,160,80,0.15)'
                  : 'none',
                background:  '#FFFFFF',
              }}
            >
              <div style={{
                fontSize:   22,
                fontWeight: 300,
                color:      stat.color ?? COLORS.amber,
              }}>
                {stat.n}
              </div>
              <div style={{
                fontSize:      9,
                fontWeight:    600,
                letterSpacing: '1px',
                textTransform: 'uppercase',
                color:         'rgba(26,20,16,0.28)',
                marginTop:     3,
              }}>
                {stat.label}
              </div>
            </div>
          ))}
        </div>

        {/* ── CAPTURE SHORTCUT ─────────────────────── */}
        <div
          onClick={() => setShowCapture(true)}
          style={{
            display:      'flex',
            alignItems:   'center',
            gap:          12,
            background:   '#FFFFFF',
            border:       '0.5px solid rgba(200,160,80,0.2)',
            borderRadius: 14,
            padding:      '14px 16px',
            cursor:       'pointer',
            boxShadow:    '0 2px 8px rgba(26,20,16,0.05)',
            marginBottom: 20,
          }}
        >
          <div style={{
            width:          34,
            height:         34,
            borderRadius:   '50%',
            background:     'linear-gradient(135deg, #C87820, #E09838)',
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            flexShrink:     0,
            boxShadow:      '0 4px 12px rgba(200,120,32,0.28)',
          }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <line x1="7" y1="2" x2="7" y2="12"
                stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
              <line x1="2" y1="7" x2="12" y2="7"
                stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </div>
          <div>
            <div style={{
              fontSize:   13,
              fontWeight: 500,
              color:      '#1A1410',
            }}>
              Capture something
            </div>
            <div style={{
              fontSize:   11,
              fontWeight: 300,
              color:      'rgba(26,20,16,0.36)',
              marginTop:  2,
            }}>
              Debrief · Email · Draft · Idea
            </div>
          </div>
        </div>

      </div>

      {/* ── CAPTURE SHEET ────────────────────────────── */}
      {showCapture && userId && (
        <CaptureSheet
          onClose={() => setShowCapture(false)}
          userId={userId}
          activeDeals={allActiveDeals}
          onCaptureComplete={() => {
            setShowCapture(false);
            fetchData();
          }}
        />
      )}

      <style>{`
        @keyframes shimmer {
          0%,100% { opacity: 0.4; }
          50%      { opacity: 1; }
        }
        @keyframes slideOut {
          from { opacity: 1; transform: translateX(0) scaleY(1); max-height: 200px; }
          to   { opacity: 0; transform: translateX(20px) scaleY(0); max-height: 0; overflow: hidden; }
        }
        @keyframes dotBlink {
          0%,100% { opacity: 1; }
          50%      { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
