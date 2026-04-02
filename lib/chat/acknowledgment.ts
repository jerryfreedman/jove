// ── SESSION 15C.1: OFFLINE-AWARE ACKNOWLEDGMENT ─────────────
// Truthful confirmation logic. Never claim visibility unless it exists.
//
// Three states:
// 1. Online + write success → "Added. I'll keep this in your focus."
// 2. Offline or uncertain sync → "Captured. I'll update your workspace when sync resumes."
// 3. Processing async → "Saved. Updating your workspace…"
//
// Key rule: Never imply visibility unless it exists.

import type { MessageBucket } from '@/lib/chat-intelligence';

// ── SYNC STATE ───────────────────────────────────────────────

export type SyncState = 'confirmed' | 'offline' | 'pending';

/**
 * Detect current sync state.
 * Uses navigator.onLine as primary signal, with fallback to 'pending'
 * when write status is unknown.
 */
export function detectSyncState(writeSucceeded?: boolean): SyncState {
  // If we know the write succeeded, it's confirmed
  if (writeSucceeded === true) return 'confirmed';

  // If we know the write failed, it's offline
  if (writeSucceeded === false) return 'offline';

  // If we don't know, check navigator
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 'offline';

  // Default to pending when uncertain
  return 'pending';
}

// ── ACKNOWLEDGMENT MESSAGES ──────────────────────────────────
// Context-aware, truthful confirmations.
// Short, human, calm. No badges, no banners.

interface AcknowledgmentOptions {
  bucket: MessageBucket;
  dealName?: string | null;
  meetingTitle?: string | null;
  syncState: SyncState;
  /** Whether the item is now visible in the control panel */
  isReflectedInUI?: boolean;
}

/**
 * Generate a truthful acknowledgment message.
 * Never claims "added" unless the system state is confirmed updated.
 */
export function getOfflineAwareAcknowledgment(opts: AcknowledgmentOptions): string {
  const { bucket, dealName, meetingTitle, syncState, isReflectedInUI } = opts;

  // Questions don't get acknowledgment
  if (bucket === 'question') return '';

  // ── OFFLINE / UNCERTAIN STATE ─────────────────────────────
  // Session 6: Compressed acknowledgments
  if (syncState === 'offline') {
    return 'Captured. Will sync.';
  }

  if (syncState === 'pending') {
    return 'Saved. Syncing…';
  }

  // ── CONFIRMED STATE ───────────────────────────────────────
  // Only claim visibility if we know it's reflected
  switch (bucket) {
    // Session 6: Shorter confirmations — no "I'll keep this in your focus"
    case 'existing_deal_update':
      if (dealName) return `Logged to ${dealName}.`;
      return 'Logged.';

    case 'meeting_context':
      if (meetingTitle) return `Logged to ${meetingTitle}.`;
      if (dealName) return `Logged for ${dealName}.`;
      return 'Logged.';

    case 'general_intel':
      return 'Captured.';

    case 'new_deal':
      return 'Tracked.';

    case 'email_draft':
      return 'Drafting.';

    default:
      return 'Captured.';
  }
}

// ── BIRD CAPTURE ACKNOWLEDGMENT ─────────────────────────────
// Bird uses simpler confirmations but must still be sync-aware.

const CONFIRMED_BIRD_MESSAGES = [
  'Got it',
  'Saved',
  'On it',
  'Noted',
  'Done',
  'Captured',
];

const OFFLINE_BIRD_MESSAGES = [
  'Captured — syncing soon',
  'Saved locally',
  'Got it — will sync',
];

const PENDING_BIRD_MESSAGES = [
  'Saving…',
  'Updating…',
];

/**
 * Get a bird capture confirmation that reflects sync state.
 */
export function getBirdAcknowledgment(syncState: SyncState): string {
  switch (syncState) {
    case 'confirmed':
      return CONFIRMED_BIRD_MESSAGES[
        Math.floor(Math.random() * CONFIRMED_BIRD_MESSAGES.length)
      ];
    case 'offline':
      return OFFLINE_BIRD_MESSAGES[
        Math.floor(Math.random() * OFFLINE_BIRD_MESSAGES.length)
      ];
    case 'pending':
      return PENDING_BIRD_MESSAGES[
        Math.floor(Math.random() * PENDING_BIRD_MESSAGES.length)
      ];
  }
}

// ── FAILURE ACKNOWLEDGMENT ──────────────────────────────────
// When a write/update definitively fails.
// Never show stale success state.

/**
 * Session 17A: Failure acknowledgment now reflects actual state.
 * Never imply success when persistence failed.
 */
export function getFailureAcknowledgment(): string {
  // Session 6: Compressed
  return 'Save failed — retrying…';
}
