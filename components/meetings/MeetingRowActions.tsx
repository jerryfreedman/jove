'use client';

// ── SESSION 8: MEETING ROW ACTIONS ──────────────────────────
// Compact overflow menu for quick meeting actions.
// Shared across ControlSurface, BriefingSurface, MeetingsSurface.
// All actions route through the shared meeting action layer.

import { useState, useRef, useEffect, useCallback } from 'react';
import { COLORS, FONTS } from '@/lib/design-system';

export interface MeetingRowActionsProps {
  meetingId: string;
  meetingTitle: string;
  onComplete: (meetingId: string) => void;
  onCancel: (meetingId: string) => void;
  onReschedule: (meetingId: string) => void;
}

export default function MeetingRowActions({
  meetingId,
  meetingTitle,
  onComplete,
  onCancel,
  onReschedule,
}: MeetingRowActionsProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside tap
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [open]);

  const handleAction = useCallback(
    (action: 'complete' | 'cancel' | 'reschedule') => {
      setOpen(false);
      switch (action) {
        case 'complete':
          onComplete(meetingId);
          break;
        case 'cancel':
          onCancel(meetingId);
          break;
        case 'reschedule':
          onReschedule(meetingId);
          break;
      }
    },
    [meetingId, onComplete, onCancel, onReschedule],
  );

  const actionItems = [
    {
      key: 'complete' as const,
      label: 'Mark complete',
      color: COLORS.green,
      icon: '✓',
    },
    {
      key: 'reschedule' as const,
      label: 'Reschedule',
      color: COLORS.teal,
      icon: '↻',
    },
    {
      key: 'cancel' as const,
      label: 'Cancel meeting',
      color: COLORS.red,
      icon: '✕',
    },
  ];

  return (
    <div ref={menuRef} style={{ position: 'relative' }}>
      {/* Trigger — compact "..." button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen(o => !o);
        }}
        aria-label={`Actions for ${meetingTitle}`}
        style={{
          background: open
            ? 'rgba(240,235,224,0.10)'
            : 'rgba(240,235,224,0.04)',
          border: 'none',
          borderRadius: 8,
          width: 32,
          height: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          fontFamily: FONTS.sans,
          fontSize: 16,
          color: 'rgba(240,235,224,0.44)',
          transition: 'background 0.15s ease',
          flexShrink: 0,
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        ···
      </button>

      {/* Dropdown menu */}
      {open && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 4px)',
            zIndex: 87,
            background: 'rgba(18,22,30,0.96)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            borderRadius: 14,
            border: '0.5px solid rgba(240,235,224,0.10)',
            boxShadow:
              '0 8px 32px rgba(0,0,0,0.32), 0 1px 4px rgba(0,0,0,0.18)',
            minWidth: 180,
            overflow: 'hidden',
            fontFamily: FONTS.sans,
          }}
        >
          {actionItems.map((item, idx) => (
            <button
              key={item.key}
              onClick={(e) => {
                e.stopPropagation();
                handleAction(item.key);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                padding: '13px 16px',
                background: 'transparent',
                border: 'none',
                borderBottom:
                  idx < actionItems.length - 1
                    ? '0.5px solid rgba(240,235,224,0.06)'
                    : 'none',
                cursor: 'pointer',
                fontFamily: FONTS.sans,
                fontSize: 13,
                fontWeight: 400,
                color: item.color,
                textAlign: 'left',
                transition: 'background 0.12s ease',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <span
                style={{
                  fontSize: 14,
                  width: 18,
                  textAlign: 'center',
                  opacity: 0.8,
                }}
              >
                {item.icon}
              </span>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
