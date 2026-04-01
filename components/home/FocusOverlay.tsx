'use client';

// ── SESSION 13A: SUN FOCUS OVERLAY ──────────────────────────
// Instant clarity moment — replaces briefing navigation.
// Shows 1–3 highest priority items. No scrolling. No categories.
// Tap outside to close. Feels instant and obvious.

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { COLORS, FONTS } from '@/lib/design-system';
import { useWhatMattersTasks } from '@/lib/task-queries';
import { useTaskEngine } from '@/lib/task-engine';
import type { DealRow } from '@/lib/types';

// ── TYPES ──────────────────────────────────────────────────

type DealWithAccount = DealRow & { accounts: { name: string } | null };

interface FocusOverlayProps {
  open: boolean;
  onClose: () => void;
  userId: string | null;
  urgentDeals: DealWithAccount[];
  allDeals: DealWithAccount[];
}

interface FocusItem {
  id: string;
  title: string;
  time?: string;
}

// ── TIME FORMATTING (compact) ──────────────────────────────

function formatFocusTime(dueAt: string | null): string | undefined {
  if (!dueAt) return undefined;
  const now = new Date();
  const due = new Date(dueAt);
  const diffMs = due.getTime() - now.getTime();
  const diffMin = Math.round(diffMs / 60000);

  if (diffMin < -60) return 'overdue';
  if (diffMin < 0) return 'overdue';
  if (diffMin === 0) return 'now';
  if (diffMin < 60) return `${diffMin}m`;
  const hours = Math.round(diffMin / 60);
  if (hours < 24) return `${hours}h`;

  // Today / tomorrow
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);
  if (due <= todayEnd) return 'today';

  const tomorrowEnd = new Date(todayEnd);
  tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);
  if (due <= tomorrowEnd) return 'tomorrow';

  return undefined;
}

// ── COMPONENT ──────────────────────────────────────────────

export default function FocusOverlay({
  open,
  onClose,
  userId,
  urgentDeals,
  allDeals,
}: FocusOverlayProps) {
  // Animation states
  const [visible, setVisible] = useState(false);
  const [animateIn, setAnimateIn] = useState(false);

  // Session 13C: One-time "Focus on this." hint — shown only on very first sun tap
  const [showFocusHint, setShowFocusHint] = useState(false);
  const focusHintShownRef = useRef(false);

  // ── OPEN / CLOSE ANIMATION ──────────────────────────────
  useEffect(() => {
    if (open) {
      setVisible(true);
      // Session 13C: Check if this is the first-ever sun tap
      if (!focusHintShownRef.current) {
        const hasSeenFocus = typeof window !== 'undefined'
          ? localStorage.getItem('jove_sun_first_tap') === 'true'
          : true;
        if (!hasSeenFocus) {
          focusHintShownRef.current = true;
          setShowFocusHint(true);
          if (typeof window !== 'undefined') {
            localStorage.setItem('jove_sun_first_tap', 'true');
          }
          // Auto-hide after 2.5s
          setTimeout(() => setShowFocusHint(false), 2500);
        } else {
          focusHintShownRef.current = true;
        }
      }
      // Next frame: trigger CSS transition
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setAnimateIn(true);
        });
      });
    } else {
      setAnimateIn(false);
      setShowFocusHint(false);
      const timer = setTimeout(() => setVisible(false), 200);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // ── TASK DATA ───────────────────────────────────────────
  // Reuse What Matters query — strict max 3
  const { tasks: dbTasks } = useWhatMattersTasks(userId, 3);
  const legacyTasks = useTaskEngine(allDeals);

  // ── BUILD FOCUS ITEMS (max 3, strict) ───────────────────
  const focusItems = useMemo((): FocusItem[] => {
    const items: FocusItem[] = [];

    // Primary: DB-backed tasks
    if (dbTasks.length > 0) {
      for (const task of dbTasks.slice(0, 3)) {
        items.push({
          id: task.id,
          title: task.title,
          time: formatFocusTime(task.dueAt),
        });
      }
    } else {
      // Fallback: legacy system tasks
      for (const task of legacyTasks.slice(0, 3)) {
        items.push({
          id: task.id,
          title: task.title,
          time: task.timeRelevance ?? undefined,
        });
      }
    }

    // If still empty, try urgent deals
    if (items.length === 0) {
      for (const deal of urgentDeals.slice(0, 2)) {
        items.push({
          id: deal.id,
          title: deal.name,
        });
      }
    }

    return items.slice(0, 3);
  }, [dbTasks, legacyTasks, urgentDeals]);

  // ── CLOSE ON BACKDROP TAP ───────────────────────────────
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  // ── RENDER ──────────────────────────────────────────────
  if (!visible) return null;

  const isEmpty = focusItems.length === 0;

  return (
    <div
      onClick={handleBackdropClick}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: animateIn
          ? 'rgba(6,10,18,0.15)'
          : 'rgba(6,10,18,0)',
        backdropFilter: animateIn ? 'blur(6px)' : 'blur(0px)',
        WebkitBackdropFilter: animateIn ? 'blur(6px)' : 'blur(0px)',
        transition: 'background 200ms ease, backdrop-filter 200ms ease, -webkit-backdrop-filter 200ms ease',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {/* ── GLASS CONTAINER ──────────────────────────── */}
      <div
        style={{
          minWidth: 240,
          maxWidth: 320,
          padding: isEmpty ? '28px 32px' : '24px 28px',
          background: 'rgba(20,24,32,0.72)',
          backdropFilter: 'blur(32px)',
          WebkitBackdropFilter: 'blur(32px)',
          border: '0.5px solid rgba(240,235,224,0.08)',
          borderRadius: 20,
          transform: animateIn ? 'scale(1)' : 'scale(0.96)',
          opacity: animateIn ? 1 : 0,
          transition: 'transform 200ms ease, opacity 180ms ease',
          display: 'flex',
          flexDirection: 'column',
          gap: isEmpty ? 0 : 14,
        }}
      >
        {/* Session 13C: One-time focus hint — subtle reinforcement */}
        {showFocusHint && (
          <div
            style={{
              fontFamily: FONTS.sans,
              fontSize: 11,
              fontWeight: 300,
              color: 'rgba(240,235,224,0.32)',
              textAlign: 'center',
              letterSpacing: '0.3px',
              marginBottom: isEmpty ? 0 : -4,
              opacity: showFocusHint ? 1 : 0,
              transition: 'opacity 0.6s ease',
            }}
          >
            Focus on this.
          </div>
        )}

        {isEmpty ? (
          /* ── EMPTY STATE ──────────────────────────── */
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                fontFamily: FONTS.serif,
                fontSize: 20,
                fontWeight: 400,
                color: COLORS.textPrimary,
                letterSpacing: '-0.01em',
                lineHeight: 1.3,
              }}
            >
              You&rsquo;re clear.
            </div>
            <div
              style={{
                fontFamily: FONTS.sans,
                fontSize: 13,
                fontWeight: 300,
                color: 'rgba(240,235,224,0.36)',
                marginTop: 6,
                lineHeight: 1.4,
              }}
            >
              Nothing pressing right now.
            </div>
          </div>
        ) : (
          /* ── FOCUS ITEMS ──────────────────────────── */
          focusItems.map((item, i) => (
            <div
              key={item.id}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: 12,
                opacity: animateIn ? 1 : 0,
                transform: animateIn ? 'translateY(0)' : 'translateY(4px)',
                transition: `opacity 200ms ease ${60 + i * 40}ms, transform 200ms ease ${60 + i * 40}ms`,
              }}
            >
              <span
                style={{
                  fontFamily: FONTS.serif,
                  fontSize: 18,
                  fontWeight: 400,
                  color: COLORS.textPrimary,
                  letterSpacing: '-0.01em',
                  lineHeight: 1.35,
                  flex: 1,
                  minWidth: 0,
                }}
              >
                {item.title}
              </span>
              {item.time && (
                <span
                  style={{
                    fontFamily: FONTS.sans,
                    fontSize: 12,
                    fontWeight: 400,
                    color: item.time === 'overdue'
                      ? COLORS.amber
                      : 'rgba(240,235,224,0.40)',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  {item.time}
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
