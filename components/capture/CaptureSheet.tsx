'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase';
import Logo from '@/components/ui/Logo';
import { COLORS, FONTS } from '@/lib/design-system';
import {
  STREAK_WEEKDAYS_ONLY,
  STREAK_MILESTONE_DAYS,
} from '@/lib/constants';
import type { DealRow, InteractionType } from '@/lib/types';

// ── TYPES ──────────────────────────────────────────────────
type CaptureMode =
  | 'tiles'
  | 'debrief'
  | 'email'
  | 'draft_context'
  | 'draft_intent'
  | 'draft_output'
  | 'idea'
  | 'done';

interface CaptureSheetProps {
  onClose: () => void;
  userId: string;
  activeDeals: DealRow[];
  onCaptureComplete?: () => void;
  initialMode?: CaptureMode;
  initialText?: string;
}

// ── EMAIL PATTERN DETECTION ───────────────────────────────
function looksLikeEmail(text: string): boolean {
  if (text.length < 100) return false;
  const patterns = ['From:', 'Subject:', 'Hi ', 'Hello ', 'Dear '];
  return patterns.some((p) => text.includes(p));
}

// ── TILE DEFINITIONS ──────────────────────────────────────
const TILES = [
  {
    id: 'debrief',
    icon: '\uD83C\uDF99',
    label: 'After a call or meeting',
    hint: 'Who was it with? What happened? Key things said.',
  },
  {
    id: 'email',
    icon: '\u2709\uFE0F',
    label: 'Email I sent or received',
    hint: 'Paste it \u2014 Jove reads it, extracts what matters.',
  },
  {
    id: 'draft',
    icon: '\u270D\uFE0F',
    label: 'Draft an email',
    hint: "Tell Jove who it's for and what to say.",
  },
  {
    id: 'idea',
    icon: '\uD83D\uDCA1',
    label: 'Idea or initiative',
    hint: 'Early-stage opportunities and strategy thoughts.',
  },
];

// ── TILE LABELS FOR BACK NAV ──────────────────────────────
const LABELS: Partial<Record<CaptureMode, string>> = {
  debrief: '\uD83C\uDF99  After a call or meeting',
  email: '\u2709\uFE0F  Email I sent or received',
  draft_context: '\u270D\uFE0F  Draft an email',
  draft_intent: '\u270D\uFE0F  Draft an email',
  draft_output: '\u270D\uFE0F  Draft an email',
  idea: '\uD83D\uDCA1  Idea or initiative',
};

// ── COMPONENT ─────────────────────────────────────────────
export default function CaptureSheet({
  onClose,
  userId,
  activeDeals,
  onCaptureComplete,
  initialMode,
  initialText,
}: CaptureSheetProps) {
  const supabase = createClient();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [mode, setMode] = useState<CaptureMode>(initialMode ?? 'tiles');
  const [text, setText] = useState(initialText ?? '');
  const [draftContext, setDraftContext] = useState('');
  const [draftIntent, setDraftIntent] = useState('');
  const [draftOutput, setDraftOutput] = useState('');
  const [draftSaving, setDraftSaving] = useState(false);
  const [selectedDealId, setSelectedDealId] = useState<string | null>(
    activeDeals.length === 1 ? activeDeals[0].id : null,
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [isFirstCapture, setIsFirstCapture] = useState(false);
  const [error, setError] = useState('');
  const [visible, setVisible] = useState(false);
  const [copyConfirmed, setCopyConfirmed] = useState(false);
  const [sentConfirmed, setSentConfirmed] = useState(false);

  // Slide up on mount
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 30);
    return () => clearTimeout(t);
  }, []);

  // Auto-focus textarea when mode changes
  useEffect(() => {
    if (mode !== 'tiles' && mode !== 'done' && mode !== 'draft_output') {
      const t = setTimeout(() => textareaRef.current?.focus(), 200);
      return () => clearTimeout(t);
    }
  }, [mode]);

  // Check if first capture of day
  useEffect(() => {
    const check = async () => {
      const today = new Date().toISOString().split('T')[0];
      const { data } = await supabase
        .from('streak_log')
        .select('id')
        .eq('user_id', userId)
        .eq('log_date', today)
        .maybeSingle();
      setIsFirstCapture(!data);
    };
    check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // ── STREAK LOGIC ─────────────────────────────────────────
  const updateStreak = async () => {
    const today = new Date();
    const dayOfWeek = today.getDay();
    if (STREAK_WEEKDAYS_ONLY && (dayOfWeek === 0 || dayOfWeek === 6)) return;

    const todayStr = today.toISOString().split('T')[0];

    const { data: existing } = await supabase
      .from('streak_log')
      .select('id, capture_count')
      .eq('user_id', userId)
      .eq('log_date', todayStr)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('streak_log')
        .update({ capture_count: (existing.capture_count ?? 1) + 1 })
        .eq('id', existing.id);
    } else {
      await supabase
        .from('streak_log')
        .insert({ user_id: userId, log_date: todayStr, capture_count: 1 });
    }

    // Trigger logo bloom on home screen
    localStorage.setItem('jove_bloom_trigger', String(Date.now()));

    // Check for streak milestone — count consecutive days
    const { data: recentLogs } = await supabase
      .from('streak_log')
      .select('log_date')
      .eq('user_id', userId)
      .order('log_date', { ascending: false })
      .limit(120);

    if (recentLogs) {
      let streakCount = recentLogs.length > 0 ? 1 : 0;
      for (let i = 1; i < recentLogs.length; i++) {
        const curr = new Date(recentLogs[i - 1].log_date);
        const prev = new Date(recentLogs[i].log_date);
        const diffDays = Math.round(
          (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24)
        );
        if (diffDays <= 2) {
          streakCount++;
        } else {
          break;
        }
      }
      if (STREAK_MILESTONE_DAYS.includes(streakCount)) {
        localStorage.setItem('jove_milestone_trigger', String(Date.now()));
      }
    }
  };

  // ── SAVE CAPTURE ─────────────────────────────────────────
  const saveCapture = async (
    type: InteractionType,
    content: string,
    extraData?: {
      saveToIdeas?: boolean;
      finalSentContent?: string;
    },
  ) => {
    if (!content.trim()) return;
    setSaving(true);
    setError('');

    try {
      const { data: interactionData, error: interactionError } = await supabase
        .from('interactions')
        .insert({
          user_id: userId,
          deal_id: selectedDealId,
          contact_id: null,
          type,
          raw_content: content.trim(),
          final_sent_content: extraData?.finalSentContent ?? null,
          extraction_status: 'pending',
        })
        .select('id')
        .single();

      if (interactionError) throw interactionError;

      // Fire extraction in background — do not await, never blocks UI
      if (interactionData?.id) {
        fetch('/api/extract', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            interactionId: interactionData.id,
            userId,
          }),
        }).catch(err => console.error('Extraction trigger error:', err));
      }

      // Fire voice profile update for email types — fire and forget
      if (type === 'email_sent' || type === 'draft') {
        fetch('/api/update-voice-profile', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ userId }),
        }).catch(err => console.error('Voice profile update error:', err));
      }

      // If idea — also save to ideas table
      if (extraData?.saveToIdeas) {
        await supabase.from('ideas').insert({
          user_id: userId,
          content: content.trim(),
          status: 'raw',
        });
      }

      // Update streak
      await updateStreak();

      setSaved(true);
      setSaving(false);

      // Notify home screen to refresh
      onCaptureComplete?.();

      // Auto close after confirmation
      setTimeout(() => {
        onClose();
      }, 2200);
    } catch (err) {
      console.error('Capture save error:', err);
      setError('Something went wrong. Please try again.');
      setSaving(false);
    }
  };

  // ── EMAIL DRAFT GENERATION ────────────────────────────────
  const generateDraft = async () => {
    if (!draftContext.trim() || !draftIntent.trim()) return;
    setMode('draft_output');
    setDraftSaving(true);
    setDraftOutput('');

    try {
      // Save the context as an interaction immediately
      const contextType: InteractionType = looksLikeEmail(draftContext)
        ? 'email_received'
        : 'note';

      await supabase.from('interactions').insert({
        user_id: userId,
        deal_id: selectedDealId,
        contact_id: null,
        type: contextType,
        raw_content: draftContext.trim(),
        extraction_status: 'pending',
      });

      // Call Claude API for draft
      const response = await fetch('/api/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: draftContext.trim(),
          intent: draftIntent.trim(),
        }),
      });

      if (!response.ok) throw new Error('Draft generation failed');

      const data = await response.json();
      setDraftOutput(data.draft ?? '');
      setDraftSaving(false);
    } catch (err) {
      console.error('Draft error:', err);
      setError('Could not generate draft. Please try again.');
      setDraftSaving(false);
      setMode('draft_intent');
    }
  };

  const handleCopyDraft = () => {
    navigator.clipboard.writeText(draftOutput);
    setCopyConfirmed(true);
    setTimeout(() => setCopyConfirmed(false), 2000);
  };

  const handleConfirmSent = async () => {
    await saveCapture('email_sent', draftContext, {
      finalSentContent: draftOutput,
    });
    // Also fire voice profile update after confirm sent
    if (userId) {
      fetch('/api/update-voice-profile', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ userId }),
      }).catch(err => console.error('Voice profile update error:', err));
    }
    setSentConfirmed(true);
  };

  // ── DEAL SELECTOR ─────────────────────────────────────────
  const DealSelector = () => {
    if (activeDeals.length <= 1) return null;
    return (
      <select
        value={selectedDealId ?? ''}
        onChange={(e) => setSelectedDealId(e.target.value || null)}
        style={{
          width: '100%',
          background: COLORS.card,
          border: `0.5px solid ${COLORS.cardBorder}`,
          borderRadius: 10,
          padding: '11px 14px',
          fontSize: 13,
          fontWeight: 300,
          color: COLORS.textMid,
          outline: 'none',
          marginBottom: 12,
          fontFamily: FONTS.sans,
          cursor: 'pointer',
        }}
      >
        <option value="">Link to a deal (optional)</option>
        {activeDeals.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
    );
  };

  // ── SUBMIT BUTTON ─────────────────────────────────────────
  const SubmitButton = ({
    label,
    onPress,
    disabled,
  }: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button
      onClick={onPress}
      disabled={disabled || saving}
      style={{
        width: '100%',
        padding: '14px 0',
        borderRadius: 12,
        border: 'none',
        background:
          !disabled && !saving
            ? 'linear-gradient(135deg, #C87820, #E09838)'
            : 'rgba(255,255,255,0.06)',
        color:
          !disabled && !saving ? 'white' : COLORS.textLight,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '2px',
        textTransform: 'uppercase',
        cursor: !disabled && !saving ? 'pointer' : 'default',
        fontFamily: FONTS.sans,
        transition: 'all 0.2s ease',
        boxShadow:
          !disabled && !saving
            ? '0 4px 18px rgba(200,120,32,0.3)'
            : 'none',
      }}
    >
      {saving ? 'Saving...' : label}
    </button>
  );

  // ── SHARED TEXTAREA STYLE ─────────────────────────────────
  const textareaStyle: React.CSSProperties = {
    width: '100%',
    background: COLORS.card,
    border: '0.5px solid rgba(232,160,48,0.22)',
    borderRadius: 14,
    padding: '14px 16px',
    fontFamily: FONTS.sans,
    fontSize: 14,
    fontWeight: 300,
    color: COLORS.textPrimary,
    outline: 'none',
    resize: 'none',
    minHeight: 130,
    lineHeight: 1.65,
    marginBottom: 12,
  };

  // ── RENDER ─────────────────────────────────────────────
  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 290,
          background: 'rgba(4,8,14,0.72)',
          backdropFilter: 'blur(10px)',
          opacity: visible ? 1 : 0,
          transition: 'opacity 0.2s ease',
        }}
      />

      {/* Sheet */}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: '50%',
          transform: visible
            ? 'translateX(-50%) translateY(0)'
            : 'translateX(-50%) translateY(100%)',
          transition: 'transform 0.32s cubic-bezier(.32,.72,0,1)',
          zIndex: 300,
          width: '100%',
          maxWidth: 390,
          background: '#0f1420',
          borderTop: '0.5px solid rgba(232,160,48,0.2)',
          borderRadius: '22px 22px 0 0',
          paddingBottom: 44,
          fontFamily: FONTS.sans,
        }}
      >
        {/* Handle */}
        <div
          style={{
            width: 36,
            height: 4,
            borderRadius: 2,
            background: 'rgba(240,235,224,0.15)',
            margin: '14px auto 0',
          }}
        />

        {/* ── SAVED STATE ── */}
        {saved && (
          <div
            style={{
              padding: '34px 20px 14px',
              textAlign: 'center',
            }}
          >
            <div style={{
              animation: 'logoBloom 0.8s ease-out both',
              marginBottom: 12,
            }}>
              <Logo light showWordmark={false} size={44} onClick={() => {}} />
            </div>
            <p
              style={{
                fontFamily: FONTS.serif,
                fontSize: 22,
                fontWeight: 300,
                color: COLORS.textPrimary,
                marginBottom: 6,
              }}
            >
              Got it.
            </p>
            <p
              style={{
                fontSize: 13,
                fontWeight: 300,
                color: COLORS.textMid,
              }}
            >
              {isFirstCapture
                ? 'Good \u2014 first signal of the day captured.'
                : 'Jove is reading and saving this now.'}
            </p>
          </div>
        )}

        {/* ── TILE SELECTION ── */}
        {!saved && mode === 'tiles' && (
          <>
            <div style={{ padding: '18px 20px 14px' }}>
              <p
                style={{
                  fontFamily: FONTS.serif,
                  fontSize: 24,
                  fontWeight: 400,
                  color: COLORS.textPrimary,
                  marginBottom: 4,
                }}
              >
                Capture
              </p>
              <p
                style={{
                  fontSize: 13,
                  fontWeight: 300,
                  color: COLORS.textMid,
                }}
              >
                What just happened?
              </p>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 10,
                padding: '0 18px',
              }}
            >
              {TILES.map((tile) => (
                <button
                  key={tile.id}
                  onClick={() => {
                    if (tile.id === 'draft') {
                      setMode('draft_context');
                    } else {
                      setMode(tile.id as CaptureMode);
                    }
                  }}
                  style={{
                    background: COLORS.card,
                    border: `0.5px solid ${COLORS.cardBorder}`,
                    borderRadius: 16,
                    padding: '17px 15px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'border-color 0.18s',
                    fontFamily: FONTS.sans,
                  }}
                >
                  <div style={{ fontSize: 24, marginBottom: 9 }}>
                    {tile.icon}
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: COLORS.textPrimary,
                      lineHeight: 1.3,
                    }}
                  >
                    {tile.label}
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {/* ── TEXT CAPTURE MODES (debrief, email, idea) ── */}
        {!saved &&
          (mode === 'debrief' || mode === 'email' || mode === 'idea') && (
            <div style={{ padding: '16px 18px 0' }}>
              {/* Back + title */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  marginBottom: 16,
                }}
              >
                <button
                  onClick={() => {
                    setMode('tiles');
                    setText('');
                  }}
                  style={{
                    color: COLORS.textMid,
                    fontSize: 19,
                    cursor: 'pointer',
                    background: 'none',
                    border: 'none',
                    padding: 0,
                  }}
                >
                  &#8249;
                </button>
                <span
                  style={{
                    fontSize: 16,
                    fontWeight: 400,
                    color: COLORS.textPrimary,
                  }}
                >
                  {LABELS[mode]}
                </span>
              </div>

              {/* Deal selector */}
              <DealSelector />

              {/* Textarea */}
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={
                  mode === 'debrief'
                    ? 'Who was it with? What happened? Key things said or decided...'
                    : mode === 'email'
                      ? 'Paste the email here...'
                      : "What's the idea or opportunity..."
                }
                style={textareaStyle}
                onFocus={(e) => {
                  e.target.style.borderColor = 'rgba(232,160,48,0.44)';
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = 'rgba(232,160,48,0.22)';
                }}
              />

              {error && (
                <p
                  style={{
                    fontSize: 12,
                    color: COLORS.red,
                    marginBottom: 10,
                  }}
                >
                  {error}
                </p>
              )}

              <SubmitButton
                label="Send to Jove \u2192"
                disabled={!text.trim()}
                onPress={() => {
                  const type: InteractionType =
                    mode === 'debrief'
                      ? 'debrief'
                      : mode === 'email'
                        ? 'email_received'
                        : 'idea';
                  saveCapture(type, text, {
                    saveToIdeas: mode === 'idea',
                  });
                }}
              />
            </div>
          )}

        {/* ── EMAIL DRAFT — STAGE 1 (CONTEXT) ── */}
        {!saved && mode === 'draft_context' && (
          <div style={{ padding: '16px 18px 0' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginBottom: 16,
              }}
            >
              <button
                onClick={() => {
                  setMode('tiles');
                  setDraftContext('');
                }}
                style={{
                  color: COLORS.textMid,
                  fontSize: 19,
                  cursor: 'pointer',
                  background: 'none',
                  border: 'none',
                  padding: 0,
                }}
              >
                &#8249;
              </button>
              <span
                style={{
                  fontSize: 16,
                  fontWeight: 400,
                  color: COLORS.textPrimary,
                }}
              >
                {LABELS.draft_context}
              </span>
            </div>

            <p
              style={{
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: '1.5px',
                textTransform: 'uppercase',
                color: 'rgba(232,160,48,0.7)',
                marginBottom: 10,
              }}
            >
              Step 1 of 2 &mdash; Context
            </p>

            <DealSelector />

            <textarea
              ref={textareaRef}
              value={draftContext}
              onChange={(e) => setDraftContext(e.target.value)}
              placeholder="Paste a received email, or describe the situation... e.g. Sarah is asking for a proposal on the enterprise tier"
              style={{ ...textareaStyle, minHeight: 120 }}
              onFocus={(e) => {
                e.target.style.borderColor = 'rgba(232,160,48,0.44)';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = 'rgba(232,160,48,0.22)';
              }}
            />

            <SubmitButton
              label="Next \u2192"
              disabled={!draftContext.trim()}
              onPress={() => setMode('draft_intent')}
            />
          </div>
        )}

        {/* ── EMAIL DRAFT — STAGE 2 (INTENT) ── */}
        {!saved && mode === 'draft_intent' && (
          <div style={{ padding: '16px 18px 0' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginBottom: 16,
              }}
            >
              <button
                onClick={() => setMode('draft_context')}
                style={{
                  color: COLORS.textMid,
                  fontSize: 19,
                  cursor: 'pointer',
                  background: 'none',
                  border: 'none',
                  padding: 0,
                }}
              >
                &#8249;
              </button>
              <span
                style={{
                  fontSize: 16,
                  fontWeight: 400,
                  color: COLORS.textPrimary,
                }}
              >
                {LABELS.draft_intent}
              </span>
            </div>

            <p
              style={{
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: '1.5px',
                textTransform: 'uppercase',
                color: 'rgba(232,160,48,0.7)',
                marginBottom: 10,
              }}
            >
              Step 2 of 2 &mdash; Intent
            </p>

            <textarea
              ref={textareaRef}
              value={draftIntent}
              onChange={(e) => setDraftIntent(e.target.value)}
              placeholder="What do you want to get across? e.g. Confirm the timeline, ask for a meeting next week, push back on the pricing concern..."
              style={{ ...textareaStyle, minHeight: 110 }}
              onFocus={(e) => {
                e.target.style.borderColor = 'rgba(232,160,48,0.44)';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = 'rgba(232,160,48,0.22)';
              }}
            />

            <SubmitButton
              label="Draft this \u2192"
              disabled={!draftIntent.trim()}
              onPress={generateDraft}
            />
          </div>
        )}

        {/* ── EMAIL DRAFT — STAGE 3 (OUTPUT) ── */}
        {!saved && mode === 'draft_output' && (
          <div style={{ padding: '16px 18px 0' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginBottom: 16,
              }}
            >
              <button
                onClick={() => setMode('draft_intent')}
                style={{
                  color: COLORS.textMid,
                  fontSize: 19,
                  cursor: 'pointer',
                  background: 'none',
                  border: 'none',
                  padding: 0,
                }}
              >
                &#8249;
              </button>
              <span
                style={{
                  fontSize: 16,
                  fontWeight: 400,
                  color: COLORS.textPrimary,
                }}
              >
                &#9997;&#65039;  Your draft
              </span>
            </div>

            {draftSaving && (
              <div style={{ textAlign: 'center', padding: '32px 0' }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    border: '2px solid rgba(232,160,48,0.2)',
                    borderTop: `2px solid ${COLORS.amber}`,
                    animation: 'captureSheetSpin 0.8s linear infinite',
                    margin: '0 auto 14px',
                  }}
                />
                <p
                  style={{
                    fontSize: 13,
                    fontWeight: 300,
                    color: COLORS.textMid,
                  }}
                >
                  Drafting in your voice...
                </p>
              </div>
            )}

            {!draftSaving && draftOutput && !sentConfirmed && (
              <>
                <div
                  style={{
                    background: COLORS.card,
                    border: '0.5px solid rgba(232,160,48,0.18)',
                    borderRadius: 14,
                    padding: '14px 16px',
                    marginBottom: 12,
                    maxHeight: 200,
                    overflowY: 'auto',
                  }}
                >
                  <p
                    style={{
                      fontSize: 13,
                      fontWeight: 300,
                      color: 'rgba(240,235,224,0.82)',
                      lineHeight: 1.65,
                      whiteSpace: 'pre-wrap',
                      fontFamily: FONTS.sans,
                    }}
                  >
                    {draftOutput}
                  </p>
                </div>

                <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                  <button
                    onClick={handleCopyDraft}
                    style={{
                      flex: 1,
                      padding: '12px 0',
                      borderRadius: 12,
                      cursor: 'pointer',
                      background: copyConfirmed
                        ? 'rgba(72,200,120,0.12)'
                        : 'rgba(232,160,48,0.1)',
                      border: `0.5px solid ${
                        copyConfirmed
                          ? 'rgba(72,200,120,0.3)'
                          : 'rgba(232,160,48,0.28)'
                      }`,
                      color: copyConfirmed ? COLORS.green : COLORS.amber,
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: '1.5px',
                      textTransform: 'uppercase',
                      fontFamily: FONTS.sans,
                      transition: 'all 0.2s',
                    }}
                  >
                    {copyConfirmed ? '\u2713 Copied' : 'Copy email'}
                  </button>

                  <button
                    onClick={handleConfirmSent}
                    style={{
                      flex: 1,
                      padding: '12px 0',
                      borderRadius: 12,
                      cursor: 'pointer',
                      background: 'linear-gradient(135deg, #C87820, #E09838)',
                      border: 'none',
                      color: 'white',
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: '1.5px',
                      textTransform: 'uppercase',
                      fontFamily: FONTS.sans,
                      boxShadow: '0 4px 14px rgba(200,120,32,0.28)',
                    }}
                  >
                    Confirm sent
                  </button>
                </div>

                <button
                  onClick={() => setMode('draft_intent')}
                  style={{
                    width: '100%',
                    padding: '10px 0',
                    background: 'none',
                    border: 'none',
                    color: COLORS.textLight,
                    fontSize: 12,
                    fontWeight: 400,
                    cursor: 'pointer',
                    fontFamily: FONTS.sans,
                  }}
                >
                  &larr; Refine
                </button>
              </>
            )}

            {error && !draftSaving && (
              <p
                style={{
                  fontSize: 12,
                  color: COLORS.red,
                  marginBottom: 10,
                  textAlign: 'center',
                }}
              >
                {error}
              </p>
            )}

            {sentConfirmed && (
              <div style={{ textAlign: 'center', padding: '24px 0' }}>
                <p
                  style={{
                    fontFamily: FONTS.serif,
                    fontSize: 22,
                    fontWeight: 300,
                    color: COLORS.textPrimary,
                    marginBottom: 6,
                  }}
                >
                  Logged.
                </p>
                <p
                  style={{
                    fontSize: 13,
                    fontWeight: 300,
                    color: COLORS.textMid,
                  }}
                >
                  Sent email saved to your deal history.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes captureSheetSpin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes logoBloom {
          0%   { transform: scale(0.6); opacity: 0; }
          60%  { transform: scale(1.15); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </>
  );
}
