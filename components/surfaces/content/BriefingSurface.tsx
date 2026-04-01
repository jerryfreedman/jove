'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createClient } from '@/lib/supabase';
import { useMeetingStore } from '@/lib/meeting-store';
import { calculateStreak } from '@/lib/streak';
import {
  COLORS,
} from '@/lib/design-system';
import { PULSE_CHECK_DEFAULT_DAYS } from '@/lib/constants';
import type {
  DealRow,
  MeetingRow,
  SignalRow,
  InteractionRow,
  StreakLogRow,
} from '@/lib/types';
import CaptureSheet from '@/components/capture/CaptureSheet';
import { useSurface } from '@/components/surfaces/SurfaceManager';
import { useMeetingActions } from '@/lib/meeting-actions';
import MeetingRowActions from '@/components/meetings/MeetingRowActions';
import RescheduleSheet from '@/components/meetings/RescheduleSheet';
import MeetingActionToast from '@/components/meetings/MeetingActionToast';

// ── MEETING LIFECYCLE ─────────────────────────────────────
type MeetingState = 'upcoming' | 'in_progress' | 'completed';

function getMeetingState(meeting: MeetingRow): MeetingState {
  const now = Date.now();
  const start = new Date(meeting.scheduled_at).getTime();
  const end = start + 60 * 60 * 1000; // +60 minutes

  if (now < start) return 'upcoming';
  if (now <= end)  return 'in_progress';
  return 'completed';
}

// ── HELPERS ────────────────────────────────────────────────
function getDaysSince(dateStr: string): number {
  return Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24)
  );
}

function formatMeetingTime(meeting: MeetingRow): string {
  const d    = new Date(meeting.scheduled_at);
  const h    = d.getHours();
  const m    = d.getMinutes().toString().padStart(2, '0');
  const h12  = h % 12 || 12;
  const ap   = h < 12 ? 'am' : 'pm';
  const time = `${h12}:${m} ${ap}`;

  const state = getMeetingState(meeting);

  if (state === 'completed')   return `${time} · Completed`;
  if (state === 'in_progress') return `${time} · In progress`;

  // upcoming — show relative time
  const diffMs   = d.getTime() - Date.now();
  const diffMins = Math.round(diffMs / 60000);
  if (diffMins < 60) return `${time} · In ${diffMins} min`;
  const diffHrs = Math.round(diffMins / 60);
  return `${time} · In ${diffHrs}h`;
}

// ── WEAK CONTEXT DETECTION ────────────────────────────────
function isWeakContext(
  meeting: MeetingRow,
  signals: SignalRow[],
  interactions: InteractionRow[],
): boolean {
  if (!meeting.deal_id) return true;

  const dealSignals = signals.filter(s => s.deal_id === meeting.deal_id);
  const dealInteractions = interactions.filter(i => i.deal_id === meeting.deal_id);

  if (dealSignals.length === 0 && dealInteractions.length === 0) return true;

  return false;
}

// ── CURIOSITY QUESTION PICKER ─────────────────────────────
function pickCuriosityQuestion(meeting: MeetingRow): string {
  if (!meeting.attendees) return "Who's joining this call?";
  return "What's the goal for this meeting?";
}

// ── MEETING ASSISTANT STATE ──────────────────────────────
interface MeetingAssistantState {
  lifecycle: MeetingState;
  has_strong_brief: boolean;
  needs_brief_context: boolean;
  needs_debrief_context: boolean;
  debrief_done: boolean;
}

function deriveMeetingAssistantState(
  meeting: MeetingRow,
  signals: SignalRow[],
  interactions: InteractionRow[],
): MeetingAssistantState {
  const lifecycle = getMeetingState(meeting);
  const weak = isWeakContext(meeting, signals, interactions);
  const minsUntil = (new Date(meeting.scheduled_at).getTime() - Date.now()) / 60000;

  return {
    lifecycle,
    has_strong_brief: !!meeting.deal_id && !weak,
    needs_brief_context: lifecycle === 'upcoming' && weak && minsUntil > 10,
    needs_debrief_context: lifecycle === 'completed' && !meeting.debrief_completed,
    debrief_done: meeting.debrief_completed === true,
  };
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
      lines.push(`• ${m.title} — ${formatMeetingTime(m)}`);
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
export default function BriefingSurface() {
  const { navigateTo, goBack } = useSurface();
  const supabase = createClient();

  const [userId, setUserId]         = useState<string | null>(null);
  const [meetings, setMeetings]     = useState<MeetingRow[]>([]);
  const [attentionDeals, setAttentionDeals] = useState<DealRow[]>([]);
  const [allActiveDeals, setAllActiveDeals] = useState<DealRow[]>([]);
  const [todaySignals, setTodaySignals]   = useState<SignalRow[]>([]);
  const [streakLogs, setStreakLogs]   = useState<StreakLogRow[]>([]);
  const [accountMap, setAccountMap]   = useState<Record<string, string>>({});
  const [loading, setLoading]         = useState(true);
  const [fetchError, setFetchError]   = useState(false);

  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(new Set());
  const [snoozedIds, setSnoozedIds]     = useState<Set<string>>(new Set());

  const [doThisFirst, setDoThisFirst]   = useState<string | null>(null);
  const [doThisLoading, setDoThisLoading] = useState(true);

  const [showCapture, setShowCapture]   = useState(false);
  const [captureMeetingContext, setCaptureMeetingContext] = useState<string | null>(null);
  const [captureMeetingId, setCaptureMeetingId] = useState<string | undefined>(undefined);
  const [meetingTimes, setMeetingTimes] = useState<Record<string, string>>({});

  const [allClear, setAllClear]         = useState(false);
  const allClearTriggered = useRef(false);
  const briefingInteracted = useRef(false);

  // Inline expansion state
  const [expandedMeetingId, setExpandedMeetingId] = useState<string | null>(null);
  const [inlineBriefs, setInlineBriefs] = useState<Record<string, string>>({});
  const [briefLoading, setBriefLoading] = useState<Record<string, boolean>>({});
  const [showCompleted, setShowCompleted] = useState(false);

  // Tick counter — forces meeting-state re-derivation every 60s
  const [tick, setTick] = useState(0);

  // Hero brief state (auto-fetched on page load for next meeting only)
  const [heroBrief, setHeroBrief] = useState<string | null>(null);
  const [heroBriefLoading, setHeroBriefLoading] = useState(false);

  // Curiosity question state
  const [curiosityAnswer, setCuriosityAnswer] = useState('');
  const [curiositySubmitting, setCuriositySubmitting] = useState(false);
  const [curiosityDismissed, setCuriosityDismissed] = useState(false);

  // Deal interactions for weak context detection
  const [dealInteractions, setDealInteractions] = useState<InteractionRow[]>([]);

  // Abort ref for inline brief streaming
  const briefAbortRef = useRef<AbortController | null>(null);

  // Session 8: Meeting actions (shared layer)
  const { completeMeeting: completeAction, cancelMeeting: cancelAction, rescheduleMeeting: rescheduleAction } = useMeetingActions();
  const [rescheduleTarget, setRescheduleTarget] = useState<{
    meetingId: string;
    title: string;
    startTime: number;
  } | null>(null);

  const handleRescheduleOpen = useCallback((meetingId: string) => {
    const row = meetings.find(m => m.id === meetingId);
    const title = row?.title ?? 'Meeting';
    const startTime = row ? new Date(row.scheduled_at).getTime() : Date.now();
    setRescheduleTarget({ meetingId, title, startTime });
  }, [meetings]);

  const handleRescheduleConfirm = useCallback((newTime: number) => {
    if (!rescheduleTarget) return;
    rescheduleAction(rescheduleTarget.meetingId, newTime);
    setRescheduleTarget(null);
  }, [rescheduleTarget, rescheduleAction]);

  // ── FETCH DATA ─────────────────────────────────────────
  const fetchData = useCallback(async () => {
    try {
    setFetchError(false);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { window.location.href = '/'; return; }
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
      interactionsRes,
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

      supabase
        .from('interactions')
        .select('*')
        .eq('user_id', user.id),
    ]);

    const fetchedMeetings     = (meetingsRes.data     ?? []) as MeetingRow[];
    const fetchedAttention    = (attentionRes.data    ?? []) as DealRow[];
    const fetchedAllDeals     = (allDealsRes.data     ?? []) as DealRow[];
    const fetchedSignals      = (signalsRes.data      ?? []) as SignalRow[];
    const fetchedStreakLogs   = (streakRes.data       ?? []) as StreakLogRow[];
    const fetchedAccounts     = (accountsRes.data     ?? []) as { id: string; name: string }[];
    const fetchedInteractions = (interactionsRes.data ?? []) as InteractionRow[];

    // Build account map
    const aMap: Record<string, string> = {};
    for (const a of fetchedAccounts) aMap[a.id] = a.name;

    // Session 7: Ingest into meeting store and filter out cancelled/completed
    useMeetingStore.getState().ingestMeetings(fetchedMeetings);
    const storeState = useMeetingStore.getState().meetings;
    const filteredMeetings = fetchedMeetings.filter(m => {
      const sm = storeState[m.id];
      return !sm || sm.status === 'scheduled';
    });
    setMeetings(filteredMeetings);
    setAttentionDeals(fetchedAttention);
    setAllActiveDeals(fetchedAllDeals);
    setTodaySignals(fetchedSignals);
    setStreakLogs(fetchedStreakLogs);
    setAccountMap(aMap);
    setDealInteractions(fetchedInteractions);

    // Init meeting time displays
    const times: Record<string, string> = {};
    for (const m of fetchedMeetings) {
      times[m.id] = formatMeetingTime(m);
    }
    setMeetingTimes(times);

    } catch (err) {
      console.error('Briefing fetch error:', err);
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    // Phase 6: Clean up stale meeting_prompt_ack_ keys older than 24 hours
    const ACK_TTL_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('meeting_prompt_ack_')) {
        const val = localStorage.getItem(key);
        // If stored as 'true' (no timestamp), check if old brief_ keys exist for same date
        // Simplest approach: store timestamp going forward, treat 'true' as stale
        if (val === 'true') {
          // Migrate: replace 'true' with timestamp
          localStorage.setItem(key, String(now));
        } else if (val) {
          const storedAt = parseInt(val, 10);
          if (!isNaN(storedAt) && (now - storedAt) > ACK_TTL_MS) {
            keysToRemove.push(key);
          }
        }
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
  }, []);

  // ── CLOCK — update meeting times + re-derive state every 60s ──
  useEffect(() => {
    const interval = setInterval(() => {
      setMeetingTimes(() => {
        const updated: Record<string, string> = {};
        for (const meeting of meetings) {
          updated[meeting.id] = formatMeetingTime(meeting);
        }
        return updated;
      });
      // Bump tick to re-derive meeting groups from scheduled_at
      setTick(t => t + 1);
    }, 60000);
    return () => clearInterval(interval);
  }, [meetings]);

  // ── HERO BRIEF — cache-first micro brief with weak context detection ──
  useEffect(() => {
    if (loading || !userId) return;

    // Find next upcoming/in-progress meeting
    const heroMeeting = meetings.find(m => {
      const state = getMeetingState(m);
      return state === 'upcoming' || state === 'in_progress';
    });

    if (!heroMeeting) return;

    // Check if curiosity question was already answered for this meeting
    const questionKey = `question_answered_${heroMeeting.id}`;
    if (localStorage.getItem(questionKey)) {
      setCuriosityDismissed(true);
    }

    // Check if meeting_prompt_ack_ is set (value is timestamp or legacy 'true')
    const ackKey = `meeting_prompt_ack_${heroMeeting.id}`;
    const ackVal = localStorage.getItem(ackKey);
    if (ackVal) {
      setCuriosityDismissed(true);
    }

    // No deal — can't generate brief, show fallback
    if (!heroMeeting.deal_id) return;

    // Check micro brief cache first (instant render)
    // Phase 4: Include deal updated_at in cache key for auto-invalidation
    const today = new Date().toISOString().split('T')[0];
    const dealForCache = allActiveDeals.find(d => d.id === heroMeeting.deal_id);
    const dealUpdatedSuffix = dealForCache?.updated_at
      ? `_${new Date(dealForCache.updated_at).getTime()}`
      : '';
    const microCacheKey = `brief_${heroMeeting.id}_${today}${dealUpdatedSuffix}`;
    const cachedMicro = localStorage.getItem(microCacheKey);
    if (cachedMicro) {
      setHeroBrief(cachedMicro);
      setInlineBriefs(prev => ({ ...prev, [heroMeeting.id]: cachedMicro }));
      return;
    }

    // Also check the full brief cache (backward compat)
    const fullCacheKey = `jove_prep_${heroMeeting.deal_id}_${today}`;
    const cachedFull = localStorage.getItem(fullCacheKey);
    if (cachedFull) {
      const brief = extractBriefSummary(cachedFull);
      setHeroBrief(brief);
      setInlineBriefs(prev => ({ ...prev, [heroMeeting.id]: brief }));
      // Also store as micro cache for next instant load
      localStorage.setItem(microCacheKey, brief);
      return;
    }

    // Fetch deal interactions for weak context check
    const checkAndFetch = async () => {
      // Fetch signals + interactions for this deal to check weak context
      const [sigRes, intRes] = await Promise.all([
        supabase
          .from('signals')
          .select('*')
          .eq('deal_id', heroMeeting.deal_id!)
          .eq('user_id', userId)
          .eq('is_duplicate', false)
          .limit(10),
        supabase
          .from('interactions')
          .select('*')
          .eq('deal_id', heroMeeting.deal_id!)
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(5),
      ]);

      const dealSigs = (sigRes.data ?? []) as SignalRow[];
      const dealInts = (intRes.data ?? []) as InteractionRow[];
      setDealInteractions(dealInts);

      // Check if context is weak
      const weak = isWeakContext(heroMeeting, dealSigs, dealInts);
      if (weak) {
        // Don't generate — show curiosity question instead (unless within 10 min)
        const minsUntil = (new Date(heroMeeting.scheduled_at).getTime() - Date.now()) / 60000;
        if (minsUntil > 10) {
          // Weak context — curiosity mode (no brief generation)
          return;
        }
        // Within 10 min — fallback, no question
        return;
      }

      // Check if meeting is within 12 hours
      const hoursUntil = (new Date(heroMeeting.scheduled_at).getTime() - Date.now()) / 3600000;
      if (hoursUntil > 12) return;

      // Strong context — generate micro brief (pass meetingId for attendee awareness)
      setHeroBriefLoading(true);
      try {
        const response = await fetch('/api/prep', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dealId: heroMeeting.deal_id, userId, mode: 'micro', meetingId: heroMeeting.id }),
        });
        if (response.ok) {
          const data = await response.json();
          if (data.summary) {
            localStorage.setItem(microCacheKey, data.summary);
            setHeroBrief(data.summary);
            setInlineBriefs(prev => ({ ...prev, [heroMeeting.id]: data.summary }));
          }
          // Phase 2: null summary = insufficient context, leave heroBrief as null (fallback UI)
        }
      } catch {
        // Fail silently — fallback UI handles this
      } finally {
        setHeroBriefLoading(false);
      }
    };

    checkAndFetch();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, userId, meetings]);

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
          context += `Next meeting: "${topMeeting.title}" at ${formatMeetingTime(topMeeting)}. `;
        }
        if (!context) {
          context = `${allActiveDeals.length} active deals in pipeline.`;
        }

        // Fetch recent briefing summaries for memory context
        // Session 4: filter by category to exclude chat_summary rows
        const { data: recentSummaries } = await supabase
          .from('thread_summaries')
          .select('content, summary_date, confirmed_action_ids, snoozed_action_ids')
          .eq('user_id', userId!)
          .or('category.eq.briefing_summary,category.is.null')
          .order('summary_date', { ascending: false })
          .limit(3);

        const historyContext = recentSummaries?.length
          ? `\nRecent history: ${recentSummaries.map(s => s.content).join(' ')}`
          : '';

        const response = await fetch('/api/do-this-first', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ context: context + historyContext, userId }),
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, attentionDeals, allActiveDeals, meetings, accountMap, userId]);

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

  // ── TRACK INTERACTION ──────────────────────────────────
  useEffect(() => {
    if (confirmedIds.size > 0 || snoozedIds.size > 0) {
      briefingInteracted.current = true;
    }
  }, [confirmedIds, snoozedIds]);

  // ── SAVE BRIEFING SUMMARY ON UNMOUNT ─────────────────
  const userIdRef = useRef(userId);
  const confirmedRef = useRef(confirmedIds);
  const snoozedRef = useRef(snoozedIds);
  const meetingsRef = useRef(meetings);
  const attentionRef = useRef(attentionDeals);

  useEffect(() => { userIdRef.current = userId; }, [userId]);
  useEffect(() => { confirmedRef.current = confirmedIds; }, [confirmedIds]);
  useEffect(() => { snoozedRef.current = snoozedIds; }, [snoozedIds]);
  useEffect(() => { meetingsRef.current = meetings; }, [meetings]);
  useEffect(() => { attentionRef.current = attentionDeals; }, [attentionDeals]);

  useEffect(() => {
    return () => {
      if (!briefingInteracted.current) return;
      if (!userIdRef.current) return;
      fetch('/api/save-briefing-summary', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId:         userIdRef.current,
          confirmedIds:   Array.from(confirmedRef.current),
          snoozedIds:     Array.from(snoozedRef.current),
          meetingCount:   meetingsRef.current.length,
          attentionCount: attentionRef.current.length,
        }),
      }).catch(console.error);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // ── INLINE BRIEF FETCH (on expand, deal-linked only) ──
  const fetchInlineBrief = useCallback(async (meeting: MeetingRow) => {
    if (!meeting.deal_id || !userId) return;
    if (inlineBriefs[meeting.id]) return; // already fetched

    // Check localStorage cache first
    const today = new Date().toISOString().split('T')[0];
    const cacheKey = `jove_prep_${meeting.deal_id}_${today}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      // Extract first 2 sentences for inline display
      const brief = extractBriefSummary(cached);
      setInlineBriefs(prev => ({ ...prev, [meeting.id]: brief }));
      return;
    }

    setBriefLoading(prev => ({ ...prev, [meeting.id]: true }));

    const controller = new AbortController();
    briefAbortRef.current = controller;

    try {
      const response = await fetch('/api/prep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dealId: meeting.deal_id, userId, meetingId: meeting.id }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        setBriefLoading(prev => ({ ...prev, [meeting.id]: false }));
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });
      }

      // Cache the full brief
      localStorage.setItem(cacheKey, fullText);

      // Extract 1-2 sentence summary for inline
      const brief = extractBriefSummary(fullText);
      setInlineBriefs(prev => ({ ...prev, [meeting.id]: brief }));
    } catch (err: unknown) {
      if ((err as Error).name !== 'AbortError') {
        // Fail silently
      }
    } finally {
      setBriefLoading(prev => ({ ...prev, [meeting.id]: false }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, inlineBriefs]);

  // Extract the SITUATION section as 1-2 sentence brief
  function extractBriefSummary(fullBrief: string): string {
    // Try to extract SITUATION section
    const situationMatch = fullBrief.match(/\*\*SITUATION\*\*\s*\n([\s\S]*?)(?=\n\*\*|$)/);
    if (situationMatch) {
      const text = situationMatch[1].trim();
      // Take first 2 sentences
      const sentences = text.match(/[^.!?]+[.!?]+/g);
      if (sentences && sentences.length > 0) {
        return sentences.slice(0, 2).join('').trim();
      }
      return text.slice(0, 200);
    }
    // Fallback: first 2 sentences of the whole thing
    const sentences = fullBrief.match(/[^.!?]+[.!?]+/g);
    if (sentences && sentences.length > 0) {
      return sentences.slice(0, 2).join('').trim();
    }
    return fullBrief.slice(0, 200);
  }

  // ── HANDLE MEETING TAP (toggle inline expansion) ─────
  const handleMeetingTap = useCallback((meeting: MeetingRow) => {
    if (expandedMeetingId === meeting.id) {
      setExpandedMeetingId(null);
      briefAbortRef.current?.abort();
      return;
    }
    setExpandedMeetingId(meeting.id);
    // Fetch brief on expand if deal-linked
    if (meeting.deal_id) {
      fetchInlineBrief(meeting);
    }
  }, [expandedMeetingId, fetchInlineBrief]);

  // ── HANDLE ADD CONTEXT ────────────────────────────────
  const handleAddContext = useCallback((meeting: MeetingRow) => {
    setCaptureMeetingContext(meeting.title);
    setCaptureMeetingId(meeting.id);
    setShowCapture(true);
  }, []);

  // ── CURIOSITY QUESTION SUBMIT ────────────────────────
  const handleCuriositySubmit = useCallback(async (meeting: MeetingRow) => {
    if (!curiosityAnswer.trim() || !userId || curiositySubmitting) return;

    setCuriositySubmitting(true);

    try {
      // 1. Save as interaction (note type) — capture the returned ID
      const { data: insertedInteraction } = await supabase.from('interactions').insert({
        user_id: userId,
        deal_id: meeting.deal_id ?? null,
        type: 'note' as const,
        raw_content: curiosityAnswer.trim(),
        extraction_status: 'pending' as const,
        // ── Session 2: Memory upgrade fields ──
        source_surface: 'briefing' as const,
        origin: 'user' as const,
        intent_type: 'clarification' as const,
        meeting_id: meeting.id,
      }).select('id').single();

      // 2. Mark question as answered (never show again for this meeting)
      localStorage.setItem(`question_answered_${meeting.id}`, 'true');
      localStorage.setItem(`meeting_prompt_ack_${meeting.id}`, String(Date.now()));
      setCuriosityDismissed(true);
      setCuriosityAnswer('');

      // 3. Trigger extraction if deal exists AND we got the interaction ID
      if (meeting.deal_id && insertedInteraction?.id) {
        fetch('/api/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            interactionId: insertedInteraction.id,
            userId,
          }),
        }).catch(() => { /* background, non-blocking */ });

        // 4. Regenerate micro brief now that we have context (pass meetingId)
        const today = new Date().toISOString().split('T')[0];
        const dealForCache = allActiveDeals.find(d => d.id === meeting.deal_id);
        const dealUpdatedSuffix = dealForCache?.updated_at
          ? `_${new Date(dealForCache.updated_at).getTime()}`
          : '';
        const microCacheKey = `brief_${meeting.id}_${today}${dealUpdatedSuffix}`;

        setHeroBriefLoading(true);
        try {
          const response = await fetch('/api/prep', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-no-cache': 'true' },
            body: JSON.stringify({ dealId: meeting.deal_id, userId, mode: 'micro', meetingId: meeting.id }),
          });
          if (response.ok) {
            const data = await response.json();
            if (data.summary) {
              localStorage.setItem(microCacheKey, data.summary);
              setHeroBrief(data.summary);
              setInlineBriefs(prev => ({ ...prev, [meeting.id]: data.summary }));
            }
            // null summary = still insufficient context, fallback UI handles this
          }
        } catch {
          // Fail silently — fallback UI handles this
        } finally {
          setHeroBriefLoading(false);
        }
      }
    } catch {
      // Fail silently — never show error to user
    } finally {
      setCuriositySubmitting(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curiosityAnswer, userId, curiositySubmitting]);

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

  // Build context lines for needs attention deals
  const dealContextMap = useMemo(() => {
    const ctx: Record<string, string> = {};
    for (const deal of attentionDeals) {
      // Find the most recent signal for this deal
      const dealSignals = todaySignals
        .filter(s => s.deal_id === deal.id)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      if (dealSignals.length > 0) {
        const signal = dealSignals[0];
        // Show signal type and a snippet of content
        const snippet = signal.content.length > 60
          ? signal.content.slice(0, 57) + '...'
          : signal.content;
        ctx[deal.id] = `Signal: ${snippet}`;
      } else {
        // Fallback: show last activity timing
        const days = getDaysSince(deal.last_activity_at);
        ctx[deal.id] = `Last activity: ${days} days ago`;
      }
    }
    return ctx;
  }, [attentionDeals, todaySignals]);

  // ── MEETING GROUPS (lifecycle-aware) ─────────────────
  const { nextMeeting, upcomingMeetings, completedMeetings } = useMemo(() => {
    const upcoming: MeetingRow[] = [];
    const completed: MeetingRow[] = [];

    for (const m of meetings) {
      const state = getMeetingState(m);
      if (state === 'upcoming' || state === 'in_progress') {
        upcoming.push(m);
      } else {
        completed.push(m);
      }
    }

    // The first upcoming/in-progress meeting is the "next" one
    const next = upcoming.length > 0 ? upcoming[0] : null;
    const rest = upcoming.slice(1);

    return {
      nextMeeting: next,
      upcomingMeetings: rest,
      completedMeetings: completed,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetings, tick]);

  // ── PHASE 2: Track if hero is showing an assistant question — prevents duplicates elsewhere ──
  const heroShowingQuestion = (() => {
    if (!nextMeeting) return false;
    const minsUntil = (new Date(nextMeeting.scheduled_at).getTime() - Date.now()) / 60000;
    const weak = nextMeeting.deal_id
      ? isWeakContext(nextMeeting, todaySignals.filter(s => s.deal_id === nextMeeting.deal_id), dealInteractions)
      : true;
    return weak && !heroBrief && !curiosityDismissed && minsUntil > 10 && !!nextMeeting.deal_id;
  })();

  // ── SECTION CARD STYLE ───────────────────────────────
  const sectionLabel: React.CSSProperties = {
    fontSize:      9,
    fontWeight:    700,
    letterSpacing: '2.5px',
    textTransform: 'uppercase',
    color:         'rgba(252,246,234,0.28)',
    paddingBottom: 8,
    marginBottom:  14,
    borderBottom:  '0.5px solid rgba(200,160,80,0.2)',
  };

  // ── RENDER ───────────────────────────────────────────
  return (
    <>
    <div style={{
      display:      'flex',
      flexDirection: 'column',
      height:       '100%',
      overflow:     'hidden',
      fontFamily:   "'DM Sans', sans-serif",
    }}>
      {/* ── HEADER ─────────────────────────────────── */}
      <div style={{
        flexShrink:   0,
        display:      'flex',
        alignItems:   'center',
        gap:          14,
        paddingTop:   '12px',
        paddingLeft:  '20px',
        paddingRight: '20px',
        paddingBottom: '16px',
        borderBottom: '0.5px solid rgba(200,160,80,0.16)',
        background:   'transparent',
        zIndex:       20,
      }}>
        <button
          onClick={() => goBack()}
          style={{
            width:          34,
            height:         34,
            borderRadius:   '50%',
            background:     'rgba(240,235,224,0.06)',
            border:         '0.5px solid rgba(200,160,80,0.22)',
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            cursor:         'pointer',
            color:          'rgba(252,246,234,0.5)',
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
          color:      'rgba(252,246,234,1)',
          margin:     0,
        }}>
          Today
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

      {/* ── ZONE 2: SCROLLABLE CONTENT ─────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', background: 'transparent' }}>

      {/* ── ERROR STATE ─────────────────────────── */}
      {fetchError && (
        <div style={{
          textAlign:  'center',
          padding:    '80px 32px',
        }}>
          <p style={{
            fontFamily: "'Cormorant Garamond', serif",
            fontSize:   22,
            fontWeight: 300,
            color:      'rgba(252,246,234,0.44)',
            marginBottom:14,
          }}>
            Couldn&apos;t load your briefing.
          </p>
          <button
            onClick={() => { setLoading(true); fetchData(); }}
            style={{
              padding:       '10px 24px',
              borderRadius:  10,
              border:        '0.5px solid rgba(232,160,48,0.4)',
              background:    'rgba(232,160,48,0.08)',
              color:         COLORS.amber,
              fontSize:      11,
              fontWeight:    700,
              letterSpacing: '1.5px',
              textTransform: 'uppercase',
              cursor:        'pointer',
              fontFamily:    "'DM Sans', sans-serif",
            }}
          >
            Retry
          </button>
        </div>
      )}

      {!fetchError && (
      <div style={{ padding: '20px 18px 0' }}>

        {/* ── NEXT MEETING HERO ────────────────────── */}
        {nextMeeting && (() => {
          const heroState = getMeetingState(nextMeeting);
          const isInProgress = heroState === 'in_progress';
          return (
          <div style={{ marginBottom: 24 }}>
            <div style={sectionLabel}>Next Meeting</div>
            <div
              style={{
                background:   'rgba(240,235,224,0.06)',
                border:       '1px solid rgba(200,160,80,0.22)',
                borderRadius: 16,
                padding:      '20px 20px 18px',
                boxShadow:    '0 4px 20px rgba(26,20,16,0.06)',
              }}
            >
              {/* Status line */}
              <div style={{
                display:      'flex',
                alignItems:   'center',
                gap:          7,
                marginBottom: 10,
              }}>
                <div style={{
                  width:        7,
                  height:       7,
                  borderRadius: '50%',
                  background:   isInProgress ? COLORS.green : COLORS.teal,
                  flexShrink:   0,
                  animation:    isInProgress ? 'dotBlink 2.5s ease-in-out infinite' : 'none',
                }} />
                <span style={{
                  fontSize:      11,
                  fontWeight:    600,
                  letterSpacing: '1.5px',
                  textTransform: 'uppercase',
                  color:         isInProgress
                    ? 'rgba(72,200,120,0.82)'
                    : 'rgba(56,184,200,0.82)',
                }}>
                  {meetingTimes[nextMeeting.id] ?? formatMeetingTime(nextMeeting)}
                </span>
                {nextMeeting.deal_id && (
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

              {/* Title — large, serif + Session 8 actions */}
              <div style={{
                display:      'flex',
                alignItems:   'flex-start',
                justifyContent: 'space-between',
                gap:          8,
                marginBottom: 6,
              }}>
                <div style={{
                  fontFamily:   "'Cormorant Garamond', serif",
                  fontSize:     24,
                  fontWeight:   400,
                  color:        'rgba(252,246,234,1)',
                  lineHeight:   1.25,
                  flex:         1,
                }}>
                  {nextMeeting.title}
                </div>
                <MeetingRowActions
                  meetingId={nextMeeting.id}
                  meetingTitle={nextMeeting.title}
                  onComplete={completeAction}
                  onCancel={cancelAction}
                  onReschedule={handleRescheduleOpen}
                />
              </div>

              {/* AI Brief / Curiosity Question / Fallback */}
              {(() => {
                const minsUntil = (new Date(nextMeeting.scheduled_at).getTime() - Date.now()) / 60000;
                const weak = nextMeeting.deal_id
                  ? isWeakContext(nextMeeting, todaySignals.filter(s => s.deal_id === nextMeeting.deal_id), dealInteractions)
                  : true;
                const showQuestion = weak && !heroBrief && !curiosityDismissed && minsUntil > 10 && nextMeeting.deal_id;

                return (
                  <div style={{ marginBottom: 14 }}>
                    {/* Loading state */}
                    {heroBriefLoading ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                        <div style={{
                          height: 11, borderRadius: 6,
                          background: 'rgba(252,246,234,0.06)',
                          animation: 'shimmer 1.5s ease-in-out infinite',
                          width: '92%',
                        }} />
                        <div style={{
                          height: 11, borderRadius: 6,
                          background: 'rgba(252,246,234,0.06)',
                          animation: 'shimmer 1.5s ease-in-out infinite',
                          width: '68%',
                        }} />
                      </div>
                    ) : heroBrief ? (
                      /* Strong context — micro brief */
                      <p style={{
                        fontSize:   14,
                        fontWeight: 300,
                        color:      'rgba(252,246,234,0.56)',
                        lineHeight: 1.65,
                        margin:     '6px 0 0',
                      }}>
                        {heroBrief}
                      </p>
                    ) : showQuestion ? (
                      /* Weak context — curiosity question */
                      <div style={{ marginTop: 8 }}>
                        <p style={{
                          fontSize:     13,
                          fontWeight:   400,
                          color:        'rgba(252,246,234,0.52)',
                          marginBottom: 8,
                          lineHeight:   1.5,
                        }}>
                          {pickCuriosityQuestion(nextMeeting)}
                        </p>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <input
                            type="text"
                            value={curiosityAnswer}
                            onChange={(e) => setCuriosityAnswer(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleCuriositySubmit(nextMeeting);
                              }
                            }}
                            placeholder="Type here..."
                            style={{
                              flex:          1,
                              padding:       '8px 12px',
                              borderRadius:  9,
                              border:        '0.5px solid rgba(200,160,80,0.3)',
                              background:    'rgba(240,235,224,0.06)',
                              fontSize:      13,
                              fontWeight:    300,
                              color:         'rgba(252,246,234,1)',
                              outline:       'none',
                              fontFamily:    "'DM Sans', sans-serif",
                            }}
                          />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCuriositySubmit(nextMeeting);
                            }}
                            disabled={!curiosityAnswer.trim() || curiositySubmitting}
                            style={{
                              padding:       '8px 14px',
                              borderRadius:  9,
                              border:        '0.5px solid rgba(200,160,80,0.4)',
                              background:    curiosityAnswer.trim()
                                ? 'rgba(232,160,48,0.12)'
                                : 'rgba(252,246,234,0.04)',
                              color:         curiosityAnswer.trim()
                                ? COLORS.amber
                                : 'rgba(252,246,234,0.2)',
                              fontSize:      11,
                              fontWeight:    700,
                              letterSpacing: '1px',
                              textTransform: 'uppercase',
                              cursor:        curiosityAnswer.trim() ? 'pointer' : 'default',
                              fontFamily:    "'DM Sans', sans-serif",
                              transition:    'all 0.2s',
                            }}
                          >
                            {curiositySubmitting ? '...' : '→'}
                          </button>
                        </div>
                      </div>
                    ) : !nextMeeting.deal_id ? (
                      /* No deal — simple fallback */
                      <div style={{ marginTop: 4 }}>
                        {nextMeeting.attendees && (
                          <div style={{
                            fontSize:     12,
                            fontWeight:   300,
                            color:        'rgba(252,246,234,0.44)',
                            marginBottom: 4,
                          }}>
                            {nextMeeting.attendees}
                          </div>
                        )}
                        <p style={{
                          fontSize:   12,
                          fontWeight: 300,
                          color:      'rgba(252,246,234,0.36)',
                          fontStyle:  'italic',
                          margin:     '4px 0 0',
                        }}>
                          Add context to get a brief
                        </p>
                      </div>
                    ) : nextMeeting.attendees ? (
                      /* Fallback with attendees */
                      <div style={{
                        fontSize:   12,
                        fontWeight: 300,
                        color:      'rgba(252,246,234,0.44)',
                        marginTop:  4,
                      }}>
                        {nextMeeting.attendees}
                      </div>
                    ) : null}
                  </div>
                );
              })()}

              {/* Single CTA based on state */}
              <div style={{ display: 'flex', gap: 8 }}>
                {heroState === 'upcoming' && nextMeeting.deal_id ? (
                  <button
                    onClick={() => navigateTo('deal-prep', { dealId: nextMeeting.deal_id! })}
                    style={{
                      padding:       '10px 20px',
                      borderRadius:  10,
                      border:        '0.5px solid rgba(56,184,200,0.4)',
                      background:    'rgba(56,184,200,0.08)',
                      color:         COLORS.teal,
                      fontSize:      11,
                      fontWeight:    700,
                      letterSpacing: '1.5px',
                      textTransform: 'uppercase',
                      cursor:        'pointer',
                      fontFamily:    "'DM Sans', sans-serif",
                    }}
                  >
                    Prep →
                  </button>
                ) : (
                  <button
                    onClick={() => handleAddContext(nextMeeting)}
                    style={{
                      padding:       '10px 20px',
                      borderRadius:  10,
                      border:        '0.5px solid rgba(200,160,80,0.3)',
                      background:    'rgba(200,160,80,0.08)',
                      color:         COLORS.amber,
                      fontSize:      11,
                      fontWeight:    700,
                      letterSpacing: '1.5px',
                      textTransform: 'uppercase',
                      cursor:        'pointer',
                      fontFamily:    "'DM Sans', sans-serif",
                    }}
                  >
                    Add context →
                  </button>
                )}
              </div>

              {/* Session 8: Hero meeting action buttons */}
              <div style={{
                display:   'flex',
                gap:       8,
                marginTop: 12,
                paddingTop: 12,
                borderTop: '0.5px solid rgba(200,160,80,0.12)',
              }}>
                <button
                  onClick={() => { completeAction(nextMeeting.id); }}
                  style={{
                    padding: '8px 16px', borderRadius: 9,
                    border: '0.5px solid rgba(72,200,120,0.3)',
                    background: 'rgba(72,200,120,0.06)',
                    color: COLORS.green, fontSize: 10, fontWeight: 700,
                    letterSpacing: '1.5px', textTransform: 'uppercase' as const,
                    cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
                  }}
                >
                  ✓ Done
                </button>
                <button
                  onClick={() => { handleRescheduleOpen(nextMeeting.id); }}
                  style={{
                    padding: '8px 16px', borderRadius: 9,
                    border: '0.5px solid rgba(56,184,200,0.3)',
                    background: 'rgba(56,184,200,0.06)',
                    color: COLORS.teal, fontSize: 10, fontWeight: 700,
                    letterSpacing: '1.5px', textTransform: 'uppercase' as const,
                    cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
                  }}
                >
                  ↻ Move
                </button>
                <button
                  onClick={() => { cancelAction(nextMeeting.id); }}
                  style={{
                    padding: '8px 16px', borderRadius: 9,
                    border: '0.5px solid rgba(224,88,64,0.25)',
                    background: 'rgba(224,88,64,0.06)',
                    color: COLORS.red, fontSize: 10, fontWeight: 700,
                    letterSpacing: '1.5px', textTransform: 'uppercase' as const,
                    cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
                  }}
                >
                  ✕ Cancel
                </button>
              </div>
            </div>
          </div>
          );
        })()}

        {/* ── UPCOMING TODAY ─────────────────────────── */}
        {upcomingMeetings.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={sectionLabel}>Upcoming Today</div>
            {upcomingMeetings.map(meeting => {
              const state = getMeetingState(meeting);
              const isExpanded = expandedMeetingId === meeting.id;
              return (
                <div
                  key={meeting.id}
                  onClick={() => handleMeetingTap(meeting)}
                  style={{
                    background:   'rgba(240,235,224,0.06)',
                    borderLeft:   `3px solid ${state === 'in_progress' ? COLORS.green : 'rgba(56,184,200,0.52)'}`,
                    borderRadius: '0 14px 14px 0',
                    padding:      '14px 17px',
                    marginBottom: 10,
                    boxShadow:    '0 2px 10px rgba(26,20,16,0.06)',
                    cursor:       'pointer',
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
                      background:   state === 'in_progress' ? COLORS.green : COLORS.teal,
                      flexShrink:   0,
                    }} />
                    <span style={{
                      fontSize:      10,
                      fontWeight:    600,
                      letterSpacing: '1.5px',
                      textTransform: 'uppercase',
                      color:         state === 'in_progress'
                        ? 'rgba(72,200,120,0.82)'
                        : 'rgba(56,184,200,0.82)',
                    }}>
                      {meetingTimes[meeting.id] ?? formatMeetingTime(meeting)}
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

                  {/* Title + Session 8 actions */}
                  <div style={{
                    display:      'flex',
                    alignItems:   'flex-start',
                    justifyContent: 'space-between',
                    gap:          8,
                    marginBottom: meeting.attendees ? 5 : 0,
                  }}>
                    <div style={{
                      fontFamily:   "'Cormorant Garamond', serif",
                      fontSize:     18,
                      fontWeight:   400,
                      color:        'rgba(252,246,234,1)',
                      flex:         1,
                    }}>
                      {meeting.title}
                    </div>
                    <MeetingRowActions
                      meetingId={meeting.id}
                      meetingTitle={meeting.title}
                      onComplete={completeAction}
                      onCancel={cancelAction}
                      onReschedule={handleRescheduleOpen}
                    />
                  </div>

                  {/* Attendees */}
                  {meeting.attendees && (
                    <div style={{
                      fontSize:     12,
                      fontWeight:   300,
                      color:        'rgba(252,246,234,0.44)',
                      marginBottom: 0,
                    }}>
                      {meeting.attendees}
                    </div>
                  )}

                  {/* Inline expanded content */}
                  {isExpanded && (
                    <div style={{
                      marginTop:    10,
                      paddingTop:   10,
                      borderTop:    '0.5px solid rgba(200,160,80,0.15)',
                    }}>
                      {/* AI Brief (deal-linked only) */}
                      {meeting.deal_id && (
                        <div style={{ marginBottom: 10 }}>
                          {briefLoading[meeting.id] ? (
                            <div style={{
                              height:       12,
                              borderRadius: 6,
                              background:   'rgba(252,246,234,0.06)',
                              animation:    'shimmer 1.5s ease-in-out infinite',
                              width:        '85%',
                            }} />
                          ) : inlineBriefs[meeting.id] ? (
                            <p style={{
                              fontSize:   13,
                              fontWeight: 300,
                              color:      'rgba(252,246,234,0.56)',
                              lineHeight: 1.6,
                              margin:     0,
                            }}>
                              {inlineBriefs[meeting.id]}
                            </p>
                          ) : null}
                        </div>
                      )}

                      {/* CTAs based on state */}
                      <div style={{ display: 'flex', gap: 8 }}>
                        {/* Prep Me — only upcoming + deal-linked */}
                        {meeting.deal_id && state === 'upcoming' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigateTo('deal-prep', { dealId: meeting.deal_id! });
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
                            Prep Me
                          </button>
                        )}
                        {/* Add context — always */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAddContext(meeting);
                          }}
                          style={{
                            padding:       '8px 16px',
                            borderRadius:  9,
                            border:        '0.5px solid rgba(200,160,80,0.3)',
                            background:    'rgba(200,160,80,0.06)',
                            color:         COLORS.amber,
                            fontSize:      10,
                            fontWeight:    700,
                            letterSpacing: '1.5px',
                            textTransform: 'uppercase',
                            cursor:        'pointer',
                            fontFamily:    "'DM Sans', sans-serif",
                          }}
                        >
                          Add Context
                        </button>
                      </div>

                      {/* Session 8: Meeting action buttons */}
                      <div style={{
                        display:   'flex',
                        gap:       8,
                        marginTop: 10,
                        paddingTop: 10,
                        borderTop: '0.5px solid rgba(200,160,80,0.10)',
                      }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); completeAction(meeting.id); }}
                          style={{
                            padding: '7px 14px', borderRadius: 9,
                            border: '0.5px solid rgba(72,200,120,0.3)',
                            background: 'rgba(72,200,120,0.06)',
                            color: COLORS.green, fontSize: 10, fontWeight: 700,
                            letterSpacing: '1px', textTransform: 'uppercase' as const,
                            cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
                          }}
                        >
                          ✓ Done
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRescheduleOpen(meeting.id); }}
                          style={{
                            padding: '7px 14px', borderRadius: 9,
                            border: '0.5px solid rgba(56,184,200,0.3)',
                            background: 'rgba(56,184,200,0.06)',
                            color: COLORS.teal, fontSize: 10, fontWeight: 700,
                            letterSpacing: '1px', textTransform: 'uppercase' as const,
                            cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
                          }}
                        >
                          ↻ Move
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); cancelAction(meeting.id); }}
                          style={{
                            padding: '7px 14px', borderRadius: 9,
                            border: '0.5px solid rgba(224,88,64,0.25)',
                            background: 'rgba(224,88,64,0.06)',
                            color: COLORS.red, fontSize: 10, fontWeight: 700,
                            letterSpacing: '1px', textTransform: 'uppercase' as const,
                            cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
                          }}
                        >
                          ✕ Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* No meetings state */}
        {!loading && meetings.length === 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={sectionLabel}>Meetings</div>
            <div style={{
              textAlign: 'center',
              padding:   '24px 0 16px',
            }}>
              <p style={{
                fontFamily: "'Cormorant Garamond', serif",
                fontSize:   18,
                fontWeight: 300,
                color:      'rgba(252,246,234,0.36)',
              }}>
                No meetings today.
              </p>
            </div>
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
                  color:        'rgba(252,246,234,1)',
                  marginBottom: 6,
                }}>
                  All clear.
                </p>
                <p style={{
                  fontSize:   13,
                  fontWeight: 300,
                  color:      'rgba(252,246,234,0.44)',
                }}>
                  {attentionDeals.length > 0
                    ? 'Nothing pressing.'
                    : 'Every deal has a next step.'}
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
                      background:   'rgba(240,235,224,0.06)',
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
                      color:        'rgba(252,246,234,1)',
                      marginBottom: 4,
                    }}>
                      {deal.name}
                    </div>

                    {/* Context line — intelligence */}
                    {dealContextMap[deal.id] && (
                      <div style={{
                        fontSize:     12,
                        fontWeight:   400,
                        fontStyle:    'italic',
                        color:        'rgba(252,246,234,0.40)',
                        marginBottom: 4,
                        lineHeight:   1.5,
                      }}>
                        {dealContextMap[deal.id]}
                      </div>
                    )}

                    {/* Stage */}
                    <div style={{
                      fontSize:     12,
                      fontWeight:   300,
                      color:        'rgba(252,246,234,0.44)',
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
                          background:    'rgba(252,246,234,0.04)',
                          border:        '0.5px solid rgba(252,246,234,0.1)',
                          color:         'rgba(252,246,234,0.3)',
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

        {/* ── COMPLETED MEETINGS ───────────────────── */}
        {completedMeetings.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <button
              onClick={() => setShowCompleted(!showCompleted)}
              style={{
                background:    'none',
                border:        'none',
                cursor:        'pointer',
                display:       'flex',
                alignItems:    'center',
                gap:           8,
                padding:       '10px 0',
                fontSize:      9,
                fontWeight:    700,
                letterSpacing: '2.5px',
                textTransform: 'uppercase',
                color:         'rgba(252,246,234,0.28)',
                fontFamily:    "'DM Sans', sans-serif",
                width:         '100%',
                paddingBottom: 8,
                marginBottom:  showCompleted ? 14 : 0,
                borderBottom:  '0.5px solid rgba(200,160,80,0.2)',
              }}
            >
              <span style={{
                display:    'inline-block',
                transform:  showCompleted ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s ease',
                fontSize:   12,
              }}>›</span>
              Completed · {completedMeetings.length}
            </button>

            {showCompleted && completedMeetings.map(meeting => {
              const isExpanded = expandedMeetingId === meeting.id;
              return (
                <div
                  key={meeting.id}
                  onClick={() => handleMeetingTap(meeting)}
                  style={{
                    background:   'rgba(240,235,224,0.06)',
                    borderLeft:   '3px solid rgba(252,246,234,0.1)',
                    borderRadius: '0 14px 14px 0',
                    padding:      '14px 17px',
                    marginBottom: 10,
                    boxShadow:    '0 1px 6px rgba(26,20,16,0.04)',
                    opacity:      0.7,
                    cursor:       'pointer',
                  }}
                >
                  {/* Time */}
                  <div style={{
                    display:      'flex',
                    alignItems:   'center',
                    gap:          7,
                    marginBottom: 5,
                  }}>
                    <span style={{
                      fontSize:      10,
                      fontWeight:    600,
                      letterSpacing: '1.5px',
                      textTransform: 'uppercase',
                      color:         'rgba(252,246,234,0.3)',
                    }}>
                      {meetingTimes[meeting.id] ?? formatMeetingTime(meeting)}
                    </span>
                  </div>

                  {/* Title */}
                  <div style={{
                    fontFamily:   "'Cormorant Garamond', serif",
                    fontSize:     17,
                    fontWeight:   400,
                    color:        'rgba(252,246,234,0.6)',
                    marginBottom: 0,
                  }}>
                    {meeting.title}
                  </div>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div style={{
                      marginTop:  10,
                      paddingTop: 10,
                      borderTop:  '0.5px solid rgba(200,160,80,0.12)',
                    }}>
                      {meeting.attendees && (
                        <div style={{
                          fontSize:     12,
                          fontWeight:   300,
                          color:        'rgba(252,246,234,0.4)',
                          marginBottom: 10,
                        }}>
                          {meeting.attendees}
                        </div>
                      )}
                      {meeting.debrief_completed ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAddContext(meeting);
                          }}
                          style={{
                            padding:       '8px 16px',
                            borderRadius:  9,
                            border:        '0.5px solid rgba(252,246,234,0.08)',
                            background:    'transparent',
                            color:         'rgba(252,246,234,0.36)',
                            fontSize:      10,
                            fontWeight:    500,
                            letterSpacing: '1.5px',
                            textTransform: 'uppercase',
                            cursor:        'pointer',
                            fontFamily:    "'DM Sans', sans-serif",
                          }}
                        >
                          View Context
                        </button>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAddContext(meeting);
                          }}
                          style={{
                            padding:       '8px 16px',
                            borderRadius:  9,
                            border:        '0.5px solid rgba(200,160,80,0.2)',
                            background:    'rgba(200,160,80,0.04)',
                            color:         'rgba(200,160,80,0.7)',
                            fontSize:      10,
                            fontWeight:    700,
                            letterSpacing: '1.5px',
                            textTransform: 'uppercase',
                            cursor:        'pointer',
                            fontFamily:    "'DM Sans', sans-serif",
                          }}
                        >
                          Add Context
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── CAPTURE SHORTCUT ─────────────────────── */}
        <div
          onClick={() => {
            setCaptureMeetingContext(null);
            setCaptureMeetingId(undefined);
            setShowCapture(true);
          }}
          style={{
            display:      'flex',
            alignItems:   'center',
            gap:          12,
            background:   'rgba(240,235,224,0.06)',
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
              color:      'rgba(252,246,234,1)',
            }}>
              Capture something
            </div>
            <div style={{
              fontSize:   11,
              fontWeight: 300,
              color:      'rgba(252,246,234,0.36)',
              marginTop:  2,
            }}>
              Debrief · Email · Draft · Idea
            </div>
          </div>
        </div>

      </div>
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
    </div>

      {/* ── CAPTURE SHEET ────────────────────────────── */}
      {showCapture && userId && (
        <CaptureSheet
          onClose={() => {
            setShowCapture(false);
            setCaptureMeetingContext(null);
            setCaptureMeetingId(undefined);
          }}
          userId={userId}
          activeDeals={allActiveDeals}
          onCaptureComplete={() => {
            setShowCapture(false);
            setCaptureMeetingContext(null);
            setCaptureMeetingId(undefined);
            fetchData();
          }}
          initialMode="debrief"
          meetingContext={captureMeetingContext}
          meetingId={captureMeetingId}
        />
      )}

      {/* Session 8: Reschedule sheet + action toast */}
      <RescheduleSheet
        open={!!rescheduleTarget}
        meetingTitle={rescheduleTarget?.title ?? ''}
        currentStartTime={rescheduleTarget?.startTime ?? Date.now()}
        onConfirm={handleRescheduleConfirm}
        onClose={() => setRescheduleTarget(null)}
      />
      <MeetingActionToast />
    </>
  );
}
