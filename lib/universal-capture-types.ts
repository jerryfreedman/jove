// ── SESSION 18: UNIVERSAL CAPTURE TYPES ──────────────────────
// Single type system for the unified capture surface.
// Used by UniversalCapture, home page, and all entry points.

// ── CAPTURE MODE ─────────────────────────────────────────────
// "default" — free input, rotating prompts (Bird tap, no context)
// "action"  — context-aware header, linked to an entity
export type CaptureMode = 'default' | 'action';

// ── CONTEXT TYPE ─────────────────────────────────────────────
// What kind of entity the capture is linked to (if any).
export type CaptureContextType =
  | 'task'
  | 'item'
  | 'person'
  | 'event'
  | 'meeting'
  | 'deal'
  | 'none';

// ── CONTEXT CONFIDENCE ───────────────────────────────────────
// How confident the system is about the suggested context.
// HIGH   → auto-attach silently
// MEDIUM → show in header, pass downstream, don't force
// LOW    → neutral header, no attachment, pipeline resolves later
export type CaptureContextConfidence = 'high' | 'medium' | 'low';

// ── CAPTURE SOURCE ───────────────────────────────────────────
// Where the capture was opened from. Used for logging + routing.
export type CaptureSource =
  | 'bird'
  | 'sun'
  | 'control_panel'
  | 'system';

// ── UNIVERSAL CAPTURE PROPS ──────────────────────────────────
export interface UniversalCaptureProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: CaptureSubmitPayload) => Promise<void>;

  // ── Mode ────────────────────────────────────────────────
  mode?: CaptureMode;

  // ── Context-aware header (action mode) ──────────────────
  title?: string;
  subtitle?: string;
  contextType?: CaptureContextType;
  contextId?: string;
  contextConfidence?: CaptureContextConfidence;

  // ── Default mode prompts ────────────────────────────────
  suggestedPrompts?: string[];

  // ── Source tracking ─────────────────────────────────────
  source?: CaptureSource;

  // ── Submission state ────────────────────────────────────
  saving?: boolean;
}

// ── SUBMIT PAYLOAD ───────────────────────────────────────────
// Everything downstream needs to route the captured input.
export interface CaptureSubmitPayload {
  text: string;
  contextType: CaptureContextType;
  contextId: string | null;
  contextConfidence: CaptureContextConfidence;
  source: CaptureSource;
}

// ── CAPTURE CONTEXT ──────────────────────────────────────────
// Convenience type for passing context from entry points.
export interface CaptureContext {
  mode: CaptureMode;
  title?: string;
  subtitle?: string;
  contextType: CaptureContextType;
  contextId?: string;
  contextConfidence: CaptureContextConfidence;
  source: CaptureSource;
  suggestedPrompts?: string[];
}

// ── DEFAULT ROTATING PROMPTS ─────────────────────────────────
export const DEFAULT_PROMPTS = [
  'What needs attention?',
  'What changed today?',
  "What's still unresolved?",
  'What moved forward?',
  "What's stuck?",
] as const;

// ── DEBUG LOG ENTRY ──────────────────────────────────────────
// Non-UI logging for future attribution tuning.
export interface CaptureDebugEntry {
  timestamp: number;
  contextConfidence: CaptureContextConfidence;
  contextType: CaptureContextType;
  source: CaptureSource;
  contextId: string | null;
  textLength: number;
}
