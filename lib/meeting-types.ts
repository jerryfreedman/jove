// ── SESSION 7: UNIFIED MEETING MODEL ──────────────────────────
// Canonical source of truth for meeting state.
// Everything reads from / writes to this model.

export type MeetingStatus =
  | 'scheduled'
  | 'cancelled'
  | 'moved'
  | 'completed';

export type MeetingSource = 'calendar' | 'user' | 'inferred';

export type Meeting = {
  id: string;
  title: string;
  startTime: number;       // epoch ms
  endTime?: number;        // epoch ms

  status: MeetingStatus;
  source: MeetingSource;
  lastUpdatedAt: number;   // epoch ms

  // optional metadata
  dealId?: string | null;
  participants?: string[];
  attendees?: string | null;

  confidence?: number;     // 0–1 if inferred

  // preserve original DB fields for round-tripping
  prepGenerated?: boolean;
  debriefCompleted?: boolean;
};

// ── MUTATION TYPES ──────────────────────────────────────────

export type MeetingMutationType = 'cancel' | 'move' | 'complete';

export type MeetingMutation = {
  type: MeetingMutationType;
  target: string;          // fuzzy match string
  newTime?: number;        // epoch ms, for 'move'
};

// ── MUTATION RESULT ─────────────────────────────────────────

export type MeetingMutationResult = {
  success: boolean;
  meetingId: string | null;
  meetingTitle: string | null;
  mutation: MeetingMutation;
  /** Human-readable confirmation for chat feedback */
  confirmationMessage: string;
};
