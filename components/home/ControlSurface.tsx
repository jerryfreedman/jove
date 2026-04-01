'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  COLORS,
  getDaysColor,
  FONTS,
  TIMING,
  EASING,
  TRANSITIONS,
  CLOSE_DELAY,
  TAP_SCALE,
  COMPLETION_REWARD,
  MOMENTUM,
  EMPTY_MESSAGES,
} from '@/lib/design-system';
import {
  evaluateModulePriority,
  isNeedsAttention,
  type SurfaceEvalResult,
} from '@/lib/module-priority';
import type { DealRow, MeetingRow, UserDomainProfile, ContactRow } from '@/lib/types';
import {
  DEFAULT_DOMAIN_PROFILE,
  getControlSurfaceLabels,
} from '@/lib/semantic-labels';
import { useSurface } from '@/components/surfaces/SurfaceManager';
import { useMeetingStore } from '@/lib/meeting-store';
import { useMeetingActions } from '@/lib/meeting-actions';
import { useTaskEngine } from '@/lib/task-engine';
import type { TaskAction } from '@/lib/task-types';
import { useWhatMattersTasks, markTaskDone, skipTask, type DisplayTask } from '@/lib/task-queries';
import RescheduleSheet from '@/components/meetings/RescheduleSheet';
import MeetingActionToast from '@/components/meetings/MeetingActionToast';
import { getDayPhase } from '@/lib/daily-loop';
import { toAction } from '@/lib/intelligence/action';
import { dedupeSurfaceItems } from '@/lib/intelligence/dedupe';
import { isWeakAction } from '@/lib/intelligence/action-quality';

// ── TYPES ──────────────────────────────────────────────────
type DealWithAccount = DealRow & { accounts: { name: string } | null };

interface ControlSurfaceProps {
  open: boolean;
  onClose: () => void;
  allDeals: DealWithAccount[];
  urgentDeals: DealWithAccount[];
  meetings: MeetingRow[];
  domainProfile?: UserDomainProfile;
  /** Session 11C: User ID for persistent task reads. */
  userId?: string | null;
  /** Session 14D: Recent contacts for People section. */
  contacts?: ContactRow[];
  /** Session 14D: Tasks completed today for momentum. */
  completedTodayCount?: number;
  /** Session 14D: Current streak days. */
  streakDays?: number;
  /** Session 14F: End-of-day closure message (shown when clear). */
  closureMessage?: string | null;
  /** Session 14F: Callback when closure is dismissed. */
  onClosureDismiss?: () => void;
}

// ── SESSION 14D: SURFACE ITEM ─────────────────────────────
// Every row is the same shape. No type labels. No "task" vs "meeting" distinction.
// Just: a thing to handle or be aware of.

interface SurfaceItem {
  id: string;
  title: string;
  /** Subtitle / secondary text. */
  subtitle?: string;
  /** Time indicator (if relevant). */
  time?: string;
  /** Subtle emphasis for urgency. */
  emphasis?: boolean;
  onClick?: () => void;
  /** For persistent tasks: done/skip actions. */
  taskActions?: {
    taskId: string;
  };
  /** Internal: zone assignment (not displayed). */
  _zone: 'attention' | 'next' | 'active' | 'people';
  /** Internal: sort key within a zone. Lower = higher. */
  _sortKey: number;
}

// ── HELPERS ────────────────────────────────────────────────

function formatMeetingTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();

  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const h12 = h % 12 || 12;
  const ap = h < 12 ? 'am' : 'pm';
  const timeStr = `${h12}:${m}${ap}`;

  if (isToday) return `Today ${timeStr}`;
  if (isTomorrow) return `Tomorrow ${timeStr}`;

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${days[d.getDay()]} ${timeStr}`;
}

function minutesUntil(dateStr: string): number {
  return (new Date(dateStr).getTime() - Date.now()) / (1000 * 60);
}

function formatDueAt(dueAt: string | null): string | null {
  if (!dueAt) return null;
  const d = new Date(dueAt);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffMin = Math.floor(diffMs / (1000 * 60));
  if (diffMin < 0) return 'overdue';
  if (diffMin < 60) return `in ${diffMin}m`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `in ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 0) return 'today';
  if (diffD === 1) return 'tomorrow';
  return `in ${diffD}d`;
}

function getDaysSince(dateStr: string): number {
  return Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24)
  );
}

function isWithinHours(dateStr: string, hours: number): boolean {
  const diff = new Date(dateStr).getTime() - Date.now();
  return diff > 0 && diff <= hours * 60 * 60 * 1000;
}

// ── COMPONENT ──────────────────────────────────────────────
export default function ControlSurface({
  open,
  onClose,
  allDeals,
  urgentDeals,
  meetings,
  domainProfile,
  userId,
  contacts,
  completedTodayCount,
  streakDays,
  closureMessage,
  onClosureDismiss,
}: ControlSurfaceProps) {
  const { navigateTo } = useSurface();
  const [sheetVisible, setSheetVisible] = useState(false);
  const labels = useMemo(
    () => getControlSurfaceLabels(domainProfile ?? DEFAULT_DOMAIN_PROFILE),
    [domainProfile],
  );

  // Animate in/out
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setSheetVisible(true);
        });
      });
    } else {
      setSheetVisible(false);
    }
  }, [open]);

  const handleClose = useCallback(() => {
    setSheetVisible(false);
    setTimeout(onClose, CLOSE_DELAY);
  }, [onClose]);

  const openSurface = useCallback((surfaceId: string, params?: Record<string, string>) => {
    handleClose();
    setTimeout(() => navigateTo(surfaceId as import('@/components/surfaces/SurfaceManager').SurfaceId, params), CLOSE_DELAY);
  }, [handleClose, navigateTo]);

  // ── Meeting actions ──
  const { completeMeeting, cancelMeeting, rescheduleMeeting } = useMeetingActions();
  const [expandedMeetingId, setExpandedMeetingId] = useState<string | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<{
    meetingId: string;
    title: string;
    startTime: number;
  } | null>(null);

  const handleRescheduleOpen = useCallback((meetingId: string) => {
    const storeMeeting = useMeetingStore.getState().getMeetingById(meetingId);
    const meetingRow = meetings.find(m => m.id === meetingId);
    const title = storeMeeting?.title ?? meetingRow?.title ?? 'Meeting';
    const startTime = storeMeeting?.startTime ?? (meetingRow ? new Date(meetingRow.scheduled_at).getTime() : Date.now());
    setRescheduleTarget({ meetingId, title, startTime });
  }, [meetings]);

  const handleRescheduleConfirm = useCallback((newTime: number) => {
    if (!rescheduleTarget) return;
    rescheduleMeeting(rescheduleTarget.meetingId, newTime);
    setRescheduleTarget(null);
  }, [rescheduleTarget, rescheduleMeeting]);

  // ── Legacy system-derived task engine (fallback) ──
  const legacySystemTasks = useTaskEngine(allDeals);

  // ── Persistent task reads from DB ──
  const { tasks: dbTasks, loading: dbTasksLoading, refetch: refetchTasks } = useWhatMattersTasks(userId ?? null, 5);

  // ── Unified task list — DB primary, legacy fallback ──
  const [taskActionPending, setTaskActionPending] = useState<string | null>(null);

  // ── Session 14E: Emotional state ──
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const [sessionCompletions, setSessionCompletions] = useState(0);
  const [isFirstCompletionToday, setIsFirstCompletionToday] = useState(true);

  // ── Session 14E: Momentum computation ──
  const momentumLevel = useMemo(() => {
    if (sessionCompletions >= MOMENTUM.fireThreshold) return 'fire';
    if (sessionCompletions >= MOMENTUM.activeThreshold) return 'active';
    return 'rest';
  }, [sessionCompletions]);

  const { unifiedTasks, usingFallback } = useMemo(() => {
    if (!dbTasksLoading && dbTasks.length > 0) {
      return { unifiedTasks: dbTasks, usingFallback: false };
    }
    if (dbTasksLoading && legacySystemTasks.length > 0) {
      return { unifiedTasks: null, usingFallback: true };
    }
    if (!dbTasksLoading && dbTasks.length === 0 && legacySystemTasks.length > 0) {
      return { unifiedTasks: null, usingFallback: true };
    }
    return { unifiedTasks: dbTasks, usingFallback: false };
  }, [dbTasks, dbTasksLoading, legacySystemTasks]);

  const effectiveTaskCount = usingFallback
    ? legacySystemTasks.length
    : (unifiedTasks?.length ?? 0);

  // ── Task action handler ──
  const handleTaskAction = useCallback((action: TaskAction) => {
    switch (action.kind) {
      case 'open_prep':
        if (action.dealId) {
          openSurface('deal-prep', { dealId: action.dealId });
        }
        break;
      case 'open_chat':
        if (action.dealId) {
          openSurface('deal-chat', { dealId: action.dealId });
        }
        break;
      case 'open_deal':
        openSurface('deal-detail', { dealId: action.dealId });
        break;
      case 'open_briefing':
        break;
    }
  }, [openSurface]);

  // ── Evaluate data state ──
  const priority = useMemo<SurfaceEvalResult>(() => {
    return evaluateModulePriority({ allDeals, urgentDeals, meetings, systemTaskCount: effectiveTaskCount });
  }, [allDeals, urgentDeals, meetings, effectiveTaskCount]);

  // ── Meeting store for status-aware filtering ──
  const meetingStoreData = useMeetingStore(state => state.meetings);

  // ── SESSION 14D: BUILD STATE SURFACE ────────────────────
  // 5 sections. Each item appears in exactly ONE section.
  // Sections are: attention, next, active, people, momentum.
  // No navigation. No CRM. Just: what matters right now.

  const { attention, next, active, people } = useMemo(() => {
    const now = new Date();
    const placed = new Set<string>();

    // ── 1. WHAT NEEDS ATTENTION ─────────────────────────────
    // Overdue tasks, tasks due soon, blocked items.
    // Strongest visual emphasis. Always visible if non-empty.
    const attentionItems: SurfaceItem[] = [];

    // Session 15A: Strict top 3. Action-normalized titles.
    if (!usingFallback && unifiedTasks) {
      for (const task of unifiedTasks) {
        if (attentionItems.length >= 3) break;
        const isOverdue = task.dueAt ? new Date(task.dueAt).getTime() < now.getTime() : false;
        const isDueSoon = task.dueAt ? isWithinHours(task.dueAt, 4) : false;
        // Include: overdue, due soon, or high priority (1-5)
        if (isOverdue || isDueSoon || (task.priority !== null && task.priority <= 5)) {
          attentionItems.push({
            id: `task-${task.id}`,
            title: toAction(task.title),
            time: formatDueAt(task.dueAt) ?? undefined,
            emphasis: isOverdue,
            onClick: task.action ? () => handleTaskAction(task.action!) : undefined,
            taskActions: { taskId: task.id },
            _zone: 'attention',
            _sortKey: isOverdue ? -1 : 0,
          });
          placed.add(`task-${task.id}`);
          if (task.meetingId) placed.add(`meeting-${task.meetingId}`);
          if (task.dealId) placed.add(`deal-${task.dealId}`);
        }
      }
    } else if (usingFallback) {
      for (const task of legacySystemTasks.slice(0, 3)) {
        if (attentionItems.length >= 3) break;
        // Legacy tasks with priority <= 8 are urgent
        if (task.priority <= 8) {
          attentionItems.push({
            id: `legacy-${task.id}`,
            title: toAction(task.title),
            time: task.timeRelevance ?? undefined,
            emphasis: task.priority <= 2,
            onClick: () => handleTaskAction(task.action),
            _zone: 'attention',
            _sortKey: task.priority,
          });
          placed.add(`legacy-${task.id}`);
          if (task.contextId) {
            if (task.type === 'meeting_prep' || task.type === 'meeting_followup') {
              placed.add(`meeting-${task.contextId}`);
            } else {
              placed.add(`deal-${task.contextId}`);
            }
          }
        }
      }
    }

    // Session 15A: Fill remaining attention slots (max 3 total)
    if (attentionItems.length < 3) {
      const attentionCandidates = urgentDeals.length > 0
        ? urgentDeals
        : allDeals.filter(isNeedsAttention);
      const remaining = 3 - attentionItems.length;
      for (const deal of attentionCandidates.slice(0, remaining)) {
        if (placed.has(`deal-${deal.id}`)) continue;
        const days = getDaysSince(deal.last_activity_at);
        attentionItems.push({
          id: `attn-${deal.id}`,
          title: toAction(`Follow up on ${deal.name}`),
          subtitle: `${days}d without activity`,
          time: `${days}d ago`,
          emphasis: days > 14,
          onClick: () => openSurface('deal-detail', { dealId: deal.id }),
          _zone: 'attention',
          _sortKey: 1,
        });
        placed.add(`deal-${deal.id}`);
      }
    }

    // ── 2. WHAT'S NEXT ──────────────────────────────────────
    // Next 1–3 tasks + next upcoming meeting (near-term only).
    // Must feel actionable. Must be time-relevant.
    const nextItems: SurfaceItem[] = [];

    // Session 15A: Remaining tasks, action-normalized
    if (!usingFallback && unifiedTasks) {
      for (const task of unifiedTasks) {
        if (nextItems.length >= 3) break;
        if (placed.has(`task-${task.id}`)) continue;
        nextItems.push({
          id: `task-${task.id}`,
          title: toAction(task.title),
          time: formatDueAt(task.dueAt) ?? undefined,
          emphasis: false,
          onClick: task.action ? () => handleTaskAction(task.action!) : undefined,
          taskActions: { taskId: task.id },
          _zone: 'next',
          _sortKey: 0,
        });
        placed.add(`task-${task.id}`);
        if (task.meetingId) placed.add(`meeting-${task.meetingId}`);
        if (task.dealId) placed.add(`deal-${task.dealId}`);
      }
    } else if (usingFallback) {
      for (const task of legacySystemTasks) {
        if (nextItems.length >= 3) break;
        if (placed.has(`legacy-${task.id}`)) continue;
        nextItems.push({
          id: `legacy-${task.id}`,
          title: toAction(task.title),
          time: task.timeRelevance ?? undefined,
          emphasis: false,
          onClick: () => handleTaskAction(task.action),
          _zone: 'next',
          _sortKey: task.priority,
        });
        placed.add(`legacy-${task.id}`);
        if (task.contextId) {
          if (task.type === 'meeting_prep' || task.type === 'meeting_followup') {
            placed.add(`meeting-${task.contextId}`);
          } else {
            placed.add(`deal-${task.contextId}`);
          }
        }
      }
    }

    // Next upcoming meeting (only near-term: within 6 hours)
    const upcomingMeetings = meetings
      .filter(m => {
        if (placed.has(`meeting-${m.id}`)) return false;
        const storeMeeting = meetingStoreData[m.id];
        if (storeMeeting) {
          return storeMeeting.status === 'scheduled' && storeMeeting.startTime >= now.getTime();
        }
        return new Date(m.scheduled_at) >= now;
      })
      .filter(m => isWithinHours(m.scheduled_at, 6))
      .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
      .slice(0, 2);

    for (const m of upcomingMeetings) {
      if (nextItems.length >= 4) break;
      nextItems.push({
        id: `meeting-${m.id}`,
        title: m.title,
        time: formatMeetingTime(m.scheduled_at),
        emphasis: minutesUntil(m.scheduled_at) <= 60,
        onClick: () => setExpandedMeetingId(prev => prev === m.id ? null : m.id),
        _zone: 'next',
        _sortKey: 10 + (new Date(m.scheduled_at).getTime() - now.getTime()),
      });
      placed.add(`meeting-${m.id}`);
    }

    // ── 3. ACTIVE ITEMS ─────────────────────────────────────
    // User's ongoing work/life. Lightweight. Max 5 visible.
    // No pipeline UI. No heavy stats. Simple status.
    const activeItems: SurfaceItem[] = [];

    const remainingDeals = allDeals
      .filter(d => {
        if (placed.has(`deal-${d.id}`)) return false;
        return d.stage !== 'Closed Won' && d.stage !== 'Closed Lost';
      })
      .sort((a, b) => new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime())
      .slice(0, 5);

    for (const deal of remainingDeals) {
      const days = getDaysSince(deal.last_activity_at);
      // Neutral status: active, waiting, done — no CRM stage labels
      const status = deal.snoozed_until && new Date(deal.snoozed_until) > now
        ? 'waiting'
        : 'active';
      activeItems.push({
        id: `deal-${deal.id}`,
        title: deal.name,
        subtitle: status === 'waiting' ? 'waiting' : undefined,
        time: days === 0 ? 'today' : `${days}d`,
        emphasis: false,
        onClick: () => openSurface('deal-detail', { dealId: deal.id }),
        _zone: 'active',
        _sortKey: days,
      });
    }

    // ── 4. PEOPLE (LIGHT CONTEXT) ───────────────────────────
    // Recent interactions, people needing follow-up.
    // Lightweight, contextual. No CRM tables.
    const peopleItems: SurfaceItem[] = [];

    if (contacts && contacts.length > 0) {
      const recentContacts = contacts
        .filter(c => c.last_interaction_at)
        .sort((a, b) => {
          const aTime = a.last_interaction_at ? new Date(a.last_interaction_at).getTime() : 0;
          const bTime = b.last_interaction_at ? new Date(b.last_interaction_at).getTime() : 0;
          return bTime - aTime;
        })
        .slice(0, 3);

      for (const contact of recentContacts) {
        const days = contact.last_interaction_at ? getDaysSince(contact.last_interaction_at) : 0;
        peopleItems.push({
          id: `person-${contact.id}`,
          title: contact.name,
          subtitle: contact.title ?? undefined,
          time: days === 0 ? 'today' : `${days}d ago`,
          emphasis: false,
          _zone: 'people',
          _sortKey: days,
        });
      }
    }

    // Session 15C: Deduplicate across sections and filter weak actions
    const dedupedAttention = dedupeSurfaceItems(attentionItems);
    const dedupedNext = dedupeSurfaceItems(nextItems).filter(
      item => !dedupedAttention.some(a => a.title.toLowerCase() === item.title.toLowerCase())
    );

    // Filter weak actions from top sections (attention + next)
    const filteredAttention = dedupedAttention.filter(item => !isWeakAction(item.title));
    const filteredNext = dedupedNext.filter(item => !isWeakAction(item.title));

    // If filtering removed everything, fall back to unfiltered
    return {
      attention: filteredAttention.length > 0 ? filteredAttention : dedupedAttention,
      next: filteredNext.length > 0 ? filteredNext : dedupedNext,
      active: activeItems,
      people: peopleItems,
    };
  }, [
    allDeals, urgentDeals, meetings, meetingStoreData, contacts,
    unifiedTasks, usingFallback, legacySystemTasks,
    handleTaskAction, openSurface,
  ]);

  // ── ALL HOOKS ABOVE THIS LINE ───────────────────────────
  if (!open) return null;

  const { isLowDataState } = priority;
  const hasContent = attention.length > 0 || next.length > 0 || active.length > 0 || people.length > 0;

  // ── Task actions (done/skip) ──
  const handleTaskDone = async (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setTaskActionPending(taskId);
    const ok = await markTaskDone(taskId);
    if (ok) {
      // Session 14E: Completion reward state
      setCompletedIds(prev => new Set(prev).add(taskId));
      setSessionCompletions(prev => prev + 1);
      // Hold reward glow, then fade and remove
      setTimeout(() => {
        setCompletedIds(prev => {
          const next = new Set(prev);
          next.delete(taskId);
          return next;
        });
        setTaskActionPending(null);
        refetchTasks();
      }, COMPLETION_REWARD.holdMs + COMPLETION_REWARD.fadeMs);
      // After first completion, mark subsequent ones as not-first
      setIsFirstCompletionToday(false);
    } else {
      setTaskActionPending(null);
    }
  };

  const handleTaskSkip = async (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setTaskActionPending(taskId);
    const ok = await skipTask(taskId);
    setTaskActionPending(null);
    if (ok) refetchTasks();
  };

  // ── SESSION 14D: UNIFIED ROW RENDERER ─────────────────────
  // Every row is identical: title + subtitle + time + actions.
  // Consistent across all sections. Tighter density.

  const ROW_STYLE = {
    background: 'rgba(240,235,224,0.025)',
    border: '0.5px solid rgba(240,235,224,0.04)',
    borderRadius: 12,
    padding: '10px 13px',
    transition: TRANSITIONS.row,
  } as const;

  const renderRow = (item: SurfaceItem) => {
    const isPending = item.taskActions ? taskActionPending === item.taskActions.taskId : false;
    const isCompleted = item.taskActions ? completedIds.has(item.taskActions.taskId) : false;
    const isMeeting = item.id.startsWith('meeting-');
    const meetingId = isMeeting ? item.id.replace('meeting-', '') : null;
    const isExpanded = meetingId ? expandedMeetingId === meetingId : false;

    return (
      <div
        key={item.id}
        className="jove-tap"
        onClick={item.onClick}
        style={{
          ...ROW_STYLE,
          borderColor: isCompleted
            ? 'rgba(72,200,120,0.15)'
            : isExpanded ? 'rgba(240,235,224,0.06)' : undefined,
          cursor: item.onClick ? 'pointer' : 'default',
          opacity: isPending && !isCompleted ? 0.4 : 1,
          animation: isCompleted
            ? (isFirstCompletionToday && sessionCompletions === 1
              ? 'firstCompletionGlow 700ms ease forwards'
              : 'completionGlow 700ms ease forwards')
            : undefined,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span
              style={{
                fontSize: 13,
                fontWeight: 400,
                color: 'rgba(252,246,234,0.88)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                display: 'block',
              }}
            >
              {item.title}
            </span>
            {item.subtitle && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 400,
                  color: 'rgba(240,235,224,0.28)',
                  marginTop: 1,
                  display: 'block',
                }}
              >
                {item.subtitle}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            {item.time && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 400,
                  color: item.emphasis ? COLORS.amber : 'rgba(240,235,224,0.42)',
                }}
              >
                {item.time}
              </span>
            )}

            {item.taskActions && (
              <>
                <button
                  className="jove-tap"
                  onClick={(e) => handleTaskDone(item.taskActions!.taskId, e)}
                  disabled={isPending}
                  style={{
                    padding: '3px 8px',
                    borderRadius: 6,
                    border: '0.5px solid rgba(72,200,120,0.25)',
                    background: 'rgba(72,200,120,0.08)',
                    color: COLORS.green,
                    fontSize: 10,
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: FONTS.sans,
                    lineHeight: '1.3',
                  }}
                >
                  Done
                </button>
                <button
                  className="jove-tap"
                  onClick={(e) => handleTaskSkip(item.taskActions!.taskId, e)}
                  disabled={isPending}
                  style={{
                    padding: '3px 6px',
                    borderRadius: 6,
                    border: '0.5px solid rgba(240,235,224,0.10)',
                    background: 'rgba(240,235,224,0.03)',
                    color: 'rgba(240,235,224,0.32)',
                    fontSize: 10,
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: FONTS.sans,
                    lineHeight: '1.3',
                  }}
                >
                  ✕
                </button>
              </>
            )}
          </div>
        </div>

        {/* Inline meeting actions — expand on tap, no navigation */}
        {isMeeting && isExpanded && meetingId && (
          <div
            style={{
              display: 'flex',
              gap: 6,
              marginTop: 8,
              paddingTop: 8,
              borderTop: '0.5px solid rgba(240,235,224,0.04)',
              flexWrap: 'wrap',
            }}
          >
            <button
              className="jove-tap"
              onClick={(e) => { e.stopPropagation(); completeMeeting(meetingId); setExpandedMeetingId(null); }}
              style={{
                padding: '5px 11px',
                borderRadius: 7,
                border: '0.5px solid rgba(72,200,120,0.3)',
                background: 'rgba(72,200,120,0.08)',
                color: COLORS.green,
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: FONTS.sans,
              }}
            >
              Done
            </button>
            <button
              className="jove-tap"
              onClick={(e) => { e.stopPropagation(); handleRescheduleOpen(meetingId); }}
              style={{
                padding: '5px 11px',
                borderRadius: 7,
                border: '0.5px solid rgba(56,184,200,0.3)',
                background: 'rgba(56,184,200,0.08)',
                color: COLORS.teal,
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: FONTS.sans,
              }}
            >
              Move
            </button>
            <button
              className="jove-tap"
              onClick={(e) => { e.stopPropagation(); cancelMeeting(meetingId); setExpandedMeetingId(null); }}
              style={{
                padding: '5px 11px',
                borderRadius: 7,
                border: '0.5px solid rgba(224,88,64,0.25)',
                background: 'rgba(224,88,64,0.06)',
                color: COLORS.red,
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: FONTS.sans,
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    );
  };

  // ── SECTION RENDERERS ──────────────────────────────────
  // Consistent header style. Tighter spacing. Sections collapse if empty.

  const SECTION_HEADER = {
    fontSize: 10,
    fontWeight: 600 as const,
    textTransform: 'uppercase' as const,
    letterSpacing: '1.2px',
    marginBottom: 7,
    paddingLeft: 2,
  };

  const renderAttention = () => {
    if (attention.length === 0) return null;
    return (
      <div style={{ marginBottom: 14 }}>
        <div style={{ ...SECTION_HEADER, color: COLORS.amber }}>
          {labels.needsAttention}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {attention.map(item => renderRow(item))}
        </div>
      </div>
    );
  };

  // Session 15A: Phase-aware section labels
  const phase = getDayPhase();

  const renderNext = () => {
    if (next.length === 0) return null;
    const nextLabel = labels.whatsNext;
    return (
      <div style={{ marginBottom: 14 }}>
        <div style={{ ...SECTION_HEADER, color: 'rgba(240,235,224,0.48)' }}>
          {nextLabel}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {next.map(item => renderRow(item))}
        </div>
      </div>
    );
  };

  const renderActive = () => {
    if (active.length === 0) return null;
    return (
      <div style={{ marginBottom: 14 }}>
        <div style={{ ...SECTION_HEADER, color: 'rgba(240,235,224,0.32)' }}>
          {labels.activeItems}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {active.map(item => renderRow(item))}
        </div>
      </div>
    );
  };

  const renderPeople = () => {
    if (people.length === 0) return null;
    return (
      <div style={{ marginBottom: 14 }}>
        <div style={{ ...SECTION_HEADER, color: 'rgba(240,235,224,0.28)' }}>
          {labels.people}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {people.map(item => renderRow(item))}
        </div>
      </div>
    );
  };

  // ── 5. MOMENTUM (SESSION 14E: Enhanced) ───────────────────
  // Tasks completed today, streaks, progress signal.
  // Subtle, rewarding. Never aggressive.
  const renderMomentum = () => {
    const hasCompletions = completedTodayCount !== undefined && completedTodayCount > 0;
    const hasStreak = streakDays !== undefined && streakDays > 1;
    if (!hasCompletions && !hasStreak) return null;

    // Session 14E: Momentum-aware styling
    const progressColor = momentumLevel === 'fire'
      ? COLORS.amber
      : momentumLevel === 'active'
        ? COLORS.green
        : 'rgba(72,200,120,0.7)';

    return (
      <div style={{ marginBottom: 14 }}>
        <div style={{ ...SECTION_HEADER, color: 'rgba(240,235,224,0.24)' }}>
          {labels.momentum}
        </div>
        <div
          style={{
            ...ROW_STYLE,
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            borderColor: momentumLevel !== 'rest'
              ? `rgba(72,200,120,0.08)`
              : undefined,
          }}
        >
          {hasCompletions && (
            <span style={{
              fontSize: 12,
              color: progressColor,
              fontWeight: 500,
              transition: `color ${TIMING.SLOW}ms ${EASING.gentle}`,
            }}>
              {completedTodayCount} done today
            </span>
          )}
          {hasStreak && (
            <span style={{ fontSize: 12, color: COLORS.amber, fontWeight: 500 }}>
              {streakDays}d streak
            </span>
          )}
          {momentumLevel === 'fire' && (
            <span style={{
              fontSize: 10,
              color: COLORS.amberDim,
              fontWeight: 400,
              fontStyle: 'italic',
            }}>
              on a roll
            </span>
          )}
        </div>
      </div>
    );
  };

  // ── MINIMAL SETTINGS ACCESS ─────────────────────────────
  // Not a nav menu. Just a single settings entry point.
  const renderSettingsAccess = () => (
    <div style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)', paddingTop: 4 }}>
      <button
        className="jove-tap"
        onClick={() => openSurface('settings')}
        style={{
          width: '100%',
          padding: '8px 0',
          borderRadius: 10,
          border: 'none',
          background: 'transparent',
          color: 'rgba(240,235,224,0.20)',
          fontSize: 11,
          fontWeight: 500,
          cursor: 'pointer',
          fontFamily: FONTS.sans,
          transition: TRANSITIONS.button,
        }}
      >
        {labels.settings}
      </button>
    </div>
  );

  // ── SESSION 15A: ACTION-FIRST EMPTY STATE ──────────────────
  const renderEmptyState = () => {
    const mainMessage = isLowDataState
      ? 'Start here.'
      : 'All clear.';
    const subMessage = isLowDataState
      ? 'Add what you\u2019re working on'
      : 'Nothing to act on right now.';

    return (
      <div
        style={{
          textAlign: 'center',
          padding: '28px 24px 20px',
        }}
      >
        <div
          style={{
            fontFamily: FONTS.serif,
            fontSize: 17,
            fontWeight: 300,
            color: 'rgba(252,246,234,0.50)',
            lineHeight: 1.5,
          }}
        >
          {mainMessage}
        </div>
        <div
          style={{
            fontSize: 12,
            fontWeight: 300,
            color: 'rgba(240,235,224,0.22)',
            lineHeight: 1.5,
            maxWidth: 260,
            margin: '8px auto 0',
          }}
        >
          {subMessage}
        </div>
      </div>
    );
  };

  // ── RENDER ──────────────────────────────────────────────
  // Dynamic ordering: filled sections first, empty sections collapse.
  // attention → next → active → people → momentum
  return (
    <>
      {/* Backdrop */}
      <div
        onClick={handleClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 70,
          background: sheetVisible ? 'rgba(6,10,18,0.38)' : 'rgba(6,10,18,0)',
          backdropFilter: sheetVisible ? 'blur(10px)' : 'blur(0px)',
          WebkitBackdropFilter: sheetVisible ? 'blur(10px)' : 'blur(0px)',
          transition: TRANSITIONS.overlay,
        }}
      />

      {/* Sheet */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 75,
          maxHeight: '82dvh',
          display: 'flex',
          flexDirection: 'column',
          background: 'linear-gradient(180deg, rgba(15,19,28,0.92) 0%, rgba(11,14,22,0.95) 100%)',
          backdropFilter: 'blur(40px) saturate(1.3)',
          WebkitBackdropFilter: 'blur(40px) saturate(1.3)',
          borderRadius: '22px 22px 0 0',
          borderTop: '0.5px solid rgba(240,235,224,0.06)',
          boxShadow: '0 -4px 32px rgba(0,0,0,0.22), 0 -0.5px 0 rgba(240,235,224,0.03) inset',
          transform: sheetVisible ? 'translateY(0)' : 'translateY(100%)',
          transition: `transform ${TIMING.STANDARD}ms ${EASING.standard}`,
          fontFamily: FONTS.sans,
        }}
      >
        {/* Handle */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            paddingTop: 10,
            paddingBottom: 10,
            flexShrink: 0,
          }}
        >
          <div
            onClick={handleClose}
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              background: 'rgba(240,235,224,0.10)',
              cursor: 'pointer',
            }}
          />
        </div>

        {/* Scrollable content — one continuous surface */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: '0 16px 6px',
            minHeight: 0,
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {hasContent ? (
            <>
              {renderAttention()}
              {renderNext()}
              {renderActive()}
              {renderPeople()}
              {renderMomentum()}
              {/* Session 14F: End-of-day closure — passive, calm signal */}
              {closureMessage && (
                <div
                  style={{
                    textAlign: 'center',
                    padding: '16px 20px 12px',
                    marginBottom: 8,
                  }}
                  onClick={() => onClosureDismiss?.()}
                >
                  <div
                    style={{
                      fontFamily: FONTS.serif,
                      fontSize: 16,
                      fontWeight: 300,
                      color: 'rgba(252,246,234,0.42)',
                      lineHeight: 1.5,
                      letterSpacing: '0.2px',
                    }}
                  >
                    {closureMessage}
                  </div>
                </div>
              )}
              {renderSettingsAccess()}
            </>
          ) : (
            <>
              {renderEmptyState()}
              {renderSettingsAccess()}
            </>
          )}
        </div>
      </div>

      {/* Reschedule sheet + action toast */}
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
