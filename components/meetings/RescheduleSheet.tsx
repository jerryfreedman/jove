'use client';

// ── SESSION 8: RESCHEDULE SHEET ─────────────────────────────
// Lightweight bottom-sheet time picker for rescheduling.
// Shared across all meeting surfaces.

import { useState, useEffect, useCallback } from 'react';
import { COLORS, FONTS, TIMING, EASING, TRANSITIONS, CLOSE_DELAY } from '@/lib/design-system';

interface RescheduleSheetProps {
  open: boolean;
  meetingTitle: string;
  currentStartTime: number; // epoch ms
  onConfirm: (newTime: number) => void;
  onClose: () => void;
}

// ── Quick-pick options ──
function getQuickOptions(currentTime: number): Array<{ label: string; time: number }> {
  const options: Array<{ label: string; time: number }> = [];
  const now = new Date();
  const current = new Date(currentTime);

  // Later today: +1h, +2h from now (only if still today)
  const plus1h = new Date(now.getTime() + 60 * 60 * 1000);
  plus1h.setMinutes(0, 0, 0);
  if (plus1h.getDate() === now.getDate()) {
    const h = plus1h.getHours();
    const h12 = h % 12 || 12;
    const ap = h < 12 ? 'am' : 'pm';
    options.push({ label: `Today ${h12}:00${ap}`, time: plus1h.getTime() });
  }

  const plus2h = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  plus2h.setMinutes(0, 0, 0);
  if (plus2h.getDate() === now.getDate()) {
    const h = plus2h.getHours();
    const h12 = h % 12 || 12;
    const ap = h < 12 ? 'am' : 'pm';
    options.push({ label: `Today ${h12}:00${ap}`, time: plus2h.getTime() });
  }

  // Tomorrow same time
  const tomorrowSame = new Date(current);
  tomorrowSame.setDate(tomorrowSame.getDate() + 1);
  if (tomorrowSame.getTime() > now.getTime()) {
    const h = tomorrowSame.getHours();
    const m = tomorrowSame.getMinutes().toString().padStart(2, '0');
    const h12 = h % 12 || 12;
    const ap = h < 12 ? 'am' : 'pm';
    options.push({
      label: `Tomorrow ${h12}:${m}${ap}`,
      time: tomorrowSame.getTime(),
    });
  }

  // Tomorrow morning (9am)
  const tomorrowMorning = new Date(now);
  tomorrowMorning.setDate(tomorrowMorning.getDate() + 1);
  tomorrowMorning.setHours(9, 0, 0, 0);
  // Only add if not duplicate of above
  const hasTomorrowMorning = options.some(
    o => Math.abs(o.time - tomorrowMorning.getTime()) < 60000,
  );
  if (!hasTomorrowMorning) {
    options.push({
      label: 'Tomorrow 9:00am',
      time: tomorrowMorning.getTime(),
    });
  }

  // Next week same day/time
  const nextWeek = new Date(current);
  nextWeek.setDate(nextWeek.getDate() + 7);
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const nwH = nextWeek.getHours();
  const nwM = nextWeek.getMinutes().toString().padStart(2, '0');
  const nwH12 = nwH % 12 || 12;
  const nwAp = nwH < 12 ? 'am' : 'pm';
  options.push({
    label: `Next ${dayNames[nextWeek.getDay()]} ${nwH12}:${nwM}${nwAp}`,
    time: nextWeek.getTime(),
  });

  return options;
}

export default function RescheduleSheet({
  open,
  meetingTitle,
  currentStartTime,
  onConfirm,
  onClose,
}: RescheduleSheetProps) {
  const [visible, setVisible] = useState(false);
  const [customDate, setCustomDate] = useState('');
  const [customTime, setCustomTime] = useState('');
  const [showCustom, setShowCustom] = useState(false);

  useEffect(() => {
    if (open) {
      setShowCustom(false);
      setCustomDate('');
      setCustomTime('');
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
    } else {
      setVisible(false);
    }
  }, [open]);

  const handleClose = useCallback(() => {
    setVisible(false);
    setTimeout(onClose, CLOSE_DELAY);
  }, [onClose]);

  const handleQuickPick = useCallback(
    (time: number) => {
      onConfirm(time);
      handleClose();
    },
    [onConfirm, handleClose],
  );

  const handleCustomConfirm = useCallback(() => {
    if (!customDate || !customTime) return;
    const newTime = new Date(`${customDate}T${customTime}`).getTime();
    if (isNaN(newTime)) return;
    onConfirm(newTime);
    handleClose();
  }, [customDate, customTime, onConfirm, handleClose]);

  if (!open) return null;

  const quickOptions = getQuickOptions(currentStartTime);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={handleClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 95,
          background: visible ? 'rgba(6,10,18,0.38)' : 'rgba(6,10,18,0)',
          backdropFilter: visible ? 'blur(10px)' : 'blur(0px)',
          WebkitBackdropFilter: visible ? 'blur(10px)' : 'blur(0px)',
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
          zIndex: 100,
          background:
            'linear-gradient(180deg, rgba(18,22,30,0.96) 0%, rgba(14,17,24,0.98) 100%)',
          backdropFilter: 'blur(40px) saturate(1.3)',
          WebkitBackdropFilter: 'blur(40px) saturate(1.3)',
          borderRadius: '22px 22px 0 0',
          borderTop: '0.5px solid rgba(240,235,224,0.06)',
          boxShadow: '0 -4px 24px rgba(0,0,0,0.22), 0 -0.5px 0 rgba(240,235,224,0.03) inset',
          transform: visible ? 'translateY(0)' : 'translateY(100%)',
          transition: `transform ${TIMING.STANDARD}ms ${EASING.standard}`,
          fontFamily: FONTS.sans,
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
        }}
      >
        {/* Handle */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            paddingTop: 12,
            paddingBottom: 4,
          }}
        >
          <div
            onClick={handleClose}
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              background: 'rgba(240,235,224,0.14)',
              cursor: 'pointer',
            }}
          />
        </div>

        {/* Title */}
        <div style={{ padding: '8px 20px 16px' }}>
          <div
            style={{
              fontFamily: FONTS.serif,
              fontSize: 18,
              fontWeight: 300,
              color: 'rgba(252,246,234,0.88)',
              letterSpacing: '-0.2px',
            }}
          >
            Reschedule
          </div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 300,
              color: 'rgba(240,235,224,0.36)',
              marginTop: 2,
            }}
          >
            {meetingTitle}
          </div>
        </div>

        {/* Quick pick options */}
        <div style={{ padding: '0 18px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {quickOptions.map((opt, idx) => (
            <button
              key={idx}
              className="jove-tap"
              onClick={() => handleQuickPick(opt.time)}
              style={{
                display: 'block',
                width: '100%',
                padding: '13px 16px',
                background: 'rgba(240,235,224,0.04)',
                border: '0.5px solid rgba(240,235,224,0.08)',
                borderRadius: 12,
                cursor: 'pointer',
                fontFamily: FONTS.sans,
                fontSize: 14,
                fontWeight: 400,
                color: 'rgba(252,246,234,0.82)',
                textAlign: 'left',
                transition: TRANSITIONS.button,
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {opt.label}
            </button>
          ))}

          {/* Custom time toggle */}
          {!showCustom ? (
            <button
              onClick={() => setShowCustom(true)}
              style={{
                display: 'block',
                width: '100%',
                padding: '13px 16px',
                background: 'transparent',
                border: '0.5px solid rgba(240,235,224,0.06)',
                borderRadius: 12,
                cursor: 'pointer',
                fontFamily: FONTS.sans,
                fontSize: 13,
                fontWeight: 400,
                color: COLORS.teal,
                textAlign: 'left',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              Pick a specific time...
            </button>
          ) : (
            <div
              style={{
                padding: '14px 16px',
                background: 'rgba(240,235,224,0.03)',
                border: '0.5px solid rgba(240,235,224,0.08)',
                borderRadius: 12,
                display: 'flex',
                gap: 8,
                alignItems: 'center',
              }}
            >
              <input
                type="date"
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
                style={{
                  flex: 1,
                  background: 'rgba(240,235,224,0.06)',
                  border: '0.5px solid rgba(240,235,224,0.10)',
                  borderRadius: 8,
                  padding: '8px 10px',
                  fontSize: 13,
                  color: 'rgba(252,246,234,0.82)',
                  fontFamily: FONTS.sans,
                  outline: 'none',
                  colorScheme: 'dark',
                }}
              />
              <input
                type="time"
                value={customTime}
                onChange={(e) => setCustomTime(e.target.value)}
                style={{
                  width: 110,
                  background: 'rgba(240,235,224,0.06)',
                  border: '0.5px solid rgba(240,235,224,0.10)',
                  borderRadius: 8,
                  padding: '8px 10px',
                  fontSize: 13,
                  color: 'rgba(252,246,234,0.82)',
                  fontFamily: FONTS.sans,
                  outline: 'none',
                  colorScheme: 'dark',
                }}
              />
              <button
                className="jove-tap"
                onClick={handleCustomConfirm}
                disabled={!customDate || !customTime}
                style={{
                  padding: '8px 14px',
                  background:
                    customDate && customTime
                      ? COLORS.teal
                      : 'rgba(56,184,200,0.3)',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  color: customDate && customTime ? '#0D0F12' : 'rgba(13,15,18,0.5)',
                  cursor: customDate && customTime ? 'pointer' : 'default',
                  fontFamily: FONTS.sans,
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                Go
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
