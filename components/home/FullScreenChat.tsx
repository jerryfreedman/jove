'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { COLORS, FONTS, TIMING, EASING, TRANSITIONS } from '@/lib/design-system';
import { renderMarkdown } from '@/lib/renderMarkdown';

// ── SESSION 15B: FULL-SCREEN CHAT ────────────────────────────
// Chat as a thinking surface. Full-screen overlay.
// Layout: thread selector (top) → conversation (middle) → input (bottom)
// Background dimmed same as sun/bird overlays.

// ── TYPES ──────────────────────────────────────────────────
export interface ChatMessageDisplay {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Inline UI mode for special flows */
  uiMode?: 'clarification' | 'new_deal_confirm' | 'new_deal_form' | 'deal_picker';
  /** For clarification: the original message ID being clarified */
  pendingMessageId?: string;
  /** Whether this message resulted in a saved interaction */
  saved?: boolean;
}

export interface ChatThread {
  id: string;
  title: string;
  createdAt: string;
  messageCount: number;
}

export interface FullScreenChatProps {
  open: boolean;
  onClose: () => void;
  messages: ChatMessageDisplay[];
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  processing: boolean;
  streaming: boolean;
  /** Thread list for selector */
  threads: ChatThread[];
  activeThreadId: string;
  onThreadSelect: (threadId: string) => void;
  onNewThread: () => void;
  /** Render slot for inline UI (deal picker, new deal form, etc.) */
  renderInlineUI?: (msg: ChatMessageDisplay) => React.ReactNode;
  /** Phase-aware placeholder */
  placeholder?: string;
}

export default function FullScreenChat({
  open,
  onClose,
  messages,
  inputValue,
  onInputChange,
  onSubmit,
  processing,
  streaming,
  threads,
  activeThreadId,
  onThreadSelect,
  onNewThread,
  renderInlineUI,
  placeholder = 'Tell me anything...',
}: FullScreenChatProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [animateIn, setAnimateIn] = useState(false);
  const [threadListOpen, setThreadListOpen] = useState(false);

  // ── Animate in on open ──────────────────────────────────
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setAnimateIn(true);
          setTimeout(() => inputRef.current?.focus(), 200);
        });
      });
    } else {
      setAnimateIn(false);
      setThreadListOpen(false);
    }
  }, [open]);

  // ── Auto-scroll on new messages ────────────────────────
  useEffect(() => {
    if (scrollRef.current) {
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({
          top: scrollRef.current.scrollHeight,
          behavior: 'smooth',
        });
      });
    }
  }, [messages]);

  // ── Key handling ──────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onSubmit, onClose]);

  // ── Active thread title ──────────────────────────────
  const activeThread = useMemo(
    () => threads.find(t => t.id === activeThreadId),
    [threads, activeThreadId],
  );

  if (!open) return null;

  return (
    <>
      {/* ── Backdrop ────────────────────────────────────── */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 80,
          background: animateIn ? 'rgba(6,10,18,0.62)' : 'rgba(6,10,18,0)',
          backdropFilter: animateIn ? 'blur(16px)' : 'blur(0px)',
          WebkitBackdropFilter: animateIn ? 'blur(16px)' : 'blur(0px)',
          transition: TRANSITIONS.overlay,
        }}
      />

      {/* ── Full-screen container ──────────────────────── */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 85,
          display: 'flex',
          flexDirection: 'column',
          background: 'rgba(10,13,22,0.96)',
          backdropFilter: 'blur(40px) saturate(1.3)',
          WebkitBackdropFilter: 'blur(40px) saturate(1.3)',
          fontFamily: FONTS.sans,
          opacity: animateIn ? 1 : 0,
          transform: animateIn ? 'scale(1)' : 'scale(0.98)',
          transition: `opacity ${TIMING.STANDARD}ms ${EASING.gentle}, transform ${TIMING.STANDARD}ms ${EASING.standard}`,
        }}
      >
        {/* ── TOP BAR: thread selector + close ─────────── */}
        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: 'calc(env(safe-area-inset-top, 0px) + 12px) 16px 10px',
            borderBottom: '0.5px solid rgba(240,235,224,0.06)',
          }}
        >
          {/* Thread selector */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setThreadListOpen(v => !v)}
              style={{
                background: 'rgba(240,235,224,0.06)',
                border: '0.5px solid rgba(240,235,224,0.08)',
                borderRadius: 10,
                padding: '6px 12px',
                cursor: 'pointer',
                fontFamily: FONTS.sans,
                fontSize: 13,
                fontWeight: 400,
                color: 'rgba(240,235,224,0.72)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                transition: 'background 0.15s ease',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M2 4h12M2 8h12M2 12h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
              {activeThread?.title ?? 'New thread'}
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{
                transform: threadListOpen ? 'rotate(180deg)' : 'rotate(0)',
                transition: 'transform 0.15s ease',
              }}>
                <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>

            {/* Thread dropdown */}
            {threadListOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  left: 0,
                  minWidth: 220,
                  maxHeight: 280,
                  overflowY: 'auto',
                  background: 'rgba(16,20,30,0.95)',
                  backdropFilter: 'blur(20px)',
                  WebkitBackdropFilter: 'blur(20px)',
                  border: '0.5px solid rgba(240,235,224,0.1)',
                  borderRadius: 14,
                  padding: '6px',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                  zIndex: 100,
                }}
              >
                {/* New thread button */}
                <button
                  onClick={() => {
                    onNewThread();
                    setThreadListOpen(false);
                  }}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 10px',
                    background: 'none',
                    border: 'none',
                    borderRadius: 8,
                    cursor: 'pointer',
                    fontFamily: FONTS.sans,
                    fontSize: 13,
                    fontWeight: 400,
                    color: COLORS.amberLight,
                    transition: 'background 0.15s ease',
                    marginBottom: 2,
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                  New thread
                </button>

                {/* Thread list */}
                {threads.map(thread => (
                  <button
                    key={thread.id}
                    onClick={() => {
                      onThreadSelect(thread.id);
                      setThreadListOpen(false);
                    }}
                    style={{
                      width: '100%',
                      display: 'block',
                      textAlign: 'left',
                      padding: '8px 10px',
                      background: thread.id === activeThreadId
                        ? 'rgba(232,160,48,0.1)'
                        : 'none',
                      border: 'none',
                      borderRadius: 8,
                      cursor: 'pointer',
                      fontFamily: FONTS.sans,
                      transition: 'background 0.15s ease',
                    }}
                  >
                    <div style={{
                      fontSize: 13,
                      fontWeight: thread.id === activeThreadId ? 500 : 400,
                      color: thread.id === activeThreadId
                        ? 'rgba(252,246,234,0.92)'
                        : 'rgba(240,235,224,0.65)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {thread.title}
                    </div>
                    <div style={{
                      fontSize: 11,
                      fontWeight: 300,
                      color: 'rgba(240,235,224,0.35)',
                      marginTop: 2,
                    }}>
                      {thread.messageCount} messages
                    </div>
                  </button>
                ))}

                {threads.length === 0 && (
                  <div style={{
                    padding: '12px 10px',
                    fontSize: 12,
                    fontWeight: 300,
                    color: 'rgba(240,235,224,0.35)',
                    textAlign: 'center',
                  }}>
                    No previous threads
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Close button */}
          <button
            onClick={onClose}
            style={{
              width: 32,
              height: 32,
              borderRadius: 10,
              border: 'none',
              background: 'rgba(240,235,224,0.06)',
              color: 'rgba(240,235,224,0.55)',
              fontSize: 16,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background 0.15s ease',
            }}
            aria-label="Close chat"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* ── CONVERSATION AREA ────────────────────────── */}
        <div
          ref={scrollRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px 20px 12px',
            minHeight: 0,
          }}
        >
          {/* Empty state */}
          {messages.length === 0 && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              minHeight: 200,
            }}>
              <div style={{
                textAlign: 'center',
                fontFamily: FONTS.serif,
                fontSize: 18,
                fontWeight: 300,
                color: 'rgba(240,235,224,0.25)',
                letterSpacing: '0.3px',
                lineHeight: 1.6,
              }}>
                Think out loud.
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  marginBottom: msg.uiMode ? 4 : 10,
                }}
              >
                <div
                  style={{
                    maxWidth: '80%',
                    padding: '10px 14px',
                    borderRadius: msg.role === 'user'
                      ? '16px 16px 4px 16px'
                      : '16px 16px 16px 4px',
                    background: msg.role === 'user'
                      ? 'rgba(232,160,48,0.14)'
                      : 'rgba(240,235,224,0.06)',
                    border: msg.role === 'user'
                      ? '0.5px solid rgba(232,160,48,0.18)'
                      : '0.5px solid rgba(240,235,224,0.06)',
                    fontSize: 14,
                    fontWeight: 300,
                    lineHeight: 1.55,
                    color: msg.role === 'user'
                      ? 'rgba(252,246,234,0.92)'
                      : 'rgba(240,235,224,0.72)',
                  }}
                >
                  {msg.role === 'assistant' ? renderMarkdown(msg.content) : msg.content}
                </div>
              </div>

              {/* Render inline UI (deal picker, new deal form, etc.) */}
              {renderInlineUI?.(msg)}
            </div>
          ))}

          {/* Typing indicator */}
          {processing && !streaming && (
            <div style={{
              display: 'flex',
              justifyContent: 'flex-start',
              marginBottom: 10,
              paddingLeft: 2,
            }}>
              <div style={{
                display: 'flex',
                gap: 4,
                padding: '10px 14px',
                borderRadius: '16px 16px 16px 4px',
                background: 'rgba(240,235,224,0.06)',
                border: '0.5px solid rgba(240,235,224,0.06)',
              }}>
                {[0, 1, 2].map(i => (
                  <div key={i} style={{
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: 'rgba(240,235,224,0.35)',
                    animation: `typingDot 1.2s ease-in-out ${i * 0.2}s infinite`,
                  }} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── INPUT ROW ────────────────────────────────── */}
        <div
          style={{
            flexShrink: 0,
            padding: '10px 16px',
            paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 14px)',
            borderTop: '0.5px solid rgba(240,235,224,0.06)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              background: 'rgba(16,20,30,0.55)',
              border: '0.5px solid rgba(240,235,224,0.09)',
              borderTop: '0.5px solid rgba(240,235,224,0.13)',
              borderRadius: 16,
              padding: '4px 6px 4px 16px',
              boxShadow: '0 1px 8px rgba(0,0,0,0.12), 0 0.5px 0 rgba(240,235,224,0.03) inset',
            }}
          >
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              autoComplete="off"
              autoCorrect="on"
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                fontSize: 14,
                fontWeight: 300,
                color: 'rgba(252,246,234,0.92)',
                fontFamily: FONTS.sans,
                padding: '10px 0',
              }}
            />
            <button
              onClick={onSubmit}
              disabled={!inputValue.trim() || processing || streaming}
              style={{
                width: 36,
                height: 36,
                borderRadius: 12,
                border: 'none',
                background: inputValue.trim() && !processing && !streaming
                  ? 'linear-gradient(135deg, #C87820, #E09838)'
                  : 'rgba(255,255,255,0.04)',
                color: inputValue.trim() && !processing && !streaming
                  ? 'white'
                  : 'rgba(240,235,224,0.22)',
                fontSize: 16,
                cursor: inputValue.trim() && !processing && !streaming ? 'pointer' : 'default',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s ease',
                flexShrink: 0,
                boxShadow: inputValue.trim() && !processing && !streaming
                  ? '0 1px 6px rgba(200,120,32,0.3)'
                  : 'none',
              }}
              aria-label="Send message"
            >
              {processing || streaming ? (
                <div style={{
                  width: 14, height: 14,
                  border: '1.5px solid rgba(240,235,224,0.22)',
                  borderTopColor: 'rgba(232,160,48,0.7)',
                  borderRadius: '50%',
                  animation: 'chatSpin 0.7s linear infinite',
                }} />
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ── Keyframes ──────────────────────────────────── */}
      <style>{`
        @keyframes typingDot {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
        @keyframes chatSpin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </>
  );
}
