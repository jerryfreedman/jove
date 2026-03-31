/**
 * assistant-trigger.ts
 * SESSION 6 — Unified proactive assistant trigger layer.
 *
 * ONE function evaluates ALL proactive signals and returns at most ONE
 * trigger.  Every surface (homepage line, bird, chat injection) reads
 * from this single source of truth.
 *
 * Priority (highest → lowest):
 *   1. Weak-context clarification  (upcoming meeting with no signals)
 *   2. Meeting prep                (upcoming meeting with context)
 *   3. At-risk / stale deal nudge  (pulse_check_days exceeded)
 *   4. None                        (silence > noise)
 */

import type { DealRow, MeetingRow, SignalRow } from './types';
import { PULSE_CHECK_DEFAULT_DAYS } from './constants';

// ── TYPES ────────────────────────────────────────────────────

export type AssistantTriggerType = 'clarify' | 'prep' | 'nudge' | 'none';

export interface AssistantTrigger {
  type: AssistantTriggerType;
  /** The one-line message shown on the homepage. */
  message: string;
  /** The prompt injected into chat when the user taps the line. */
  chatPrompt: string;
  /** Stable ID used for cooldown deduplication. */
  triggerId: string;
  /** Optional context forwarded to chat / bird. */
  context?: {
    dealId?: string | null;
    meetingId?: string | null;
    accountName?: string | null;
  };
}

type DealWithAccount = DealRow & { accounts: { name: string } | null };

export interface TriggerInput {
  meetings: MeetingRow[];
  allDeals: DealWithAccount[];
  urgentDeals: DealWithAccount[];
  signals: SignalRow[];
}

// ── COOLDOWN HELPERS ─────────────────────────────────────────

const COOLDOWN_PREFIX = 'assistant_trigger_seen_';
const COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours

function isCoolingDown(triggerId: string): boolean {
  if (typeof window === 'undefined') return false;
  const raw = localStorage.getItem(`${COOLDOWN_PREFIX}${triggerId}`);
  if (!raw) return false;
  const ts = parseInt(raw, 10);
  return Date.now() - ts < COOLDOWN_MS;
}

export function markTriggerSeen(triggerId: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(`${COOLDOWN_PREFIX}${triggerId}`, String(Date.now()));
}

// ── HELPERS ──────────────────────────────────────────────────

function isAlreadyAnswered(id: string): boolean {
  if (typeof window === 'undefined') return false;
  return (
    localStorage.getItem(`curiosity_asked_${id}`) === 'true' ||
    localStorage.getItem(`question_answered_${id}`) === 'true'
  );
}

function hasWeakContext(meeting: MeetingRow, signals: SignalRow[]): boolean {
  if (!meeting.deal_id) return true;
  return signals.filter(s => s.deal_id === meeting.deal_id).length === 0;
}

function getDaysSinceActivity(deal: DealRow): number {
  return Math.floor(
    (Date.now() - new Date(deal.last_activity_at).getTime()) / (1000 * 60 * 60 * 24),
  );
}

function minutesUntil(dateStr: string): number {
  return (new Date(dateStr).getTime() - Date.now()) / (1000 * 60);
}

// ── MAIN EVALUATION ─────────────────────────────────────────

export function evaluateAssistantTrigger(input: TriggerInput): AssistantTrigger {
  const { meetings, allDeals, urgentDeals, signals } = input;
  const nowMs = Date.now();
  const todayStr = new Date().toDateString();
  const none: AssistantTrigger = {
    type: 'none',
    message: '',
    chatPrompt: '',
    triggerId: '',
  };

  // ── P1: WEAK CONTEXT — upcoming meeting with no signals ────
  const upcomingToday = meetings
    .filter(m => {
      const mt = new Date(m.scheduled_at);
      return mt.getTime() > nowMs && mt.toDateString() === todayStr;
    })
    .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());

  for (const meeting of upcomingToday) {
    const tid = `clarify_${meeting.id}`;
    if (isAlreadyAnswered(meeting.id)) continue;
    if (isCoolingDown(tid)) continue;
    if (!hasWeakContext(meeting, signals)) continue;

    const minsLeft = minutesUntil(meeting.scheduled_at);
    const timeLabel = minsLeft < 60
      ? `in ${Math.round(minsLeft)} min`
      : `in ${Math.round(minsLeft / 60)} hour${Math.round(minsLeft / 60) !== 1 ? 's' : ''}`;

    const msg = !meeting.attendees
      ? `Who's joining your call ${timeLabel}?`
      : `What's the goal for your meeting ${timeLabel}?`;

    return {
      type: 'clarify',
      message: msg,
      chatPrompt: !meeting.attendees
        ? `Help me figure out who's joining my upcoming meeting "${meeting.title}"`
        : `Help me clarify the goal for my meeting "${meeting.title}"`,
      triggerId: tid,
      context: {
        dealId: meeting.deal_id ?? null,
        meetingId: meeting.id,
      },
    };
  }

  // ── P2: UPCOMING MEETING PREP (has context) ────────────────
  for (const meeting of upcomingToday) {
    const tid = `prep_${meeting.id}`;
    if (isCoolingDown(tid)) continue;

    const minsLeft = minutesUntil(meeting.scheduled_at);
    // Only surface prep within ~2 hours
    if (minsLeft > 120) continue;

    const timeLabel = minsLeft < 60
      ? `in ${Math.round(minsLeft)} min`
      : `in about ${Math.round(minsLeft / 60)} hour`;

    return {
      type: 'prep',
      message: `You're meeting ${meeting.title} ${timeLabel} — want a quick prep?`,
      chatPrompt: `Help me prep for my meeting "${meeting.title}"`,
      triggerId: tid,
      context: {
        dealId: meeting.deal_id ?? null,
        meetingId: meeting.id,
      },
    };
  }

  // ── P3: AT-RISK / STALE DEAL NUDGE ────────────────────────
  // Use urgentDeals (already filtered server-side by pulse_check_days)
  // but also check allDeals for >14 day inactivity
  const nudgeCandidates: DealWithAccount[] = [];

  for (const deal of urgentDeals) {
    if (!nudgeCandidates.find(d => d.id === deal.id)) {
      nudgeCandidates.push(deal);
    }
  }
  for (const deal of allDeals) {
    if (getDaysSinceActivity(deal) > 14 && !nudgeCandidates.find(d => d.id === deal.id)) {
      nudgeCandidates.push(deal);
    }
  }

  // Sort by stalest first
  nudgeCandidates.sort((a, b) => getDaysSinceActivity(b) - getDaysSinceActivity(a));

  for (const deal of nudgeCandidates) {
    const tid = `nudge_${deal.id}`;
    if (isCoolingDown(tid)) continue;
    if (isAlreadyAnswered(deal.id)) continue;

    const name = deal.accounts?.name || deal.name;
    const days = getDaysSinceActivity(deal);

    return {
      type: 'nudge',
      message: `You haven't touched ${name} in ${days} days.`,
      chatPrompt: `Any updates on ${name}? It's been ${days} days since last activity.`,
      triggerId: tid,
      context: {
        dealId: deal.id,
        accountName: name,
      },
    };
  }

  return none;
}
