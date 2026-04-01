// ── SESSION 11B: TASK PERSISTENCE LAYER ────────────────────
// Writes system-derived and user-created tasks to the tasks table.
// Idempotent upsert logic. No read-path changes.
//
// System tasks use a stable dedupe key derived from:
//   user_id + source_type + deal_id/meeting_id + normalized title
// User tasks are simpler: one task per clear intent, no dedupe across messages.

import { SupabaseClient } from '@supabase/supabase-js';
import type { TaskRow, TaskSource, TaskSourceType } from '@/lib/types';
import type { SystemTask } from '@/lib/task-types';

// ── TYPES ──────────────────────────────────────────────────

export interface TaskWrite {
  title: string;
  source: TaskSource;
  source_type: TaskSourceType | null;
  priority: number | null;
  due_at: string | null;           // ISO 8601 timestamptz
  deal_id: string | null;
  meeting_id: string | null;
  action: Record<string, unknown> | null;
  status?: TaskRow['status'];
}

// ── DEDUPE KEY ─────────────────────────────────────────────
// Stable key for system tasks. Prevents duplicates across loads.
// Shape: source_type:deal_id|meeting_id
// This is intentionally coarse — one pending system task per
// (source_type, entity) pair at a time.

function systemDedupeKey(task: {
  source_type: TaskSourceType;
  deal_id?: string | null;
  meeting_id?: string | null;
}): string {
  const entity = task.meeting_id ?? task.deal_id ?? 'none';
  return `${task.source_type}:${entity}`;
}

// ── SYSTEM TASK SYNC ───────────────────────────────────────
// Upserts system-derived tasks for a user.
// - Creates new pending tasks that don't exist yet
// - Marks stale system tasks as 'skipped' when no longer relevant
// - Never touches user-created tasks
// - Never touches done/skipped tasks (they stay as historical record)

export async function syncSystemTasksForUser(
  supabase: SupabaseClient,
  userId: string,
  derivedTasks: SystemTask[],
): Promise<{ created: number; skipped: number; errors: string[] }> {
  const result = { created: 0, skipped: 0, errors: [] as string[] };

  // 1. Fetch all current pending/in_progress system tasks for this user
  const { data: existingTasks, error: fetchError } = await supabase
    .from('tasks')
    .select('id, title, source_type, deal_id, meeting_id, status')
    .eq('user_id', userId)
    .eq('source', 'system')
    .in('status', ['pending', 'in_progress']);

  if (fetchError) {
    result.errors.push(`Fetch existing tasks: ${fetchError.message}`);
    return result;
  }

  const existing = existingTasks ?? [];

  // Build a map of existing system tasks by dedupe key
  const existingByKey = new Map<string, { id: string; status: string }>();
  for (const task of existing) {
    if (task.source_type) {
      const key = systemDedupeKey({
        source_type: task.source_type as TaskSourceType,
        deal_id: task.deal_id,
        meeting_id: task.meeting_id,
      });
      existingByKey.set(key, { id: task.id, status: task.status });
    }
  }

  // 2. Determine which derived tasks need to be created
  const derivedKeys = new Set<string>();
  const toCreate: TaskWrite[] = [];

  for (const task of derivedTasks) {
    const key = systemDedupeKey({
      source_type: task.type,
      deal_id: task.action.kind === 'open_deal' ? task.action.dealId
        : task.action.kind === 'open_prep' ? (task.action.dealId ?? null)
        : task.action.kind === 'open_chat' ? (task.action.dealId ?? null)
        : null,
      meeting_id: task.action.kind === 'open_prep' ? task.action.meetingId
        : task.action.kind === 'open_chat' ? (task.action.meetingId ?? null)
        : null,
    });
    derivedKeys.add(key);

    // Skip if already exists as pending/in_progress
    if (existingByKey.has(key)) continue;

    // Extract deal_id and meeting_id from action
    let dealId: string | null = null;
    let meetingId: string | null = null;
    if (task.action.kind === 'open_deal') {
      dealId = task.action.dealId;
    } else if (task.action.kind === 'open_prep') {
      meetingId = task.action.meetingId;
      dealId = task.action.dealId ?? null;
    } else if (task.action.kind === 'open_chat') {
      dealId = task.action.dealId ?? null;
      meetingId = task.action.meetingId ?? null;
    }

    toCreate.push({
      title: task.title,
      source: 'system',
      source_type: task.type,
      priority: task.priority,
      due_at: null,
      deal_id: dealId,
      meeting_id: meetingId,
      action: task.action as unknown as Record<string, unknown>,
      status: 'pending',
    });
  }

  // 3. Create new system tasks
  if (toCreate.length > 0) {
    const rows = toCreate.map(t => ({
      user_id: userId,
      title: t.title,
      source: t.source,
      source_type: t.source_type,
      priority: t.priority,
      due_at: t.due_at,
      deal_id: t.deal_id,
      meeting_id: t.meeting_id,
      action: t.action,
      status: t.status ?? 'pending',
    }));

    const { error: insertError } = await supabase
      .from('tasks')
      .insert(rows);

    if (insertError) {
      result.errors.push(`Insert tasks: ${insertError.message}`);
    } else {
      result.created = toCreate.length;
    }
  }

  // 4. Mark stale system tasks as 'skipped'
  // A system task is stale if it's pending but no longer derived
  const staleIds: string[] = [];
  existingByKey.forEach((entry, key) => {
    if (!derivedKeys.has(key) && entry.status === 'pending') {
      staleIds.push(entry.id);
    }
  });

  if (staleIds.length > 0) {
    const { error: updateError } = await supabase
      .from('tasks')
      .update({ status: 'skipped' })
      .in('id', staleIds);

    if (updateError) {
      result.errors.push(`Skip stale tasks: ${updateError.message}`);
    } else {
      result.skipped = staleIds.length;
    }
  }

  return result;
}

// ── USER TASK CREATION ─────────────────────────────────────
// Creates a single user task from direct user input.
// No deduplication needed — each clear intent creates one task.

export async function createUserTask(
  supabase: SupabaseClient,
  userId: string,
  params: {
    title: string;
    dueAt?: string | null;
    dealId?: string | null;
    meetingId?: string | null;
  },
): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from('tasks')
    .insert({
      user_id: userId,
      title: params.title,
      source: 'user',
      source_type: null,
      priority: null,
      due_at: params.dueAt ?? null,
      deal_id: params.dealId ?? null,
      meeting_id: params.meetingId ?? null,
      action: null,
      status: 'pending',
    })
    .select('id')
    .single();

  if (error) {
    console.error('Create user task error:', error);
    return null;
  }
  return data;
}
