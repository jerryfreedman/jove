// ── SESSION 19: TASKS LIST PAGE ─────────────────────────────
// Route: /tasks
// Full task list with title, due state, and completion actions.
// Gateway from control panel navigation.

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { useTasks, markTaskDone, skipTask, type DisplayTask } from '@/lib/task-queries';
import { COLORS, FONTS } from '@/lib/design-system';

function formatDue(dueAt: string | null): string | null {
  if (!dueAt) return null;
  const d = new Date(dueAt);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffMin = Math.floor(diffMs / (1000 * 60));
  if (diffMin < 0) return 'overdue';
  if (diffMin < 60) return `in ${diffMin}m`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `in ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 0) return 'today';
  if (diffD === 1) return 'tomorrow';
  return `in ${diffD}d`;
}

export default function TasksPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setUserId(data.user.id);
      } else {
        router.push('/');
      }
    });
  }, [router]);

  const { tasks, loading, error, refetch } = useTasks(userId);
  const [actionPending, setActionPending] = useState<string | null>(null);

  const handleDone = useCallback(async (taskId: string) => {
    setActionPending(taskId);
    const ok = await markTaskDone(taskId);
    setActionPending(null);
    if (ok) refetch();
  }, [refetch]);

  const handleSkip = useCallback(async (taskId: string) => {
    setActionPending(taskId);
    const ok = await skipTask(taskId);
    setActionPending(null);
    if (ok) refetch();
  }, [refetch]);

  const handleBack = () => {
    router.push('/home');
  };

  // ── LOADING ──────────────────────────────────────────────

  if (loading || !userId) {
    return (
      <div style={{
        minHeight: '100dvh',
        background: COLORS.bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div style={{
          fontSize: 14,
          color: COLORS.textLight,
          fontFamily: FONTS.sans,
        }}>
          Loading...
        </div>
      </div>
    );
  }

  // ── ERROR ────────────────────────────────────────────────

  if (error) {
    return (
      <div style={{
        minHeight: '100dvh',
        background: COLORS.bg,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
      }}>
        <div style={{
          fontSize: 16,
          color: COLORS.textMid,
          fontFamily: FONTS.sans,
        }}>
          {error}
        </div>
        <button
          onClick={handleBack}
          style={{
            fontSize: 14,
            color: COLORS.teal,
            fontFamily: FONTS.sans,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '8px 16px',
          }}
        >
          Back to home
        </button>
      </div>
    );
  }

  // ── RENDER ───────────────────────────────────────────────

  return (
    <div style={{
      minHeight: '100dvh',
      background: COLORS.bg,
      fontFamily: FONTS.sans,
    }}>
      {/* Back navigation */}
      <button
        onClick={handleBack}
        style={{
          position: 'fixed',
          top: 16,
          left: 16,
          zIndex: 10,
          background: 'rgba(255,255,255,0.06)',
          border: `1px solid ${COLORS.cardBorder}`,
          borderRadius: 8,
          padding: '6px 14px',
          color: COLORS.textMid,
          fontSize: 13,
          fontFamily: FONTS.sans,
          cursor: 'pointer',
          backdropFilter: 'blur(8px)',
        }}
      >
        Back
      </button>

      {/* Header */}
      <div style={{
        padding: '60px 20px 16px',
      }}>
        <h1 style={{
          fontSize: 22,
          fontWeight: 300,
          color: 'rgba(252,246,234,0.85)',
          fontFamily: FONTS.serif,
          letterSpacing: '0.3px',
          margin: 0,
        }}>
          Tasks
        </h1>
      </div>

      {/* Task list */}
      <div style={{
        padding: '0 16px 32px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}>
        {tasks.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '40px 20px',
            color: 'rgba(240,235,224,0.30)',
            fontSize: 14,
          }}>
            No active tasks.
          </div>
        ) : (
          tasks.map((task) => {
            const isPending = actionPending === task.id;
            const due = formatDue(task.dueAt);
            const isOverdue = due === 'overdue';

            return (
              <div
                key={task.id}
                style={{
                  background: 'rgba(240,235,224,0.018)',
                  border: '0.5px solid rgba(240,235,224,0.035)',
                  borderRadius: 10,
                  padding: '10px 12px',
                  opacity: isPending ? 0.4 : 1,
                  transition: 'opacity 200ms ease',
                }}
              >
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}>
                  {/* Title + due */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{
                      fontSize: 13,
                      fontWeight: 400,
                      color: task.schedulingState === 'waiting'
                        ? 'rgba(252,246,234,0.45)'
                        : 'rgba(252,246,234,0.88)',
                      display: 'block',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {task.title}
                    </span>
                    {(due || task.schedulingState === 'waiting') && (
                      <span style={{
                        fontSize: 11,
                        fontWeight: 400,
                        color: isOverdue ? COLORS.amber : 'rgba(240,235,224,0.28)',
                        marginTop: 1,
                        display: 'block',
                      }}>
                        {task.schedulingState === 'waiting' ? 'Waiting' : due}
                      </span>
                    )}
                  </div>

                  {/* Actions */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    flexShrink: 0,
                  }}>
                    {due && (
                      <span style={{
                        fontSize: 11,
                        fontWeight: 400,
                        color: isOverdue ? COLORS.amber : 'rgba(240,235,224,0.42)',
                      }}>
                        {due}
                      </span>
                    )}
                    <button
                      onClick={() => handleDone(task.id)}
                      disabled={isPending}
                      style={{
                        padding: '3px 8px',
                        borderRadius: 6,
                        border: '0.5px solid rgba(72,200,120,0.25)',
                        background: 'rgba(72,200,120,0.08)',
                        color: COLORS.green,
                        fontSize: 10,
                        fontWeight: 600,
                        cursor: 'pointer',
                        fontFamily: FONTS.sans,
                        lineHeight: '1.3',
                      }}
                    >
                      Done
                    </button>
                    <button
                      onClick={() => handleSkip(task.id)}
                      disabled={isPending}
                      style={{
                        padding: '3px 6px',
                        borderRadius: 6,
                        border: '0.5px solid rgba(240,235,224,0.10)',
                        background: 'rgba(240,235,224,0.03)',
                        color: 'rgba(240,235,224,0.32)',
                        fontSize: 10,
                        fontWeight: 600,
                        cursor: 'pointer',
                        fontFamily: FONTS.sans,
                        lineHeight: '1.3',
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
