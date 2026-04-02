// ── SESSION 4: CONSEQUENCE PLANNER ─────────────────────────
// Upgrades the system from one input = one effect
// to one input = interpreted consequence across the system.
//
// Input: resolved intent + context + entity state
// Output: primary action + optional secondary actions + summary
//
// Rules:
//   - primary executes first
//   - secondary must be safe + deterministic
//   - never relax high-confidence mutation rule
//   - never auto-create chains of tasks
//   - keep tasks open unless clearly resolved
//   - bias toward explicit, grounded updates

import type { ResolvedIntent, IntentType } from './resolveIntent';
import type { CaptureContextType } from '@/lib/universal-capture-types';

// ── CONSEQUENCE ACTION TYPES ───────────────────────────────

export type ConsequenceAction =
  | { type: 'complete_task'; taskId: string }
  | { type: 'update_task'; taskId: string; patch: Record<string, unknown> }
  | { type: 'update_event'; eventId: string; patch: Record<string, unknown> }
  | { type: 'update_item'; itemId: string; patch: Record<string, unknown> }
  | { type: 'update_person'; personId: string; patch: Record<string, unknown> }
  | { type: 'save_interaction'; payload: InteractionPayload }
  | { type: 'keep_open'; taskId?: string; reason: string }
  | { type: 'suggest_followup'; payload: FollowupSuggestion };

export interface InteractionPayload {
  text: string;
  contextType: CaptureContextType;
  contextId: string | null;
  signal: 'high' | 'low' | 'context_only';
}

export interface FollowupSuggestion {
  suggestedTitle: string;
  reason: string;
  relatedContextType?: CaptureContextType;
  relatedContextId?: string;
}

// ── CONSEQUENCE PLAN ───────────────────────────────────────

export interface ConsequencePlan {
  primaryAction: ConsequenceAction;
  secondaryActions: ConsequenceAction[];
  summary: string;
}

// ── CONTEXT STATE (optional, for richer planning) ──────────

export interface ContextEntityState {
  /** The context entity type */
  contextType: CaptureContextType;
  contextId: string | null;
  /** Related task IDs (e.g., prep tasks for an event) */
  relatedTaskIds?: string[];
  /** Related item ID (e.g., item linked to a task) */
  linkedItemId?: string;
  /** Related person ID */
  linkedPersonId?: string;
  /** Current task status (if context is a task) */
  taskStatus?: string;
  /** Current item status (if context is an item) */
  itemStatus?: string;
}

// ── WEAK / NO-PROGRESS PATTERNS ────────────────────────────
// These should NEVER close a task.

const WEAK_INPUT_PATTERNS: RegExp[] = [
  /^idk\.?$/i,
  /^i don'?t know\.?$/i,
  /^nothing\.?$/i,
  /^nothing happened\.?$/i,
  /^not sure\.?$/i,
  /^no update\.?$/i,
  /^no progress\.?$/i,
  /^n\/a\.?$/i,
  /^nope\.?$/i,
  /^no\.?$/i,
  /^still waiting\.?$/i,
  /^waiting\.?$/i,
  /^same\.?$/i,
  /^\?+$/,
  /^\.+$/,
  /^-+$/,
];

// ── BLOCKER / RISK PATTERNS ────────────────────────────────

const BLOCKER_PATTERNS: RegExp[] = [
  /\bblocked\b/i,
  /\bblocker\b/i,
  /\bstuck\b/i,
  /\bcan'?t move forward\b/i,
  /\bholding us up\b/i,
  /\brisk\b/i,
  /\bconcern(?:ed)?\b/i,
  /\bissue\b/i,
  /\bproblem\b/i,
  /\bleaning\b/i,    // e.g. "leaning Azure" = competitive risk
  /\bprefers?\s+\w/i, // e.g. "prefers competitor"
];

// ── COMPLETION WITH PROGRESS PATTERNS ──────────────────────
// Signals that the user did something meaningful (not just closed)

const PROGRESS_SIGNAL_PATTERNS: RegExp[] = [
  /\bsent\b/i,
  /\bdelivered\b/i,
  /\bsubmitted\b/i,
  /\bshared\b/i,
  /\bpresented\b/i,
  /\bclosed\b/i,
  /\bsigned\b/i,
  /\bagreed\b/i,
  /\bconfirmed\b/i,
  /\bafter the (?:call|meeting)\b/i,
];

// ── RELATIONSHIP SIGNAL PATTERNS ───────────────────────────

const RELATIONSHIP_SIGNAL_PATTERNS: RegExp[] = [
  /\bprefers?\b/i,
  /\blikes?\b/i,
  /\bwants?\b/i,
  /\bmentioned\b/i,
  /\basked (?:for|about)\b/i,
  /\binterested in\b/i,
  /\bnot interested\b/i,
  /\bresponds? (?:to|via|by)\b/i,
  /\bbest (?:way|time|method)\b/i,
];

// ── FOLLOWUP SUGGESTION PATTERNS ───────────────────────────

const FOLLOWUP_TRIGGER_PATTERNS: { pattern: RegExp; template: string }[] = [
  { pattern: /\bwants?\s+(?:a|the)\s+(.+?)(?:\s+before|\s+first|\s*$)/i, template: 'Prepare: $1' },
  { pattern: /\basked (?:for|about)\s+(.+?)(?:\s*$)/i, template: 'Follow up: $1' },
  { pattern: /\bneed(?:s)?\s+(.+?)(?:\s+before|\s+first|\s*$)/i, template: 'Provide: $1' },
  { pattern: /\bwaiting (?:on|for)\s+(.+?)(?:\s*$)/i, template: 'Follow up on: $1' },
];

// ── MAIN PLANNER ───────────────────────────────────────────

export function planConsequences(
  intent: ResolvedIntent,
  text: string,
  contextType: CaptureContextType,
  contextId: string | null,
  entityState?: ContextEntityState,
): ConsequencePlan {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  // ── GUARD: weak / no-progress input ──────────────────────
  // CRITICAL: These must NEVER complete a task.
  if (isWeakInput(trimmed)) {
    return planWeakInput(contextId, trimmed, contextType);
  }

  // ── ROUTE by intent type ─────────────────────────────────
  switch (intent.type) {
    case 'complete':
      return planComplete(intent, trimmed, contextType, contextId, entityState);
    case 'reschedule':
      return planReschedule(intent, trimmed, contextType, contextId, entityState);
    case 'update':
      return planUpdate(intent, trimmed, contextType, contextId, entityState);
    case 'note':
      return planNote(intent, trimmed, contextType, contextId, entityState);
    case 'unknown':
    default:
      return planUnknown(trimmed, contextType, contextId);
  }
}

// ── WEAK INPUT HANDLER ─────────────────────────────────────
// Rule: do NOT complete, keep task open, feedback reflects lack of progress.

function isWeakInput(text: string): boolean {
  const trimmed = text.trim();
  for (const pattern of WEAK_INPUT_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }
  return false;
}

function planWeakInput(
  contextId: string | null,
  text: string,
  contextType: CaptureContextType,
): ConsequencePlan {
  const secondaryActions: ConsequenceAction[] = [];

  // Save a low-signal interaction if there's context
  if (contextId) {
    secondaryActions.push({
      type: 'save_interaction',
      payload: {
        text,
        contextType,
        contextId,
        signal: 'low',
      },
    });
  }

  return {
    primaryAction: {
      type: 'keep_open',
      taskId: contextType === 'task' ? (contextId ?? undefined) : undefined,
      reason: 'weak_or_no_progress_input',
    },
    secondaryActions,
    summary: 'No progress yet, task remains active.',
  };
}

// ── COMPLETE PLANNER ───────────────────────────────────────
// Rule A: Completion with progress
//   - complete task
//   - save interaction
//   - optionally update related item progress

function planComplete(
  intent: ResolvedIntent,
  text: string,
  contextType: CaptureContextType,
  contextId: string | null,
  entityState?: ContextEntityState,
): ConsequencePlan {
  // Only plan completion if we have a valid context to complete
  if (!contextId || intent.confidence !== 'high') {
    return {
      primaryAction: {
        type: 'save_interaction',
        payload: { text, contextType, contextId, signal: 'high' },
      },
      secondaryActions: [],
      summary: 'Context captured, no state change.',
    };
  }

  const secondaryActions: ConsequenceAction[] = [];
  const hasProgressSignal = PROGRESS_SIGNAL_PATTERNS.some(p => p.test(text));

  // Secondary: save interaction (always on complete)
  secondaryActions.push({
    type: 'save_interaction',
    payload: { text, contextType, contextId, signal: 'high' },
  });

  // Secondary: update linked item progress if task has one and there's a progress signal
  if (
    contextType === 'task' &&
    entityState?.linkedItemId &&
    hasProgressSignal
  ) {
    secondaryActions.push({
      type: 'update_item',
      itemId: entityState.linkedItemId,
      patch: { last_activity_at: new Date().toISOString() },
    });
  }

  // Check for followup suggestions from the text
  const followup = detectFollowupSuggestion(text, contextType, entityState);
  if (followup) {
    secondaryActions.push({ type: 'suggest_followup', payload: followup });
  }

  if (contextType === 'task') {
    return {
      primaryAction: { type: 'complete_task', taskId: contextId },
      secondaryActions,
      summary: hasProgressSignal
        ? 'Task completed, progress logged.'
        : 'Task completed.',
    };
  }

  if (contextType === 'item') {
    return {
      primaryAction: { type: 'update_item', itemId: contextId, patch: { status: 'done' } },
      secondaryActions,
      summary: 'Item completed.',
    };
  }

  // Other context types: just save interaction
  return {
    primaryAction: {
      type: 'save_interaction',
      payload: { text, contextType, contextId, signal: 'high' },
    },
    secondaryActions,
    summary: 'Completion noted, context captured.',
  };
}

// ── RESCHEDULE PLANNER ─────────────────────────────────────
// Rule B: Reschedule
//   - update date/time
//   - preserve related open tasks unless explicitly invalidated
//   - save interaction

function planReschedule(
  intent: ResolvedIntent,
  text: string,
  contextType: CaptureContextType,
  contextId: string | null,
  entityState?: ContextEntityState,
): ConsequencePlan {
  if (!contextId || intent.confidence !== 'high' || !intent.entities?.date) {
    return {
      primaryAction: {
        type: 'save_interaction',
        payload: { text, contextType, contextId, signal: 'context_only' },
      },
      secondaryActions: [],
      summary: 'Context captured, no state change.',
    };
  }

  const newDate = intent.entities.date.toISOString();
  const secondaryActions: ConsequenceAction[] = [];

  // Secondary: save interaction (always on reschedule)
  secondaryActions.push({
    type: 'save_interaction',
    payload: { text, contextType, contextId, signal: 'high' },
  });

  // Secondary: related tasks stay open (explicit keep_open for prep tasks)
  if (entityState?.relatedTaskIds?.length) {
    for (const taskId of entityState.relatedTaskIds) {
      secondaryActions.push({
        type: 'keep_open',
        taskId,
        reason: 'parent_event_rescheduled',
      });
    }
  }

  // Primary: update the entity date
  if (contextType === 'event' || contextType === 'meeting') {
    return {
      primaryAction: {
        type: 'update_event',
        eventId: contextId,
        patch: { scheduled_at: newDate },
      },
      secondaryActions,
      summary: 'Event moved, prep still open.',
    };
  }

  if (contextType === 'task') {
    return {
      primaryAction: {
        type: 'update_task',
        taskId: contextId,
        patch: { due_at: newDate },
      },
      secondaryActions,
      summary: 'Task rescheduled.',
    };
  }

  // Other context: save as interaction
  return {
    primaryAction: {
      type: 'save_interaction',
      payload: { text, contextType, contextId, signal: 'high' },
    },
    secondaryActions,
    summary: 'Reschedule noted.',
  };
}

// ── UPDATE PLANNER ─────────────────────────────────────────
// Rule D: Relationship signal → update person
// Rule E: Blocker/risk → update item/task state

function planUpdate(
  intent: ResolvedIntent,
  text: string,
  contextType: CaptureContextType,
  contextId: string | null,
  entityState?: ContextEntityState,
): ConsequencePlan {
  const secondaryActions: ConsequenceAction[] = [];
  const hasBlocker = BLOCKER_PATTERNS.some(p => p.test(text));

  // Always save interaction on update
  if (contextId) {
    secondaryActions.push({
      type: 'save_interaction',
      payload: {
        text,
        contextType,
        contextId,
        signal: hasBlocker ? 'high' : 'context_only',
      },
    });
  }

  // Check for followup suggestions
  const followup = detectFollowupSuggestion(text, contextType, entityState);
  if (followup) {
    secondaryActions.push({ type: 'suggest_followup', payload: followup });
  }

  // ── Blocker/risk handling (Rule E) ─────────────────────
  if (hasBlocker && contextId && intent.confidence === 'high') {
    if (contextType === 'task') {
      return {
        primaryAction: {
          type: 'update_task',
          taskId: contextId,
          patch: { status: 'in_progress' },
        },
        secondaryActions,
        summary: 'Blocker noted, task flagged.',
      };
    }

    if (contextType === 'item') {
      return {
        primaryAction: {
          type: 'update_item',
          itemId: contextId,
          patch: { status: 'waiting', last_activity_at: new Date().toISOString() },
        },
        secondaryActions,
        summary: 'Risk flagged on item.',
      };
    }
  }

  // ── Standard update (non-blocker) ──────────────────────
  if (contextId && contextType === 'task' && intent.confidence === 'high') {
    return {
      primaryAction: {
        type: 'update_task',
        taskId: contextId,
        patch: { status: 'in_progress' },
      },
      secondaryActions,
      summary: 'Task updated.',
    };
  }

  // No mutation path — just interaction
  return {
    primaryAction: contextId
      ? {
          type: 'save_interaction',
          payload: { text, contextType, contextId, signal: 'context_only' },
        }
      : {
          type: 'keep_open',
          reason: 'update_without_context',
        },
    secondaryActions,
    summary: hasBlocker ? 'Blocker noted.' : 'Update captured.',
  };
}

// ── NOTE PLANNER ───────────────────────────────────────────
// Rule D: Relationship signal → update person
// Otherwise: context-only interaction

function planNote(
  intent: ResolvedIntent,
  text: string,
  contextType: CaptureContextType,
  contextId: string | null,
  entityState?: ContextEntityState,
): ConsequencePlan {
  const secondaryActions: ConsequenceAction[] = [];
  const hasRelationshipSignal = RELATIONSHIP_SIGNAL_PATTERNS.some(p => p.test(text));

  // ── Relationship signal on person context (Rule D) ─────
  if (contextType === 'person' && contextId && hasRelationshipSignal) {
    // Primary: update person notes
    secondaryActions.push({
      type: 'save_interaction',
      payload: { text, contextType, contextId, signal: 'high' },
    });

    // Check for followup suggestions
    const followup = detectFollowupSuggestion(text, contextType, entityState);
    if (followup) {
      secondaryActions.push({ type: 'suggest_followup', payload: followup });
    }

    return {
      primaryAction: {
        type: 'update_person',
        personId: contextId,
        patch: { last_interaction_at: new Date().toISOString() },
      },
      secondaryActions,
      summary: 'Person updated, context captured.',
    };
  }

  // ── Note on event/meeting context ──────────────────────
  if ((contextType === 'event' || contextType === 'meeting') && contextId) {
    return {
      primaryAction: {
        type: 'save_interaction',
        payload: { text, contextType, contextId, signal: 'context_only' },
      },
      secondaryActions,
      summary: 'Context captured.',
    };
  }

  // ── Note on item context with relationship signal → may affect person
  if (contextType === 'item' && contextId && hasRelationshipSignal && entityState?.linkedPersonId) {
    secondaryActions.push({
      type: 'update_person',
      personId: entityState.linkedPersonId,
      patch: { last_interaction_at: new Date().toISOString() },
    });

    secondaryActions.push({
      type: 'save_interaction',
      payload: { text, contextType, contextId, signal: 'high' },
    });

    // Check for followup
    const followup = detectFollowupSuggestion(text, contextType, entityState);
    if (followup) {
      secondaryActions.push({ type: 'suggest_followup', payload: followup });
    }

    return {
      primaryAction: {
        type: 'update_item',
        itemId: contextId,
        patch: { last_activity_at: new Date().toISOString() },
      },
      secondaryActions,
      summary: 'Item and person updated.',
    };
  }

  // ── Generic note — save interaction only ───────────────
  const followup = detectFollowupSuggestion(text, contextType, entityState);
  if (followup) {
    secondaryActions.push({ type: 'suggest_followup', payload: followup });
  }

  return {
    primaryAction: {
      type: 'save_interaction',
      payload: { text, contextType, contextId, signal: 'context_only' },
    },
    secondaryActions,
    summary: 'Context captured, no state change.',
  };
}

// ── UNKNOWN PLANNER ────────────────────────────────────────

function planUnknown(
  text: string,
  contextType: CaptureContextType,
  contextId: string | null,
): ConsequencePlan {
  return {
    primaryAction: {
      type: 'keep_open',
      taskId: contextType === 'task' ? (contextId ?? undefined) : undefined,
      reason: 'unknown_intent',
    },
    secondaryActions: [],
    summary: 'No clear signal, state unchanged.',
  };
}

// ── FOLLOWUP SUGGESTION DETECTOR ───────────────────────────
// Part 5: Lightweight derived suggestion layer.
// Does NOT auto-create tasks. Returns suggestion objects for future surfacing.

function detectFollowupSuggestion(
  text: string,
  contextType: CaptureContextType,
  entityState?: ContextEntityState,
): FollowupSuggestion | null {
  for (const { pattern, template } of FOLLOWUP_TRIGGER_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const captured = match[1].trim();
      // Don't suggest if the captured text is too short or generic
      if (captured.length < 3) continue;

      return {
        suggestedTitle: template.replace('$1', captured),
        reason: `Detected from: "${text.slice(0, 60)}"`,
        relatedContextType: entityState?.contextType ?? contextType,
        relatedContextId: entityState?.contextId ?? undefined,
      };
    }
  }

  return null;
}

// ── CONSEQUENCE LOGGING ────────────────────────────────────
// Part 10: Internal logs for consequence planning.

export function logConsequencePlan(plan: ConsequencePlan): void {
  if (typeof console !== 'undefined') {
    console.debug('[consequence-plan]', {
      primaryActionType: plan.primaryAction.type,
      secondaryActionsCount: plan.secondaryActions.length,
      secondaryActionTypes: plan.secondaryActions.map(a => a.type),
      taskStayedOpen: plan.primaryAction.type === 'keep_open',
      entityChanges: {
        itemChanged: plan.secondaryActions.some(a => a.type === 'update_item') || plan.primaryAction.type === 'update_item',
        personChanged: plan.secondaryActions.some(a => a.type === 'update_person') || plan.primaryAction.type === 'update_person',
        eventChanged: plan.primaryAction.type === 'update_event',
      },
      hasSuggestions: plan.secondaryActions.some(a => a.type === 'suggest_followup'),
      summary: plan.summary,
      timestamp: new Date().toISOString(),
    });
  }
}
