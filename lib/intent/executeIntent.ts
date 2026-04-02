// ── SESSION 2 + SESSION 3: EXECUTION ENGINE (CONTROLLED MUTATION) ──
// Mutates system state ONLY on high confidence.
// Conservative: no mutation is always safer than wrong mutation.
//
// Rules:
//   HIGH confidence → mutate
//   MEDIUM/LOW      → no mutation (interaction only)
//
// Session 3: Enhanced logging with context + entity signals.
// CORE SAFETY RULE UNCHANGED — only mutate on HIGH confidence.
//
// Does NOT touch database schema, Supabase structure, or UI.

import { SupabaseClient } from '@supabase/supabase-js';
import { emitReflection } from '@/lib/chat/reflection';
import { invalidateUserCache } from '@/lib/context-cache';
import type { ResolvedIntent } from './resolveIntent';

// ── EXECUTION RESULT ────────────────────────────────────────

export type ExecutionMode = 'mutation+interaction' | 'interaction_only';

export interface ExecutionResult {
  /** Whether a structural mutation occurred */
  mutated: boolean;
  /** The ingestion mode — controls whether the pipeline should create entities */
  mode: ExecutionMode;
  /** Human-readable summary of what happened (for logging) */
  summary: string;
}

// ── EXECUTION INPUT ─────────────────────────────────────────

export interface ExecuteIntentInput {
  intent: ResolvedIntent;
  contextType: 'task' | 'item' | 'person' | 'event' | 'meeting' | 'deal' | 'none';
  contextId: string | null;
  userId: string;
  text: string;
}

// ── MAIN EXECUTOR ───────────────────────────────────────────

export async function executeIntent(
  supabase: SupabaseClient,
  input: ExecuteIntentInput,
): Promise<ExecutionResult> {
  const { intent, contextType, contextId, userId, text } = input;

  // ── CRITICAL RULE: Only mutate on HIGH confidence ─────────
  if (intent.confidence !== 'high' || !contextId) {
    return {
      mutated: false,
      mode: 'interaction_only',
      summary: `No mutation: confidence=${intent.confidence}, contextId=${contextId ?? 'none'}`,
    };
  }

  // ── COMPLETE ──────────────────────────────────────────────
  if (intent.type === 'complete' && contextType === 'task') {
    const { error } = await supabase
      .from('tasks')
      .update({
        status: 'done',
        completed_at: new Date().toISOString(),
      })
      .eq('id', contextId)
      .eq('user_id', userId)
      .in('status', ['pending', 'in_progress']); // Only complete active tasks

    if (error) {
      console.error('executeIntent: complete task error:', error);
      return {
        mutated: false,
        mode: 'interaction_only',
        summary: `Complete task failed: ${error.message}`,
      };
    }

    emitReflection('task:created'); // Reuse existing event — triggers control panel refresh
    invalidateUserCache(userId);

    logIntentExecution(intent, true, 'mutation+interaction');

    return {
      mutated: true,
      mode: 'mutation+interaction',
      summary: `Task ${contextId} marked complete`,
    };
  }

  // ── COMPLETE (item) ───────────────────────────────────────
  if (intent.type === 'complete' && contextType === 'item') {
    const { error } = await supabase
      .from('items')
      .update({ status: 'done' })
      .eq('id', contextId)
      .eq('user_id', userId)
      .in('status', ['active', 'paused', 'waiting']);

    if (error) {
      console.error('executeIntent: complete item error:', error);
      return {
        mutated: false,
        mode: 'interaction_only',
        summary: `Complete item failed: ${error.message}`,
      };
    }

    emitReflection('item:created');
    invalidateUserCache(userId);
    logIntentExecution(intent, true, 'mutation+interaction');

    return {
      mutated: true,
      mode: 'mutation+interaction',
      summary: `Item ${contextId} marked done`,
    };
  }

  // ── RESCHEDULE (task) ─────────────────────────────────────
  if (intent.type === 'reschedule' && contextType === 'task' && intent.entities?.date) {
    const newDueAt = intent.entities.date.toISOString();

    const { error } = await supabase
      .from('tasks')
      .update({ due_at: newDueAt })
      .eq('id', contextId)
      .eq('user_id', userId);

    if (error) {
      console.error('executeIntent: reschedule task error:', error);
      return {
        mutated: false,
        mode: 'interaction_only',
        summary: `Reschedule task failed: ${error.message}`,
      };
    }

    emitReflection('task:created');
    invalidateUserCache(userId);
    logIntentExecution(intent, true, 'mutation+interaction');

    return {
      mutated: true,
      mode: 'mutation+interaction',
      summary: `Task ${contextId} rescheduled to ${newDueAt}`,
    };
  }

  // ── RESCHEDULE (event/meeting) ────────────────────────────
  if (intent.type === 'reschedule' && (contextType === 'event' || contextType === 'meeting') && intent.entities?.date) {
    const newScheduledAt = intent.entities.date.toISOString();

    const { error } = await supabase
      .from('meetings')
      .update({ scheduled_at: newScheduledAt })
      .eq('id', contextId)
      .eq('user_id', userId);

    if (error) {
      console.error('executeIntent: reschedule meeting/event error:', error);
      return {
        mutated: false,
        mode: 'interaction_only',
        summary: `Reschedule meeting/event failed: ${error.message}`,
      };
    }

    emitReflection('event:created');
    invalidateUserCache(userId);
    logIntentExecution(intent, true, 'mutation+interaction');

    return {
      mutated: true,
      mode: 'mutation+interaction',
      summary: `Meeting/event ${contextId} rescheduled to ${newScheduledAt}`,
    };
  }

  // ── UPDATE ────────────────────────────────────────────────
  // Appends status note — no structural mutation, but records the update.
  // For tasks: we could update status to in_progress if "started"
  if (intent.type === 'update' && contextType === 'task') {
    // If blocked/waiting, set to in_progress (signal activity without completing)
    const { error } = await supabase
      .from('tasks')
      .update({ status: 'in_progress' })
      .eq('id', contextId)
      .eq('user_id', userId)
      .eq('status', 'pending'); // Only upgrade from pending

    if (error) {
      console.error('executeIntent: update task status error:', error);
    }

    // Even if the status update fails/no-ops, we consider the update logged
    emitReflection('task:created');
    invalidateUserCache(userId);
    logIntentExecution(intent, !error, 'mutation+interaction');

    return {
      mutated: !error,
      mode: 'mutation+interaction',
      summary: `Task ${contextId} status updated (update intent)`,
    };
  }

  // ── NOTE ──────────────────────────────────────────────────
  // No structural mutation — interaction only
  if (intent.type === 'note') {
    logIntentExecution(intent, false, 'interaction_only');
    return {
      mutated: false,
      mode: 'interaction_only',
      summary: 'Note captured — interaction only',
    };
  }

  // ── UNKNOWN / fallback ────────────────────────────────────
  logIntentExecution(intent, false, 'interaction_only');
  return {
    mutated: false,
    mode: 'interaction_only',
    summary: `No mutation for intent type: ${intent.type}`,
  };
}

// ── SESSION 3: ENHANCED DEBUG LOGGING (INTERNAL ONLY — NOT UI) ──

function logIntentExecution(
  intent: ResolvedIntent,
  mutationApplied: boolean,
  mode: ExecutionMode,
): void {
  if (typeof console !== 'undefined') {
    console.debug('[intent-execution]', {
      type: intent.type,
      confidence: intent.confidence,
      mutationApplied,
      mode,
      // Session 3: Log entity signals + context info
      entitySignals: {
        personName: intent.entities?.personName ?? null,
        statusKeyword: intent.entities?.statusKeyword ?? null,
        referenceType: intent.entities?.referenceType ?? null,
      },
      entityLinkStrength: intent.entityLinkStrength,
      contextBoostApplied: intent.contextBoostApplied ?? 'none',
      secondaryIntent: intent.secondaryIntent
        ? { type: intent.secondaryIntent.type, confidence: intent.secondaryIntent.confidence }
        : null,
      timestamp: new Date().toISOString(),
    });
  }
}
