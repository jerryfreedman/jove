'use client';

import { useState, useEffect, useCallback } from 'react';
import { FONTS, TIMING, EASING, TRANSITIONS, CLOSE_DELAY } from '@/lib/design-system';

interface SurfaceContainerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  level?: 1 | 2;
  onBack?: () => void;
  maxHeight?: string;
  children: React.ReactNode;
}

export default function SurfaceContainer({
  open,
  onClose,
  title,
  level = 1,
  onBack,
  maxHeight = '88dvh',
  children,
}: SurfaceContainerProps) {
  const [sheetVisible, setSheetVisible] = useState(false);

  // Animate in
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setSheetVisible(true);
        });
      });
    } else {
      setSheetVisible(false);
    }
  }, [open]);

  const handleClose = useCallback(() => {
    setSheetVisible(false);
    setTimeout(onClose, CLOSE_DELAY);
  }, [onClose]);

  if (!open) return null;

  // Z-index: Level 2 sits above Level 1
  const backdropZ = level === 2 ? 80 : 70;
  const sheetZ    = level === 2 ? 85 : 75;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={handleClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: backdropZ,
          background: sheetVisible ? 'rgba(6,10,18,0.38)' : 'rgba(6,10,18,0)',
          backdropFilter: sheetVisible ? 'blur(10px)' : 'blur(0px)',
          WebkitBackdropFilter: sheetVisible ? 'blur(10px)' : 'blur(0px)',
          transition: TRANSITIONS.overlay,
        }}
      />

      {/* Sheet */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: sheetZ,
          maxHeight,
          display: 'flex',
          flexDirection: 'column',
          background: 'linear-gradient(180deg, rgba(15,19,28,0.92) 0%, rgba(11,14,22,0.95) 100%)',
          backdropFilter: 'blur(40px) saturate(1.3)',
          WebkitBackdropFilter: 'blur(40px) saturate(1.3)',
          borderRadius: '22px 22px 0 0',
          borderTop: '0.5px solid rgba(240,235,224,0.06)',
          boxShadow: '0 -4px 32px rgba(0,0,0,0.22), 0 -0.5px 0 rgba(240,235,224,0.03) inset',
          transform: sheetVisible ? 'translateY(0)' : 'translateY(100%)',
          transition: `transform ${TIMING.STANDARD}ms ${EASING.standard}`,
          fontFamily: FONTS.sans,
        }}
      >
        {/* Handle */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            paddingTop: 12,
            paddingBottom: 4,
            flexShrink: 0,
          }}
        >
          <div
            onClick={handleClose}
            className="jove-tap"
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              background: 'rgba(240,235,224,0.10)',
              cursor: 'pointer',
            }}
          />
        </div>

        {/* Header */}
        <div
          style={{
            padding: '8px 22px 16px',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          {onBack && (
            <button
              onClick={onBack}
              className="jove-tap"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
              aria-label="Go back"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path
                  d="M12 16L6 10L12 4"
                  stroke="rgba(240,235,224,0.56)"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
          <div
            style={{
              fontFamily: FONTS.serif,
              fontSize: 22,
              fontWeight: 300,
              color: 'rgba(252,246,234,0.92)',
              letterSpacing: '-0.3px',
            }}
          >
            {title}
          </div>
        </div>

        {/* Scrollable content */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: '0 18px 8px',
            minHeight: 0,
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {children}
        </div>
      </div>
    </>
  );
}
