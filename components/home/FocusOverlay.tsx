'use client';

// ── SESSION 15A: SUN DECISION SURFACE ──────────────────────────
// Replaces the old focus overlay with a decision surface.
//
// Structure:
//   [Decision headline]
//   • key interpretation insight
//   • key risk or gap
//   Next:
//   → action 1
//   → action 2
//
// Rules:
//   - no paragraphs
//   - max ~5 lines
//   - must feel like a recommendation, not a recap
//   - NEVER echo input
//   - ALWAYS recommend a direction

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { COLORS, FONTS, TIMING, EASING, TRANSITIONS } from '@/lib/design-system';
import { useWhatMattersTasks } from '@/lib/task-queries';
import { useTaskEngine } from '@/lib/task-engine';
import { getDayPhase } from '@/lib/daily-loop';
import { decideSunOutput, type SunDecision } from '@/lib/intelligence/decide';
import { toAction } from '@/lib/intelligence/action';
import type { DealRow } from '@/lib/types';
import { dedupeSurfaceItems } from '@/lib/intelligence/dedupe';
import { isWeakAction } from '@/lib/intelligence/action-quality';

// ── TYPES ──────────────────────────────────────────────────

type DealWithAccount = DealRow & { accounts: { name: string } | null };

interface FocusOverlayProps {
  open: boolean;
  onClose: () => void;
  userId: string | null;
  urgentDeals: DealWithAccount[];
  allDeals: DealWithAccount[];
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

  // Session 13C: One-time hint
  const [showFocusHint, setShowFocusHint] = useState(false);
  const focusHintShownRef = useRef(false);

  // ── OPEN / CLOSE ANIMATION ──────────────────────────────
  useEffect(() => {
    if (open) {
      setVisible(true);
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
          setTimeout(() => setShowFocusHint(false), 2500);
        } else {
          focusHintShownRef.current = true;
        }
      }
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setAnimateIn(true);
        });
      });
    } else {
      setAnimateIn(false);
      setShowFocusHint(false);
      const timer = setTimeout(() => setVisible(false), 240);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // ── TASK DATA ───────────────────────────────────────────
  const { tasks: dbTasks } = useWhatMattersTasks(userId, 3);
  const legacyTasks = useTaskEngine(allDeals);

  // ── BUILD DECISION SURFACE ─────────────────────────────
  const sunDecision = useMemo((): SunDecision | null => {
    // Gather items for the decision engine
    const items: Array<{ title: string; subtitle?: string; time?: string; nextAction?: string }> = [];

    // Primary: DB-backed tasks
    if (dbTasks.length > 0) {
      for (const task of dbTasks.slice(0, 3)) {
        items.push({
          title: task.title,
          time: formatDecisionTime(task.dueAt),
          nextAction: task.title, // Task title IS the action
        });
      }
    } else {
      // Fallback: legacy system tasks
      for (const task of legacyTasks.slice(0, 3)) {
        items.push({
          title: task.title,
          subtitle: task.subtitle ?? undefined,
          time: task.timeRelevance ?? undefined,
          nextAction: task.title,
        });
      }
    }

    // If still empty, try urgent deals
    if (items.length === 0) {
      for (const deal of urgentDeals.slice(0, 2)) {
        items.push({
          title: deal.name,
          nextAction: deal.next_action ?? undefined,
        });
      }
    }

    // Session 15C: Deduplicate and filter weak items before decision
    const dedupedItems = dedupeSurfaceItems(
      items.map((item, i) => ({ ...item, id: `sun-${i}` }))
    ).map(({ id, ...rest }) => rest);

    // Filter items with weak titles
    const qualityItems = dedupedItems.filter(item => {
      const titleToCheck = item.nextAction ?? item.title;
      return !isWeakAction(titleToCheck);
    });

    return decideSunOutput(qualityItems.length > 0 ? qualityItems : dedupedItems);
  }, [dbTasks, legacyTasks, urgentDeals]);

  // ── CLOSE ON BACKDROP TAP ───────────────────────────────
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  // ── RENDER ──────────────────────────────────────────────
  if (!visible) return null;

  const isEmpty = !sunDecision;

  // Phase-aware empty state
  const phase = getDayPhase();
  const emptyTitle = phase === 'evening' || phase === 'night'
    ? 'You\u2019re done.'
    : 'You\u2019re clear.';
  const emptySubtitle = phase === 'morning'
    ? 'Nothing on your plate yet.'
    : phase === 'evening' || phase === 'night'
      ? 'Rest well tonight.'
      : 'Nothing pressing right now.';

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
          ? 'rgba(6,10,18,0.38)'
          : 'rgba(6,10,18,0)',
        backdropFilter: animateIn ? 'blur(10px)' : 'blur(0px)',
        WebkitBackdropFilter: animateIn ? 'blur(10px)' : 'blur(0px)',
        transition: TRANSITIONS.overlay,
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {/* ── GLASS CONTAINER ──────────────────────────── */}
      <div
        style={{
          minWidth: 260,
          maxWidth: 340,
          padding: isEmpty ? '28px 32px' : '22px 26px 20px',
          background: 'rgba(20,24,32,0.72)',
          backdropFilter: 'blur(32px)',
          WebkitBackdropFilter: 'blur(32px)',
          border: '0.5px solid rgba(240,235,224,0.06)',
          borderRadius: 22,
          transform: animateIn ? 'scale(1)' : 'scale(0.97)',
          opacity: animateIn ? 1 : 0,
          transition: TRANSITIONS.sheet,
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
        }}
      >
        {/* One-time focus hint */}
        {showFocusHint && (
          <div
            style={{
              fontFamily: FONTS.sans,
              fontSize: 11,
              fontWeight: 300,
              color: 'rgba(240,235,224,0.32)',
              textAlign: 'center',
              letterSpacing: '0.3px',
              marginBottom: 6,
              opacity: showFocusHint ? 1 : 0,
              transition: 'opacity 0.6s ease',
            }}
          >
            Here&apos;s what to do.
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
              {emptyTitle}
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
              {emptySubtitle}
            </div>
          </div>
        ) : (
          /* ── DECISION SURFACE ─────────────────────── */
          <>
            {/* Decision headline */}
            <div
              style={{
                fontFamily: FONTS.serif,
                fontSize: 18,
                fontWeight: 400,
                color: COLORS.textPrimary,
                letterSpacing: '-0.01em',
                lineHeight: 1.3,
                opacity: animateIn ? 1 : 0,
                transform: animateIn ? 'translateY(0)' : 'translateY(4px)',
                transition: `opacity ${TIMING.STANDARD}ms ${EASING.gentle} 40ms, transform ${TIMING.STANDARD}ms ${EASING.gentle} 40ms`,
              }}
            >
              {sunDecision.headline}
            </div>

            {/* Insight + gap bullets */}
            <div
              style={{
                marginTop: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
                opacity: animateIn ? 1 : 0,
                transform: animateIn ? 'translateY(0)' : 'translateY(4px)',
                transition: `opacity ${TIMING.STANDARD}ms ${EASING.gentle} 80ms, transform ${TIMING.STANDARD}ms ${EASING.gentle} 80ms`,
              }}
            >
              <div
                style={{
                  fontFamily: FONTS.sans,
                  fontSize: 12,
                  fontWeight: 400,
                  color: 'rgba(240,235,224,0.50)',
                  lineHeight: 1.4,
                }}
              >
                &bull; {sunDecision.insight}
              </div>
              <div
                style={{
                  fontFamily: FONTS.sans,
                  fontSize: 12,
                  fontWeight: 400,
                  color: 'rgba(240,235,224,0.36)',
                  lineHeight: 1.4,
                }}
              >
                &bull; {sunDecision.gap}
              </div>
            </div>

            {/* Next actions */}
            {sunDecision.nextActions.length > 0 && (
              <div
                style={{
                  marginTop: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  opacity: animateIn ? 1 : 0,
                  transform: animateIn ? 'translateY(0)' : 'translateY(4px)',
                  transition: `opacity ${TIMING.STANDARD}ms ${EASING.gentle} 120ms, transform ${TIMING.STANDARD}ms ${EASING.gentle} 120ms`,
                }}
              >
                <div
                  style={{
                    fontFamily: FONTS.sans,
                    fontSize: 10,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '1.2px',
                    color: 'rgba(240,235,224,0.28)',
                    marginBottom: 2,
                  }}
                >
                  Next
                </div>
                {sunDecision.nextActions.map((action, i) => (
                  <div
                    key={i}
                    style={{
                      fontFamily: FONTS.sans,
                      fontSize: 13,
                      fontWeight: 500,
                      color: COLORS.textPrimary,
                      lineHeight: 1.4,
                    }}
                  >
                    &rarr; {action}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── HELPERS ──────────────────────────────────────────────

function formatDecisionTime(dueAt: string | null): string | undefined {
  if (!dueAt) return undefined;
  const now = new Date();
  const due = new Date(dueAt);
  const diffMs = due.getTime() - now.getTime();
  const diffMin = Math.round(diffMs / 60000);

  if (diffMin < 0) return 'overdue';
  if (diffMin === 0) return 'now';
  if (diffMin < 60) return `${diffMin}m`;
  const hours = Math.round(diffMin / 60);
  if (hours < 24) return `${hours}h`;

  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);
  if (due <= todayEnd) return 'today';

  const tomorrowEnd = new Date(todayEnd);
  tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);
  if (due <= tomorrowEnd) return 'tomorrow';

  return undefined;
}
