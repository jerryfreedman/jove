// ── SESSION 15C.1: WRITE → REFLECTION TRIGGERS ─────────────
// After successful ingestion (chat or bird), trigger:
// 1. Control panel refresh / re-fetch
// 2. Sun state recalculation
// 3. Priority recomputation
//
// Do NOT rely on passive refresh. Force immediate reflection.
//
// This module provides a lightweight event emitter for cross-component
// state invalidation without tight coupling.

type ReflectionListener = () => void;

// ── REFLECTION EVENT BUS ─────────────────────────────────────
// Components subscribe to know when to re-fetch/recompute.

const listeners: Map<string, Set<ReflectionListener>> = new Map();

export type ReflectionEvent =
  | 'task:created'      // New task added
  | 'task:updated'      // Task status changed
  | 'task:completed'    // Task marked done
  | 'interaction:created' // New interaction captured
  | 'event:created'     // New event/meeting added
  | 'item:created'      // New item added
  | 'person:created'    // New person added
  | 'blocker:detected'  // Blocker signal found
  | 'momentum:changed'  // Session 16A: Real momentum state changed
  | 'data:changed';     // Generic data change

/**
 * Subscribe to reflection events.
 * Returns an unsubscribe function.
 */
export function onReflection(event: ReflectionEvent, listener: ReflectionListener): () => void {
  if (!listeners.has(event)) {
    listeners.set(event, new Set());
  }
  listeners.get(event)!.add(listener);

  return () => {
    listeners.get(event)?.delete(listener);
  };
}

/**
 * Emit a reflection event, triggering all subscribers.
 * Call this after any successful write operation.
 */
export function emitReflection(event: ReflectionEvent): void {
  const eventListeners = listeners.get(event);
  if (eventListeners) {
    eventListeners.forEach(listener => {
      try {
        listener();
      } catch (err) {
        console.error(`Reflection listener error (${event}):`, err);
      }
    });
  }

  // All specific events also trigger the generic data:changed event
  if (event !== 'data:changed') {
    const genericListeners = listeners.get('data:changed');
    if (genericListeners) {
      genericListeners.forEach(listener => {
        try {
          listener();
        } catch (err) {
          console.error('Reflection listener error (data:changed):', err);
        }
      });
    }
  }
}

/**
 * Emit multiple reflection events at once.
 * Deduplicates the generic data:changed event.
 */
export function emitReflections(events: ReflectionEvent[]): void {
  for (const event of events) {
    emitReflection(event);
  }
}

// ── CONVENIENCE: TRIGGER FULL SURFACE REFRESH ────────────────
// Forces control panel, sun, and priority to recalculate.
// Use after major state changes.

export function triggerFullRefresh(): void {
  emitReflection('data:changed');
}
