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

import { useEffect, useState, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase';
import type { TaskRow, TaskStatus } from '@/lib/types';
import type { TaskAction } from '@/lib/task-types';

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
}

export interface UseTasksResult {
  tasks: DisplayTask[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

// ── TRANSFORM ──────────────────────────────────────────────

function toDisplayTask(row: TaskRow): DisplayTask {
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
  };
}

// ── WHAT MATTERS ORDERING ──────────────────────────────────
// Deterministic, explainable sort for the primary task surface.
//
// Order:
//   1. due_at soonest (nulls last)
//   2. explicit priority (lower = more urgent, nulls last)
//   3. system urgency (system tasks before user tasks as tiebreak)
//   4. created_at recency as final fallback

function whatMattersSort(a: DisplayTask, b: DisplayTask): number {
  // 1. Due date: soonest first, nulls last
  if (a.dueAt && b.dueAt) {
    const diff = new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    if (diff !== 0) return diff;
  } else if (a.dueAt && !b.dueAt) {
    return -1;
  } else if (!a.dueAt && b.dueAt) {
    return 1;
  }

  // 2. Priority: lower number = more urgent, nulls last
  if (a.priority !== null && b.priority !== null) {
    const diff = a.priority - b.priority;
    if (diff !== 0) return diff;
  } else if (a.priority !== null && b.priority === null) {
    return -1;
  } else if (a.priority === null && b.priority !== null) {
    return 1;
  }

  // 3. System urgency: system tasks before user tasks
  if (a.source !== b.source) {
    return a.source === 'system' ? -1 : 1;
  }

  // 4. Recency: newest first
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
        const displayTasks = (data ?? []).map(toDisplayTask);
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
  return true;
}
