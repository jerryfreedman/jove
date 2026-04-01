// ── SESSION 7: CENTRAL MEETING STORE ──────────────────────────
// Single source of truth for all meetings.
// Zustand store with localStorage persistence.

import { create } from 'zustand';
import type { Meeting, MeetingStatus } from './meeting-types';
import type { MeetingRow } from './types';

const STORAGE_KEY = 'jove_meetings_state';

// ── HELPERS ──────────────────────────────────────────────────

function loadFromStorage(): Record<string, Meeting> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, Meeting>;
  } catch {
    return {};
  }
}

function saveToStorage(meetings: Record<string, Meeting>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(meetings));
  } catch {
    // Storage full or unavailable — silent fail
  }
}

// ── NORMALIZE: MeetingRow → Meeting ─────────────────────────

export function normalizeMeetingRow(row: MeetingRow): Meeting {
  const startTime = new Date(row.scheduled_at).getTime();
  return {
    id: row.id,
    title: row.title,
    startTime,
    endTime: startTime + 60 * 60 * 1000, // 1 hour default
    status: 'scheduled',
    source: row.source === 'calendar_screenshot' ? 'calendar' : 'calendar',
    lastUpdatedAt: new Date(row.updated_at).getTime(),
    dealId: row.deal_id ?? null,
    attendees: row.attendees ?? null,
    participants: row.attendees
      ? row.attendees.split(',').map(s => s.trim()).filter(Boolean)
      : undefined,
    prepGenerated: row.prep_generated,
    debriefCompleted: row.debrief_completed,
  };
}

// ── STORE TYPE ───────────────────────────────────────────────

interface MeetingStoreState {
  meetings: Record<string, Meeting>;

  // ── Getters ──
  getAll: () => Meeting[];
  getUpcomingMeetings: () => Meeting[];
  getActiveMeetings: () => Meeting[];
  getCancelledMeetings: () => Meeting[];
  getCompletedMeetings: () => Meeting[];
  getMeetingById: (id: string) => Meeting | undefined;

  // ── Mutators ──
  updateMeeting: (id: string, patch: Partial<Meeting>) => void;
  upsertMeeting: (meeting: Meeting) => void;

  // ── Bulk ingestion (calendar sync) ──
  ingestMeetings: (rows: MeetingRow[]) => void;

  // ── Direct status mutations ──
  cancelMeeting: (id: string) => void;
  completeMeeting: (id: string) => void;
  moveMeeting: (id: string, newStartTime: number) => void;
}

// ── STORE ────────────────────────────────────────────────────

export const useMeetingStore = create<MeetingStoreState>((set, get) => ({
  meetings: loadFromStorage(),

  // ── Getters ──

  getAll: () => Object.values(get().meetings),

  getUpcomingMeetings: () => {
    const now = Date.now();
    return Object.values(get().meetings)
      .filter(m => m.status === 'scheduled' && m.startTime >= now - 2 * 60 * 60 * 1000)
      .sort((a, b) => a.startTime - b.startTime);
  },

  getActiveMeetings: () => {
    const now = Date.now();
    return Object.values(get().meetings)
      .filter(m => {
        if (m.status !== 'scheduled') return false;
        const end = m.endTime ?? m.startTime + 60 * 60 * 1000;
        return now >= m.startTime && now <= end;
      });
  },

  getCancelledMeetings: () =>
    Object.values(get().meetings)
      .filter(m => m.status === 'cancelled')
      .sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt),

  getCompletedMeetings: () =>
    Object.values(get().meetings)
      .filter(m => m.status === 'completed')
      .sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt),

  getMeetingById: (id: string) => get().meetings[id],

  // ── Mutators ──

  updateMeeting: (id, patch) => {
    set(state => {
      const existing = state.meetings[id];
      if (!existing) return state;
      const updated = {
        ...state.meetings,
        [id]: { ...existing, ...patch, lastUpdatedAt: Date.now() },
      };
      saveToStorage(updated);
      return { meetings: updated };
    });
  },

  upsertMeeting: (meeting) => {
    set(state => {
      const updated = {
        ...state.meetings,
        [meeting.id]: meeting,
      };
      saveToStorage(updated);
      return { meetings: updated };
    });
  },

  // ── Bulk ingestion: normalize calendar rows, merge with existing state ──
  ingestMeetings: (rows) => {
    set(state => {
      const updated = { ...state.meetings };

      for (const row of rows) {
        const normalized = normalizeMeetingRow(row);
        const existing = updated[row.id];

        if (existing) {
          // PHASE 9 — Conflict handling:
          // If user has manually updated status more recently than
          // the calendar data, preserve user's status.
          if (
            existing.source === 'user' &&
            existing.lastUpdatedAt > normalized.lastUpdatedAt
          ) {
            // Merge calendar metadata but keep user status
            updated[row.id] = {
              ...normalized,
              status: existing.status,
              source: existing.source,
              lastUpdatedAt: existing.lastUpdatedAt,
            };
          } else {
            // Calendar is newer or same — use calendar data but
            // don't blindly overwrite a user-set status
            if (existing.source === 'user' && existing.status !== 'scheduled') {
              // User explicitly changed status — keep it
              updated[row.id] = {
                ...normalized,
                status: existing.status,
                source: existing.source,
                lastUpdatedAt: existing.lastUpdatedAt,
              };
            } else {
              updated[row.id] = normalized;
            }
          }
        } else {
          // New meeting — just add it
          updated[row.id] = normalized;
        }
      }

      saveToStorage(updated);
      return { meetings: updated };
    });
  },

  // ── Direct status mutations ──

  cancelMeeting: (id) => {
    get().updateMeeting(id, {
      status: 'cancelled' as MeetingStatus,
      source: 'user',
    });
  },

  completeMeeting: (id) => {
    get().updateMeeting(id, {
      status: 'completed' as MeetingStatus,
      source: 'user',
    });
  },

  moveMeeting: (id, newStartTime) => {
    const meeting = get().meetings[id];
    const duration = meeting
      ? (meeting.endTime ?? meeting.startTime + 60 * 60 * 1000) - meeting.startTime
      : 60 * 60 * 1000;
    get().updateMeeting(id, {
      status: 'moved' as MeetingStatus,
      source: 'user',
      startTime: newStartTime,
      endTime: newStartTime + duration,
    });
  },
}));
