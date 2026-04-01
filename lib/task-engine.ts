// ── SESSION 9: TASK ENGINE ──────────────────────────────────
// Derives actionable tasks from system state.
// Pure computation — no side effects, no storage.
//
// Inputs: meetings (from store), deals (from props)
// Output: prioritized list of SystemTask[]

import { useMemo } from 'react';
import { useMeetingStore } from './meeting-store';
import type { Meeting } from './meeting-types';
import type { DealRow } from './types';
import type { SystemTask, TaskAction } from './task-types';
import { PULSE_CHECK_DEFAULT_DAYS } from './constants';

// ── CONFIGURATION ───────────────────────────────────────────

const PREP_WINDOW_MS = 6 * 60 * 60 * 1000;       // 6 hours before meeting
const FOLLOWUP_WINDOW_MS = 24 * 60 * 60 * 1000;   // 24 hours after completion
const STALE_DAYS_REENGAGE = PULSE_CHECK_DEFAULT_DAYS;
const MAX_TASKS = 5;

// ── HELPERS ─────────────────────────────────────────────────

function getDaysSince(dateStr: string): number {
  return Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24)
  );
}

function formatTimeUntil(ms: number): string {
  const minutes = Math.floor(ms / (1000 * 60));
  if (minutes < 0) return 'now';
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'tomorrow' : `in ${days}d`;
}

function formatTimeSince(ms: number): string {
  const minutes = Math.floor(ms / (1000 * 60));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}

// ── TASK GENERATORS ─────────────────────────────────────────
// Exported for server-side use in task sync (Session 11B).
// The hook below wraps these for client-side React usage.

export function generateMeetingTasks(meetings: Meeting[]): SystemTask[] {
  const now = Date.now();
  const tasks: SystemTask[] = [];

  for (const meeting of meetings) {
    // ── MEETING PREP ──
    // Upcoming scheduled meeting within prep window
    if (
      meeting.status === 'scheduled' &&
      meeting.startTime > now &&
      meeting.startTime - now <= PREP_WINDOW_MS
    ) {
      const msUntil = meeting.startTime - now;
      const minutesUntil = msUntil / (1000 * 60);

      // Priority: closer meetings are more urgent
      // 0-60 min = priority 1, 1-3h = priority 5, 3-6h = priority 10
      let priority: number;
      if (minutesUntil <= 60) priority = 1;
      else if (minutesUntil <= 180) priority = 5;
      else priority = 10;

      const action: TaskAction = meeting.dealId
        ? { kind: 'open_prep', meetingId: meeting.id, dealId: meeting.dealId }
        : { kind: 'open_briefing' };

      tasks.push({
        id: `prep_${meeting.id}`,
        type: 'meeting_prep',
        title: `Prep for ${meeting.title}`,
        subtitle: meeting.dealId ? 'Review deal context' : 'Review briefing',
        contextId: meeting.id,
        priority,
        timeRelevance: formatTimeUntil(msUntil),
        action,
        createdAt: now,
      });
    }

    // ── MEETING FOLLOWUP ──
    // Recently completed meeting that hasn't been debriefed
    if (
      meeting.status === 'completed' &&
      !meeting.debriefCompleted &&
      now - meeting.lastUpdatedAt <= FOLLOWUP_WINDOW_MS
    ) {
      const msSince = now - meeting.lastUpdatedAt;

      // Priority: more recent completions are more urgent
      const hoursAgo = msSince / (1000 * 60 * 60);
      let priority: number;
      if (hoursAgo <= 1) priority = 2;
      else if (hoursAgo <= 4) priority = 8;
      else priority = 15;

      const action: TaskAction = meeting.dealId
        ? { kind: 'open_chat', dealId: meeting.dealId, meetingId: meeting.id }
        : { kind: 'open_chat', meetingId: meeting.id };

      tasks.push({
        id: `followup_${meeting.id}`,
        type: 'meeting_followup',
        title: `Log notes from ${meeting.title}`,
        subtitle: 'Capture while it\'s fresh',
        contextId: meeting.id,
        priority,
        timeRelevance: formatTimeSince(msSince),
        action,
        createdAt: now,
      });
    }
  }

  return tasks;
}

export function generateDealTasks(deals: DealRow[]): SystemTask[] {
  const tasks: SystemTask[] = [];
  const now = Date.now();

  for (const deal of deals) {
    // Skip closed deals
    if (deal.stage === 'Closed Won' || deal.stage === 'Closed Lost') continue;

    // Skip snoozed deals
    if (deal.snoozed_until && new Date(deal.snoozed_until) > new Date()) continue;

    const daysSince = getDaysSince(deal.last_activity_at);

    // ── NEXT STEP ──
    // Active item with no next action defined
    if (!deal.next_action && daysSince <= STALE_DAYS_REENGAGE) {
      // Priority based on staleness only — no stage or value weighting
      const priority = daysSince > 7 ? 14 : 20;

      tasks.push({
        id: `nextstep_${deal.id}`,
        type: 'deal_next_step',
        title: `Define next step for ${deal.name}`,
        subtitle: 'no action set',
        contextId: deal.id,
        priority,
        action: { kind: 'open_deal', dealId: deal.id },
        createdAt: now,
      });
    }

    // ── REENGAGE ──
    // Item stale beyond threshold
    if (daysSince > STALE_DAYS_REENGAGE) {
      // Priority based on staleness only — no value or stage weighting
      const priority = daysSince > 21 ? 14 : 18;

      tasks.push({
        id: `reengage_${deal.id}`,
        type: 'reengage',
        title: `Re-engage ${deal.name}`,
        subtitle: `${daysSince}d since last activity`,
        contextId: deal.id,
        priority,
        timeRelevance: `${daysSince}d ago`,
        action: { kind: 'open_deal', dealId: deal.id },
        createdAt: now,
      });
    }
  }

  return tasks;
}

// ── MAIN HOOK ───────────────────────────────────────────────

export function useTaskEngine(deals: DealRow[]): SystemTask[] {
  const meetingStoreData = useMeetingStore(state => state.meetings);

  return useMemo(() => {
    const allMeetings = Object.values(meetingStoreData);

    const meetingTasks = generateMeetingTasks(allMeetings);
    const dealTasks = generateDealTasks(deals);

    // Merge and sort by priority (lower = more urgent)
    const all = [...meetingTasks, ...dealTasks]
      .sort((a, b) => a.priority - b.priority);

    // Deduplicate: if a deal has both reengage and next_step, keep the higher priority one
    const seen = new Set<string>();
    const deduped: SystemTask[] = [];
    for (const task of all) {
      const dedupeKey = task.contextId ?? task.id;
      // Allow same context if different task types that aren't deal-deal overlap
      const typeKey = `${dedupeKey}_${task.type.startsWith('meeting') ? 'meeting' : 'deal'}`;
      if (!seen.has(typeKey)) {
        seen.add(typeKey);
        deduped.push(task);
      }
    }

    return deduped.slice(0, MAX_TASKS);
  }, [meetingStoreData, deals]);
}

// ── PURE DERIVATION (SERVER-SIDE) ──────────────────────────
// Session 11B: Same logic as useTaskEngine but without React hooks.
// Used by the task sync API route for server-side persistence.

export function deriveSystemTasks(
  meetings: Meeting[],
  deals: DealRow[],
): SystemTask[] {
  const meetingTasks = generateMeetingTasks(meetings);
  const dealTasks = generateDealTasks(deals);

  const all = [...meetingTasks, ...dealTasks]
    .sort((a, b) => a.priority - b.priority);

  const seen = new Set<string>();
  const deduped: SystemTask[] = [];
  for (const task of all) {
    const dedupeKey = task.contextId ?? task.id;
    const typeKey = `${dedupeKey}_${task.type.startsWith('meeting') ? 'meeting' : 'deal'}`;
    if (!seen.has(typeKey)) {
      seen.add(typeKey);
      deduped.push(task);
    }
  }

  return deduped.slice(0, MAX_TASKS);
}
