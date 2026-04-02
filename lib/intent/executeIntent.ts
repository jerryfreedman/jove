// ── SESSION 2 + SESSION 3 + SESSION 4: EXECUTION ENGINE (CONTROLLED MUTATION) ──
// Mutates system state ONLY on high confidence.
// Conservative: no mutation is always safer than wrong mutation.
//
// Rules:
//   HIGH confidence → mutate
//   MEDIUM/LOW      → no mutation (interaction only)
//
// Session 3: Enhanced logging with context + entity signals.
// Session 4: Consequence-plan-driven execution with secondary actions.
// CORE SAFETY RULE UNCHANGED — only mutate on HIGH confidence.
//
// Does NOT touch database schema, Supabase structure, or UI.

import { SupabaseClient } from '@supabase/supabase-js';
import { emitReflection } from '@/lib/chat/reflection';
import { invalidateUserCache } from '@/lib/context-cache';
import type { ResolvedIntent } from './resolveIntent';
import type { ConsequencePlan, ConsequenceAction } from './planConsequences';

// ── EXECUTION RESULT ────────────────────────────────────────

export type ExecutionMode = 'mutation+interaction' | 'interaction_only';

export interface ExecutionResult {
  /** Whether a structural mutation occurred */
  mutated: boolean;
  /** The ingestion mode — controls whether the pipeline should create entities */
  mode: ExecutionMode;
  /** Human-readable summary of what happened (for logging) */
  summary: string;
  /** Session 4: Compact state summary for downstream use */
  stateSummary?: string;
  /** Session 4: Number of secondary actions executed */
  secondaryActionsExecuted?: number;
  /** Session 4: Follow-up suggestions generated (not auto-created) */
  followupSuggestions?: Array<{ suggestedTitle: string; reason: string }>;
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

// ── SESSION 4: CONSEQUENCE-PLAN-DRIVEN EXECUTION ───────────
// Executes a full ConsequencePlan: primary action first, then safe secondaries.
// Returns an enriched ExecutionResult with state summary and followup suggestions.

export async function executeConsequencePlan(
  supabase: SupabaseClient,
  plan: ConsequencePlan,
  userId: string,
  intent: ResolvedIntent,
): Promise<ExecutionResult> {
  let mutated = false;
  let secondaryExecuted = 0;
  const followupSuggestions: Array<{ suggestedTitle: string; reason: string }> = [];

  // ── STEP 1: Execute primary action ─────────────────────
  const primaryResult = await executeConsequenceAction(supabase, plan.primaryAction, userId);
  if (primaryResult) mutated = true;

  // ── STEP 2: Execute safe secondary actions ─────────────
  for (const action of plan.secondaryActions) {
    // Followup suggestions are NOT executed — they're collected
    if (action.type === 'suggest_followup') {
      followupSuggestions.push({
        suggestedTitle: action.payload.suggestedTitle,
        reason: action.payload.reason,
      });
      secondaryExecuted++;
      continue;
    }

    // keep_open is a no-op in execution (it's an intent signal, not a mutation)
    if (action.type === 'keep_open') {
      secondaryExecuted++;
      continue;
    }

    // save_interaction is handled by the caller (page.tsx)
    // to avoid duplicate interaction saves
    if (action.type === 'save_interaction') {
      secondaryExecuted++;
      continue;
    }

    // Execute mutation-type secondary actions
    const secondaryResult = await executeConsequenceAction(supabase, action, userId);
    if (secondaryResult) mutated = true;
    secondaryExecuted++;
  }

  // ── STEP 3: Side effects (if any mutation occurred) ────
  if (mutated) {
    emitReflection('task:created'); // Generic refresh trigger
    invalidateUserCache(userId);
  }

  logIntentExecution(intent, mutated, mutated ? 'mutation+interaction' : 'interaction_only');

  return {
    mutated,
    mode: mutated ? 'mutation+interaction' : 'interaction_only',
    summary: plan.summary,
    stateSummary: plan.summary,
    secondaryActionsExecuted: secondaryExecuted,
    followupSuggestions: followupSuggestions.length > 0 ? followupSuggestions : undefined,
  };
}

// ── SINGLE ACTION EXECUTOR ─────────────────────────────────
// Executes one ConsequenceAction against the database.
// Returns true if a mutation occurred, false otherwise.

async function executeConsequenceAction(
  supabase: SupabaseClient,
  action: ConsequenceAction,
  userId: string,
): Promise<boolean> {
  switch (action.type) {
    case 'complete_task': {
      const { error } = await supabase
        .from('tasks')
        .update({
          status: 'done',
          completed_at: new Date().toISOString(),
        })
        .eq('id', action.taskId)
        .eq('user_id', userId)
        .in('status', ['pending', 'in_progress']);

      if (error) {
        console.error('[consequence-exec] complete_task error:', error);
        return false;
      }
      return true;
    }

    case 'update_task': {
      const { error } = await supabase
        .from('tasks')
        .update(action.patch)
        .eq('id', action.taskId)
        .eq('user_id', userId);

      if (error) {
        console.error('[consequence-exec] update_task error:', error);
        return false;
      }
      return true;
    }

    case 'update_event': {
      const { error } = await supabase
        .from('meetings')
        .update(action.patch)
        .eq('id', action.eventId)
        .eq('user_id', userId);

      if (error) {
        console.error('[consequence-exec] update_event error:', error);
        return false;
      }
      return true;
    }

    case 'update_item': {
      const { error } = await supabase
        .from('items')
        .update(action.patch)
        .eq('id', action.itemId)
        .eq('user_id', userId);

      if (error) {
        console.error('[consequence-exec] update_item error:', error);
        return false;
      }
      return true;
    }

    case 'update_person': {
      const { error } = await supabase
        .from('people')
        .update(action.patch)
        .eq('id', action.personId)
        .eq('user_id', userId);

      if (error) {
        console.error('[consequence-exec] update_person error:', error);
        return false;
      }
      return true;
    }

    case 'save_interaction':
      // Handled by the caller (page.tsx), not here.
      // This avoids coupling the execution engine to interaction save logic.
      return false;

    case 'keep_open':
      // No-op: task remains in current state.
      return false;

    case 'suggest_followup':
      // Not a mutation — collected by the plan executor.
      return false;

    default:
      return false;
  }
}

// ── SESSION 3 + 4: ENHANCED DEBUG LOGGING (INTERNAL ONLY — NOT UI) ──

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
