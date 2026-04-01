'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { COLORS, FONTS, TIMING, EASING, TRANSITIONS, CLOSE_DELAY } from '@/lib/design-system';
import { detectSyncState, getBirdAcknowledgment, type SyncState } from '@/lib/chat/acknowledgment';

// ── SESSION 13B: BIRD CAPTURE OVERLAY ──────────────────────
// Lightweight, instant capture moment.
// NOT a chat window. NOT a conversation.
// → Drop something in. It's handled.

// ── PLACEHOLDER ROTATION ───────────────────────────────────
const PLACEHOLDERS = [
  'What just happened?',
  'Add something…',
  'What changed?',
];

// ── CONFIRMATION MESSAGES ──────────────────────────────────
// Session 15C.1: Sync-aware confirmations via acknowledgment module.
// Brief, human, non-structural. User never sees "task created".

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── TYPES ──────────────────────────────────────────────────

export interface CaptureOverlayProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (text: string) => Promise<void>;
  /** Whether submission is in progress */
  saving?: boolean;
}

export default function CaptureOverlay({
  open,
  onClose,
  onSubmit,
  saving = false,
}: CaptureOverlayProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [placeholder] = useState(() => randomFrom(PLACEHOLDERS));
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [capturedText, setCapturedText] = useState<string | null>(null);
  const [animateIn, setAnimateIn] = useState(false);
  // Session 13C: Track first-ever capture for stronger reinforcement
  const isFirstCaptureRef = useRef(
    typeof window !== 'undefined'
      ? localStorage.getItem('jove_bird_first_capture') !== 'true'
      : false
  );

  // ── AUTO-FOCUS on open ────────────────────────────────────
  // Session 14F: Track capture count for micro-reinforcement (smoother experience)
  const captureCountRef = useRef(0);

  useEffect(() => {
    if (open) {
      setValue('');
      setConfirmation(null);
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

  // ── SUBMIT ────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed || saving) return;

    // Session 15C.1: Detect sync state BEFORE submission
    const preSyncState = detectSyncState();

    // Fire submission — track success/failure for truthful confirmation
    let writeSucceeded = true;
    try {
      await onSubmit(trimmed);
    } catch {
      writeSucceeded = false;
    }

    // Session 15C.1: Determine actual sync state based on write result
    const syncState: SyncState = writeSucceeded
      ? detectSyncState(true)
      : (preSyncState === 'offline' ? 'offline' : detectSyncState(false));

    // Session 14F: Increment capture count for micro-reinforcement
    captureCountRef.current += 1;

    // Session 13C: First capture gets stronger reinforcement — "Added [text]"
    const isFirst = isFirstCaptureRef.current;
    if (isFirst) {
      isFirstCaptureRef.current = false;
      if (typeof window !== 'undefined') {
        localStorage.setItem('jove_bird_first_capture', 'true');
      }
      // Truncate for display
      const display = trimmed.length > 30 ? trimmed.slice(0, 30) + '…' : trimmed;
      // Session 15C.1: Even first capture is sync-aware
      if (syncState === 'offline') {
        setConfirmation(`Captured "${display}" — syncing soon`);
      } else {
        setConfirmation(`Added "${display}"`);
      }
      setCapturedText(trimmed);
    } else {
      // Session 15C.1: Use sync-aware bird acknowledgment
      setConfirmation(getBirdAcknowledgment(syncState));
      setCapturedText(null);
    }
    setValue('');

    // Auto-close after confirmation fades (slightly longer for first capture)
    // Session 14F: Tightened from 1200→1000ms for snappier repeat captures
    setTimeout(() => {
      setConfirmation(null);
      setCapturedText(null);
      onClose();
    }, isFirst ? 1600 : 1000);
  }, [value, saving, onSubmit, onClose]);

  // ── KEY HANDLING ──────────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      onClose();
    }
  }, [handleSubmit, onClose]);

  if (!open) return null;

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

      {/* ── Capture container ───────────────────────────── */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          bottom: '38%',
          left: '50%',
          transform: animateIn
            ? 'translate(-50%, 0) scale(1)'
            : 'translate(-50%, 8px) scale(0.97)',
          zIndex: 65,
          width: 'calc(100% - 48px)',
          maxWidth: 360,
          // Glass container
          background: 'rgba(20,24,32,0.72)',
          backdropFilter: 'blur(32px)',
          WebkitBackdropFilter: 'blur(32px)',
          borderRadius: 22,
          border: '0.5px solid rgba(232,160,48,0.10)',
          padding: '16px 16px 14px',
          fontFamily: "'DM Sans', sans-serif",
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
              padding: capturedText ? '10px 0' : '12px 0',
              fontFamily: FONTS?.serif ?? "'Cormorant Garamond', serif",
              fontSize: capturedText ? 16 : 18,
              fontWeight: 400,
              color: COLORS.amberLight,
              opacity: 1,
              // Session 14F: Use smoother animation for repeat captures
              animation: capturedText
                ? 'captureConfirmFade 1.6s ease forwards'
                : captureCountRef.current > 1
                  ? 'captureConfirmSmooth 1s ease forwards'
                  : 'captureConfirmFade 1.2s ease forwards',
            }}
          >
            {confirmation}
          </div>
        ) : (
          /* ── Input state ────────────────────────────── */
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              autoComplete="off"
              autoCorrect="on"
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 15,
                fontWeight: 300,
                color: 'rgba(252,246,234,0.92)',
                padding: '8px 0',
                lineHeight: 1.5,
              }}
            />
            {/* Submit arrow — only visible when there's text */}
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
                transition: 'all 0.15s ease',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                padding: 0,
              }}
            >
              ↵
            </button>
          </div>
        )}
      </div>

      {/* ── Keyframes ──────────────────────────────────── */}
      {/* Session 14F: Added captureConfirmSmooth for snappier repeat captures */}
      <style>{`
        @keyframes captureConfirmFade {
          0% { opacity: 1; }
          70% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes captureConfirmSmooth {
          0% { opacity: 0; transform: translateY(2px); }
          15% { opacity: 1; transform: translateY(0); }
          75% { opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>
    </>
  );
}
