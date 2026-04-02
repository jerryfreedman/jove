// ── SESSION 11C: TASK QUERY LAYER ──────────────────────────
// Shared read abstraction for persistent tasks.
// All task reads go through this file — no raw queries in components.
//
// Reads from the tasks table (written by Session 11B persistence layer).
// Returns normalized shapes for UI consumption.
//
// Key principle: user-created and system-derived tasks look the same
// to the consumer. Source distinction is internal only.

'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { createClient } from '@/lib/supabase';
import type { TaskRow, TaskStatus } from '@/lib/types';
import type { TaskAction } from '@/lib/task-types';
import { onReflection } from '@/lib/chat/reflection';
// Session 15: Task scheduling state for lifecycle clarity
import { getTaskSchedulingState, type TaskSchedulingState } from '@/lib/tasks/taskSchedulingState';

// ── TYPES ──────────────────────────────────────────────────

/** Unified task shape for UI consumption. Source-agnostic. */
export interface DisplayTask {
  id: string;
  title: string;
  status: TaskStatus;
  priority: number | null;
  dueAt: string | null;         // ISO 8601
  dealId: string | null;
  meetingId: string | null;
  source: 'user' | 'system';
  sourceType: string | null;
  action: TaskAction | null;
  createdAt: string;
  updatedAt: string;
  /** Session 15: Scheduling state for lifecycle clarity */
  schedulingState: TaskSchedulingState;
}

export interface UseTasksResult {
  tasks: DisplayTask[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

// ── TRANSFORM ──────────────────────────────────────────────

function toDisplayTask(row: TaskRow): DisplayTask {
  const schedulingInfo = getTaskSchedulingState({
    title: row.title,
    dueAt: row.due_at,
    status: row.status,
  });

  return {
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    dueAt: row.due_at,
    dealId: row.deal_id,
    meetingId: row.meeting_id,
    source: row.source,
    sourceType: row.source_type,
    action: row.action as TaskAction | null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    schedulingState: schedulingInfo.state,
  };
}

// Session 15: Junk task patterns that should be suppressed from task lists
const JUNK_TASK_PATTERNS = [
  /(?:call went|meeting went|demo went|nothing happened)/i,
  /^idk\.?$/i,
  /^nothing\.?$/i,
  /^no update\.?$/i,
  /^waiting\.?$/i,
  /^same\.?$/i,
];

function isJunkTask(title: string): boolean {
  return JUNK_TASK_PATTERNS.some(p => p.test(title));
}

// ── SESSION 15C: ENHANCED PRIORITIZATION ──────────────────
// Tuned weights for intelligent task ordering:
//   1. Time-sensitive items first (due within 4h get boost)
//   2. Due date soonest (nulls last)
//   3. Explicit priority (lower = urgent, nulls last)
//   4. User-created > system-inferred (explicit intent wins)
//   5. Specific actions (strong verbs) > generic items
//   6. Committed items (has dealId/meetingId) > unlinked
//   7. Penalize generic/short titles
//   8. Recency as final fallback

const STRONG_ACTION_VERBS = new Set([
  'confirm', 'send', 'schedule', 'call', 'prepare', 'lock',
  'draft', 'ask', 'decide', 'align', 'book', 'submit', 'notify',
]);

const GENERIC_TITLE_PATTERNS = [
  /^follow\s+up$/i,
  /^check\s+in$/i,
  /^review\s+project$/i,
  /^think\s+about/i,
  /^consider\s+/i,
];

function isGenericTitle(title: string): boolean {
  if (title.trim().split(/\s+/).length <= 2) return true;
  return GENERIC_TITLE_PATTERNS.some(p => p.test(title));
}

function hasStrongVerb(title: string): boolean {
  const firstWord = title.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  return STRONG_ACTION_VERBS.has(firstWord);
}

function whatMattersSort(a: DisplayTask, b: DisplayTask): number {
  const now = Date.now();

  // Session 15: Waiting/blocked tasks sort after active tasks
  const aWaiting = a.schedulingState === 'waiting';
  const bWaiting = b.schedulingState === 'waiting';
  if (aWaiting && !bWaiting) return 1;
  if (!aWaiting && bWaiting) return -1;

  // 1. Items due within 4 hours always win over items without near-term due dates
  const aImminentDue = a.dueAt && (new Date(a.dueAt).getTime() - now) <= 4 * 60 * 60 * 1000 && new Date(a.dueAt).getTime() > 0;
  const bImminentDue = b.dueAt && (new Date(b.dueAt).getTime() - now) <= 4 * 60 * 60 * 1000 && new Date(b.dueAt).getTime() > 0;
  if (aImminentDue && !bImminentDue) return -1;
  if (!aImminentDue && bImminentDue) return 1;

  // 2. Due date: soonest first, nulls last
  if (a.dueAt && b.dueAt) {
    const diff = new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    if (diff !== 0) return diff;
  } else if (a.dueAt && !b.dueAt) {
    return -1;
  } else if (!a.dueAt && b.dueAt) {
    return 1;
  }

  // 3. Priority: lower number = more urgent, nulls last
  if (a.priority !== null && b.priority !== null) {
    const diff = a.priority - b.priority;
    if (diff !== 0) return diff;
  } else if (a.priority !== null && b.priority === null) {
    return -1;
  } else if (a.priority === null && b.priority !== null) {
    return 1;
  }

  // 4. User-created > system-inferred (explicit intent wins)
  if (a.source !== b.source) {
    return a.source === 'user' ? -1 : 1;
  }

  // 5. Strong action verbs sort before generic titles
  const aStrong = hasStrongVerb(a.title);
  const bStrong = hasStrongVerb(b.title);
  if (aStrong && !bStrong) return -1;
  if (!aStrong && bStrong) return 1;

  // 6. Committed items (linked to deal/meeting) > unlinked
  const aLinked = !!(a.dealId || a.meetingId);
  const bLinked = !!(b.dealId || b.meetingId);
  if (aLinked && !bLinked) return -1;
  if (!aLinked && bLinked) return 1;

  // 7. Penalize generic/short titles
  const aGeneric = isGenericTitle(a.title);
  const bGeneric = isGenericTitle(b.title);
  if (!aGeneric && bGeneric) return -1;
  if (aGeneric && !bGeneric) return 1;

  // 8. Recency: newest first
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

// ── CORE QUERY: Active tasks for user ──────────────────────
// Returns pending + in_progress tasks, ordered for "what matters".

export function useTasks(userId: string | null): UseTasksResult {
  const [tasks, setTasks] = useState<DisplayTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    if (!userId) {
      setTasks([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { data, error: fetchErr } = await supabase
        .from('tasks')
        .select('*')
        .eq('user_id', userId)
        .in('status', ['pending', 'in_progress'])
        .order('created_at', { ascending: false })
        .limit(20);

      if (fetchErr) {
        setError(fetchErr.message);
        setTasks([]);
      } else {
        const displayTasks = (data ?? [])
          .map(toDisplayTask)
          // Session 15: Filter out junk tasks that shouldn't be in active lists
          .filter(t => !isJunkTask(t.title));
        displayTasks.sort(whatMattersSort);
        setTasks(displayTasks);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Session 15C.1: Auto-refetch when new data arrives via reflection events.
  // This ensures the control panel reflects new inputs quickly.
  useEffect(() => {
    const unsubs = [
      onReflection('task:created', fetchTasks),
      onReflection('task:updated', fetchTasks),
      onReflection('task:completed', fetchTasks),
      onReflection('data:changed', fetchTasks),
    ];
    return () => unsubs.forEach(u => u());
  }, [fetchTasks]);

  return { tasks, loading, error, refetch: fetchTasks };
}

// ── DERIVED QUERIES ────────────────────────────────────────

/** Top N tasks for "What Matters" surface. Max 5. */
export function useWhatMattersTasks(userId: string | null, max = 5) {
  const result = useTasks(userId);
  const tasks = useMemo(
    () => result.tasks.slice(0, max),
    [result.tasks, max],
  );
  return { ...result, tasks };
}

/** Session 14E: Count tasks completed today for progress signal */
export function useCompletedTodayCount(userId: string | null): { count: number; loading: boolean } {
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchCount = useCallback(async () => {
    if (!userId) {
      setCount(0);
      setLoading(false);
      return;
    }

    try {
      const supabase = createClient();
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const { count: total, error } = await supabase
        .from('tasks')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'done')
        .gte('completed_at', todayStart.toISOString());

      if (!error && total !== null) {
        setCount(total);
      }
    } catch {
      // Silent — non-critical
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchCount();
  }, [fetchCount]);

  return { count, loading };
}

// ── TASK MUTATIONS (minimal — mark done / skip) ────────────
// These are the only write operations exposed from the read layer.
// Intentionally minimal — no full task management yet.

export async function markTaskDone(taskId: string): Promise<boolean> {
  const supabase = createClient();
  const { error } = await supabase
    .from('tasks')
    .update({
      status: 'done' as TaskStatus,
      completed_at: new Date().toISOString(),
    })
    .eq('id', taskId);

  if (error) {
    console.error('markTaskDone error:', error);
    return false;
  }
  // Session 15C.1: Emit reflection so surfaces update immediately
  const { emitReflection } = await import('@/lib/chat/reflection');
  emitReflection('task:completed');
  return true;
}

export async function skipTask(taskId: string): Promise<boolean> {
  const supabase = createClient();
  const { error } = await supabase
    .from('tasks')
    .update({ status: 'skipped' as TaskStatus })
    .eq('id', taskId);

  if (error) {
    console.error('skipTask error:', error);
    return false;
  }
  // Session 15C.1: Emit reflection so surfaces update immediately
  const { emitReflection } = await import('@/lib/chat/reflection');
  emitReflection('task:updated');
  return true;
}
