'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
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
import type { DealRow, MeetingRow, UserDomainProfile, ContactRow, ItemRow, PersonRow } from '@/lib/types';
import {
  DEFAULT_DOMAIN_PROFILE,
  getControlSurfaceLabels,
  getDomainAwareTerms,
} from '@/lib/semantic-labels';
import { normalizeItemStatus, dealStageToUniversalStatus } from '@/lib/types';
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
import {
  initMomentum,
  getMomentumStatusLine,
  onMomentumChange,
  type DailyMomentum,
  type ReinforcementMessage,
} from '@/lib/intelligence/momentum';
import type { RankedAction, PrioritizationResult } from '@/lib/prioritization/rankNextActions';
import type { SunTruthState } from '@/lib/prioritization/sunTruth';
import { compressReason, compressText } from '@/lib/output/compressState';
import {
  getPrimaryAction,
  type DecisionEngineOutput,
  type PrimaryAction as PrimaryActionType,
  type SecondaryAction as SecondaryActionType,
  type PrimaryActionSource,
} from '@/lib/intelligence/getPrimaryAction';

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
  /** Session 9: Real items from Items table. */
  items?: ItemRow[];
  /** Session 9: Real people from People table. */
  people?: PersonRow[];
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
  /** Session 18: Open UniversalCapture with context from any item. */
  onOpenCapture?: (context: {
    title: string;
    subtitle?: string;
    contextType: 'task' | 'item' | 'person' | 'event' | 'meeting' | 'deal' | 'none';
    contextId?: string;
    contextConfidence: 'high' | 'medium' | 'low';
  }) => void;
  /** Session 5: Prioritization result from truth engine. */
  prioritization?: PrioritizationResult | null;
  /** Session 5: Sun truth state. */
  sunTruth?: SunTruthState | null;
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
  /** Session 15: Scheduling state for visual distinction. */
  _schedulingState?: 'scheduled' | 'unscheduled' | 'waiting';
  /** Internal: zone assignment (not displayed). */
  _zone: 'attention' | 'next' | 'active' | 'people';
  /** Internal: sort key within a zone. Lower = higher. */
  _sortKey: number;
}

// ── SESSION 8: STATUS ICONS ─────────────────────────────────
// Lightweight SVG icons for state-driven rows.

const StatusIcon = ({ type }: { type: 'blocked' | 'upcoming' | 'waiting' | 'active' }) => {
  const size = 14;
  const common = { width: size, height: size, viewBox: '0 0 14 14', fill: 'none', xmlns: 'http://www.w3.org/2000/svg' } as const;

  switch (type) {
    case 'blocked':
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="5.5" stroke={COLORS.red} strokeWidth="1" strokeOpacity="0.5" />
          <line x1="4.5" y1="7" x2="9.5" y2="7" stroke={COLORS.red} strokeWidth="1" strokeOpacity="0.6" />
        </svg>
      );
    case 'upcoming':
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="5.5" stroke={COLORS.teal} strokeWidth="1" strokeOpacity="0.5" />
          <polyline points="7,4 7,7.5 9.5,7.5" stroke={COLORS.teal} strokeWidth="1" strokeOpacity="0.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'waiting':
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="5.5" stroke={COLORS.amber} strokeWidth="1" strokeOpacity="0.4" />
          <circle cx="4.5" cy="7" r="0.8" fill={COLORS.amber} fillOpacity="0.5" />
          <circle cx="7" cy="7" r="0.8" fill={COLORS.amber} fillOpacity="0.5" />
          <circle cx="9.5" cy="7" r="0.8" fill={COLORS.amber} fillOpacity="0.5" />
        </svg>
      );
    case 'active':
    default:
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="2" fill={COLORS.green} fillOpacity="0.4" />
        </svg>
      );
  }
};

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

// ── SESSION 8: Derive active item status ────────────────────
function deriveActiveStatus(deal: DealWithAccount, now: Date): 'blocked' | 'upcoming' | 'waiting' | 'active' {
  if (deal.snoozed_until && new Date(deal.snoozed_until) > now) return 'waiting';
  const days = getDaysSince(deal.last_activity_at);
  if (days > 14) return 'blocked';
  return 'active';
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
  items: itemsProp,
  people: peopleProp,
  contacts,
  completedTodayCount,
  streakDays,
  closureMessage,
  onClosureDismiss,
  onOpenCapture,
  prioritization,
  sunTruth,
}: ControlSurfaceProps) {
  const { navigateTo } = useSurface();
  const router = useRouter();
  const [sheetVisible, setSheetVisible] = useState(false);
  const labels = useMemo(
    () => getControlSurfaceLabels(domainProfile ?? DEFAULT_DOMAIN_PROFILE),
    [domainProfile],
  );
  const domainTerms = useMemo(
    () => getDomainAwareTerms(domainProfile ?? DEFAULT_DOMAIN_PROFILE),
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

  // ── Session 14E: Momentum computation (legacy) ──
  const momentumLevel = useMemo(() => {
    if (sessionCompletions >= MOMENTUM.fireThreshold) return 'fire';
    if (sessionCompletions >= MOMENTUM.activeThreshold) return 'active';
    return 'rest';
  }, [sessionCompletions]);

  // ── Session 16A: Real momentum system ──
  const [momentumStatusLine, setMomentumStatusLine] = useState<string | null>(null);
  const [reinforcementText, setReinforcementText] = useState<string | null>(null);

  useEffect(() => {
    initMomentum();
    setMomentumStatusLine(getMomentumStatusLine());

    const unsub = onMomentumChange(
      (_daily: DailyMomentum, reinforcement: ReinforcementMessage | null) => {
        setMomentumStatusLine(getMomentumStatusLine());
        if (reinforcement?.shouldShow) {
          setReinforcementText(reinforcement.text);
          // Auto-dismiss after 3 seconds
          setTimeout(() => setReinforcementText(null), 3000);
        }
      },
    );
    return unsub;
  }, []);

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

  // ── SESSION 17: DECISION ENGINE ─────────────────────────
  // Compute primary + secondary actions across tasks, items, people.
  // This replaces the old zone-first approach with a decision-first model.
  const decisionEngine = useMemo<DecisionEngineOutput | null>(() => {
    // Only run when we have DB tasks loaded (not in fallback mode)
    if (usingFallback) return null;
    const taskList = unifiedTasks ?? [];
    return getPrimaryAction({
      tasks: taskList,
      items: itemsProp ?? [],
      people: peopleProp ?? [],
      now: new Date(),
    });
  }, [unifiedTasks, usingFallback, itemsProp, peopleProp]);

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
        // Session 18: Route to unified item dashboard
        handleClose();
        setTimeout(() => router.push(`/item/${action.dealId}`), CLOSE_DELAY);
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
            _schedulingState: task.schedulingState,
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
          onClick: () => { handleClose(); setTimeout(() => router.push(`/item/${deal.id}`), CLOSE_DELAY); },
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
          // Session 15: Waiting tasks get dimmed styling
          subtitle: task.schedulingState === 'waiting' ? 'Waiting' : undefined,
          emphasis: false,
          onClick: task.action ? () => handleTaskAction(task.action!) : undefined,
          taskActions: { taskId: task.id },
          _schedulingState: task.schedulingState,
          _zone: 'next',
          _sortKey: task.schedulingState === 'waiting' ? 1 : 0,
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
    // Session 9: Now includes real Items alongside deals.
    const activeItems: SurfaceItem[] = [];

    // Session 9: Active items from Items table (non-done, non-dropped)
    const activeItemRows = (itemsProp ?? [])
      .filter(i => i.status !== 'done' && i.status !== 'dropped')
      .slice(0, 3);

    for (const item of activeItemRows) {
      const days = getDaysSince(item.last_activity_at);
      // Session 12: Use universal status model
      const normalized = normalizeItemStatus(item.status);
      const displayStatus = normalized === 'waiting' ? 'waiting'
        : normalized === 'blocked' ? 'blocked'
        : days > 7 ? 'blocked'
        : 'active';
      activeItems.push({
        id: `item-${item.id}`,
        title: item.name,
        subtitle: displayStatus === 'waiting' ? 'waiting'
          : displayStatus === 'blocked' ? `${days}d stale`
          : item.category ?? undefined,
        time: days === 0 ? 'today' : `${days}d`,
        emphasis: item.is_starred,
        onClick: () => router.push(`/item/${item.id}`),
        _zone: 'active',
        _sortKey: item.is_starred ? -1 : days,
      });
    }

    const remainingDeals = allDeals
      .filter(d => {
        if (placed.has(`deal-${d.id}`)) return false;
        return d.stage !== 'Closed Won' && d.stage !== 'Closed Lost';
      })
      .sort((a, b) => new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime())
      .slice(0, Math.max(0, 5 - activeItems.length));

    for (const deal of remainingDeals) {
      const days = getDaysSince(deal.last_activity_at);
      // Session 8: State-driven status instead of flat label
      const status = deriveActiveStatus(deal, now);
      activeItems.push({
        id: `deal-${deal.id}`,
        title: deal.name,
        subtitle: status === 'waiting' ? 'waiting' : status === 'blocked' ? `${days}d stale` : undefined,
        time: days === 0 ? 'today' : `${days}d`,
        emphasis: false,
        onClick: () => { handleClose(); setTimeout(() => router.push(`/item/${deal.id}`), CLOSE_DELAY); },
        _zone: 'active',
        _sortKey: days,
      });
    }

    // ── 4. PEOPLE (SESSION 9: REAL PEOPLE TABLE) ────────────
    // Uses People table data when available, falls back to contacts.
    const peopleItems: SurfaceItem[] = [];

    if (peopleProp && peopleProp.length > 0) {
      // Session 9/12: Real People table data — with natural follow-up language
      const recentPeople = peopleProp.slice(0, 3);

      for (const person of recentPeople) {
        const days = person.last_interaction_at ? getDaysSince(person.last_interaction_at) : null;
        // Session 12: People with stale interaction get action-oriented titles
        const isStale = days !== null && days > 14;
        const title = isStale
          ? `Reconnect with ${person.name}`
          : person.name;
        const subtitle = isStale
          ? `${days}d since last interaction`
          : person.relationship ?? undefined;
        peopleItems.push({
          id: `person-${person.id}`,
          title,
          subtitle,
          time: days !== null ? (days === 0 ? 'today' : `${days}d ago`) : undefined,
          emphasis: isStale,
          onClick: () => router.push(`/people/${person.id}`),
          _zone: 'people',
          _sortKey: days ?? 999,
        });
      }
    } else if (contacts && contacts.length > 0) {
      // Fallback to contacts (legacy behavior)
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
    itemsProp, peopleProp,
  ]);

  // ── ALL HOOKS ABOVE THIS LINE ───────────────────────────
  if (!open) return null;

  const { isLowDataState } = priority;
  const hasContent = attention.length > 0 || next.length > 0 || active.length > 0 || people.length > 0;
  // Session 8: Include prioritization primary action in content check
  const hasPrimaryAction = !!prioritization?.primaryAction;
  // Session 17: Decision engine provides primary action
  const hasDecisionEngine = !!decisionEngine && decisionEngine.primary.source !== 'clear';
  const hasAnything = hasContent || hasPrimaryAction || hasDecisionEngine;

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

  // ── Session 18 Patch: Derive capture context from item ID ──
  const deriveItemContext = (item: SurfaceItem) => {
    const ctxType = item.id.startsWith('meeting-') ? 'event' as const
      : item.id.startsWith('item-') ? 'item' as const
      : item.id.startsWith('deal-') || item.id.startsWith('attn-') ? 'deal' as const
      : item.id.startsWith('person-') ? 'person' as const
      : item.id.startsWith('task-') || item.id.startsWith('legacy-') ? 'task' as const
      : 'none' as const;
    const rawId = item.id.replace(/^(meeting|item|deal|attn|person|task|legacy)-/, '');
    const confidence = ctxType !== 'none' ? 'medium' as const : 'low' as const;
    return { ctxType, rawId, confidence };
  };

  // ── SESSION 19: ROW STYLES — COMPACT, STRUCTURED ──────────
  // Tighter rows, cleaner density. Feels like an execution layer, not a note list.

  const ROW_STYLE = {
    background: 'rgba(240,235,224,0.018)',
    border: '0.5px solid rgba(240,235,224,0.035)',
    borderRadius: 10,
    padding: '9px 12px',
    transition: `${TRANSITIONS.row}, transform ${TIMING.FAST}ms ${EASING.standard}, box-shadow ${TIMING.STANDARD}ms ${EASING.gentle}`,
  } as const;

  // ── Session 19: Smart row tap — route to the RIGHT destination ──
  // Items → item dashboard, People → person profile, Tasks → capture with context
  // NOT everything goes to generic capture anymore.
  const handleRowTap = (item: SurfaceItem) => {
    const { ctxType, rawId } = deriveItemContext(item);

    // Items → open item dashboard directly
    if (ctxType === 'item' && rawId) {
      handleClose();
      setTimeout(() => router.push(`/item/${rawId}`), CLOSE_DELAY);
      return;
    }

    // Deals → route to item dashboard (same as items, Session 18)
    if (ctxType === 'deal' && rawId) {
      handleClose();
      setTimeout(() => router.push(`/item/${rawId}`), CLOSE_DELAY);
      return;
    }

    // People → open person profile directly
    if (ctxType === 'person' && rawId) {
      handleClose();
      setTimeout(() => router.push(`/people/${rawId}`), CLOSE_DELAY);
      return;
    }

    // Meetings → use existing onClick (toggle inline expand)
    if (ctxType === 'event') {
      item.onClick?.();
      return;
    }

    // Tasks and other → open capture with context (the correct surface for logging/action)
    if (onOpenCapture) {
      handleClose();
      setTimeout(() => {
        onOpenCapture({
          title: item.title,
          subtitle: item.subtitle ?? item.time ? `${item.subtitle ?? ''}${item.subtitle && item.time ? ' \u00b7 ' : ''}${item.time ?? ''}` : undefined,
          contextType: ctxType,
          contextId: rawId,
          contextConfidence: ctxType !== 'none' ? 'medium' : 'low',
        });
      }, CLOSE_DELAY + 40);
      return;
    }

    // Fallback: use original onClick
    item.onClick?.();
  };

  // ── SESSION 8: UNIFIED ROW RENDERER ──────────────────────
  // Every row: title + subtitle + time + actions + status icon.
  // Staggered entrance animation via index.

  const renderRow = (item: SurfaceItem, index: number = 0, showStatusIcon: boolean = false) => {
    const isPending = item.taskActions ? taskActionPending === item.taskActions.taskId : false;
    const isCompleted = item.taskActions ? completedIds.has(item.taskActions.taskId) : false;
    const isMeeting = item.id.startsWith('meeting-');
    const meetingId = isMeeting ? item.id.replace('meeting-', '') : null;
    const isExpanded = meetingId ? expandedMeetingId === meetingId : false;

    // Session 8: Derive status for icon
    const statusType: 'blocked' | 'upcoming' | 'waiting' | 'active' = (() => {
      if (item.subtitle === 'waiting') return 'waiting';
      if (item.subtitle?.includes('stale')) return 'blocked';
      if (isMeeting) return 'upcoming';
      return 'active';
    })();

    return (
      <div
        key={item.id}
        className="jove-tap"
        onClick={() => handleRowTap(item)}
        style={{
          ...ROW_STYLE,
          borderColor: isCompleted
            ? 'rgba(72,200,120,0.15)'
            : isExpanded ? 'rgba(240,235,224,0.06)' : undefined,
          cursor: 'pointer',
          opacity: isPending && !isCompleted ? 0.4 : 1,
          animation: isCompleted
            ? (isFirstCompletionToday && sessionCompletions === 1
              ? 'firstCompletionGlow 700ms ease forwards'
              : 'completionGlow 700ms ease forwards')
            : `s8FadeIn ${TIMING.STANDARD}ms ${EASING.standard} ${index * 40}ms both`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
            {/* Session 8: Status icon for active items */}
            {showStatusIcon && (
              <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                <StatusIcon type={statusType} />
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 400,
                  // Session 15: Waiting tasks get dimmed text
                  color: item._schedulingState === 'waiting'
                    ? 'rgba(252,246,234,0.45)'
                    : 'rgba(252,246,234,0.88)',
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

            {/* Session 18 Patch: Secondary nav affordance — chevron to detail view */}
            {item.onClick && (
              <button
                className="jove-tap"
                onClick={(e) => {
                  e.stopPropagation();
                  // For meetings, toggle inline expand instead of navigating
                  if (isMeeting && meetingId) {
                    setExpandedMeetingId(prev => prev === meetingId ? null : meetingId);
                    return;
                  }
                  item.onClick!();
                }}
                aria-label="Open detail"
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  border: 'none',
                  background: 'transparent',
                  color: 'rgba(240,235,224,0.22)',
                  fontSize: 14,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  padding: 0,
                  transition: TRANSITIONS.button,
                }}
              >
                ›
              </button>
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
              animation: `s8FadeIn ${TIMING.FAST}ms ${EASING.standard} both`,
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

  // ── SESSION 8: SECTION HEADER ─────────────────────────────
  // Consistent, minimal. Tighter spacing.

  const SECTION_HEADER = {
    fontSize: 10,
    fontWeight: 600 as const,
    textTransform: 'uppercase' as const,
    letterSpacing: '1.2px',
    marginBottom: 7,
    paddingLeft: 2,
  };

  // ══════════════════════════════════════════════════════════
  // SESSION 8: "DO THIS NEXT" — DOMINANT PRIMARY CARD
  // ══════════════════════════════════════════════════════════
  // The system's single recommendation. Larger than everything else.
  // Visually distinct. Feels like a recommendation, not a list item.

  const mapRankedActionContextType = (a: RankedAction): 'task' | 'item' | 'person' | 'event' | 'meeting' | 'deal' | 'none' => {
    if (!a.contextType) return 'none';
    return a.contextType;
  };

  // Session 19: Legacy ranked action tap — smart routing like decision engine
  const handleDoThisNextTap = useCallback((action: RankedAction) => {
    const ctxType = mapRankedActionContextType(action);

    // Item → item dashboard
    if (ctxType === 'item' && action.contextId) {
      handleClose();
      setTimeout(() => router.push(`/item/${action.contextId}`), CLOSE_DELAY);
      return;
    }

    // Deal → item dashboard (Session 18: unified destination)
    if (ctxType === 'deal' && action.contextId) {
      handleClose();
      setTimeout(() => router.push(`/item/${action.contextId}`), CLOSE_DELAY);
      return;
    }

    // Person → person profile
    if (ctxType === 'person' && action.contextId) {
      handleClose();
      setTimeout(() => router.push(`/people/${action.contextId}`), CLOSE_DELAY);
      return;
    }

    // Task/other → capture with context
    if (onOpenCapture) {
      handleClose();
      setTimeout(() => {
        onOpenCapture({
          title: action.title,
          subtitle: action.subtitle,
          contextType: ctxType,
          contextId: action.contextId,
          contextConfidence: 'medium',
        });
      }, CLOSE_DELAY + 40);
    }
  }, [onOpenCapture, handleClose, router, openSurface]);

  // ── SESSION 17: Decision engine tap handler ──────────────
  // Routes based on source type:
  //   task → open capture with task context
  //   item → open item dashboard
  //   person → open person profile
  //   clear → no-op
  const handleDecisionTap = useCallback((
    source: PrimaryActionSource,
    sourceId: string,
    label: string,
    context: string,
  ) => {
    if (source === 'clear') return;

    if (source === 'task') {
      // Open capture with task context
      if (onOpenCapture) {
        handleClose();
        setTimeout(() => {
          onOpenCapture({
            title: label,
            subtitle: context,
            contextType: 'task',
            contextId: sourceId,
            contextConfidence: 'high',
          });
        }, CLOSE_DELAY + 40);
      }
      return;
    }

    if (source === 'item') {
      handleClose();
      setTimeout(() => router.push(`/item/${sourceId}`), CLOSE_DELAY);
      return;
    }

    if (source === 'person') {
      handleClose();
      setTimeout(() => router.push(`/people/${sourceId}`), CLOSE_DELAY);
      return;
    }
  }, [onOpenCapture, handleClose, router]);

  // ══════════════════════════════════════════════════════════
  // SESSION 17: DECISION ENGINE — PRIMARY ACTION CARD
  // ══════════════════════════════════════════════════════════
  // The system's single recommendation. 1.5-2x size of secondary items.
  // User should NOT scan — they should instantly see what to do.

  const renderDoThisNext = () => {
    // Session 17: Prefer decision engine over legacy prioritization
    if (decisionEngine) {
      return renderDecisionEngine();
    }
    // Fallback to legacy ranked action system
    if (!prioritization?.primaryAction) return null;
    return renderLegacyDoThisNext();
  };

  const renderDecisionEngine = () => {
    if (!decisionEngine) return null;
    const { primary, secondaries } = decisionEngine;
    const isClear = primary.source === 'clear';

    return (
      <div style={{
        marginBottom: 20,
        animation: `s8FadeIn ${TIMING.SLOW}ms ${EASING.standard} both`,
      }}>
        {/* ── PRIMARY ACTION — DOMINANT, CENTERED ── */}
        <div
          className={isClear ? undefined : 'jove-tap'}
          onClick={isClear ? undefined : () => handleDecisionTap(primary.source, primary.sourceId, primary.label, primary.context)}
          style={{
            background: isClear
              ? 'transparent'
              : 'linear-gradient(135deg, rgba(232,160,48,0.10) 0%, rgba(232,160,48,0.03) 100%)',
            border: isClear
              ? 'none'
              : '0.5px solid rgba(232,160,48,0.18)',
            borderRadius: 16,
            padding: isClear ? '28px 20px 20px' : '20px 18px 16px',
            cursor: isClear ? 'default' : 'pointer',
            marginBottom: secondaries.length > 0 ? 10 : 0,
            textAlign: isClear ? 'center' : 'left',
            transition: `${TRANSITIONS.row}, box-shadow ${TIMING.STANDARD}ms ${EASING.gentle}`,
            boxShadow: isClear
              ? 'none'
              : '0 2px 16px rgba(232,160,48,0.05), 0 0 0 0 transparent',
          }}
        >
          {/* Primary label — 1.5-2x size, highest contrast */}
          <span
            style={{
              fontSize: isClear ? 22 : 19,
              fontWeight: isClear ? 300 : 500,
              color: isClear ? 'rgba(252,246,234,0.50)' : 'rgba(252,246,234,0.96)',
              display: 'block',
              lineHeight: 1.3,
              fontFamily: isClear ? FONTS.serif : FONTS.sans,
              letterSpacing: isClear ? '0.3px' : '-0.2px',
            }}
          >
            {primary.label}
          </span>
          {/* Context subline */}
          {primary.context && (
            <span
              style={{
                fontSize: isClear ? 13 : 12,
                fontWeight: isClear ? 300 : 400,
                color: isClear ? 'rgba(240,235,224,0.22)' : 'rgba(240,235,224,0.42)',
                marginTop: isClear ? 8 : 5,
                display: 'block',
                lineHeight: 1.4,
              }}
            >
              {primary.context}
            </span>
          )}
        </div>

        {/* ── SECONDARY ACTIONS — MAX 3, LIGHTER, SMALLER ── */}
        {secondaries.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {secondaries.map((action, i) => (
              <div
                key={`decision-${action.source}-${action.sourceId}-${i}`}
                className="jove-tap"
                onClick={() => handleDecisionTap(action.source, action.sourceId, action.label, action.context)}
                style={{
                  background: 'rgba(240,235,224,0.02)',
                  border: '0.5px solid rgba(240,235,224,0.04)',
                  borderRadius: 11,
                  padding: '9px 13px',
                  cursor: 'pointer',
                  transition: `${TRANSITIONS.row}, transform ${TIMING.FAST}ms ${EASING.standard}`,
                  animation: `s8FadeIn ${TIMING.STANDARD}ms ${EASING.standard} ${(i + 1) * 60}ms both`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 400,
                        color: 'rgba(252,246,234,0.72)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        display: 'block',
                      }}
                    >
                      {action.label}
                    </span>
                    {action.context && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 400,
                          color: 'rgba(240,235,224,0.22)',
                          marginTop: 1,
                          display: 'block',
                        }}
                      >
                        {action.context}
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: 13, color: 'rgba(240,235,224,0.16)', flexShrink: 0 }}>›</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // Legacy fallback for when decision engine is not available (fallback mode)
  const renderLegacyDoThisNext = () => {
    if (!prioritization?.primaryAction) return null;

    const primary = prioritization.primaryAction;
    const secondaries = prioritization.secondaryActions;

    return (
      <div style={{
        marginBottom: 20,
        animation: `s8FadeIn ${TIMING.SLOW}ms ${EASING.standard} both`,
      }}>
        <div style={{ ...SECTION_HEADER, color: COLORS.amber, marginBottom: 10 }}>
          DO THIS NEXT
        </div>
        <div
          className="jove-tap"
          onClick={() => handleDoThisNextTap(primary)}
          style={{
            background: 'linear-gradient(135deg, rgba(232,160,48,0.08) 0%, rgba(232,160,48,0.03) 100%)',
            border: '0.5px solid rgba(232,160,48,0.16)',
            borderRadius: 14,
            padding: '16px 16px 14px',
            cursor: 'pointer',
            marginBottom: secondaries.length > 0 ? 8 : 0,
            transition: `${TRANSITIONS.row}, box-shadow ${TIMING.STANDARD}ms ${EASING.gentle}`,
            boxShadow: '0 2px 12px rgba(232,160,48,0.04), 0 0 0 0 transparent',
          }}
        >
          <span
            style={{
              fontSize: 16,
              fontWeight: 500,
              color: 'rgba(252,246,234,0.95)',
              display: 'block',
              lineHeight: 1.3,
              fontFamily: FONTS.sans,
            }}
          >
            {primary.title}
          </span>
          {(primary.subtitle || primary.reason) && (
            <span
              style={{
                fontSize: 12,
                fontWeight: 400,
                color: 'rgba(240,235,224,0.40)',
                marginTop: 4,
                display: 'block',
                lineHeight: 1.4,
              }}
            >
              {primary.subtitle ?? compressReason(primary.reason)}
            </span>
          )}
        </div>
        {secondaries.map((action, i) => (
          <div
            key={action.id}
            className="jove-tap"
            onClick={() => handleDoThisNextTap(action)}
            style={{
              background: 'rgba(240,235,224,0.02)',
              border: '0.5px solid rgba(240,235,224,0.04)',
              borderRadius: 11,
              padding: '9px 13px',
              cursor: 'pointer',
              marginBottom: i < secondaries.length - 1 ? 4 : 0,
              transition: `${TRANSITIONS.row}, transform ${TIMING.FAST}ms ${EASING.standard}`,
              animation: `s8FadeIn ${TIMING.STANDARD}ms ${EASING.standard} ${(i + 1) * 50}ms both`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 400,
                    color: 'rgba(252,246,234,0.78)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    display: 'block',
                  }}
                >
                  {action.title}
                </span>
                {action.reason && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 400,
                      color: 'rgba(240,235,224,0.25)',
                      marginTop: 1,
                      display: 'block',
                    }}
                  >
                    {compressReason(action.reason)}
                  </span>
                )}
              </div>
              <span style={{ fontSize: 13, color: 'rgba(240,235,224,0.18)', flexShrink: 0 }}>›</span>
            </div>
          </div>
        ))}
      </div>
    );
  };

  // ══════════════════════════════════════════════════════════
  // SESSION 8: ATTENTION SECTION
  // ══════════════════════════════════════════════════════════

  const renderAttention = () => {
    if (attention.length === 0) return null;
    // Session 8/17: Skip this section if we show decision engine or "Do This Next"
    // to avoid visual redundancy at the top
    if (hasPrimaryAction || hasDecisionEngine) return null;
    return (
      <div style={{
        marginBottom: 16,
        animation: `s8FadeIn ${TIMING.STANDARD}ms ${EASING.standard} both`,
      }}>
        <div style={{ ...SECTION_HEADER, color: COLORS.amber }}>
          {labels.needsAttention}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {attention.map((item, i) => renderRow(item, i))}
        </div>
      </div>
    );
  };

  // Session 15A: Phase-aware section labels
  const phase = getDayPhase();

  // ══════════════════════════════════════════════════════════
  // SESSION 19: ACTIVE SECTION — COMPACT, STRUCTURED, IMPORTANT
  // ══════════════════════════════════════════════════════════
  // Items and tasks feel like real work objects, not a flat list.
  // State-driven grouping with visible status indicators.

  const renderActive = () => {
    const hasTopAction = hasPrimaryAction || hasDecisionEngine;
    const activeAndNext = hasTopAction
      ? [...next, ...active]
      : active;

    if (activeAndNext.length === 0) return null;

    // Session 19: Limit to top 5 to avoid list sprawl
    const capped = activeAndNext.slice(0, 5);

    return (
      <div style={{
        marginBottom: 14,
        animation: `s8FadeIn ${TIMING.STANDARD}ms ${EASING.standard} 80ms both`,
      }}>
        <div style={{ ...SECTION_HEADER, color: 'rgba(240,235,224,0.30)', fontSize: 9, letterSpacing: '1.4px' }}>
          IN MOTION
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {capped.map((item, i) => renderRow(item, i, true))}
        </div>
      </div>
    );
  };

  // ══════════════════════════════════════════════════════════
  // SESSION 8: NEXT SECTION (only when no DO THIS NEXT)
  // ══════════════════════════════════════════════════════════

  const renderNext = () => {
    // Session 8/17: When we have decision engine or DO THIS NEXT, next items merge into Active
    if (hasPrimaryAction || hasDecisionEngine) return null;
    if (next.length === 0) return null;
    return (
      <div style={{
        marginBottom: 16,
        animation: `s8FadeIn ${TIMING.STANDARD}ms ${EASING.standard} 40ms both`,
      }}>
        <div style={{ ...SECTION_HEADER, color: 'rgba(240,235,224,0.48)' }}>
          {labels.whatsNext}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {next.map((item, i) => renderRow(item, i))}
        </div>
      </div>
    );
  };

  // ══════════════════════════════════════════════════════════
  // SESSION 19: PEOPLE — RELATIONSHIP INTELLIGENCE
  // ══════════════════════════════════════════════════════════
  // Feels like "the system remembers who matters."
  // Compact inline layout, tappable into profiles.

  const renderPeople = () => {
    if (people.length === 0) return null;
    return (
      <div style={{
        marginBottom: 14,
        animation: `s8FadeIn ${TIMING.STANDARD}ms ${EASING.standard} 120ms both`,
      }}>
        <div style={{ ...SECTION_HEADER, color: 'rgba(240,235,224,0.22)', fontSize: 9, letterSpacing: '1.4px' }}>
          PEOPLE
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {people.map((item, i) => {
            const isStale = item.emphasis;
            return (
              <div
                key={item.id}
                className="jove-tap"
                onClick={() => handleRowTap(item)}
                style={{
                  ...ROW_STYLE,
                  cursor: 'pointer',
                  animation: `s8FadeIn ${TIMING.STANDARD}ms ${EASING.standard} ${(i + 1) * 40 + 120}ms both`,
                  borderColor: isStale ? 'rgba(232,160,48,0.06)' : undefined,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: isStale ? 400 : 300,
                        color: isStale ? 'rgba(252,246,234,0.82)' : 'rgba(252,246,234,0.65)',
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
                          fontSize: 10,
                          fontWeight: 300,
                          color: isStale ? 'rgba(232,160,48,0.38)' : 'rgba(240,235,224,0.22)',
                          marginTop: 1,
                          display: 'block',
                        }}
                      >
                        {item.subtitle}
                      </span>
                    )}
                  </div>
                  {item.time && (
                    <span style={{
                      fontSize: 10,
                      fontWeight: 300,
                      color: isStale ? 'rgba(232,160,48,0.35)' : 'rgba(240,235,224,0.28)',
                      flexShrink: 0,
                    }}>
                      {item.time}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ── 5. MOMENTUM (SESSION 16A: Real progress reflection) ────
  const renderMomentum = () => {
    if (!momentumStatusLine) return null;

    return (
      <div style={{ marginBottom: 14 }}>
        <div
          style={{
            textAlign: 'center',
            padding: '12px 16px 8px',
          }}
        >
          <span
            style={{
              fontFamily: FONTS.serif,
              fontSize: 14,
              fontWeight: 300,
              color: 'rgba(252,246,234,0.36)',
              letterSpacing: '0.2px',
              lineHeight: 1.5,
            }}
          >
            {compressText(momentumStatusLine, 60)}
          </span>
        </div>
      </div>
    );
  };

  // ── Session 16A: Micro reinforcement feedback ──
  const renderReinforcement = () => {
    if (!reinforcementText) return null;

    return (
      <div
        style={{
          position: 'fixed',
          bottom: 'calc(84dvh + 12px)',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 80,
          padding: '6px 14px',
          borderRadius: 10,
          background: 'rgba(15,19,28,0.85)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '0.5px solid rgba(72,200,120,0.12)',
          animation: `s8FadeIn ${TIMING.FAST}ms ${EASING.standard} both`,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: 'rgba(72,200,120,0.75)',
            fontFamily: FONTS.sans,
          }}
        >
          {reinforcementText}
        </span>
      </div>
    );
  };

  // ── SESSION 19: SYSTEM NAVIGATION ROW ───────────────────
  // Gateway to full Tasks, People, Items views.
  // Must feel like navigation, not content. Sits below all decision content.
  const NAV_ITEMS = [
    { label: 'Tasks', route: '/tasks' },
    { label: 'People', route: '/people' },
    { label: 'Items', route: '/items' },
  ] as const;

  const renderSystemNav = () => (
    <div style={{
      display: 'flex',
      gap: 6,
      padding: '6px 0 4px',
      marginBottom: 4,
    }}>
      {NAV_ITEMS.map((nav) => (
        <button
          key={nav.route}
          className="jove-tap"
          onClick={() => {
            handleClose();
            setTimeout(() => router.push(nav.route), CLOSE_DELAY);
          }}
          style={{
            flex: 1,
            padding: '10px 0',
            borderRadius: 10,
            border: '0.5px solid rgba(240,235,224,0.06)',
            background: 'rgba(240,235,224,0.025)',
            color: 'rgba(240,235,224,0.50)',
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
            fontFamily: FONTS.sans,
            letterSpacing: '0.3px',
            transition: TRANSITIONS.button,
          }}
        >
          {nav.label}
        </button>
      ))}
    </div>
  );

  // ── MINIMAL SETTINGS ACCESS ─────────────────────────────
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

  // ══════════════════════════════════════════════════════════
  // SESSION 8: EMPTY STATE — CALM, INTENTIONAL
  // ══════════════════════════════════════════════════════════
  // "You're clear." — strong, satisfying.
  // Optional light prompt: "Anything new?"

  const renderEmptyState = () => {
    // Session 17: If decision engine says clear, use its language
    const decisionClear = decisionEngine?.primary.source === 'clear';
    const mainMessage = isLowDataState
      ? 'Start here.'
      : decisionClear
        ? decisionEngine!.primary.label
        : "You're clear.";
    const subMessage = isLowDataState
      ? 'Add what you\u2019re working on.'
      : decisionClear && decisionEngine!.primary.context
        ? decisionEngine!.primary.context
        : 'Anything new?';

    return (
      <div
        style={{
          textAlign: 'center',
          padding: '36px 24px 24px',
          animation: `s8FadeIn ${TIMING.SLOW}ms ${EASING.standard} both`,
        }}
      >
        <div
          style={{
            fontFamily: FONTS.serif,
            fontSize: 20,
            fontWeight: 300,
            color: 'rgba(252,246,234,0.55)',
            lineHeight: 1.4,
            letterSpacing: '0.3px',
          }}
        >
          {mainMessage}
        </div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 300,
            color: 'rgba(240,235,224,0.20)',
            lineHeight: 1.5,
            maxWidth: 240,
            margin: '10px auto 0',
          }}
        >
          {subMessage}
        </div>
      </div>
    );
  };

  // ══════════════════════════════════════════════════════════
  // SESSION 19: MAIN RENDER — DECISION-FIRST LAYOUT
  // ══════════════════════════════════════════════════════════
  // Order: PRIMARY ACTION (dominant) → IN MOTION (compact) → PEOPLE → momentum
  // The system tells the user what to do. Not a list. A decision.
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

      {/* Session 19: Decision panel — premium glass sheet */}
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
          background: 'linear-gradient(180deg, rgba(14,18,26,0.94) 0%, rgba(10,13,20,0.97) 100%)',
          backdropFilter: 'blur(48px) saturate(1.4)',
          WebkitBackdropFilter: 'blur(48px) saturate(1.4)',
          borderRadius: '24px 24px 0 0',
          borderTop: '0.5px solid rgba(240,235,224,0.07)',
          boxShadow: '0 -6px 40px rgba(0,0,0,0.28), 0 -0.5px 0 rgba(240,235,224,0.04) inset',
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

        {/* Session 19: Scrollable content — decision-first surface */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: '2px 18px 8px',
            minHeight: 0,
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {hasAnything ? (
            <>
              {/* Session 19: Decision-first layout */}
              {/* 1. PRIMARY ACTION — dominant, the system's decision */}
              {renderDoThisNext()}
              {/* 2. ATTENTION — only when no decision engine */}
              {renderAttention()}
              {/* 3. NEXT — only when no decision engine */}
              {renderNext()}
              {/* 4. IN MOTION — compact structured items */}
              {renderActive()}
              {/* 5. PEOPLE — relationship intelligence */}
              {renderPeople()}
              {/* 6. MOMENTUM — reflective */}
              {renderMomentum()}
              {/* Session 14F: End-of-day closure */}
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
              {/* Session 19: System navigation — gateway to full views */}
              {renderSystemNav()}
              {renderSettingsAccess()}
            </>
          ) : (
            <>
              {renderEmptyState()}
              {/* Session 19: System navigation — always visible, even when clear */}
              {renderSystemNav()}
              {renderSettingsAccess()}
            </>
          )}
        </div>
      </div>

      {/* Session 16A: Micro reinforcement toast */}
      {renderReinforcement()}

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
