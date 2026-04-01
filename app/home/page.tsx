'use client';

import { useState, useEffect, useCallback, useRef, useReducer, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import SceneBackground from '@/components/home/SceneBackground';
import type { CelestialPosition } from '@/components/home/SceneBackground';
import AmbientBird from '@/components/home/AmbientBird';
import ControlSurface from '@/components/home/ControlSurface';
import Logo from '@/components/ui/Logo';
import {
  saveInteraction,
  updateInteractionLinkage,
  triggerExtraction,
  updateStreak,
} from '@/lib/capture-utils';
import { persistChatMessage, generateThreadId, registerChatThread } from '@/lib/chat-persistence';
import {
  getGreeting,
  formatTime,
  COLORS,
} from '@/lib/design-system';
import { PULSE_CHECK_DEFAULT_DAYS } from '@/lib/constants';
import { getFractionalHour, getInterpolatedScene } from '@/lib/scene-interpolation';
import {
  evaluateAssistantTrigger,
  markTriggerSeen,
  type AssistantTrigger,
} from '@/lib/assistant-trigger';
import type {
  DealRow,
  MeetingRow,
  SignalRow,
  StreakLogRow,
  UserRow,
  InteractionSourceSurface,
  InteractionOrigin,
  InteractionIntentType,
  InteractionRoutingMetadata,
} from '@/lib/types';
import {
  classifyMessage,
  isFollowUp,
  hasQuestionIntent,
  type ClassificationResult,
  type MessageBucket,
} from '@/lib/chat-intelligence';
import { renderMarkdown } from '@/lib/renderMarkdown';

// ── TYPES ──────────────────────────────────────────────────
type DealWithAccount = DealRow & { accounts: { name: string } | null };

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Classification result attached to user messages after processing */
  classification?: ClassificationResult;
  /** Whether this message resulted in a saved interaction */
  saved?: boolean;
  /** Inline UI mode for special flows (new deal form, clarification, deal picker) */
  uiMode?: 'clarification' | 'new_deal_confirm' | 'new_deal_form' | 'deal_picker';
  /** For clarification: the original message ID being clarified */
  pendingMessageId?: string;
}

/** Tracks whether any real intelligence was saved during this chat session */
type ChatSaveState = {
  hasSaved: boolean;
};

interface HomeData {
  user:          UserRow | null;
  meetings:      MeetingRow[];
  urgentDeals:   DealWithAccount[];
  allDeals:      DealWithAccount[];
  signals:       SignalRow[];
  streakLogs:    StreakLogRow[];
  accountCount:  number;
}

interface WeatherData {
  emoji:     string;
  temp:      number;
  condition: string;
}

// ── WEATHER HELPER ────────────────────────────────────────
function getWeatherEmoji(code: number): { emoji: string; condition: string } {
  if (code === 0)                    return { emoji: '☀️',  condition: 'Clear' };
  if (code <= 3)                     return { emoji: '⛅️', condition: 'Partly cloudy' };
  if (code <= 48)                    return { emoji: '🌫',  condition: 'Foggy' };
  if (code <= 67)                    return { emoji: '🌧',  condition: 'Rainy' };
  if (code <= 77)                    return { emoji: '❄️',  condition: 'Snow' };
  if (code <= 82)                    return { emoji: '🌦',  condition: 'Showers' };
  return                                    { emoji: '⛈',  condition: 'Stormy' };
}

// ── FIRST NAME HELPER ─────────────────────────────────────
function getFirstName(user: UserRow | null): string {
  if (!user) return '';
  if (user.full_name) return user.full_name.split(' ')[0];
  if (user.email)     return user.email.split('@')[0];
  return '';
}

// ── COMPONENT ─────────────────────────────────────────────
export default function HomePage() {
  const router   = useRouter();
  const supabase = createClient();

  const [data, setData]       = useState<HomeData | null>(null);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [time, setTime]       = useState(formatTime());
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [homeRefreshKey, setHomeRefreshKey] = useState(0);
  const [logoBloom, setLogoBloom] = useState(false);

  // ── CONTROL SURFACE STATE ──────────────────────────────
  const [controlOpen, setControlOpen] = useState(false);

  // ── CELESTIAL POSITION (single source of truth from SceneBackground) ──
  const [celestialPos, setCelestialPos] = useState<CelestialPosition>({
    x: '50%', y: '50%', isMoon: false, size: 0,
  });

  // ── BIRD INTERACTION STATE ──────────────────────────────────
  const [birdModalOpen, setBirdModalOpen] = useState(false);
  const [birdModalInput, setBirdModalInput] = useState('');
  const [birdModalSaving, setBirdModalSaving] = useState(false);
  const [birdDealGate, setBirdDealGate] = useState(false);
  const [birdPulseTrigger, setBirdPulseTrigger] = useState(0);
  const birdPositionRef = useRef({ x: 0, y: 0 });
  const birdHitboxRef = useRef<HTMLDivElement>(null);
  const birdModalInputRef = useRef<HTMLTextAreaElement>(null);

  // Session 6: birdAnsweredCount removed — birdQuestion now derives from
  // assistantTrigger which re-evaluates when data changes via homeRefreshKey.
  // Ref for cross-system curiosity resolution (chat → homepage/bird)
  const birdQuestionRef = useRef<{
    text: string;
    dealId: string | null;
    meetingId: string | null;
    targetId: string;
  } | null>(null);

  // ── ENVIRONMENTAL ACKNOWLEDGMENT STATE ─────────────────
  const [ackToken, setAckToken] = useState(0);
  const [shimmerActive, setShimmerActive] = useState(false);
  const [shimmerOpacity, setShimmerOpacity] = useState(1);
  const ackGuardRef = useRef<number>(0);
  // ── BIRD REACTION TRIGGER ────────────────────────────
  const [birdReactionTrigger, setBirdReactionTrigger] = useState(0);
  // Stable ref: labels the source of the next reaction increment ('save' | 'ambient')
  const birdReactionSourceRef = useRef<'save' | 'ambient'>('ambient');

  // Guard: track which interaction IDs have already been retried this session
  const retriedInteractionIdsRef = useRef<Set<string>>(new Set());

  // ── FIRST VISIT OVERLAY STATE ────────────────────────────
  const [firstVisitVisible, setFirstVisitVisible] = useState(
    () => typeof window !== 'undefined'
      ? localStorage.getItem('jove_first_visit_shown') !== 'true'
      : false
  );
  const [firstVisitOpacity, setFirstVisitOpacity] = useState(1);

  // ── TOUR REFS ────────────────────────────────────────────
  const sunRef     = useRef<HTMLDivElement>(null);
  const logoRef    = useRef<HTMLDivElement>(null);

  // ── CHAT STATE ──────────────────────────────────────────
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatSheetVisible, setChatSheetVisible] = useState(false);
  const [chatProcessing, setChatProcessing] = useState(false);
  const [chatStreaming, setChatStreaming] = useState(false);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatIdCounter = useRef(0);
  const chatSaveStateRef = useRef<ChatSaveState>({ hasSaved: false });
  // ── CHAT PERSISTENCE: thread ID for durable message storage ──
  const chatThreadIdRef = useRef<string>(generateThreadId('home_chat'));

  // Pending message waiting for clarification resolution
  // Session 3: also holds savedInteractionId so resolution updates the existing row
  const pendingClarificationRef = useRef<{
    messageId: string;
    originalText: string;
    classification: ClassificationResult;
    /** ID of the already-saved interaction (raw preserved), updated on resolution */
    savedInteractionId: string | null;
  } | null>(null);
  // New deal form state (inline in chat)
  const [newDealForm, setNewDealForm] = useState<{
    dealName: string;
    accountName: string;
    value: string;
    originalText: string;
  } | null>(null);

  const openChat = useCallback(() => {
    setChatOpen(true);
    // Allow DOM to mount, then animate in
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setChatSheetVisible(true);
        setTimeout(() => chatInputRef.current?.focus(), 320);
      });
    });
  }, []);

  const closeChat = useCallback(() => {
    const hadSave = chatSaveStateRef.current.hasSaved;
    setChatSheetVisible(false);
    setTimeout(() => {
      setChatOpen(false);
      // Preserve messages so reopening shows history
      // Phase 8: Environmental acknowledgment after real saved intelligence
      if (hadSave) {
        chatSaveStateRef.current.hasSaved = false;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            triggerEnvironmentalAcknowledgment({ source: 'capture' });
          });
        });
      }
    }, 340);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── CHAT PERSISTENCE: helper to add + persist assistant message ──
  const addAndPersistAssistantMessage = useCallback((
    content: string,
    opts?: {
      uiMode?: ChatMessage['uiMode'];
      pendingMessageId?: string;
      saved?: boolean;
      dealId?: string | null;
    },
  ) => {
    const msgId = `msg-${++chatIdCounter.current}`;
    const msg: ChatMessage = {
      id: msgId,
      role: 'assistant',
      content,
      ...(opts?.uiMode && { uiMode: opts.uiMode }),
      ...(opts?.pendingMessageId && { pendingMessageId: opts.pendingMessageId }),
      ...(opts?.saved && { saved: opts.saved }),
    };
    setChatMessages(prev => [...prev, msg]);

    // Persist durably (fire-and-forget)
    if (data?.user) {
      persistChatMessage(supabase, {
        userId: data.user.id,
        threadId: chatThreadIdRef.current,
        role: 'assistant',
        sourceSurface: 'home_chat',
        messageText: content,
        dealId: opts?.dealId ?? null,
      });
    }
    return msgId;
  }, [data, supabase]);

  // ── CHAT INTELLIGENCE: save interaction helper ──────────────
  const chatSaveInteraction = useCallback(async (
    rawContent: string,
    dealId: string | null,
    type: 'note' | 'debrief' | 'meeting_log' = 'note',
    memoryFields?: {
      meetingId?: string | null;
      intentType?: InteractionIntentType | null;
      routingConfidence?: number | null;
      routingMetadata?: InteractionRoutingMetadata | null;
    },
  ): Promise<string | null> => {
    if (!data?.user) return null;
    try {
      const result = await saveInteraction(supabase, {
        userId: data.user.id,
        dealId,
        type,
        rawContent,
        sourceSurface: 'home_chat',
        origin: 'user',
        intentType: memoryFields?.intentType ?? null,
        meetingId: memoryFields?.meetingId ?? null,
        routingConfidence: memoryFields?.routingConfidence ?? null,
        routingMetadata: memoryFields?.routingMetadata ?? null,
      });
      if (result?.id) {
        triggerExtraction(result.id, data.user.id);
        await updateStreak(supabase, data.user.id);
        chatSaveStateRef.current.hasSaved = true;
        // Resolve homepage/bird curiosity if this save matches the active target
        const activeQ = birdQuestionRef.current;
        if (activeQ && dealId && dealId === activeQ.dealId) {
          localStorage.setItem(`curiosity_asked_${activeQ.targetId}`, 'true');
          // Session 6: birdAnsweredCount removed — homeRefreshKey handles recompute
        }
        // Delayed re-fetch for extraction
        setTimeout(() => setHomeRefreshKey(k => k + 1), 3000);
        return result.id;
      }
    } catch (err) {
      console.error('Chat save error:', err);
    }
    return null;
  }, [data, supabase]);

  // ── ResponseContext type for grounded LLM awareness ──────────
  type ResponseContext = {
    classification: string;
    actionTaken?: 'saved' | 'linked' | 'created_deal' | 'none';
    linkedDealId?: string | null;
    linkedDealName?: string | null;
    createdDealId?: string | null;
    ambiguity?: boolean;
  };

  // ── Conversational input detection ─────────────────────────
  const isConversational = useCallback((input: string): boolean => {
    return /^(hi|hello|hey|what do you do|help|who are you|what can you do|good morning|good afternoon|good evening|thanks|thank you|sup|yo)/i.test(input.trim());
  }, []);

  // ── CHAT INTELLIGENCE: stream assistant response ────────────
  const streamAssistantResponse = useCallback(async (
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    dealId?: string | null,
    responseContext?: ResponseContext | null,
  ) => {
    if (!data?.user) return;
    const assistantMsgId = `msg-${++chatIdCounter.current}`;
    setChatMessages(prev => [...prev, {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
    }]);
    setChatStreaming(true);

    try {
      const res = await fetch('/api/chat-home', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: data.user.id,
          messages,
          dealId: dealId ?? null,
          responseContext: responseContext ?? null,
        }),
      });

      if (!res.ok || !res.body) {
        setChatMessages(prev => prev.map(m =>
          m.id === assistantMsgId
            ? { ...m, content: "Didn\u2019t catch that \u2014 try again?" }
            : m
        ));
        setChatStreaming(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        const current = accumulated;
        setChatMessages(prev => prev.map(m =>
          m.id === assistantMsgId ? { ...m, content: current } : m
        ));
      }

      // ── Persist final assistant reply durably (fire-and-forget) ──
      if (accumulated.trim()) {
        persistChatMessage(supabase, {
          userId: data.user.id,
          threadId: chatThreadIdRef.current,
          role: 'assistant',
          sourceSurface: 'home_chat',
          messageText: accumulated,
          dealId: dealId ?? null,
        });
      }
    } catch {
      setChatMessages(prev => prev.map(m =>
        m.id === assistantMsgId
          ? { ...m, content: "Didn\u2019t catch that \u2014 try again?" }
          : m
      ));
    } finally {
      setChatStreaming(false);
    }
  }, [data, supabase]);

  // ── CHAT INTELLIGENCE: handle new deal creation inline ──────
  const handleNewDealCreate = useCallback(async () => {
    if (!newDealForm || !data?.user) return;
    const { dealName, accountName, value, originalText } = newDealForm;
    if (!dealName.trim() || !accountName.trim()) return;

    setChatProcessing(true);

    try {
      // Check if account exists
      const { data: existingAccount } = await supabase
        .from('accounts')
        .select('id')
        .eq('user_id', data.user.id)
        .ilike('name', accountName.trim())
        .maybeSingle();

      let accountId: string;
      if (existingAccount) {
        accountId = existingAccount.id;
      } else {
        const { data: newAccount, error: accountError } = await supabase
          .from('accounts')
          .insert({ user_id: data.user.id, name: accountName.trim() })
          .select('id')
          .single();
        if (accountError || !newAccount) throw accountError ?? new Error('Account creation failed');
        accountId = newAccount.id;
      }

      // Create deal
      const dealInsert: Record<string, unknown> = {
        user_id: data.user.id,
        account_id: accountId,
        name: dealName.trim(),
        stage: 'Discovery',
      };
      if (value.trim()) {
        const numVal = parseFloat(value.replace(/[,$]/g, ''));
        if (!isNaN(numVal)) dealInsert.value = numVal;
      }

      const { data: newDeal, error: dealError } = await supabase
        .from('deals')
        .insert(dealInsert)
        .select('id, name')
        .single();
      if (dealError || !newDeal) throw dealError ?? new Error('Deal creation failed');

      // Save original message as interaction on new deal
      await chatSaveInteraction(originalText, newDeal.id, 'note', {
        intentType: 'capture',
        routingConfidence: 1,
        routingMetadata: {
          classifierBucket: 'new_deal',
          routingPath: 'user_clarified',
        },
      });

      // Stream a conversational response about the new deal
      const history = chatMessages
        .filter(m => !m.uiMode)
        .map(m => ({ role: m.role, content: m.content }));
      history.push({ role: 'user', content: originalText });
      await streamAssistantResponse(history, newDeal.id, {
        classification: 'new_deal',
        actionTaken: 'created_deal',
        createdDealId: newDeal.id,
        linkedDealName: dealName.trim(),
      });

      setNewDealForm(null);
      setHomeRefreshKey(k => k + 1);
    } catch (err) {
      console.error('New deal creation error:', err);
      addAndPersistAssistantMessage("Couldn\u2019t create that \u2014 try again?");
    } finally {
      setChatProcessing(false);
    }
  }, [newDealForm, data, supabase, chatSaveInteraction, addAndPersistAssistantMessage, chatMessages, streamAssistantResponse]);

  // ── SESSION 3: build routing metadata with all candidates ────
  const buildRoutingMetadata = useCallback((
    classification: ClassificationResult,
    routingPath: 'auto' | 'user_clarified',
  ): InteractionRoutingMetadata => {
    const meta: InteractionRoutingMetadata = {
      classifierBucket: classification.bucket,
      routingPath,
    };
    // Always preserve all deal candidates
    if (classification.allDealCandidates.length > 0) {
      meta.matchedDealCandidates = classification.allDealCandidates.map(c => ({
        dealId: c.dealId,
        dealName: c.dealName,
        score: c.score,
      }));
    }
    // Always preserve all meeting candidates
    if (classification.allMeetingCandidates.length > 0) {
      meta.matchedMeetingCandidates = classification.allMeetingCandidates.map(c => ({
        meetingId: c.meetingId,
        meetingTitle: c.meetingTitle,
        score: c.score,
      }));
    }
    // Preserve ambiguity reason if present
    if (classification.ambiguityReason) {
      meta.ambiguityNotes = classification.ambiguityReason;
    }
    return meta;
  }, []);

  // ── CHAT INTELLIGENCE: handle clarification response ────────
  // Session 3: If we already saved the raw interaction, update it instead of creating a duplicate.
  const handleClarificationResponse = useCallback(async (selectedDealId: string | null) => {
    const pending = pendingClarificationRef.current;
    if (!pending) return;

    pendingClarificationRef.current = null;
    setChatProcessing(true);

    try {
      const resolvedMeta = buildRoutingMetadata(pending.classification, 'user_clarified');

      if (pending.savedInteractionId) {
        // Phase 9: Update the existing saved interaction — don't duplicate
        await updateInteractionLinkage(supabase, {
          interactionId: pending.savedInteractionId,
          dealId: selectedDealId,
          meetingId: pending.classification.matchedMeetingId,
          routingConfidence: 1,
          routingMetadata: resolvedMeta,
        });
        // Now trigger extraction on the updated row
        if (data?.user) {
          triggerExtraction(pending.savedInteractionId, data.user.id);
          await updateStreak(supabase, data.user.id);
          chatSaveStateRef.current.hasSaved = true;
          setTimeout(() => setHomeRefreshKey(k => k + 1), 3000);
        }
      } else {
        // Fallback: no pre-saved interaction (shouldn't happen in normal flow)
        const type = pending.classification.bucket === 'meeting_context' ? 'meeting_log' as const : 'note' as const;
        const intentType = pending.classification.bucket === 'meeting_context' ? 'debrief' as const : 'capture' as const;
        await chatSaveInteraction(pending.originalText, selectedDealId, type, {
          meetingId: pending.classification.matchedMeetingId,
          intentType,
          routingConfidence: 1,
          routingMetadata: resolvedMeta,
        });
      }

      // ALWAYS stream a conversational response after clarification resolution
      const dealName = selectedDealId
        ? data?.allDeals.find(d => d.id === selectedDealId)?.name ?? null
        : null;
      const history = chatMessages
        .filter(m => !m.uiMode)
        .map(m => ({ role: m.role, content: m.content }));
      history.push({ role: 'user', content: pending.originalText });
      await streamAssistantResponse(history, selectedDealId, {
        classification: pending.classification.bucket,
        actionTaken: 'linked',
        linkedDealId: selectedDealId,
        linkedDealName: dealName,
      });
    } catch {
      addAndPersistAssistantMessage('Didn\u2019t save that \u2014 try again?');
    } finally {
      setChatProcessing(false);
    }
  }, [data, supabase, chatSaveInteraction, addAndPersistAssistantMessage, buildRoutingMetadata, chatMessages, streamAssistantResponse]);

  // ── MAIN CHAT SUBMIT HANDLER ────────────────────────────────
  const handleChatSubmit = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || chatProcessing || chatStreaming) return;
    if (!data?.user) return;

    const userMsgId = `msg-${++chatIdCounter.current}`;
    const userMsg: ChatMessage = {
      id: userMsgId,
      role: 'user',
      content: text,
    };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput('');
    setChatProcessing(true);

    // ── Persist user message durably (fire-and-forget) ──
    persistChatMessage(supabase, {
      userId: data.user.id,
      threadId: chatThreadIdRef.current,
      role: 'user',
      sourceSurface: 'home_chat',
      messageText: text,
    });

    // ── Drop any pending clarification state from a previous message ──
    // If the user sends a new message while a clarification is pending,
    // gracefully abandon the old flow rather than deadlocking.
    if (pendingClarificationRef.current) {
      pendingClarificationRef.current = null;
      // Remove the stale deal_picker UI from chat
      setChatMessages(prev => prev.map(m =>
        m.uiMode === 'deal_picker' ? { ...m, uiMode: undefined } : m
      ));
    }
    if (newDealForm) {
      setNewDealForm(null);
      setChatMessages(prev => prev.map(m =>
        (m.uiMode === 'new_deal_confirm' || m.uiMode === 'new_deal_form') ? { ...m, uiMode: undefined } : m
      ));
    }

    try {
      // ── FOLLOW-UP DETECTION ─────────────────────────────────
      const previousMessages = chatMessages
        .filter(m => !m.uiMode)
        .map(m => ({ role: m.role, content: m.content }));

      if (isFollowUp(text, previousMessages)) {
        const history = [...previousMessages, { role: 'user' as const, content: text }];
        const lastClassified = [...chatMessages].reverse().find(m => m.classification?.matchedDealId);
        await streamAssistantResponse(history, lastClassified?.classification?.matchedDealId ?? null);
        setChatProcessing(false);
        return;
      }

      // ── CONVERSATIONAL INPUT DETECTION ──────────────────────
      // Skip strict classification for greetings/conversational messages.
      // Still send to LLM so the assistant always responds naturally.
      if (isConversational(text)) {
        const history = [...previousMessages, { role: 'user' as const, content: text }];
        await streamAssistantResponse(history, null, {
          classification: 'conversational',
          actionTaken: 'none',
        });
        setChatProcessing(false);
        return;
      }

      // Phase 1: Classify message
      const classification = classifyMessage(
        text,
        data.allDeals ?? [],
        data.meetings ?? [],
      );

      // Attach classification to user message
      setChatMessages(prev => prev.map(m =>
        m.id === userMsgId ? { ...m, classification } : m
      ));

      // ── SESSION 3: Build routing metadata with all candidates ──
      const routingMeta = buildRoutingMetadata(classification, 'auto');

      // Phase 2: Route based on confidence
      switch (classification.bucket) {

        // ── QUESTION PATH ────────────────────────────────────
        case 'question': {
          // Optionally save if strong intel detected in the question
          if (classification.matchedDealId && text.length > 40) {
            chatSaveInteraction(text, classification.matchedDealId, 'note', {
              intentType: 'mixed' as InteractionIntentType,
              routingConfidence: 1,
              routingMetadata: routingMeta,
            });
          }

          const history = chatMessages
            .filter(m => !m.uiMode)
            .map(m => ({ role: m.role, content: m.content }));
          history.push({ role: 'user', content: text });

          await streamAssistantResponse(history, classification.matchedDealId, {
            classification: 'question',
            actionTaken: classification.matchedDealId && text.length > 40 ? 'saved' : 'none',
            linkedDealId: classification.matchedDealId,
            linkedDealName: classification.matchedDealName,
          });
          break;
        }

        // ── EMAIL DRAFT PATH ────────────────────────────────
        case 'email_draft': {
          if (classification.confidence === 'low') {
            const savedId = await chatSaveInteraction(text, null, 'note', {
              intentType: 'draft_intent',
              routingConfidence: 0.3,
              routingMetadata: { ...routingMeta, routingPath: 'auto' },
            });
            pendingClarificationRef.current = {
              messageId: userMsgId,
              originalText: text,
              classification,
              savedInteractionId: savedId,
            };
            addAndPersistAssistantMessage(
              classification.clarificationQuestion ?? 'Which deal is this about?',
              { uiMode: 'deal_picker', pendingMessageId: userMsgId },
            );
          } else {
            await chatSaveInteraction(text, classification.matchedDealId, 'note', {
              intentType: 'draft_intent',
              routingConfidence: 1,
              routingMetadata: routingMeta,
            });
            const history = chatMessages
              .filter(m => !m.uiMode)
              .map(m => ({ role: m.role, content: m.content }));
            history.push({ role: 'user', content: text });
            await streamAssistantResponse(history, classification.matchedDealId, {
              classification: 'email_draft',
              actionTaken: 'saved',
              linkedDealId: classification.matchedDealId,
              linkedDealName: classification.matchedDealName,
            });
          }
          break;
        }

        // ── NEW DEAL PATH ───────────────────────────────────
        case 'new_deal': {
          addAndPersistAssistantMessage(
            'Should I create a new deal for this?',
            { uiMode: 'new_deal_confirm', pendingMessageId: userMsgId },
          );
          // Pre-populate form with extracted entity name
          setNewDealForm({
            dealName: classification.extractedEntityName ?? '',
            accountName: classification.extractedEntityName ?? '',
            value: '',
            originalText: text,
          });
          break;
        }

        // ── EXISTING DEAL UPDATE ────────────────────────────
        case 'existing_deal_update': {
          if (classification.confidence === 'low') {
            // Save raw immediately, then ask for clarification
            const savedId = await chatSaveInteraction(text, null, 'note', {
              intentType: 'capture',
              routingConfidence: 0.3,
              routingMetadata: { ...routingMeta, routingPath: 'auto' },
            });
            pendingClarificationRef.current = {
              messageId: userMsgId,
              originalText: text,
              classification,
              savedInteractionId: savedId,
            };
            addAndPersistAssistantMessage(
              classification.clarificationQuestion ?? 'Which deal is this about?',
              { uiMode: 'deal_picker', pendingMessageId: userMsgId },
            );
          } else {
            // Save first, then ALWAYS stream a conversational response
            const isMixed = hasQuestionIntent(text);
            await chatSaveInteraction(text, classification.matchedDealId, 'note', {
              intentType: isMixed ? 'mixed' as InteractionIntentType : 'capture',
              routingConfidence: 1,
              routingMetadata: routingMeta,
            });

            const history = chatMessages
              .filter(m => !m.uiMode)
              .map(m => ({ role: m.role, content: m.content }));
            history.push({ role: 'user', content: text });
            await streamAssistantResponse(history, classification.matchedDealId, {
              classification: 'existing_deal_update',
              actionTaken: 'saved',
              linkedDealId: classification.matchedDealId,
              linkedDealName: classification.matchedDealName,
            });
          }
          break;
        }

        // ── MEETING CONTEXT PATH ────────────────────────────
        case 'meeting_context': {
          if (classification.confidence === 'low') {
            // Save raw immediately, then ask for clarification
            const savedId = await chatSaveInteraction(text, null, 'meeting_log', {
              meetingId: classification.matchedMeetingId,
              intentType: 'debrief',
              routingConfidence: 0.3,
              routingMetadata: { ...routingMeta, routingPath: 'auto' },
            });
            pendingClarificationRef.current = {
              messageId: userMsgId,
              originalText: text,
              classification,
              savedInteractionId: savedId,
            };
            addAndPersistAssistantMessage(
              classification.clarificationQuestion ?? 'Which deal is this about?',
              { uiMode: 'deal_picker', pendingMessageId: userMsgId },
            );
          } else {
            // Save first, then ALWAYS stream a conversational response
            const isMixed = hasQuestionIntent(text);
            await chatSaveInteraction(text, classification.matchedDealId, 'meeting_log', {
              meetingId: classification.matchedMeetingId,
              intentType: isMixed ? 'mixed' as InteractionIntentType : 'debrief',
              routingConfidence: 1,
              routingMetadata: routingMeta,
            });

            const history = chatMessages
              .filter(m => !m.uiMode)
              .map(m => ({ role: m.role, content: m.content }));
            history.push({ role: 'user', content: text });
            await streamAssistantResponse(history, classification.matchedDealId, {
              classification: 'meeting_context',
              actionTaken: 'saved',
              linkedDealId: classification.matchedDealId,
              linkedDealName: classification.matchedDealName,
            });
          }
          break;
        }

        // ── GENERAL INTEL PATH ──────────────────────────────
        case 'general_intel': {
          // Save first, then ALWAYS stream a conversational response
          const isMixed = hasQuestionIntent(text);
          await chatSaveInteraction(text, null, 'note', {
            intentType: isMixed ? 'mixed' as InteractionIntentType : 'general_intel',
            routingConfidence: 1,
            routingMetadata: routingMeta,
          });

          const history = chatMessages
            .filter(m => !m.uiMode)
            .map(m => ({ role: m.role, content: m.content }));
          history.push({ role: 'user', content: text });
          await streamAssistantResponse(history, null, {
            classification: 'general_intel',
            actionTaken: 'saved',
          });
          break;
        }
      }
    } catch (err) {
      console.error('Chat submit error:', err);
      addAndPersistAssistantMessage("Didn\u2019t catch that \u2014 try again?");
    } finally {
      setChatProcessing(false);
    }
  }, [chatInput, chatProcessing, chatStreaming, data, chatMessages, chatSaveInteraction, streamAssistantResponse, addAndPersistAssistantMessage, buildRoutingMetadata, isConversational]);

  // Auto-scroll chat to bottom on new messages
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  // ── CONTINUOUS SCENE (synced with SceneBackground's 30s tick) ──
  const [sceneFh, setSceneFh] = useState(getFractionalHour);
  useEffect(() => {
    const id = setInterval(() => setSceneFh(getFractionalHour()), 30_000);
    return () => clearInterval(id);
  }, []);
  const h     = Math.floor(sceneFh);
  const scene = getInterpolatedScene(sceneFh);

  // ── FIRST VISIT OVERLAY FADE ─────────────────────────────
  useEffect(() => {
    if (!firstVisitVisible) return;

    const fadeTimer = setTimeout(() => {
      setFirstVisitOpacity(0);
    }, 100);

    const hideTimer = setTimeout(() => {
      setFirstVisitVisible(false);
      localStorage.setItem('jove_first_visit_shown', 'true');
    }, 900);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, [firstVisitVisible]);

  // Sync body background with sky top color so the area behind
  // the iOS status bar shows the correct color.
  useEffect(() => {
    const topColor = scene.sky[0].split(' ')[0];
    document.body.style.backgroundColor = topColor;
    // Also update meta theme-color so iOS status bar
    // tint matches the sky rather than the static dark default
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', topColor);
    return () => {
      document.body.style.backgroundColor = '#060a12';
      if (meta) meta.setAttribute('content', '#060a12');
    };
  }, [scene]);

  // ── CELESTIAL CENTER — derived from SceneBackground callback ──
  // This is the single source of truth for all celestial-dependent UI.
  // No independent position derivation lives here anymore.
  const sunCenterLeft = celestialPos.x;
  const sunCenterTop  = celestialPos.y;
  const isNight       = celestialPos.isMoon;

  // Moon vs sun color families — used by bloom, warmth
  const bloomColor  = isNight
    ? 'radial-gradient(circle, rgba(200,210,230,0.58), rgba(180,190,210,0.22) 50%, transparent 75%)'
    : 'radial-gradient(circle, rgba(248,190,64,0.65), rgba(232,160,48,0.25) 50%, transparent 75%)';
  const warmthInner = isNight ? 'rgba(180,200,230,0.24)' : 'rgba(232,160,48,0.28)';
  const warmthOuter = isNight ? 'rgba(140,160,200,0.09)' : 'rgba(200,120,32,0.11)';
  const brightInner = isNight ? 'rgba(210,220,240,0.10)' : 'rgba(255,248,230,0.13)';
  const brightOuter = isNight ? 'rgba(210,220,240,0.05)' : 'rgba(255,248,230,0.065)';


  // Text color adapts to sky brightness
  const textPrimary   = scene.lightText
    ? 'rgba(252,246,234,0.94)'
    : 'rgba(26,20,16,0.90)';
  const textSecondary = scene.lightText
    ? 'rgba(240,235,224,0.44)'
    : 'rgba(26,20,16,0.44)';

  // Theme-color is now static (#060a12) — black-translucent handles transparency.

  // ── OFFLINE DETECTION ──────────────────────────────────
  useEffect(() => {
    const handleOnline  = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    if (!navigator.onLine) setIsOffline(true);
    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // ── CLOCK ──────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => setTime(formatTime()), 60000);
    return () => clearInterval(interval);
  }, []);


  // ── BIRD HITBOX TRACKING ────────────────────────────────
  useEffect(() => {
    let rafId: number;
    const track = () => {
      const el = birdHitboxRef.current;
      if (el) {
        // Bird SVG is 32x14 — center at (x+16, y+7)
        const cx = birdPositionRef.current.x + 16;
        const cy = birdPositionRef.current.y + 7;
        el.style.transform = `translate(${cx - 22}px, ${cy - 22}px)`;
      }
      rafId = requestAnimationFrame(track);
    };
    rafId = requestAnimationFrame(track);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // ── GLOBAL CAPTURE PULSE ON RETURN ────────────────────
  useEffect(() => {
    const pending = localStorage.getItem('jove_pulse_pending');
    if (pending) {
      const ts = parseInt(pending, 10);
      if (Date.now() - ts < 15000) {
        setTimeout(() => {
          triggerEnvironmentalAcknowledgment({ source: 'other' });
        }, 600);
      }
      localStorage.removeItem('jove_pulse_pending');
    }
  }, []);

  // ── WEATHER ────────────────────────────────────────────
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(async pos => {
      try {
        const { latitude: lat, longitude: lon } = pos.coords;
        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&temperature_unit=fahrenheit&timezone=auto`
        );
        const json = await res.json();
        const code = json.current.weather_code as number;
        const temp = Math.round(json.current.temperature_2m as number);
        const { emoji, condition } = getWeatherEmoji(code);
        setWeather({ emoji, temp, condition });
      } catch {
        // Weather is optional — fail silently
      }
    }, () => {
      // Geolocation denied — fail silently
    });
  }, []);

  // ── DATA FETCH ─────────────────────────────────────────
  const fetchHomeData = useCallback(async () => {
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) { router.push('/'); return; }

      const now      = new Date();
      const todayStr = now.toISOString().split('T')[0];
      const cutoff   = new Date();
      cutoff.setDate(cutoff.getDate() - PULSE_CHECK_DEFAULT_DAYS);

      // Parallel queries for speed
      const [
        userRes,
        meetingsRes,
        urgentDealsRes,
        allDealsRes,
        signalRes,
        streakRes,
        accountCountRes,
        /* debriefRes — removed, positional placeholder */,
        stuckInteractionsRes,
      ] = await Promise.all([
        supabase
          .from('users')
          .select('*')
          .eq('id', authUser.id)
          .single(),

        supabase
          .from('meetings')
          .select('id, title, scheduled_at, deal_id, attendees, debrief_completed, debrief_prompted_at')
          .eq('user_id', authUser.id)
          .gte('scheduled_at', todayStr)
          .order('scheduled_at', { ascending: true })
          .limit(10),

        supabase
          .from('deals')
          .select('id, name, stage, last_activity_at, snoozed_until, intel_score, momentum_score, signal_velocity, next_action, account_id, user_id, accounts(name)')
          .eq('user_id', authUser.id)
          .not('stage', 'in', '("Closed Won","Closed Lost")')
          .lt('last_activity_at', cutoff.toISOString())
          .or(`snoozed_until.is.null,snoozed_until.lt.${now.toISOString()}`)
          .order('last_activity_at', { ascending: true })
          .limit(5),

        supabase
          .from('deals')
          .select('id, name, stage, last_activity_at, snoozed_until, intel_score, momentum_score, signal_velocity, next_action, account_id, user_id, accounts(name)')
          .eq('user_id', authUser.id)
          .not('stage', 'in', '("Closed Won","Closed Lost")')
          .order('last_activity_at', { ascending: false })
          .limit(10),

        supabase
          .from('signals')
          .select('id, content, signal_type, deal_id, created_at')
          .eq('user_id', authUser.id)
          .order('created_at', { ascending: false })
          .limit(20),

        supabase
          .from('streak_log')
          .select('id, log_date, capture_count, user_id')
          .eq('user_id', authUser.id)
          .gte('log_date', new Date(Date.now() - 120 * 24 * 60 * 60 * 1000)
            .toISOString().split('T')[0])
          .order('log_date', { ascending: false }),

        supabase
          .from('accounts')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', authUser.id),

        supabase
          .from('meetings')
          .select('*')
          .eq('user_id', authUser.id)
          .eq('debrief_completed', false)
          .is('debrief_prompted_at', null)
          .lt('scheduled_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
          .order('scheduled_at', { ascending: false })
          .limit(1),

        // Stuck interactions: failed OR processing > 2 min old, but not < 30s old
        supabase
          .from('interactions')
          .select('id, user_id, extraction_status, created_at')
          .eq('user_id', authUser.id)
          .or('extraction_status.eq.failed,extraction_status.eq.processing')
          .lt('created_at', new Date(Date.now() - 30 * 1000).toISOString())
          .order('created_at', { ascending: false })
          .limit(5),
      ]);

      const activeDeals = (allDealsRes.data ?? []) as unknown as DealWithAccount[];

      setData({
        user:         userRes.data as UserRow | null,
        meetings:     (meetingsRes.data ?? []) as MeetingRow[],
        urgentDeals:  (urgentDealsRes.data ?? []) as unknown as DealWithAccount[],
        allDeals:     activeDeals,
        signals:      (signalRes.data ?? []) as SignalRow[],
        streakLogs:   (streakRes.data ?? []) as StreakLogRow[],
        accountCount: accountCountRes.count ?? 0,
      });

      // ── Session 4: Register homepage chat thread for durable metadata ──
      if (authUser) {
        registerChatThread(supabase, {
          threadId: chatThreadIdRef.current,
          userId: authUser.id,
          sourceSurface: 'home_chat',
        });
      }

      // ── SILENT EXTRACTION RETRY ──────────────────────────
      // Re-fire extraction for the most recent stuck interaction (fire-and-forget)
      const stuckInteractions = (stuckInteractionsRes.data ?? []) as Array<{
        id: string;
        user_id: string;
        extraction_status: string;
        created_at: string;
      }>;

      const twoMinAgo = Date.now() - 2 * 60 * 1000;
      // Filter: failed (any age past 30s) OR processing older than 2 min
      const eligible = stuckInteractions.filter(si => {
        if (retriedInteractionIdsRef.current.has(si.id)) return false;
        if (si.extraction_status === 'failed') return true;
        // processing + older than 2 minutes
        return new Date(si.created_at).getTime() < twoMinAgo;
      });

      if (eligible.length > 0) {
        const mostRecent = eligible[0]; // already ordered desc by created_at
        retriedInteractionIdsRef.current.add(mostRecent.id);
        // Fire-and-forget — do not await, do not block render
        triggerExtraction(mostRecent.id, mostRecent.user_id);
      }

    } catch (err) {
      console.error('Home data fetch error:', err);
      setFetchError(true);
    } finally {
      setLoading(false);
      setTimeout(() => setVisible(true), 80);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchHomeData();
  }, [fetchHomeData, homeRefreshKey]);

  // ── LOGO BLOOM + MILESTONE LISTENER ──────────────────────
  const [logoMilestone, setLogoMilestone] = useState(false);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'jove_bloom_trigger') {
        setLogoBloom(true);
        setTimeout(() => setLogoBloom(false), 800);
        // Environmental response for cross-tab capture / Save to Jove
        triggerEnvironmentalAcknowledgment({ source: 'other' });
      }
      if (e.key === 'jove_milestone_trigger') {
        setLogoMilestone(true);
        setTimeout(() => setLogoMilestone(false), 2000);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // ── SESSION 6: UNIFIED ASSISTANT TRIGGER ──────────────────
  // ONE evaluation. Every surface (homepage line, bird, chat injection)
  // reads from this single result. Priority: clarify > prep > nudge > none.
  const assistantTrigger = useMemo((): AssistantTrigger => {
    if (!data) return { type: 'none', message: '', chatPrompt: '', triggerId: '' };
    return evaluateAssistantTrigger({
      meetings: data.meetings,
      allDeals: data.allDeals,
      urgentDeals: data.urgentDeals,
      signals: data.signals,
    });
  }, [data]);

  // ── SESSION 6: BIRD QUESTION — derives from unified trigger ──
  // The bird uses the SAME evaluateAssistantTrigger result.
  // When trigger type is 'clarify' or 'nudge', the bird has a question.
  // Otherwise the bird remains passive.
  const birdQuestion = useMemo((): {
    text: string;
    dealId: string | null;
    meetingId: string | null;
    targetId: string;
  } | null => {
    if (!data) return null;

    // Bird surfaces clarify and nudge triggers as interactive questions.
    // Prep triggers are informational (no answer needed), so bird stays passive.
    if (assistantTrigger.type === 'clarify' || assistantTrigger.type === 'nudge') {
      return {
        text: assistantTrigger.message,
        dealId: assistantTrigger.context?.dealId ?? null,
        meetingId: assistantTrigger.context?.meetingId ?? null,
        targetId: assistantTrigger.triggerId,
      };
    }

    return null;
  }, [data, assistantTrigger]);
  birdQuestionRef.current = birdQuestion;

  // ── BIRD CAPTURE HANDLER ──────────────────────────────────
  // Core bird save logic — accepts explicit dealId
  const executeBirdSave = async (finalDealId: string | null) => {
    if (!birdModalInput.trim() || birdModalSaving || !data?.user || !birdQuestion) return;
    setBirdModalSaving(true);

    // Capture the targetId before any async work — useMemo may recompute
    const currentTargetId = birdQuestion.targetId;
    const questionText = birdQuestion.text;

    try {
      const result = await saveInteraction(supabase, {
        userId: data.user.id,
        dealId: finalDealId,
        type: 'note',
        rawContent: '[Bird question: ' + questionText + '] ' + birdModalInput.trim(),
        sourceSurface: 'bird',
        origin: 'user',
        intentType: 'clarification',
        meetingId: birdQuestion.meetingId ?? null,
      });

      if (result?.id) {
        triggerExtraction(result.id, data.user.id);
      }

      await updateStreak(supabase, data.user.id);

      // ── PERSIST: mark this target as asked — never ask again ──
      localStorage.setItem(`curiosity_asked_${currentTargetId}`, 'true');
      // Session 6: also mark trigger cooldown so unified trigger doesn't re-surface
      markTriggerSeen(currentTargetId);
    } catch (err) {
      console.error('Bird capture error:', err);
    }

    // Close modal immediately
    setBirdModalOpen(false);
    setBirdModalInput('');
    setBirdModalSaving(false);
    setBirdDealGate(false);

    // Clear pending pulse flag (prevent double-fire on next mount)
    localStorage.removeItem('jove_pulse_pending');

    // ── SAVE CONFIRMED: environmental response + bird soar ──
    // Double rAF ensures modal is visually gone and home has painted
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        triggerEnvironmentalAcknowledgment({ source: 'bird' });
      });
    });

    // Delayed re-fetch to let extraction complete
    setTimeout(() => setHomeRefreshKey(k => k + 1), 3000);
  };

  const handleBirdSubmit = async () => {
    if (!birdModalInput.trim() || birdModalSaving || !data?.user || !birdQuestion) return;

    // Soft gate: no deal and active deals exist — ask before saving
    if (!birdQuestion.dealId && data.allDeals.length > 0) {
      setBirdDealGate(true);
      return;
    }

    executeBirdSave(birdQuestion.dealId);
  };

  const richnessLevel   = Math.min((data?.signals.length ?? 0) / 12, 1);

  // ── ENVIRONMENTAL ACKNOWLEDGMENT HELPER ──────────────────
  // One shared function for ALL post-save homepage feedback.
  // Every save path routes through this — no other helper may fire home feedback.
  // 1-second guard prevents double-firing from overlapping trigger paths.
  const triggerEnvironmentalAcknowledgment = useCallback((options?: { source?: 'bird' | 'capture' | 'meeting' | 'other' }) => {
    const now = Date.now();
    if (now - ackGuardRef.current < 1000) return;
    ackGuardRef.current = now;

    const source = options?.source ?? 'other';

    // Single coordinated acknowledgment: page-wide warmth + sun bloom + brightness + shimmer
    setAckToken(t => t + 1);

    // Water shimmer — fires once, 1.2s total
    setShimmerActive(true);
    setShimmerOpacity(1);
    setTimeout(() => setShimmerOpacity(0), 800);
    setTimeout(() => setShimmerActive(false), 1200);

    // Bird soar — only for bird-originated saves (strengthens the single moment)
    if (source === 'bird') {
      setBirdPulseTrigger(k => k + 1);
      birdReactionSourceRef.current = 'save';
      setBirdReactionTrigger(k => k + 1);
    }
  }, []);

  // ── SUN IMMINENT / IN-PROGRESS STATE ─────────────────
  const now = new Date();
  const isImminent = (data?.meetings ?? []).some(m => {
    const mt = new Date(m.scheduled_at);
    const diff = mt.getTime() - now.getTime();
    return diff > 0 && diff < 60 * 60 * 1000;
  });
  const firstName       = getFirstName(data?.user ?? null);
  const greeting        = getGreeting(h);

  // ── HOMEPAGE INTELLIGENCE LINE (unified trigger > brief cache > fallback) ──
  // Exactly ONE line under the greeting. Reads from assistantTrigger first,
  // then falls back to cached brief or time-of-day message.
  const homepageIntelligenceLine = useMemo((): {
    type: 'trigger' | 'brief' | 'fallback';
    text: string;
    trigger?: AssistantTrigger;
  } => {
    if (!data) return { type: 'fallback', text: '' };

    // ── P1: UNIFIED TRIGGER ───────────────────────
    if (assistantTrigger.type !== 'none') {
      return {
        type: 'trigger',
        text: assistantTrigger.message,
        trigger: assistantTrigger,
      };
    }

    // ── P2: AUTO-BRIEF FROM CACHE ─────────────────
    if (typeof window !== 'undefined') {
      const nowMs = Date.now();
      const today = new Date().toISOString().split('T')[0];
      const nextMeeting = data.meetings.find(m => new Date(m.scheduled_at).getTime() > nowMs);
      if (nextMeeting) {
        const prefix = `brief_${nextMeeting.id}_${today}`;
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key?.startsWith(prefix)) {
            const cached = localStorage.getItem(key);
            if (cached) {
              let enriched = cached;
              if (nextMeeting.deal_id) {
                const dealSignals = data.signals.filter(s => s.deal_id === nextMeeting.deal_id);
                const recentSignal = dealSignals[0];
                if (recentSignal?.content) {
                  const snippet = recentSignal.content.split(/[.!?]/)[0]?.trim();
                  if (
                    snippet &&
                    snippet.length >= 10 &&
                    snippet.length <= 60 &&
                    !cached.toLowerCase().includes(snippet.toLowerCase().slice(0, 20))
                  ) {
                    enriched = `${cached} ${snippet}.`;
                  }
                }
              }
              return { type: 'brief', text: enriched };
            }
          }
        }
      }
    }

    // ── P3: SOFT FALLBACK ─────────────────────────
    const hour = new Date().getHours();
    let fallback: string;
    if (hour >= 5 && hour < 12) fallback = "Whenever you\u2019re ready.";
    else if (hour >= 12 && hour < 17) fallback = "You\u2019re set for the day.";
    else if (hour >= 17 && hour < 21) fallback = "Nothing urgent right now.";
    else fallback = "Rest well.";

    return { type: 'fallback', text: fallback };
  }, [data, assistantTrigger]);

  // Entrance animation values
  const anim = (delay: number) => ({
    opacity:    visible ? 1 : 0,
    transform:  visible ? 'translateY(0)' : 'translateY(12px)',
    transition: `opacity 0.65s ease ${delay}s, transform 0.65s ease ${delay}s`,
  });

  // ── RENDER ─────────────────────────────────────────────
  return (
    <div
      className="relative"
      style={{
        width:     '100%',
        minHeight: '100dvh',
        height:    '100dvh',
        fontFamily:"'DM Sans', sans-serif",
        overflow:  'hidden',
      }}
    >
      <SceneBackground onCelestialPosition={setCelestialPos} />
      <AmbientBird signalCount={data?.signals.length ?? 0} reactionTrigger={birdReactionTrigger} reactionSourceRef={birdReactionSourceRef} positionRef={birdPositionRef} pulseTrigger={birdPulseTrigger} />

      {/* ── BIRD TAP HITBOX ──────────────────────────── */}
      {/* Only interactive when bird has a valid curiosity target */}
      <div
        ref={birdHitboxRef}
        onClick={() => {
          if (!birdModalOpen && birdQuestion) {
            setBirdModalInput('');
            setBirdModalOpen(true);
            setTimeout(() => birdModalInputRef.current?.focus(), 200);
          }
        }}
        onPointerDown={(e) => { if (birdQuestion) (e.currentTarget as HTMLElement).style.transform = `${(e.currentTarget as HTMLElement).style.transform?.replace(/scale\([^)]*\)/, '') || ''} scale(0.9)`; }}
        onPointerUp={(e) => { if (birdQuestion) (e.currentTarget as HTMLElement).style.transform = (e.currentTarget as HTMLElement).style.transform?.replace(/scale\([^)]*\)/, '') || ''; }}
        onPointerLeave={(e) => { if (birdQuestion) (e.currentTarget as HTMLElement).style.transform = (e.currentTarget as HTMLElement).style.transform?.replace(/scale\([^)]*\)/, '') || ''; }}
        style={{
          position:     'fixed',
          top:          0,
          left:         0,
          width:        44,
          height:       44,
          borderRadius: '50%',
          zIndex:       23,
          pointerEvents: birdQuestion ? 'auto' : 'none',
          cursor:       birdQuestion ? 'pointer' : 'default',
          willChange:   'transform',
          WebkitTapHighlightColor: 'transparent',
          ...(birdQuestion ? {
            boxShadow: '0 0 14px 6px rgba(232,160,48,0.15)',
            animation: 'celestialGlow 4s ease-in-out infinite',
          } : {}),
        }}
        aria-label={birdQuestion ? 'Tap bird to answer' : 'Bird is resting'}
      />

      {/* ── ACKNOWLEDGMENT + SUN KEYFRAMES ──────────── */}
      <style>{`
        @keyframes ackWarmth {
          0% { opacity: 0; }
          12.5% { opacity: 1; }
          37.5% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes ackSunBloom {
          0% { transform: translate(-50%,-50%) scale(1); opacity: 0; }
          12.5% { transform: translate(-50%,-50%) scale(1.4); opacity: 1; }
          37.5% { transform: translate(-50%,-50%) scale(1.6); opacity: 0.81; }
          100% { transform: translate(-50%,-50%) scale(3.22); opacity: 0; }
        }
        @keyframes ackBrightness {
          0% { opacity: 0; }
          12.5% { opacity: 1; }
          37.5% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes chatSpin {
          to { transform: rotate(360deg); }
        }
        @keyframes typingDot {
          0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
          30% { opacity: 1; transform: translateY(-3px); }
        }
      `}</style>

      {/* ── WARM TINT LAYER (additive, gradient-based) ── */}
      {richnessLevel > 0 && (
        <div
          style={{
            position:       'fixed',
            inset:          0,
            pointerEvents:  'none',
            zIndex:         1,
            background:     `radial-gradient(circle at ${sunCenterLeft} ${sunCenterTop}, ${isNight ? `rgba(180,200,230,${richnessLevel * 0.03})` : `rgba(232,160,48,${richnessLevel * 0.03})`} 0%, transparent 60%)`,
            transition:     'opacity 1.2s ease',
          }}
        />
      )}

      {/* ── ENVIRONMENTAL ACKNOWLEDGMENT: full-screen warmth radial ── */}
      <div
        key={`ack-warmth-${ackToken}`}
        style={{
          position:       'fixed',
          inset:          0,
          pointerEvents:  'none',
          zIndex:         19,
          background:     `radial-gradient(ellipse at ${sunCenterLeft} ${sunCenterTop}, ${warmthInner} 0%, ${warmthOuter} 40%, transparent 75%)`,
          animation:      ackToken > 0 ? 'ackWarmth 3200ms ease forwards' : 'none',
          opacity:        ackToken > 0 ? undefined : 0,
        }}
      />

      {/* ── ENVIRONMENTAL ACKNOWLEDGMENT: page-wide brightness lift ── */}
      <div
        key={`ack-bright-${ackToken}`}
        style={{
          position:       'fixed',
          inset:          0,
          pointerEvents:  'none',
          zIndex:         19,
          background:     `linear-gradient(to bottom, ${brightInner} 0%, ${brightOuter} 40%, transparent 80%)`,
          animation:      ackToken > 0 ? 'ackBrightness 3200ms ease forwards' : 'none',
          opacity:        ackToken > 0 ? undefined : 0,
        }}
      />

      {/* ── ENVIRONMENTAL ACKNOWLEDGMENT: celestial bloom (visual anchor) ── */}
      <div
        key={`ack-bloom-${ackToken}`}
        style={{
          position:       'absolute',
          left:           sunCenterLeft,
          top:            sunCenterTop,
          transform:      'translate(-50%, -50%)',
          width:          240,
          height:         240,
          borderRadius:   '50%',
          background:     bloomColor,
          animation:      ackToken > 0 ? 'ackSunBloom 3200ms ease-out forwards' : 'none',
          opacity:        ackToken > 0 ? undefined : 0,
          zIndex:         22,
          pointerEvents:  'none',
        }}
      />

      {/* ── WATER SHIMMER ON CAPTURE ─────────────── */}
      {shimmerActive && (
        <div style={{
          position:      'absolute',
          top:           '65%',
          left:          0,
          right:         0,
          height:        '2px',
          overflow:      'hidden',
          zIndex:        8,
          opacity:       shimmerOpacity,
          transition:    'opacity 0.2s ease',
          pointerEvents: 'none',
        }}>
          <div style={{
            width:      '100%',
            height:     '100%',
            background: 'linear-gradient(to right, transparent 0%, rgba(255,248,220,0.18) 30%, rgba(255,255,240,0.28) 50%, rgba(255,248,220,0.18) 70%, transparent 100%)',
            animation:  'waterShimmer 1.2s ease-in-out both',
          }} />
        </div>
      )}

      {/* ── SUN TAP TARGET + BREATHING GLOW ─────────── */}
      {(scene.sun.opacity > 0 || isNight) ? (
        <>
          {/* Subtle glow ring — discoverable without being explicit */}
          <div
            style={{
              position:     'absolute',
              left:         `calc(${sunCenterLeft} - 36px)`,
              top:          `calc(${sunCenterTop} - 36px)`,
              width:        72,
              height:       72,
              borderRadius: '50%',
              background:   isNight
                ? 'radial-gradient(circle, rgba(200,210,230,0.12) 0%, transparent 70%)'
                : 'radial-gradient(circle, rgba(250,200,70,0.12) 0%, transparent 70%)',
              zIndex:       14,
              pointerEvents:'none',
              animation:    isImminent
                ? 'celestialGlowImminent 2.5s ease-in-out infinite'
                : isNight
                  ? 'celestialGlow 10s ease-in-out infinite'
                  : 'celestialGlow 6s ease-in-out infinite',
            }}
          />

          {/* Clickable celestial overlay — uses calc() for centering because the
              breath animation's transform (scale) would override translate(-50%,-50%). */}
          <div
            ref={sunRef}
            onClick={() => router.push('/briefing')}
            onPointerDown={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(0.92)'; }}
            onPointerUp={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
            onPointerLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
            style={{
              position:     'absolute',
              left:         `calc(${sunCenterLeft} - 50px)`,
              top:          `calc(${sunCenterTop} - 50px)`,
              width:        100,
              height:       100,
              borderRadius: '50%',
              cursor:       'pointer',
              zIndex:       15,
              display:      'flex',
              alignItems:   'center',
              justifyContent:'center',
              animation:    isImminent
                ? 'breath 2.5s ease-in-out infinite'
                : isNight
                  ? 'breath 12s ease-in-out infinite'
                  : 'breath 5s ease-in-out infinite',
              transition:   'transform 0.15s ease',
              WebkitTapHighlightColor: 'transparent',
            }}
            aria-label="Tap for briefing"
          >
          </div>

        </>
      ) : null}

      {/* ── OFFLINE BANNER ─────────────────────────── */}
      <div style={{
        position:   'absolute',
        top:        0,
        left:       0,
        right:      0,
        zIndex:     50,
        height:     isOffline ? 28 : 0,
        overflow:   'hidden',
        transition: 'height 0.3s ease',
      }}>
        <div style={{
          height:      28,
          background:  'rgba(224,88,64,0.9)',
          display:     'flex',
          alignItems:  'center',
          justifyContent: 'center',
        }}>
          <span style={{
            fontSize:   10,
            fontWeight: 400,
            color:      '#FFFFFF',
            fontFamily: "'DM Sans', sans-serif",
          }}>
            You&apos;re offline — some features unavailable.
          </span>
        </div>
      </div>

      {/* ── TOP BAR (z:30 — above bird) ─────────── */}
      <div
        style={{
          position:      'absolute',
          top:           0,
          left:          0,
          right:         0,
          zIndex:        30,
          pointerEvents: 'none',
        }}
      >
        <div
          className="flex items-start justify-between"
          style={{ paddingTop: 'env(safe-area-inset-top)', paddingLeft: 22, paddingRight: 22, pointerEvents: 'auto', ...anim(0.06) }}
        >
          {/* Logo — taps to settings */}
          <div
            ref={logoRef}
            style={{
              transition: logoMilestone
                ? 'box-shadow 2s ease, transform 2s ease'
                : 'box-shadow 0.4s ease, transform 0.4s ease',
              borderRadius: 12,
              ...(logoMilestone
                ? {
                    boxShadow: '0 0 24px 12px rgba(232,160,48,0.4)',
                    transform: 'scale(1.2)',
                  }
                : logoBloom
                  ? {
                      boxShadow: '0 0 24px rgba(232,160,48,0.5)',
                      transform: 'scale(1.15)',
                    }
                  : {
                      boxShadow: 'none',
                      transform: 'scale(1)',
                    }),
            }}
          >
            <Logo light={scene.lightText} showWordmark size={30} />
          </div>
        </div>
      </div>

      <div
        className="absolute inset-0 flex flex-col items-center"
        style={{ zIndex: 20, pointerEvents: 'none', paddingTop: 'calc(env(safe-area-inset-top, 0px) + 10vh)' }}
      >
        {/* ── GREETING + NAME (top third — anchor, never competes with sun) ── */}
        <div
          style={{
            textAlign:  'center',
            padding:    '0 32px',
            maxWidth:   400,
            ...anim(0.14),
          }}
        >
          <div
            style={{
              display:        'inline-block',
              padding:        '6px 20px 10px',
            }}
          >
            <div style={{
              fontFamily:   "'Cormorant Garamond', serif",
              fontSize:     13,
              fontWeight:   300,
              color:        textSecondary,
              marginBottom: 4,
              letterSpacing: '0.3px',
            }}>
              {greeting}
            </div>
            <div style={{
              fontFamily:   "'Cormorant Garamond', serif",
              fontSize:     44,
              fontWeight:   300,
              color:        textPrimary,
              lineHeight:   1.05,
              letterSpacing:'-0.5px',
              textShadow:   scene.lightText
                ? '0 1px 0 rgba(0,0,0,0.2), 0 2px 20px rgba(0,0,0,0.18)'
                : '0 1px 2px rgba(255,255,255,0.3)',
            }}>
              {loading ? '' : firstName || 'there'}.
            </div>
          </div>
        </div>

        {/* ── HOMEPAGE INTELLIGENCE LINE (exactly one) ──── */}
        {/* Session 6: Tappable when trigger exists — opens chat with injected prompt */}
        {!loading && homepageIntelligenceLine.text && (
          <div
            onClick={homepageIntelligenceLine.trigger ? () => {
              // Mark this trigger as seen (cooldown)
              markTriggerSeen(homepageIntelligenceLine.trigger!.triggerId);
              // Open chat and inject the prompt
              openChat();
              // Small delay to let chat mount, then inject message
              setTimeout(() => {
                setChatInput(homepageIntelligenceLine.trigger!.chatPrompt);
              }, 350);
            } : undefined}
            onPointerDown={homepageIntelligenceLine.trigger ? (e) => { (e.currentTarget as HTMLElement).style.opacity = '0.6'; (e.currentTarget as HTMLElement).style.transform = 'scale(0.97)'; } : undefined}
            onPointerUp={homepageIntelligenceLine.trigger ? (e) => { (e.currentTarget as HTMLElement).style.opacity = '1'; (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; } : undefined}
            onPointerLeave={homepageIntelligenceLine.trigger ? (e) => { (e.currentTarget as HTMLElement).style.opacity = '1'; (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; } : undefined}
            style={{
              textAlign:  'center',
              padding:    '0 32px',
              marginTop:  10,
              maxWidth:   340,
              pointerEvents: homepageIntelligenceLine.trigger ? 'auto' : 'none',
              cursor:     homepageIntelligenceLine.trigger ? 'pointer' : 'default',
              ...anim(0.22),
              ...(visible ? { transition: 'opacity 0.15s ease, transform 0.15s ease' } : {}),
            }}
          >
            <span style={{
              fontFamily:    "'Cormorant Garamond', serif",
              fontSize:      15,
              fontWeight:    300,
              color:         textSecondary,
              letterSpacing: '0.2px',
              lineHeight:    '1.5',
              opacity:       homepageIntelligenceLine.trigger ? 1 : 0.7,
              transition:    'opacity 0.4s ease',
              ...(homepageIntelligenceLine.trigger ? {
                textDecoration: 'underline',
                textDecorationColor: scene.lightText ? 'rgba(252,246,234,0.18)' : 'rgba(40,30,20,0.15)',
                textUnderlineOffset: '3px',
              } : {}),
            }}>
              {homepageIntelligenceLine.text}
            </span>
          </div>
        )}

        {/* ── ERROR STATE ─────────────────────────── */}
        {fetchError && !data && (
          <div
            style={{
              display:        'flex',
              flexDirection:  'column',
              alignItems:     'center',
              justifyContent: 'center',
              gap:            12,
              pointerEvents:  'auto',
              marginTop:      32,
              ...anim(0.23),
            }}
          >
            <div style={{
              fontFamily:   "'Cormorant Garamond', serif",
              fontSize:     20,
              fontWeight:   300,
              color:        textPrimary,
              textAlign:    'center',
            }}>
              Couldn&apos;t load your data.
            </div>
            <button
              onClick={() => {
                setFetchError(false);
                setLoading(true);
                setHomeRefreshKey(k => k + 1);
              }}
              style={{
                background:    'none',
                border:        'none',
                cursor:        'pointer',
                fontSize:      13,
                fontWeight:    400,
                color:         textSecondary,
                fontFamily:    "'DM Sans', sans-serif",
                padding:       '8px 16px',
              }}
            >
              Tap to retry.
            </button>
          </div>
        )}
      </div>

      {/* ── CONTROL SURFACE ────────────────────────── */}
      <ControlSurface
        open={controlOpen}
        onClose={() => setControlOpen(false)}
        allDeals={data?.allDeals ?? []}
        urgentDeals={data?.urgentDeals ?? []}
        meetings={data?.meetings ?? []}
      />

      {/* ── UNIFIED INTERACTION BAR (control entry + chat entry) ───────── */}
      {!chatOpen && (
        <div
          style={{
            position:       'fixed',
            bottom:         'calc(env(safe-area-inset-bottom, 0px) + 14px)',
            left:           0,
            right:          0,
            display:        'flex',
            justifyContent: 'center',
            zIndex:         25,
            pointerEvents:  'none',
            opacity:        visible ? 1 : 0,
            transform:      visible ? 'translateY(0)' : 'translateY(12px)',
            transition:     `opacity 0.7s ease 0.32s, transform 0.7s cubic-bezier(.32,.72,0,1) 0.32s`,
          }}
        >
          <div
            style={{
              width:          '90%',
              maxWidth:       360,
              pointerEvents:  'auto',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
          <div
            style={{
              background:      'rgba(15,20,32,0.48)',
              backdropFilter:  'blur(32px) saturate(1.4)',
              WebkitBackdropFilter: 'blur(32px) saturate(1.4)',
              borderRadius:    22,
              border:          '0.5px solid rgba(240,235,224,0.11)',
              borderTop:       '0.5px solid rgba(240,235,224,0.16)',
              padding:         '5px 5px 5px 5px',
              display:         'flex',
              alignItems:      'center',
              gap:             0,
              boxShadow:       '0 4px 24px rgba(0,0,0,0.22), 0 0.5px 0 rgba(240,235,224,0.04) inset',
            }}
          >
            {/* Control surface entry — left side */}
            <div
              onClick={() => setControlOpen(true)}
              onPointerDown={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(0.88)'; }}
              onPointerUp={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
              onPointerLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
              style={{
                width:          36,
                height:         36,
                borderRadius:   12,
                display:        'flex',
                alignItems:     'center',
                justifyContent: 'center',
                cursor:         'pointer',
                flexShrink:     0,
                transition:     'transform 0.15s ease, background 0.15s ease',
                background:     'rgba(240,235,224,0.09)',
              }}
              aria-label="Open overview"
            >
              <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
                <rect x="2" y="2" width="5.5" height="5.5" rx="1.5" stroke="rgba(240,235,224,0.55)" strokeWidth="1.1" />
                <rect x="10.5" y="2" width="5.5" height="5.5" rx="1.5" stroke="rgba(240,235,224,0.55)" strokeWidth="1.1" />
                <rect x="2" y="10.5" width="5.5" height="5.5" rx="1.5" stroke="rgba(240,235,224,0.55)" strokeWidth="1.1" />
                <rect x="10.5" y="10.5" width="5.5" height="5.5" rx="1.5" stroke="rgba(240,235,224,0.55)" strokeWidth="1.1" />
              </svg>
            </div>

            {/* Chat entry — tappable area fills remaining space */}
            <div
              onClick={openChat}
              onPointerDown={(e) => { (e.currentTarget as HTMLElement).style.opacity = '0.7'; }}
              onPointerUp={(e) => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
              onPointerLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
              style={{
                flex:           1,
                padding:        '9px 14px',
                cursor:         'pointer',
                transition:     'opacity 0.15s ease',
              }}
            >
              <span
                style={{
                  fontFamily:    "'DM Sans', sans-serif",
                  fontSize:      14,
                  fontWeight:    300,
                  color:         'rgba(240,235,224,0.42)',
                  letterSpacing: '0.15px',
                }}
              >
                What&apos;s on your mind?
              </span>
            </div>
          </div>
        </div>
        </div>
      )}

      {/* ── CHAT BOTTOM SHEET ──────────────────────── */}
      {chatOpen && (
        <>
          {/* Backdrop */}
          <div
            onClick={closeChat}
            style={{
              position:       'fixed',
              inset:          0,
              zIndex:         290,
              background:     chatSheetVisible ? 'rgba(4,8,14,0.55)' : 'rgba(4,8,14,0)',
              backdropFilter: chatSheetVisible ? 'blur(14px)' : 'blur(0px)',
              WebkitBackdropFilter: chatSheetVisible ? 'blur(14px)' : 'blur(0px)',
              transition:     'background 0.32s ease, backdrop-filter 0.32s ease, -webkit-backdrop-filter 0.32s ease',
            }}
          />

          {/* Sheet */}
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position:       'fixed',
              bottom:         0,
              left:           0,
              right:          0,
              zIndex:         300,
              maxHeight:      '88dvh',
              display:        'flex',
              flexDirection:  'column',
              background:     'rgba(13,17,28,0.92)',
              backdropFilter: 'blur(40px) saturate(1.3)',
              WebkitBackdropFilter: 'blur(40px) saturate(1.3)',
              borderRadius:   '22px 22px 0 0',
              borderTop:      '0.5px solid rgba(240,235,224,0.10)',
              boxShadow:      '0 -4px 32px rgba(0,0,0,0.22), 0 -0.5px 0 rgba(240,235,224,0.04) inset',
              transform:      chatSheetVisible ? 'translateY(0)' : 'translateY(100%)',
              transition:     'transform 0.32s cubic-bezier(.32,.72,0,1)',
              fontFamily:     "'DM Sans', sans-serif",
            }}
          >
            {/* Handle + close affordance */}
            <div
              style={{
                display:        'flex',
                justifyContent: 'center',
                paddingTop:     12,
                paddingBottom:  8,
                flexShrink:     0,
              }}
            >
              <div
                onClick={closeChat}
                style={{
                  width:        36,
                  height:       4,
                  borderRadius: 2,
                  background:   'rgba(240,235,224,0.14)',
                  cursor:       'pointer',
                }}
              />
            </div>

            {/* Conversation area */}
            <div
              ref={chatScrollRef}
              style={{
                flex:         1,
                overflowY:    'auto',
                padding:      '0 20px 12px',
                minHeight:    0,
              }}
            >
              {/* Empty state — no separate prompt; input placeholder serves as the sole CTA */}
              {chatMessages.length === 0 && (
                <div style={{ paddingTop: 48, paddingBottom: 48 }} />
              )}

              {chatMessages.map((msg) => (
                <div key={msg.id}>
                  <div
                    style={{
                      display:       'flex',
                      justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                      marginBottom:  msg.uiMode ? 4 : 10,
                    }}
                  >
                    <div
                      style={{
                        maxWidth:     '80%',
                        padding:      '10px 14px',
                        borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                        background:   msg.role === 'user'
                          ? 'rgba(232,160,48,0.14)'
                          : 'rgba(240,235,224,0.06)',
                        border:       msg.role === 'user'
                          ? '0.5px solid rgba(232,160,48,0.18)'
                          : '0.5px solid rgba(240,235,224,0.06)',
                        fontSize:     14,
                        fontWeight:   300,
                        lineHeight:   1.55,
                        color:        msg.role === 'user'
                          ? 'rgba(252,246,234,0.92)'
                          : 'rgba(240,235,224,0.72)',
                      }}
                    >
                      {msg.role === 'assistant' ? renderMarkdown(msg.content) : msg.content}
                    </div>
                  </div>

                  {/* ── DEAL PICKER (clarification UI) ──────────── */}
                  {msg.uiMode === 'deal_picker' && pendingClarificationRef.current && (
                    <div style={{ marginBottom: 10, paddingLeft: 4 }}>
                      <div style={{
                        maxHeight: 160,
                        overflowY: 'auto',
                        marginBottom: 6,
                      }}>
                        {(data?.allDeals ?? []).map((d) => (
                          <button
                            key={d.id}
                            onClick={() => handleClarificationResponse(d.id)}
                            disabled={chatProcessing}
                            style={{
                              width:        '100%',
                              display:      'block',
                              textAlign:    'left',
                              background:   'rgba(16,20,30,0.6)',
                              border:       '0.5px solid rgba(232,160,48,0.15)',
                              borderRadius: 10,
                              padding:      '9px 13px',
                              marginBottom: 4,
                              cursor:       'pointer',
                              fontFamily:   "'DM Sans', sans-serif",
                              transition:   'border-color 0.15s',
                            }}
                          >
                            <span style={{ fontSize: 13, fontWeight: 400, color: 'rgba(252,246,234,0.88)' }}>
                              {d.name}
                            </span>
                            {d.accounts?.name && (
                              <span style={{ fontSize: 12, fontWeight: 300, color: 'rgba(240,235,224,0.45)', marginLeft: 6 }}>
                                &middot; {d.accounts.name}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={() => handleClarificationResponse(null)}
                        disabled={chatProcessing}
                        style={{
                          background: 'none',
                          border:     'none',
                          color:      'rgba(240,235,224,0.36)',
                          fontSize:   12,
                          fontWeight: 400,
                          cursor:     'pointer',
                          fontFamily: "'DM Sans', sans-serif",
                          padding:    '4px 0',
                        }}
                      >
                        Save without a deal
                      </button>
                    </div>
                  )}

                  {/* ── NEW DEAL CONFIRMATION ───────────────────── */}
                  {msg.uiMode === 'new_deal_confirm' && newDealForm && (
                    <div style={{ marginBottom: 10, paddingLeft: 4 }}>
                      {/* Yes / No buttons */}
                      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                        <button
                          onClick={() => {
                            // Show inline form
                            setChatMessages(prev => prev.map(m =>
                              m.id === msg.id ? { ...m, uiMode: 'new_deal_form' } : m
                            ));
                          }}
                          style={{
                            flex:         1,
                            padding:      '10px 0',
                            borderRadius: 10,
                            border:       '0.5px solid rgba(232,160,48,0.3)',
                            background:   'rgba(232,160,48,0.1)',
                            color:        'rgba(252,246,234,0.88)',
                            fontSize:     13,
                            fontWeight:   500,
                            cursor:       'pointer',
                            fontFamily:   "'DM Sans', sans-serif",
                          }}
                        >
                          Yes, create it
                        </button>
                        <button
                          onClick={async () => {
                            // Save as general intel instead
                            setNewDealForm(null);
                            setChatMessages(prev => prev.map(m =>
                              m.id === msg.id ? { ...m, uiMode: undefined } : m
                            ));
                            await chatSaveInteraction(newDealForm.originalText, null, 'note', {
                              intentType: 'general_intel',
                              routingConfidence: 1,
                              routingMetadata: {
                                classifierBucket: 'new_deal',
                                routingPath: 'user_clarified',
                                ambiguityNotes: 'User declined new deal creation, saved as general intel',
                              },
                            });
                            setChatMessages(prev => [...prev, {
                              id: `msg-${++chatIdCounter.current}`,
                              role: 'assistant',
                              content: 'Saved.',
                              saved: true,
                            }]);
                          }}
                          style={{
                            flex:         1,
                            padding:      '10px 0',
                            borderRadius: 10,
                            border:       '0.5px solid rgba(240,235,224,0.08)',
                            background:   'rgba(240,235,224,0.04)',
                            color:        'rgba(240,235,224,0.5)',
                            fontSize:     13,
                            fontWeight:   400,
                            cursor:       'pointer',
                            fontFamily:   "'DM Sans', sans-serif",
                          }}
                        >
                          No, just save it
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ── NEW DEAL INLINE FORM ────────────────────── */}
                  {msg.uiMode === 'new_deal_form' && newDealForm && (
                    <div style={{ marginBottom: 10, paddingLeft: 4 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
                        <input
                          type="text"
                          placeholder="Deal name *"
                          value={newDealForm.dealName}
                          onChange={(e) => setNewDealForm(prev => prev ? { ...prev, dealName: e.target.value } : prev)}
                          style={{
                            width:        '100%',
                            background:   'rgba(16,20,30,0.6)',
                            border:       '0.5px solid rgba(232,160,48,0.22)',
                            borderRadius: 10,
                            padding:      '10px 13px',
                            fontFamily:   "'DM Sans', sans-serif",
                            fontSize:     13,
                            fontWeight:   300,
                            color:        'rgba(252,246,234,0.92)',
                            outline:      'none',
                          }}
                        />
                        <input
                          type="text"
                          placeholder="Account name *"
                          value={newDealForm.accountName}
                          onChange={(e) => setNewDealForm(prev => prev ? { ...prev, accountName: e.target.value } : prev)}
                          style={{
                            width:        '100%',
                            background:   'rgba(16,20,30,0.6)',
                            border:       '0.5px solid rgba(232,160,48,0.22)',
                            borderRadius: 10,
                            padding:      '10px 13px',
                            fontFamily:   "'DM Sans', sans-serif",
                            fontSize:     13,
                            fontWeight:   300,
                            color:        'rgba(252,246,234,0.92)',
                            outline:      'none',
                          }}
                        />
                        <input
                          type="text"
                          placeholder="Value (optional)"
                          value={newDealForm.value}
                          onChange={(e) => setNewDealForm(prev => prev ? { ...prev, value: e.target.value } : prev)}
                          style={{
                            width:        '100%',
                            background:   'rgba(16,20,30,0.6)',
                            border:       '0.5px solid rgba(240,235,224,0.1)',
                            borderRadius: 10,
                            padding:      '10px 13px',
                            fontFamily:   "'DM Sans', sans-serif",
                            fontSize:     13,
                            fontWeight:   300,
                            color:        'rgba(252,246,234,0.92)',
                            outline:      'none',
                          }}
                        />
                      </div>
                      <button
                        onClick={handleNewDealCreate}
                        disabled={!newDealForm.dealName.trim() || !newDealForm.accountName.trim() || chatProcessing}
                        style={{
                          width:        '100%',
                          padding:      '11px 0',
                          borderRadius: 10,
                          border:       'none',
                          background:   newDealForm.dealName.trim() && newDealForm.accountName.trim() && !chatProcessing
                            ? 'linear-gradient(135deg, #C87820, #E09838)'
                            : 'rgba(255,255,255,0.06)',
                          color:        newDealForm.dealName.trim() && newDealForm.accountName.trim() && !chatProcessing
                            ? 'white'
                            : 'rgba(240,235,224,0.36)',
                          fontSize:     12,
                          fontWeight:   600,
                          cursor:       newDealForm.dealName.trim() && newDealForm.accountName.trim() && !chatProcessing
                            ? 'pointer'
                            : 'default',
                          fontFamily:   "'DM Sans', sans-serif",
                          transition:   'all 0.2s ease',
                        }}
                      >
                        {chatProcessing ? 'Creating...' : 'Create deal'}
                      </button>
                    </div>
                  )}
                </div>
              ))}

              {/* Session 7: Subtle typing indicator while processing (pre-stream) */}
              {chatProcessing && !chatStreaming && (
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

            {/* Input row */}
            <div
              style={{
                flexShrink:     0,
                padding:        '8px 16px',
                paddingBottom:  'calc(env(safe-area-inset-bottom, 0px) + 12px)',
                borderTop:      '0.5px solid rgba(240,235,224,0.06)',
              }}
            >
              <div
                style={{
                  display:      'flex',
                  alignItems:   'center',
                  gap:          10,
                  background:   'rgba(16,20,30,0.55)',
                  border:       '0.5px solid rgba(240,235,224,0.09)',
                  borderTop:    '0.5px solid rgba(240,235,224,0.13)',
                  borderRadius: 16,
                  padding:      '4px 6px 4px 16px',
                  boxShadow:    '0 1px 8px rgba(0,0,0,0.12), 0 0.5px 0 rgba(240,235,224,0.03) inset',
                }}
              >
                <input
                  ref={chatInputRef}
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleChatSubmit();
                    }
                    if (e.key === 'Escape') {
                      closeChat();
                    }
                  }}
                  placeholder="What's on your mind?"
                  style={{
                    flex:        1,
                    background:  'transparent',
                    border:      'none',
                    outline:     'none',
                    fontSize:    14,
                    fontWeight:  300,
                    color:       'rgba(252,246,234,0.92)',
                    fontFamily:  "'DM Sans', sans-serif",
                    padding:     '10px 0',
                  }}
                />
                <button
                  onClick={handleChatSubmit}
                  disabled={!chatInput.trim() || chatProcessing || chatStreaming}
                  style={{
                    width:        36,
                    height:       36,
                    borderRadius: 12,
                    border:       'none',
                    background:   chatInput.trim() && !chatProcessing && !chatStreaming
                      ? 'linear-gradient(135deg, #C87820, #E09838)'
                      : 'rgba(255,255,255,0.04)',
                    color:        chatInput.trim() && !chatProcessing && !chatStreaming
                      ? 'white'
                      : 'rgba(240,235,224,0.22)',
                    fontSize:     16,
                    cursor:       chatInput.trim() && !chatProcessing && !chatStreaming ? 'pointer' : 'default',
                    display:      'flex',
                    alignItems:   'center',
                    justifyContent: 'center',
                    transition:   'all 0.2s ease',
                    flexShrink:   0,
                    boxShadow:    chatInput.trim() && !chatProcessing && !chatStreaming
                      ? '0 1px 6px rgba(200,120,32,0.3)'
                      : 'none',
                  }}
                  aria-label="Send message"
                >
                  {chatProcessing || chatStreaming ? (
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
        </>
      )}

      {/* ── FIRST VISIT OVERLAY ───────────────── */}
      {firstVisitVisible && (
        <div style={{
          position:       'fixed',
          inset:          0,
          zIndex:         200,
          background:     '#060a12',
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          opacity:        firstVisitOpacity,
          transition:     'opacity 0.7s ease',
          pointerEvents:  firstVisitOpacity < 1 ? 'none' : 'auto',
        }}>
          <Logo light size={48} showWordmark />
        </div>
      )}


      {/* ── BIRD CAPTURE MODAL ──────────────────────── */}
      {birdModalOpen && birdQuestion && (
        <>
          {/* Backdrop — tap to dismiss */}
          <div
            onClick={() => {
              setBirdModalOpen(false);
              setBirdModalInput('');
              setBirdDealGate(false);
            }}
            style={{
              position:       'fixed',
              inset:          0,
              zIndex:         290,
              background:     'rgba(13,15,18,0.6)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
            }}
          />

          {/* Modal — centered on screen */}
          <div
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setBirdModalOpen(false);
                setBirdModalInput('');
                setBirdDealGate(false);
              }
            }}
            style={{
              position:       'fixed',
              top:            '50%',
              left:           '50%',
              transform:      'translate(-50%, -50%)',
              zIndex:         300,
              width:          'calc(100% - 48px)',
              maxWidth:       340,
              background:     '#0f1420',
              borderRadius:   18,
              border:         '0.5px solid rgba(232,160,48,0.18)',
              padding:        '22px 20px 18px',
              fontFamily:     "'DM Sans', sans-serif",
            }}
          >
            {/* Question */}
            <div style={{
              fontFamily:   "'Cormorant Garamond', serif",
              fontSize:     18,
              fontWeight:   400,
              color:        'rgba(252,246,234,0.88)',
              lineHeight:   1.4,
              marginBottom: 14,
            }}>
              {birdQuestion.text}
            </div>

            {/* Input + Submit — hidden when deal gate is active */}
            {!birdDealGate && (
              <>
                <textarea
                  ref={birdModalInputRef}
                  value={birdModalInput}
                  onChange={(e) => setBirdModalInput(e.target.value)}
                  placeholder="Type anything..."
                  style={{
                    width:        '100%',
                    background:   'rgba(16,20,30,0.6)',
                    border:       '0.5px solid rgba(232,160,48,0.22)',
                    borderRadius: 12,
                    padding:      '12px 14px',
                    fontFamily:   "'DM Sans', sans-serif",
                    fontSize:     14,
                    fontWeight:   300,
                    color:        'rgba(252,246,234,0.92)',
                    outline:      'none',
                    resize:       'none',
                    minHeight:    80,
                    lineHeight:   1.6,
                    marginBottom: 12,
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = 'rgba(232,160,48,0.44)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = 'rgba(232,160,48,0.22)';
                  }}
                />

                {/* Submit button */}
                <button
                  onClick={handleBirdSubmit}
                  disabled={!birdModalInput.trim() || birdModalSaving}
                  style={{
                    width:           '100%',
                    padding:         '12px 0',
                    borderRadius:    10,
                    border:          'none',
                    background:      birdModalInput.trim() && !birdModalSaving
                      ? 'linear-gradient(135deg, #C87820, #E09838)'
                      : 'rgba(255,255,255,0.06)',
                    color:           birdModalInput.trim() && !birdModalSaving
                      ? 'white'
                      : 'rgba(240,235,224,0.36)',
                    fontSize:        12,
                    fontWeight:      600,
                    cursor:          birdModalInput.trim() && !birdModalSaving
                      ? 'pointer'
                      : 'default',
                    fontFamily:      "'DM Sans', sans-serif",
                    transition:      'all 0.2s ease',
                    boxShadow:       birdModalInput.trim() && !birdModalSaving
                      ? '0 4px 14px rgba(200,120,32,0.28)'
                      : 'none',
                  }}
                >
                  {birdModalSaving ? 'Saving...' : 'Save \u2192'}
                </button>
              </>
            )}

            {/* ── BIRD DEAL ASSIGNMENT GATE ── */}
            {birdDealGate && data && (
              <>
                <p
                  style={{
                    fontSize:     13,
                    fontWeight:   300,
                    color:        'rgba(240,235,224,0.5)',
                    marginBottom: 12,
                    fontFamily:   "'DM Sans', sans-serif",
                  }}
                >
                  Add to a deal?
                </p>

                <div
                  style={{
                    maxHeight:  180,
                    overflowY:  'auto',
                    marginBottom: 12,
                  }}
                >
                  {data.allDeals.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => executeBirdSave(d.id)}
                      style={{
                        width:        '100%',
                        display:      'block',
                        textAlign:    'left',
                        background:   'rgba(16,20,30,0.6)',
                        border:       '0.5px solid rgba(232,160,48,0.15)',
                        borderRadius: 10,
                        padding:      '10px 14px',
                        marginBottom: 5,
                        cursor:       'pointer',
                        fontFamily:   "'DM Sans', sans-serif",
                        transition:   'border-color 0.15s',
                      }}
                    >
                      <span
                        style={{
                          fontSize:   13,
                          fontWeight: 400,
                          color:      'rgba(252,246,234,0.88)',
                        }}
                      >
                        {d.name}
                      </span>
                      {d.accounts?.name && (
                        <span
                          style={{
                            fontSize:   12,
                            fontWeight: 300,
                            color:      'rgba(240,235,224,0.45)',
                            marginLeft: 6,
                          }}
                        >
                          &middot; {d.accounts.name}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => executeBirdSave(null)}
                  style={{
                    width:      '100%',
                    padding:    '8px 0',
                    background: 'none',
                    border:     'none',
                    color:      'rgba(240,235,224,0.36)',
                    fontSize:   12,
                    fontWeight: 400,
                    cursor:     'pointer',
                    fontFamily: "'DM Sans', sans-serif",
                  }}
                >
                  Skip &mdash; save without a deal
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
