'use client';

// ── SESSION 8: MEETING ACTION TOAST ─────────────────────────
// Compact confirmation toast with undo support.
// Shared across all meeting surfaces — reads from useMeetingActionStore.

import { useEffect, useState } from 'react';
import { COLORS, FONTS } from '@/lib/design-system';
import { useMeetingActionStore } from '@/lib/meeting-actions';

export default function MeetingActionToast() {
  const toast = useMeetingActionStore(s => s.toast);
  const undo = useMeetingActionStore(s => s.undo);
  const dismissToast = useMeetingActionStore(s => s.dismissToast);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (toast) {
      // Animate in
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
    } else {
      setVisible(false);
    }
  }, [toast]);

  if (!toast) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)',
        left: 16,
        right: 16,
        zIndex: 350,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        background: 'rgba(18,22,30,0.94)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '0.5px solid rgba(240,235,224,0.10)',
        borderRadius: 14,
        padding: '12px 16px',
        boxShadow: '0 6px 24px rgba(0,0,0,0.30)',
        fontFamily: FONTS.sans,
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(12px)',
        transition: 'opacity 0.22s ease, transform 0.22s ease',
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      {/* Message */}
      <span
        style={{
          fontSize: 13,
          fontWeight: 400,
          color: 'rgba(252,246,234,0.82)',
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {toast.message}
      </span>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        {toast.undoAvailable && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              undo();
            }}
            style={{
              background: 'rgba(240,235,224,0.08)',
              border: '0.5px solid rgba(240,235,224,0.12)',
              borderRadius: 8,
              padding: '6px 12px',
              cursor: 'pointer',
              fontFamily: FONTS.sans,
              fontSize: 12,
              fontWeight: 500,
              color: COLORS.amber,
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            Undo
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            dismissToast();
          }}
          style={{
            background: 'transparent',
            border: 'none',
            padding: '6px 8px',
            cursor: 'pointer',
            fontSize: 14,
            color: 'rgba(240,235,224,0.32)',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
