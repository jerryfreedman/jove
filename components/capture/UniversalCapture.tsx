'use client';

// ── SESSION 18: UNIVERSAL CAPTURE ────────────────────────────
// Single capture surface for the entire system.
// Opens from Bird, Sun, Control Panel — identical animation,
// identical layout, identical feel.
//
// Modes:
//   "default" — rotating prompts, free input (Bird tap)
//   "action"  — context-aware header with title/subtitle
//
// Attribution rules:
//   HIGH   → auto-attach silently (no friction)
//   MEDIUM → prefill header, pass confidence flag, don't force
//   LOW    → neutral header, no attachment, pipeline resolves
//
// HARD RULE: Never silently attach input to an entity if
// confidence is not HIGH.

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { COLORS, FONTS, TIMING, EASING, TRANSITIONS, CLOSE_DELAY } from '@/lib/design-system';
import { detectSyncState, getBirdAcknowledgment, type SyncState } from '@/lib/chat/acknowledgment';
import type {
  UniversalCaptureProps,
  CaptureSubmitPayload,
  CaptureContextConfidence,
  CaptureDebugEntry,
} from '@/lib/universal-capture-types';
import { DEFAULT_PROMPTS } from '@/lib/universal-capture-types';

// ── PROMPT ROTATION ──────────────────────────────────────────
const PROMPT_ROTATE_MS = 2500;  // rotate every 2.5 seconds
const PROMPT_FADE_MS = 400;     // soft fade transition duration

// ── DEBUG LOG (non-UI, for future tuning) ────────────────────
function logCapture(entry: CaptureDebugEntry): void {
  if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
    console.debug('[UniversalCapture]', entry);
  }
  // Future: push to analytics/telemetry endpoint
}

// ── COMPONENT ────────────────────────────────────────────────
export default function UniversalCapture({
  open,
  onClose,
  onSubmit,
  mode = 'default',
  title,
  subtitle,
  contextType = 'none',
  contextId,
  contextConfidence = 'low',
  suggestedPrompts,
  source = 'bird',
  saving = false,
}: UniversalCaptureProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState('');
  const [animateIn, setAnimateIn] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  // ── Rotating prompt state ──────────────────────────────────
  const prompts = useMemo(
    () => suggestedPrompts ?? [...DEFAULT_PROMPTS],
    [suggestedPrompts],
  );
  const [promptIndex, setPromptIndex] = useState(0);
  const [promptFading, setPromptFading] = useState(false);
  const isTypingRef = useRef(false);
  const rotationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── First capture tracking ─────────────────────────────────
  const isFirstCaptureRef = useRef(
    typeof window !== 'undefined'
      ? localStorage.getItem('jove_bird_first_capture') !== 'true'
      : false,
  );
  const captureCountRef = useRef(0);

  // ── AUTO-FOCUS on open ─────────────────────────────────────
  useEffect(() => {
    if (open) {
      setValue('');
      setConfirmation(null);
      setPromptIndex(0);
      setPromptFading(false);
      isTypingRef.current = false;
      // Double rAF for DOM paint → then focus
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setAnimateIn(true);
          inputRef.current?.focus();
        });
      });
    } else {
      setAnimateIn(false);
    }
  }, [open]);

  // ── PROMPT ROTATION (default mode only) ────────────────────
  useEffect(() => {
    if (!open || mode !== 'default') return;

    // Clear any existing timer
    if (rotationTimerRef.current) {
      clearInterval(rotationTimerRef.current);
      rotationTimerRef.current = null;
    }

    rotationTimerRef.current = setInterval(() => {
      // Pause rotation while user is typing
      if (isTypingRef.current) return;

      setPromptFading(true);
      setTimeout(() => {
        setPromptIndex(prev => (prev + 1) % prompts.length);
        setPromptFading(false);
      }, PROMPT_FADE_MS);
    }, PROMPT_ROTATE_MS);

    return () => {
      if (rotationTimerRef.current) {
        clearInterval(rotationTimerRef.current);
        rotationTimerRef.current = null;
      }
    };
  }, [open, mode, prompts.length]);

  // Track typing state for prompt rotation pause
  useEffect(() => {
    isTypingRef.current = value.length > 0;
  }, [value]);

  // ── RESOLVE EFFECTIVE CONFIDENCE ───────────────────────────
  // Apply attribution rules:
  //   HIGH   → pass contextId as-is
  //   MEDIUM → pass contextId but flag as medium (downstream decides)
  //   LOW    → strip contextId, let pipeline resolve
  const resolveAttribution = useCallback((): {
    effectiveContextId: string | null;
    effectiveConfidence: CaptureContextConfidence;
  } => {
    if (contextConfidence === 'high' && contextId) {
      return { effectiveContextId: contextId, effectiveConfidence: 'high' };
    }
    if (contextConfidence === 'medium' && contextId) {
      // Pass it through but flag — downstream can use or discard
      return { effectiveContextId: contextId, effectiveConfidence: 'medium' };
    }
    // LOW or no contextId — don't attach
    return { effectiveContextId: null, effectiveConfidence: 'low' };
  }, [contextConfidence, contextId]);

  // ── SUBMIT ─────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed || saving) return;

    // Resolve attribution before submission
    const { effectiveContextId, effectiveConfidence } = resolveAttribution();

    // Debug log (non-UI)
    logCapture({
      timestamp: Date.now(),
      contextConfidence: effectiveConfidence,
      contextType,
      source,
      contextId: effectiveContextId,
      textLength: trimmed.length,
    });

    // Detect sync state for truthful acknowledgment
    const preSyncState = detectSyncState();

    let writeSucceeded = true;
    try {
      const payload: CaptureSubmitPayload = {
        text: trimmed,
        contextType,
        contextId: effectiveContextId,
        contextConfidence: effectiveConfidence,
        source,
      };
      await onSubmit(payload);
    } catch {
      writeSucceeded = false;
    }

    // Sync-aware confirmation
    const syncState: SyncState = writeSucceeded
      ? detectSyncState(true)
      : (preSyncState === 'offline' ? 'offline' : detectSyncState(false));

    captureCountRef.current += 1;

    // First capture gets stronger reinforcement
    const isFirst = isFirstCaptureRef.current;
    if (isFirst) {
      isFirstCaptureRef.current = false;
      if (typeof window !== 'undefined') {
        localStorage.setItem('jove_bird_first_capture', 'true');
      }
      const display = trimmed.length > 30 ? trimmed.slice(0, 30) + '\u2026' : trimmed;
      if (syncState === 'offline') {
        setConfirmation(`Captured "${display}" \u2014 syncing soon`);
      } else {
        setConfirmation(`Added "${display}"`);
      }
    } else {
      setConfirmation(getBirdAcknowledgment(syncState));
    }
    setValue('');

    // Auto-close after confirmation
    setTimeout(() => {
      setConfirmation(null);
      onClose();
    }, isFirst ? 1600 : 1000);
  }, [value, saving, onSubmit, onClose, resolveAttribution, contextType, source]);

  // ── KEY HANDLING ───────────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      onClose();
    }
    // Shift+Enter = newline (textarea default behavior)
  }, [handleSubmit, onClose]);

  // ── TEXTAREA AUTO-EXPAND ───────────────────────────────────
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    // Auto-expand textarea
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, []);

  if (!open) return null;

  // ── HEADER CONTENT ─────────────────────────────────────────
  const isActionMode = mode === 'action' && title;
  const showContextIndicator = isActionMode && contextType !== 'none' && contextConfidence !== 'low';

  return (
    <>
      {/* ── Backdrop: tap to dismiss ────────────────────── */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 60,
          background: animateIn ? 'rgba(6,10,18,0.38)' : 'rgba(6,10,18,0)',
          backdropFilter: animateIn ? 'blur(10px)' : 'blur(0px)',
          WebkitBackdropFilter: animateIn ? 'blur(10px)' : 'blur(0px)',
          transition: TRANSITIONS.overlay,
        }}
      />

      {/* ── Capture container — TRUE CENTER ─────────────── */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: animateIn
            ? 'translate(-50%, -50%) scale(1)'
            : 'translate(-50%, -50%) scale(0.97)',
          zIndex: 65,
          width: 'calc(100% - 48px)',
          maxWidth: 360,
          // Glass container — matches existing system aesthetic
          background: 'rgba(20,24,32,0.72)',
          backdropFilter: 'blur(32px)',
          WebkitBackdropFilter: 'blur(32px)',
          borderRadius: 22,
          border: '0.5px solid rgba(232,160,48,0.10)',
          padding: '16px 16px 14px',
          fontFamily: FONTS.sans,
          opacity: animateIn ? 1 : 0,
          transition: TRANSITIONS.sheet,
          boxShadow: '0 8px 32px rgba(0,0,0,0.32)',
        }}
      >
        {/* ── Confirmation state ──────────────────────── */}
        {confirmation ? (
          <div
            style={{
              textAlign: 'center',
              padding: '12px 0',
              fontFamily: FONTS.serif,
              fontSize: 18,
              fontWeight: 400,
              color: COLORS.amberLight,
              animation: captureCountRef.current > 1
                ? 'ucConfirmSmooth 1s ease forwards'
                : 'ucConfirmFade 1.2s ease forwards',
            }}
          >
            {confirmation}
          </div>
        ) : (
          <>
            {/* ── Context-aware header (action mode) ─── */}
            {isActionMode && (
              <div style={{ marginBottom: 12 }}>
                {/* Title */}
                <div
                  style={{
                    fontFamily: FONTS.serif,
                    fontSize: 17,
                    fontWeight: 400,
                    color: COLORS.textPrimary,
                    letterSpacing: '-0.01em',
                    lineHeight: 1.35,
                    opacity: animateIn ? 1 : 0,
                    transform: animateIn ? 'translateY(0)' : 'translateY(4px)',
                    transition: `opacity ${TIMING.STANDARD}ms ${EASING.gentle} 40ms, transform ${TIMING.STANDARD}ms ${EASING.gentle} 40ms`,
                  }}
                >
                  {title}
                </div>

                {/* Subtitle */}
                {subtitle && (
                  <div
                    style={{
                      fontFamily: FONTS.sans,
                      fontSize: 12,
                      fontWeight: 300,
                      color: 'rgba(240,235,224,0.42)',
                      marginTop: 3,
                      lineHeight: 1.4,
                      opacity: animateIn ? 1 : 0,
                      transform: animateIn ? 'translateY(0)' : 'translateY(3px)',
                      transition: `opacity ${TIMING.STANDARD}ms ${EASING.gentle} 80ms, transform ${TIMING.STANDARD}ms ${EASING.gentle} 80ms`,
                    }}
                  >
                    {subtitle}
                  </div>
                )}

                {/* Context indicator (subtle, non-intrusive) */}
                {showContextIndicator && (
                  <div
                    style={{
                      fontFamily: FONTS.sans,
                      fontSize: 10,
                      fontWeight: 400,
                      color: 'rgba(232,160,48,0.45)',
                      marginTop: 6,
                      letterSpacing: '0.2px',
                      opacity: animateIn ? 1 : 0,
                      transition: `opacity ${TIMING.STANDARD}ms ${EASING.gentle} 120ms`,
                    }}
                  >
                    Linked to {contextType}
                  </div>
                )}
              </div>
            )}

            {/* ── Rotating prompt (default mode) ───────── */}
            {mode === 'default' && !value && (
              <div
                style={{
                  fontFamily: FONTS.serif,
                  fontSize: 15,
                  fontWeight: 400,
                  color: 'rgba(240,235,224,0.32)',
                  textAlign: 'center',
                  marginBottom: 8,
                  height: 22,
                  opacity: promptFading ? 0 : 1,
                  transition: `opacity ${PROMPT_FADE_MS}ms ease`,
                  pointerEvents: 'none',
                }}
              >
                {prompts[promptIndex]}
              </div>
            )}

            {/* ── Input area ───────────────────────────── */}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
              <textarea
                ref={inputRef}
                value={value}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                placeholder={isActionMode ? 'Type here\u2026' : ''}
                autoComplete="off"
                autoCorrect="on"
                rows={1}
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  fontFamily: FONTS.sans,
                  fontSize: 15,
                  fontWeight: 300,
                  color: 'rgba(252,246,234,0.92)',
                  padding: '8px 0',
                  lineHeight: 1.5,
                  resize: 'none',
                  overflow: 'hidden',
                  minHeight: 36,
                  maxHeight: 160,
                }}
              />

              {/* Submit arrow */}
              <button
                onClick={handleSubmit}
                disabled={!value.trim() || saving}
                aria-label="Submit"
                className="jove-tap"
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  border: 'none',
                  background: value.trim() && !saving
                    ? 'rgba(232,160,48,0.22)'
                    : 'transparent',
                  color: value.trim() && !saving
                    ? COLORS.amberLight
                    : 'rgba(240,235,224,0.18)',
                  fontSize: 16,
                  cursor: value.trim() && !saving ? 'pointer' : 'default',
                  transition: TRANSITIONS.button,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  padding: 0,
                  marginBottom: 4,
                }}
              >
                \u21B5
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── Keyframes ──────────────────────────────────── */}
      <style>{`
        @keyframes ucConfirmFade {
          0% { opacity: 1; }
          70% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes ucConfirmSmooth {
          0% { opacity: 0; transform: translateY(2px); }
          15% { opacity: 1; transform: translateY(0); }
          75% { opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>
    </>
  );
}
