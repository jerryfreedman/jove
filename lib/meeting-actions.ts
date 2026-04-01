// ── SESSION 8: SHARED MEETING ACTION LAYER ───────────────────
// Single action + undo layer for all meeting surfaces.
// Routes every UI action through the canonical meeting store.
// No duplicate mutation logic — this is the ONLY UI → store bridge.

import { create } from 'zustand';
import { useMeetingStore } from './meeting-store';
import type { Meeting, MeetingStatus } from './meeting-types';

// ── UI ACTION MODEL ──────────────────────────────────────────

export type MeetingUIAction =
  | { type: 'complete'; meetingId: string }
  | { type: 'cancel'; meetingId: string }
  | { type: 'reschedule'; meetingId: string; newTime: number };

// ── UNDO SNAPSHOT ────────────────────────────────────────────

interface UndoSnapshot {
  action: MeetingUIAction;
  previousState: Meeting;
  timestamp: number;
}

// ── ACTION TOAST STATE ───────────────────────────────────────

export interface MeetingActionToastData {
  id: string;
  message: string;
  undoAvailable: boolean;
}

// ── UNDO STORE ───────────────────────────────────────────────
// Stores exactly one undo snapshot. Single-action undo is sufficient.

interface MeetingActionStoreState {
  undoSnapshot: UndoSnapshot | null;
  toast: MeetingActionToastData | null;
  toastTimeoutId: ReturnType<typeof setTimeout> | null;

  // ── Core action dispatcher ──
  dispatch: (action: MeetingUIAction) => void;

  // ── Undo ──
  undo: () => void;
  clearUndo: () => void;

  // ── Toast ──
  dismissToast: () => void;
}

const UNDO_WINDOW_MS = 6000; // 6 seconds

export const useMeetingActionStore = create<MeetingActionStoreState>(
  (set, get) => ({
    undoSnapshot: null,
    toast: null,
    toastTimeoutId: null,

    dispatch: (action: MeetingUIAction) => {
      const meetingStore = useMeetingStore.getState();
      const meeting = meetingStore.getMeetingById(action.meetingId);

      if (!meeting) return;

      // 1. Snapshot current state for undo
      const snapshot: UndoSnapshot = {
        action,
        previousState: { ...meeting },
        timestamp: Date.now(),
      };

      // 2. Apply mutation through canonical store
      let message = '';
      switch (action.type) {
        case 'complete':
          meetingStore.completeMeeting(action.meetingId);
          message = `${meeting.title} marked complete`;
          break;
        case 'cancel':
          meetingStore.cancelMeeting(action.meetingId);
          message = `${meeting.title} cancelled`;
          break;
        case 'reschedule': {
          meetingStore.moveMeeting(action.meetingId, action.newTime);
          const timeStr = new Date(action.newTime).toLocaleString('en-US', {
            weekday: 'short',
            hour: 'numeric',
            minute: '2-digit',
          });
          message = `${meeting.title} → ${timeStr}`;
          break;
        }
      }

      // 3. Clear any existing toast timeout
      const existingTimeout = get().toastTimeoutId;
      if (existingTimeout) clearTimeout(existingTimeout);

      // 4. Set toast + undo window
      const toastId = `${action.type}_${action.meetingId}_${Date.now()}`;
      const timeoutId = setTimeout(() => {
        set({ toast: null, undoSnapshot: null, toastTimeoutId: null });
      }, UNDO_WINDOW_MS);

      set({
        undoSnapshot: snapshot,
        toast: {
          id: toastId,
          message,
          undoAvailable: true,
        },
        toastTimeoutId: timeoutId,
      });
    },

    undo: () => {
      const { undoSnapshot, toastTimeoutId } = get();
      if (!undoSnapshot) return;

      // Check if still within undo window
      if (Date.now() - undoSnapshot.timestamp > UNDO_WINDOW_MS) {
        set({ undoSnapshot: null, toast: null });
        return;
      }

      // Restore previous state through canonical store (not local state)
      const meetingStore = useMeetingStore.getState();
      meetingStore.updateMeeting(undoSnapshot.previousState.id, {
        status: undoSnapshot.previousState.status,
        source: undoSnapshot.previousState.source,
        startTime: undoSnapshot.previousState.startTime,
        endTime: undoSnapshot.previousState.endTime,
        lastUpdatedAt: undoSnapshot.previousState.lastUpdatedAt,
      });

      // Clear timeout and state
      if (toastTimeoutId) clearTimeout(toastTimeoutId);
      set({
        undoSnapshot: null,
        toast: {
          id: `undo_${Date.now()}`,
          message: 'Undone',
          undoAvailable: false,
        },
        toastTimeoutId: setTimeout(() => {
          set({ toast: null, toastTimeoutId: null });
        }, 2000),
      });
    },

    clearUndo: () => {
      const { toastTimeoutId } = get();
      if (toastTimeoutId) clearTimeout(toastTimeoutId);
      set({ undoSnapshot: null, toast: null, toastTimeoutId: null });
    },

    dismissToast: () => {
      const { toastTimeoutId } = get();
      if (toastTimeoutId) clearTimeout(toastTimeoutId);
      set({ toast: null, toastTimeoutId: null });
    },
  }),
);

// ── CONVENIENCE HOOK ─────────────────────────────────────────
// Provides the action primitives for any surface to use.

export function useMeetingActions() {
  const dispatch = useMeetingActionStore(s => s.dispatch);
  const undo = useMeetingActionStore(s => s.undo);
  const toast = useMeetingActionStore(s => s.toast);
  const dismissToast = useMeetingActionStore(s => s.dismissToast);

  return {
    completeMeeting: (meetingId: string) =>
      dispatch({ type: 'complete', meetingId }),
    cancelMeeting: (meetingId: string) =>
      dispatch({ type: 'cancel', meetingId }),
    rescheduleMeeting: (meetingId: string, newTime: number) =>
      dispatch({ type: 'reschedule', meetingId, newTime }),
    undo,
    toast,
    dismissToast,
  };
}
