'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { COLORS, FONTS, STAGE_STYLES } from '@/lib/design-system';
import type { DealRow, AccountRow } from '@/lib/types';
import { renderMarkdown } from '@/lib/renderMarkdown';
import SpotlightTour, { TourStop } from '@/components/onboarding/SpotlightTour';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
};

type UpdateChip = {
  id: string;
  description: string;
  type: string;
  to: string;
  messageId: string;
  dismissed: boolean;
  confirmed: boolean;
};

function generateId() {
  return Math.random().toString(36).slice(2);
}

function hasEmailDraft(text: string): boolean {
  return /^Subject:/im.test(text);
}

function extractEmailParts(text: string): { subject: string; body: string } {
  const lines = text.split('\n');
  const subIdx = lines.findIndex(l => /^Subject:/i.test(l));
  if (subIdx === -1) return { subject: '', body: text };
  const subject = lines[subIdx].replace(/^Subject:\s*/i, '').trim();
  const body = lines.slice(subIdx + 1).join('\n').trim();
  return { subject, body };
}

export default function DealChatPage() {
  const router = useRouter();
  const params = useParams();
  const supabase = createClient();
  const dealId = params.id as string;

  const [deal, setDeal] = useState<DealRow | null>(null);
  const [account, setAccount] = useState<AccountRow | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [chips, setChips] = useState<UpdateChip[]>([]);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [loggedMsgId, setLoggedMsgId] = useState<string | null>(null);

  // Tour state
  const [hasInteractions, setHasInteractions] = useState(false);
  const [showChatTour, setShowChatTour]       = useState(false);
  const chatInputRef = useRef<HTMLDivElement>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const userIdRef = useRef<string | null>(null);

  useEffect(() => {
    document.body.style.backgroundColor = '#0D0F12';
    return () => {
      document.body.style.backgroundColor = '#060a12';
    };
  }, []);

  // Tour trigger — only if user has interactions
  useEffect(() => {
    if (!hasInteractions) return;
    if (localStorage.getItem('jove_tour_chat') === 'true') return;
    const timer = setTimeout(() => setShowChatTour(true), 600);
    return () => clearTimeout(timer);
  }, [hasInteractions]);

  // Keep refs in sync for cleanup
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { userIdRef.current = userId; }, [userId]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, chips]);

  // Init
  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/'); return; }
      setUserId(user.id);

      const { data } = await supabase
        .from('deals')
        .select('*, accounts(*)')
        .eq('id', dealId)
        .eq('user_id', user.id)
        .single();

      if (!data) { router.push('/deals'); return; }
      setDeal(data as unknown as DealRow);
      setAccount(data.accounts as unknown as AccountRow);

      // Check for interactions
      const { count } = await supabase
        .from('interactions')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id);
      setHasInteractions((count ?? 0) > 0);
    };
    init();
    return () => { abortRef.current?.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  // Save thread on unmount
  useEffect(() => {
    return () => {
      const msgs = messagesRef.current;
      const uid = userIdRef.current;
      if (msgs.length >= 2 && uid) {
        saveThread(msgs, uid);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveThread = async (msgs: Message[], uid: string) => {
    try {
      const response = await fetch('/api/summarize-thread', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: msgs.map(m => ({ role: m.role, content: m.content })),
          dealId,
          userId: uid,
        }),
      });
      if (!response.ok) return;
      const { summary } = await response.json();
      if (!summary) return;
      await supabase.from('thread_summaries').insert({
        user_id: uid,
        summary_date: new Date().toISOString().split('T')[0],
        content: summary,
      });
    } catch {
      // Fail silently
    }
  };

  // Update detection — fire and forget
  const detectUpdates = useCallback(async (userMessage: string, messageId: string) => {
    if (!deal) return;
    try {
      const response = await fetch('/api/detect-updates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          stage: deal.stage,
          nextAction: deal.next_action,
        }),
      });
      if (!response.ok) return;
      const data = await response.json();
      const updates = data.updates ?? [];
      if (updates.length === 0) return;

      const newChips: UpdateChip[] = updates.map((u: {
        type: string; description: string; to: string;
      }) => ({
        id: generateId(),
        description: u.description,
        type: u.type,
        to: u.to,
        messageId,
        dismissed: false,
        confirmed: false,
      }));

      setChips(prev => [...prev, ...newChips]);
    } catch {
      // Fail silently
    }
  }, [deal]);

  // Send message
  const handleSend = useCallback(async () => {
    if (!input.trim() || streaming || !userId || !deal) return;

    const userMessage: Message = {
      id: generateId(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput('');
    setStreaming(true);

    const assistantId = generateId();
    let fullResponse = '';

    // Add empty assistant message that will be streamed into
    setMessages(prev => [...prev, {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
    }]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dealId,
          userId,
          messages: updatedMessages.map(m => ({
            role: m.role,
            content: m.content,
          })),
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        setMessages(prev => prev.map(m =>
          m.id === assistantId
            ? { ...m, content: 'Could not reach Jove. Please try again.' }
            : m
        ));
        setStreaming(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        fullResponse += chunk;
        const captured = fullResponse;
        setMessages(prev => prev.map(m =>
          m.id === assistantId ? { ...m, content: captured } : m
        ));
      }

      setStreaming(false);

      // Fire update detection in background — never awaited
      detectUpdates(userMessage.content, assistantId);

    } catch (err: unknown) {
      if ((err as Error).name !== 'AbortError') {
        setMessages(prev => prev.map(m =>
          m.id === assistantId
            ? { ...m, content: 'Could not reach Jove. Please try again.' }
            : m
        ));
      }
      setStreaming(false);
    }
  }, [input, streaming, userId, deal, messages, dealId, detectUpdates]);

  // Confirm update chip
  const confirmChip = async (chip: UpdateChip) => {
    if (!userId || !deal) return;
    setChips(prev => prev.map(c =>
      c.id === chip.id ? { ...c, confirmed: true } : c
    ));

    const updates: Record<string, unknown> = {
      last_activity_at: new Date().toISOString(),
    };
    if (chip.type === 'stage_change') updates.stage = chip.to;
    if (chip.type === 'next_action') {
      updates.next_action = chip.to;
      updates.next_action_confirmed = true;
    }
    if (chip.type === 'value') updates.value = parseFloat(chip.to) || null;
    if (chip.type === 'notes') {
      updates.notes = deal.notes
        ? `${deal.notes}\n\u2014 ${new Date().toLocaleDateString()}: ${chip.to}`
        : chip.to;
    }

    if (chip.type === 'log_interaction') {
      await supabase.from('interactions').insert({
        user_id: userId,
        deal_id: dealId,
        type: 'note',
        raw_content: chip.to,
        extraction_status: 'pending',
      });
    } else if (chip.type === 'new_contact') {
      const { data: dealData } = await supabase
        .from('deals')
        .select('account_id')
        .eq('id', dealId)
        .single();
      if (dealData) {
        await supabase.from('contacts').insert({
          user_id: userId,
          account_id: dealData.account_id,
          name: chip.to,
        });
      }
    } else if (Object.keys(updates).length > 1) {
      await supabase
        .from('deals')
        .update(updates)
        .eq('id', dealId)
        .eq('user_id', userId);
      setDeal(d => d ? { ...d, ...updates } as DealRow : d);
    }

    setTimeout(() => {
      setChips(prev => prev.filter(c => c.id !== chip.id));
    }, 1500);
  };

  const dismissChip = (chipId: string) => {
    setChips(prev => prev.filter(c => c.id !== chipId));
  };

  // Copy message
  const copyMessage = (msg: Message) => {
    navigator.clipboard.writeText(msg.content);
    setCopiedMsgId(msg.id);
    setTimeout(() => setCopiedMsgId(null), 2000);
  };

  // Log as sent
  const logAsSent = async (msg: Message) => {
    if (!userId) return;
    const { body } = extractEmailParts(msg.content);
    await supabase.from('interactions').insert({
      user_id: userId,
      deal_id: dealId,
      type: 'email_sent',
      raw_content: msg.content,
      final_sent_content: body,
      extraction_status: 'pending',
    });
    await supabase
      .from('deals')
      .update({ last_activity_at: new Date().toISOString() })
      .eq('id', dealId)
      .eq('user_id', userId);
    setLoggedMsgId(msg.id);
    setTimeout(() => setLoggedMsgId(null), 2000);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!deal) return null;

  const stage = STAGE_STYLES[deal.stage] ?? STAGE_STYLES['Prospect'];

  return (
    <>
    <div style={{
      height: '100vh',
      background: COLORS.bg,
      fontFamily: FONTS.sans,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      animation: 'pageFadeIn 0.22s ease both',
    }}>

      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        paddingTop: 'calc(env(safe-area-inset-top) + 12px)', paddingLeft: '20px', paddingRight: '20px', paddingBottom: '14px',
        borderBottom: `0.5px solid ${COLORS.cardBorder}`,
        flexShrink: 0,
        background: COLORS.bg,
      }}>
        <button
          onClick={() => { abortRef.current?.abort(); router.back(); }}
          style={{
            width: 34, height: 34, borderRadius: '50%',
            background: 'rgba(255,255,255,0.06)',
            border: '0.5px solid rgba(255,255,255,0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: 'rgba(240,235,224,0.5)',
            fontSize: 19, flexShrink: 0,
          }}
        >{'\u2039'}</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: FONTS.serif,
            fontSize: 18, fontWeight: 400, color: COLORS.textPrimary,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {deal.name}
          </div>
          <div style={{
            fontSize: 11, fontWeight: 300,
            color: 'rgba(240,235,224,0.36)', marginTop: 1,
          }}>
            {account?.name ?? ''}
          </div>
        </div>
        <div style={{
          fontSize: 9, fontWeight: 600, letterSpacing: '0.8px',
          textTransform: 'uppercase', color: stage.color,
          background: stage.bg, border: `0.5px solid ${stage.border}`,
          borderRadius: 20, padding: '3px 9px', flexShrink: 0,
        }}>
          {deal.stage}
        </div>
      </div>

      {/* Messages */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '16px 16px 0',
      }}>
        {messages.length === 0 && (
          <div style={{
            textAlign: 'center',
            paddingTop: 60,
          }}>
            <p style={{
              fontFamily: FONTS.serif,
              fontSize: 20, fontWeight: 300,
              color: 'rgba(240,235,224,0.44)',
              marginBottom: 8,
            }}>
              Ask Jove anything about this deal.
            </p>
            <p style={{
              fontSize: 13, fontWeight: 300,
              color: COLORS.textLight,
              lineHeight: 1.6,
            }}>
              Draft an email, prep for a call,
              or ask what to do next.
            </p>
          </div>
        )}

        {messages.map(msg => {
          const isUser = msg.role === 'user';
          const isStreaming = !isUser && streaming &&
            msg === messages[messages.length - 1];
          const isEmail = !isUser && hasEmailDraft(msg.content);
          const msgChips = chips.filter(c => c.messageId === msg.id);

          return (
            <div key={msg.id} style={{ marginBottom: 16 }}>
              <div style={{
                display: 'flex',
                justifyContent: isUser ? 'flex-end' : 'flex-start',
              }}>
                <div style={{
                  maxWidth: '82%',
                  background: isUser
                    ? 'linear-gradient(135deg, #C87820, #E09838)'
                    : COLORS.card,
                  borderRadius: isUser
                    ? '18px 18px 4px 18px'
                    : '4px 18px 18px 18px',
                  padding: '11px 14px',
                  position: 'relative',
                }}>
                  {/* Label */}
                  {!isUser && (
                    <div style={{
                      fontSize: 8, fontWeight: 700,
                      letterSpacing: '1.5px', textTransform: 'uppercase',
                      color: COLORS.textLight,
                      marginBottom: 6,
                    }}>
                      Jove
                    </div>
                  )}

                  {/* Content */}
                  <div style={{
                    fontSize: 14, fontWeight: 300,
                    color: isUser ? 'white' : 'rgba(240,235,224,0.82)',
                    lineHeight: 1.58,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}>
                    {isUser ? msg.content : (renderMarkdown(msg.content) || (isStreaming ? '' : ''))}
                    {isStreaming && msg.content === '' && (
                      <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                        {[0, 1, 2].map(dotIdx => (
                          <span key={dotIdx} style={{
                            width: 5, height: 5, borderRadius: '50%',
                            background: 'rgba(240,235,224,0.4)',
                            display: 'inline-block',
                            animation: `dotBlink 1.2s ease-in-out ${dotIdx * 0.2}s infinite`,
                          }} />
                        ))}
                      </span>
                    )}
                  </div>

                  {/* Timestamp */}
                  <div style={{
                    fontSize: 9, fontWeight: 300,
                    color: isUser
                      ? 'rgba(255,255,255,0.4)'
                      : 'rgba(240,235,224,0.2)',
                    marginTop: 5,
                    textAlign: 'right',
                  }}>
                    {msg.timestamp.toLocaleTimeString('en-US', {
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </div>
                </div>
              </div>

              {/* Copy / email buttons for assistant messages */}
              {!isUser && msg.content && !isStreaming && (
                <div style={{
                  display: 'flex', gap: 8,
                  marginTop: 6, paddingLeft: 4,
                }}>
                  <button
                    onClick={() => copyMessage(msg)}
                    style={{
                      background: 'none', border: 'none',
                      cursor: 'pointer', padding: '4px 0',
                      fontSize: 10, fontWeight: 500,
                      color: copiedMsgId === msg.id
                        ? COLORS.green
                        : COLORS.textLight,
                      fontFamily: FONTS.sans,
                      letterSpacing: '0.5px',
                    }}
                  >
                    {copiedMsgId === msg.id ? '\u2713 Copied' : 'Copy'}
                  </button>
                  {isEmail && (
                    <button
                      onClick={() => logAsSent(msg)}
                      style={{
                        background: 'none', border: 'none',
                        cursor: 'pointer', padding: '4px 0',
                        fontSize: 10, fontWeight: 500,
                        color: loggedMsgId === msg.id
                          ? COLORS.green
                          : COLORS.amberDim,
                        fontFamily: FONTS.sans,
                        letterSpacing: '0.5px',
                      }}
                    >
                      {loggedMsgId === msg.id ? '\u2713 Logged' : 'Log as Sent'}
                    </button>
                  )}
                </div>
              )}

              {/* Update chips */}
              {msgChips.map(chip => (
                <div
                  key={chip.id}
                  style={{
                    marginTop: 8,
                    marginLeft: 4,
                    background: COLORS.card,
                    borderLeft: `2px solid ${COLORS.amber}`,
                    borderRadius: '0 10px 10px 0',
                    padding: '8px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    opacity: chip.confirmed ? 0.5 : 1,
                    transition: 'opacity 0.3s',
                  }}
                >
                  <span style={{
                    fontSize: 12, fontWeight: 300,
                    color: 'rgba(240,235,224,0.7)', flex: 1,
                  }}>
                    {chip.description}
                  </span>
                  {chip.confirmed ? (
                    <span style={{
                      fontSize: 10, color: COLORS.green, fontWeight: 600,
                    }}>Saved.</span>
                  ) : (
                    <>
                      <button
                        onClick={() => confirmChip(chip)}
                        style={{
                          background: 'none', border: 'none',
                          cursor: 'pointer', fontSize: 10,
                          fontWeight: 700, color: COLORS.amber,
                          letterSpacing: '0.5px',
                          fontFamily: FONTS.sans,
                        }}
                      >Confirm</button>
                      <span style={{ color: 'rgba(240,235,224,0.2)', fontSize: 10 }}>{'\u00B7'}</span>
                      <button
                        onClick={() => dismissChip(chip.id)}
                        style={{
                          background: 'none', border: 'none',
                          cursor: 'pointer', fontSize: 10,
                          fontWeight: 500, color: COLORS.textLight,
                          fontFamily: FONTS.sans,
                        }}
                      >Dismiss</button>
                    </>
                  )}
                </div>
              ))}
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div ref={chatInputRef} style={{
        flexShrink: 0,
        padding: '12px 16px 32px',
        borderTop: `0.5px solid ${COLORS.cardBorder}`,
        background: COLORS.bg,
        display: 'flex',
        alignItems: 'flex-end',
        gap: 10,
      }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask Jove anything..."
          rows={1}
          style={{
            flex: 1,
            background: COLORS.card,
            border: '0.5px solid rgba(255,255,255,0.08)',
            borderRadius: 14,
            padding: '12px 14px',
            fontSize: 14,
            fontWeight: 300,
            color: COLORS.textPrimary,
            outline: 'none',
            resize: 'none',
            lineHeight: 1.5,
            maxHeight: 120,
            fontFamily: FONTS.sans,
            caretColor: COLORS.amber,
          }}
          onFocus={e => { e.target.style.borderColor = 'rgba(232,160,48,0.3)'; }}
          onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.08)'; }}
          onInput={e => {
            const t = e.currentTarget;
            t.style.height = 'auto';
            t.style.height = Math.min(t.scrollHeight, 120) + 'px';
          }}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || streaming}
          style={{
            width: 44, height: 44, borderRadius: '50%',
            background: input.trim() && !streaming
              ? 'linear-gradient(135deg, #C87820, #E09838)'
              : 'rgba(255,255,255,0.06)',
            border: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: input.trim() && !streaming ? 'pointer' : 'default',
            flexShrink: 0,
            transition: 'all 0.2s',
            boxShadow: input.trim() && !streaming
              ? '0 4px 14px rgba(200,120,32,0.3)'
              : 'none',
          }}
          aria-label="Send"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2 8L14 8M14 8L9 3M14 8L9 13"
              stroke={input.trim() && !streaming ? 'white' : 'rgba(240,235,224,0.3)'}
              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      <style>{`
        @keyframes dotBlink {
          0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
      `}</style>

      {/* Chat Tour */}
      {showChatTour && (
        <SpotlightTour
          stops={[
            { ref: chatInputRef, copy: 'Ask anything — prep, drafts, strategy.', position: 'above' as const },
          ]}
          storageKey="jove_tour_chat"
          onComplete={() => setShowChatTour(false)}
        />
      )}
    </div>
    </>
  );
}
