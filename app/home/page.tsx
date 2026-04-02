'use client';

import { useState, useEffect, useCallback, useRef, useReducer, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import SceneBackground from '@/components/home/SceneBackground';
import type { CelestialPosition } from '@/components/home/SceneBackground';
import AmbientBird from '@/components/home/AmbientBird';
import ControlSurface from '@/components/home/ControlSurface';
import FocusOverlay from '@/components/home/FocusOverlay';
import UniversalCapture from '@/components/capture/UniversalCapture';
import type { CaptureSubmitPayload, CaptureContext } from '@/lib/universal-capture-types';
import { useUniversalCapture } from '@/lib/universal-capture-state';
import FullScreenChat from '@/components/home/FullScreenChat';
import type { ChatThread } from '@/components/home/FullScreenChat';
import { ChatControllerProvider, useChatController } from '@/components/chat/ChatController';
import type { ChatMessage } from '@/components/chat/ChatController';
import { SurfaceProvider, useSurface } from '@/components/surfaces/SurfaceManager';
import SurfaceRenderer from '@/components/surfaces/SurfaceRenderer';
// Logo removed — Session 4: world-first homepage, no app chrome
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
// renderMarkdown moved to FullScreenChat component (Session 15B)
import { useMeetingStore } from '@/lib/meeting-store';
import { detectMeetingMutation, applyMeetingMutation } from '@/lib/meeting-mutations';
import { usePrioritization } from '@/lib/prioritization/usePrioritization';
import { routeUniversalIntent } from '@/lib/universal-routing';
import {
  createTaskFromIntent,
  createItemFromIntent,
  findOrCreatePerson,
  createEventFromIntent,
} from '@/lib/universal-persistence';
import { createUserTask } from '@/lib/task-persistence';
// Session 2: Intent resolution + execution layer
import { resolveIntent } from '@/lib/intent/resolveIntent';
import { executeIntent, executeConsequencePlan } from '@/lib/intent/executeIntent';
import { generateFeedback } from '@/lib/intent/generateFeedback';
import { planConsequences, logConsequencePlan } from '@/lib/intent/planConsequences';
import type { ContextEntityState } from '@/lib/intent/planConsequences';
import { useCompletedTodayCount, useWhatMattersTasks } from '@/lib/task-queries';
import { useActiveItems } from '@/lib/hooks/useItems';
import { usePeople } from '@/lib/hooks/usePeople';
import { useDailyLoop, markSessionOpen } from '@/lib/daily-loop';
// Session 15B: Chat ingestion — capture-worthy detection
import { ingestChatMessage } from '@/lib/chat/ingest';
// Session 17A: Reflection-driven state updates (replaces arbitrary timeouts)
import { emitReflection, onReflection } from '@/lib/chat/reflection';

// ── TYPES ──────────────────────────────────────────────────
type DealWithAccount = DealRow & { accounts: { name: string } | null };

// ChatMessage and ChatSaveState types moved to ChatController (Session 17B)

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
  return (
    <SurfaceProvider>
      <ChatControllerProvider>
        <HomePageInner />
      </ChatControllerProvider>
    </SurfaceProvider>
  );
}

function HomePageInner() {
  const router   = useRouter();
  const supabase = createClient();
  const { navigateTo: surfaceNavigateTo } = useSurface();

  // ── SESSION 17B: Chat state from isolated controller (no rerenders to parent) ──
  const {
    chatOpen, setChatOpen,
    chatMessages, setChatMessages,
    chatInput, setChatInput,
    chatProcessing, setChatProcessing,
    chatStreaming, setChatStreaming,
    chatThreads, setChatThreads,
    activeThreadId, setActiveThreadId,
    newDealForm, setNewDealForm,
    chatInputRef, chatScrollRef,
    chatIdCounter, chatSaveStateRef,
    chatThreadIdRef, pendingClarificationRef,
  } = useChatController();

  const [data, setData]       = useState<HomeData | null>(null);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [time, setTime]       = useState(formatTime());
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [homeRefreshKey, setHomeRefreshKey] = useState(0);

  // ── SESSION 17B: DEBOUNCED REFRESH KEY ──────────────────
  // Single debounced updater prevents multiple Supabase fetch bursts
  // from overlapping reflection events and setTimeout calls.
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      setHomeRefreshKey(k => k + 1);
      refreshTimerRef.current = null;
    }, 250);
  }, []);
  // logoBloom removed — Session 4

  // ── CONTROL SURFACE STATE ──────────────────────────────
  const [controlOpen, setControlOpen] = useState(false);

  // Session 14E: Progress tracking
  const { count: completedTodayCount } = useCompletedTodayCount(data?.user?.id ?? null);

  // ── SESSION 9: ITEMS + PEOPLE READ HOOKS ──────────────────
  const { items: activeItems } = useActiveItems(data?.user?.id ?? null);
  const { people } = usePeople(data?.user?.id ?? null);

  // ── SESSION 14F: DAILY LOOP — pending task count for loop awareness ──
  const { tasks: loopTasks } = useWhatMattersTasks(data?.user?.id ?? null, 10);
  const pendingTaskCount = loopTasks.length;
  const urgentItemCount = (data?.urgentDeals?.length ?? 0)
    + loopTasks.filter(t => t.dueAt && new Date(t.dueAt).getTime() < Date.now()).length;
  const dailyLoop = useDailyLoop(pendingTaskCount, urgentItemCount);

  // ── SESSION 5 + 9: TRUTH ENGINE + PRIORITIZATION ──────────
  // Session 9: Real items and people now fed into truth engine.
  const { prioritization, sunTruth } = usePrioritization({
    tasks: loopTasks,
    items: activeItems,
    people,
    meetings: data?.meetings ?? [],
  });

  // ── SESSION 17B: PAGE VISIBILITY — pause expensive loops when hidden ──
  const [pageVisible, setPageVisible] = useState(true);
  useEffect(() => {
    const handleVisibility = () => setPageVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  // ── SESSION 13A: FOCUS OVERLAY STATE ────────────────────
  const [focusOverlayOpen, setFocusOverlayOpen] = useState(false);

  // ── CELESTIAL POSITION (single source of truth from SceneBackground) ──
  const [celestialPos, setCelestialPos] = useState<CelestialPosition>({
    x: '50%', y: '50%', isMoon: false, size: 0,
  });

  // ── BIRD INTERACTION STATE ──────────────────────────────────
  const [birdPulseTrigger, setBirdPulseTrigger] = useState(0);
  const birdPositionRef = useRef({ x: 0, y: 0 });
  const birdHitboxRef = useRef<HTMLDivElement>(null);

  // ── SESSION 18: UNIVERSAL CAPTURE STATE ─────────────────────
  const universalCapture = useUniversalCapture();
  const [captureSaving, setCaptureSaving] = useState(false);

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

  // ── SESSION 6: FIRST-USE HINT SYSTEM (behavioral, no UI) ──
  // Tracks which subtle hints have fired this session (not persisted across sessions
  // except for the first-ever visit). These hints amplify existing animations briefly.
  const hintStateRef = useRef({
    /** True if this is the very first app load ever */
    isFirstEverVisit: typeof window !== 'undefined'
      ? localStorage.getItem('jove_first_visit_shown') !== 'true'
      : false,
    /** Sun hint: stronger initial pulse (fires once per session on first load) */
    sunHintFired: false,
    /** Bird hint: brief emphasis when bird first becomes interactive */
    birdHintFired: false,
    /** Chat hint: subtle prominence boost after idle (~4s without interaction) */
    chatHintFired: false,
    /** Timestamp of page becoming visible */
    pageVisibleAt: 0,
  });
  const [sunFirstUseHint, setSunFirstUseHint] = useState(false);
  const [birdFirstUseHint, setBirdFirstUseHint] = useState(false);
  const [chatBarHint, setChatBarHint] = useState(false);
  // Session 13C: Bird discovery pulse — draws attention on first app load (5s)
  const [birdDiscoverPulse, setBirdDiscoverPulse] = useState(false);
  // Session 13C: "Anything else?" hint — shown once after first bird capture
  const [anythingElseHint, setAnythingElseHint] = useState(false);
  const anythingElseShownRef = useRef(false);

  // ── TOUR REFS ────────────────────────────────────────────
  const sunRef     = useRef<HTMLDivElement>(null);
  // logoRef removed — Session 4

  // ── CHAT STATE (Session 17B: moved to ChatController for isolation) ──
  // All chat state is now accessed via useChatController() above.

  const openChat = useCallback(() => {
    setChatOpen(true);
  }, []);

  const closeChat = useCallback(() => {
    const hadSave = chatSaveStateRef.current.hasSaved;
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── SESSION 15B: Thread management ──────────────────────────
  const handleNewThread = useCallback(() => {
    const newThreadId = generateThreadId('home_chat');
    chatThreadIdRef.current = newThreadId;
    setActiveThreadId(newThreadId);
    setChatMessages([]);
    // Register the new thread
    if (data?.user) {
      registerChatThread(supabase, {
        threadId: newThreadId,
        userId: data.user.id,
        sourceSurface: 'home_chat',
      });
    }
    // Add to thread list
    setChatThreads(prev => [{
      id: newThreadId,
      title: 'New thread',
      createdAt: new Date().toISOString(),
      messageCount: 0,
    }, ...prev]);
  }, [data, supabase]);

  const handleThreadSelect = useCallback((threadId: string) => {
    chatThreadIdRef.current = threadId;
    setActiveThreadId(threadId);
    // For now, clear messages when switching threads
    // Future: load messages from DB
    setChatMessages([]);
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
        // Session 17A: Trigger immediate reflection instead of arbitrary 3s delay.
        // The reflection event bus notifies subscribers (control panel, sun)
        // to re-fetch data. This ensures consistent state without guessing timing.
        emitReflection('interaction:created');
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
            ? { ...m, content: "Something went wrong. Try again." }
            : m
        ));
        setChatStreaming(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';

      // Session 17B: Update only the last message (the streaming one)
      // instead of .map() over the entire array per chunk.
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        const current = accumulated;
        setChatMessages(prev => {
          const last = prev[prev.length - 1];
          if (last && last.id === assistantMsgId) {
            // Shallow-clone only the last element, reuse the rest
            const updated = [...prev];
            updated[updated.length - 1] = { ...last, content: current };
            return updated;
          }
          // Fallback: full scan (shouldn't happen)
          return prev.map(m =>
            m.id === assistantMsgId ? { ...m, content: current } : m
          );
        });
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
          // Session 17A: Use reflection instead of arbitrary timeout
          emitReflection('interaction:created');
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

      // ── SESSION 7: MEETING MUTATION DETECTION ─────────────────
      // Before full classification, check if user is mutating meeting state.
      // This layer intercepts cancel/complete/move intents.
      const meetingMutation = detectMeetingMutation(text);
      if (meetingMutation) {
        const result = applyMeetingMutation(meetingMutation);

        // Stream a conversational response with grounded awareness
        const history = [...previousMessages, { role: 'user' as const, content: text }];
        await streamAssistantResponse(history, result.meetingId ? undefined : null, {
          classification: `meeting_mutation_${meetingMutation.type}`,
          actionTaken: result.success ? 'saved' : 'none',
          linkedDealId: result.meetingId
            ? useMeetingStore.getState().getMeetingById(result.meetingId)?.dealId ?? null
            : null,
        });

        // Trigger data refresh so UI updates
        setHomeRefreshKey(k => k + 1);
        setChatProcessing(false);
        return;
      }

      // ── SESSION 12C: UNIVERSAL ROUTING — INSTANT VALUE ────────────
      // Before sales classification, check if the input creates a universal
      // primitive (task, item, event). If so, create it immediately and
      // confirm — no classification, no clarification, no friction.
      const universalResult = routeUniversalIntent(text);
      if (universalResult) {
        if (universalResult.intent === 'create_task' && universalResult.task) {
          // Create task in DB immediately
          const taskResult = await createUserTask(supabase, data.user.id, {
            title: universalResult.task.title,
            dueAt: universalResult.task.dueAt ?? undefined,
          });

          if (taskResult) {
            // Build confirmation message — minimal, calm, no explanation
            const timePart = universalResult.task.dueAt
              ? (() => {
                  const d = new Date(universalResult.task.dueAt!);
                  const now = new Date();
                  const isToday = d.toDateString() === now.toDateString();
                  const tomorrow = new Date(now);
                  tomorrow.setDate(tomorrow.getDate() + 1);
                  const isTomorrow = d.toDateString() === tomorrow.toDateString();
                  if (isToday) return ' for today';
                  if (isTomorrow) return ' for tomorrow';
                  return '';
                })()
              : '';
            addAndPersistAssistantMessage(`Got it — I added that${timePart}.`);
            chatSaveStateRef.current.hasSaved = true;
            // Refresh so task appears in What Matters
            debouncedRefresh();
          } else {
            addAndPersistAssistantMessage("Got it — I saved that.");
          }
          setChatProcessing(false);
          return;
        }

        if (universalResult.intent === 'create_event' && universalResult.event) {
          // Events also become tasks with a time
          const taskResult = await createUserTask(supabase, data.user.id, {
            title: universalResult.event.title,
            dueAt: universalResult.event.scheduledAt ?? undefined,
          });

          if (taskResult) {
            addAndPersistAssistantMessage(`Got it — ${universalResult.event.title} is on your list.`);
            chatSaveStateRef.current.hasSaved = true;
            debouncedRefresh();
          } else {
            addAndPersistAssistantMessage("Got it — I saved that.");
          }
          setChatProcessing(false);
          return;
        }

        if (universalResult.intent === 'create_item' && universalResult.item) {
          // Save as a note for now — items are tracked but not yet fully surfaced
          await chatSaveInteraction(text, null, 'note', {
            intentType: 'general_intel',
            routingConfidence: 1,
            routingMetadata: {
              classifierBucket: 'universal_item' as any,
              routingPath: 'auto',
            },
          });
          addAndPersistAssistantMessage(`Got it — I'm tracking that.`);
          setChatProcessing(false);
          return;
        }
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
            'Should I track this as something you\u2019re working on?',
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

  // Session 17B: Scroll removed — FullScreenChat owns its own scroll effect.
  // Having both caused double-scroll during streaming.

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

  // ── SESSION 6: FIRST-USE BEHAVIORAL HINTS ──────────────────
  // Sun hint: on first load, use a slightly stronger glow for 2 cycles (~8s)
  // Session 13C: Bird discovery pulse — runs in parallel with sun hint
  useEffect(() => {
    if (hintStateRef.current.sunHintFired) return;
    hintStateRef.current.sunHintFired = true;
    hintStateRef.current.pageVisibleAt = Date.now();
    setSunFirstUseHint(true);
    // Session 13C: Bird discovery pulse — slightly delayed to stagger with sun
    const birdDelay = setTimeout(() => setBirdDiscoverPulse(true), 800);
    // Revert to normal glow after ~8 seconds (sun) and ~5 seconds (bird)
    const t = setTimeout(() => setSunFirstUseHint(false), 8000);
    const birdRevert = setTimeout(() => setBirdDiscoverPulse(false), 5800);
    return () => { clearTimeout(t); clearTimeout(birdDelay); clearTimeout(birdRevert); };
  }, []);

  // Chat hint: if user hasn't interacted within ~4s, subtly boost chat bar
  useEffect(() => {
    if (hintStateRef.current.chatHintFired) return;
    const t = setTimeout(() => {
      if (hintStateRef.current.chatHintFired) return;
      hintStateRef.current.chatHintFired = true;
      setChatBarHint(true);
      // Revert after the settle animation plays (~1.2s)
      setTimeout(() => setChatBarHint(false), 1200);
    }, 4000);

    // If user opens chat or interacts before 4s, cancel
    const cancel = () => {
      clearTimeout(t);
      hintStateRef.current.chatHintFired = true;
    };
    window.addEventListener('pointerdown', cancel, { once: true });

    return () => {
      clearTimeout(t);
      window.removeEventListener('pointerdown', cancel);
    };
  }, []);

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


  // ── BIRD HITBOX TRACKING (Session 17B: paused when not visible/overlay open) ──
  const hitboxPaused = !pageVisible || chatOpen || universalCapture.state.open;
  useEffect(() => {
    if (hitboxPaused) return; // No RAF when paused
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
  }, [hitboxPaused]);

  // ── SESSION 13C: "Anything else?" hint after first bird capture ──
  useEffect(() => {
    // When universalCapture.state.open goes from true → false, check if first capture just happened
    if (!universalCapture.state.open && !anythingElseShownRef.current) {
      const hasCapture = typeof window !== 'undefined'
        ? localStorage.getItem('jove_bird_first_capture') === 'true'
        : false;
      const hasShownHint = typeof window !== 'undefined'
        ? localStorage.getItem('jove_anything_else_shown') === 'true'
        : false;
      if (hasCapture && !hasShownHint) {
        anythingElseShownRef.current = true;
        if (typeof window !== 'undefined') {
          localStorage.setItem('jove_anything_else_shown', 'true');
        }
        // Delay slightly so the capture overlay fully closes first
        const t = setTimeout(() => {
          setAnythingElseHint(true);
          setTimeout(() => setAnythingElseHint(false), 2500);
        }, 400);
        return () => clearTimeout(t);
      }
    }
  }, [universalCapture.state.open]);

  // ── SESSION 14F: MORNING CUE AUTO-DISMISS ───────────────
  // Dismiss morning cue when user first interacts with any surface.
  // Also auto-dismiss after 6 seconds if user just reads the screen.
  useEffect(() => {
    if (!dailyLoop.showMorningCue) return;
    const autoDismiss = setTimeout(() => {
      dailyLoop.dismissMorningCue();
    }, 6000);
    return () => clearTimeout(autoDismiss);
  }, [dailyLoop.showMorningCue, dailyLoop.dismissMorningCue]);

  // ── SESSION 14F: MIDDAY RE-ENTRY REFRESH ───────────────
  // When user returns to the app after being away, refresh data
  // so the panel feels alive and updated, not stale.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        markSessionOpen();
        // Refresh data on return
        setHomeRefreshKey(k => k + 1);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
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

      const rawMeetings = (meetingsRes.data ?? []) as MeetingRow[];

      setData({
        user:         userRes.data as UserRow | null,
        meetings:     rawMeetings,
        urgentDeals:  (urgentDealsRes.data ?? []) as unknown as DealWithAccount[],
        allDeals:     activeDeals,
        signals:      (signalRes.data ?? []) as SignalRow[],
        streakLogs:   (streakRes.data ?? []) as StreakLogRow[],
        accountCount: accountCountRes.count ?? 0,
      });

      // ── Session 7: Ingest meetings into central meeting store ──
      useMeetingStore.getState().ingestMeetings(rawMeetings);

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

  // ── SESSION 17A/17B: REFLECTION-DRIVEN HOME REFRESH (debounced) ──
  // Subscribe to reflection events so the home page stays consistent.
  // Session 17B: All events route through debouncedRefresh to prevent
  // multiple Supabase fetch bursts from overlapping events.
  useEffect(() => {
    const unsubs = [
      onReflection('extraction:complete', debouncedRefresh),
      onReflection('interaction:created', debouncedRefresh),
      onReflection('task:created', debouncedRefresh),
      onReflection('task:updated', debouncedRefresh),
      // Session 9: Items + People refresh
      onReflection('item:created', debouncedRefresh),
      onReflection('person:created', debouncedRefresh),
    ];
    return () => unsubs.forEach(u => u());
  }, [debouncedRefresh]);

  // ── CROSS-TAB ENVIRONMENTAL LISTENER (logo bloom removed — Session 4) ──
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'jove_bloom_trigger') {
        // Environmental response for cross-tab capture / Save to Jove
        triggerEnvironmentalAcknowledgment({ source: 'other' });
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

  // ── SESSION 6: Bird first-use hint — brief emphasis when bird first becomes interactive
  useEffect(() => {
    if (!birdQuestion || hintStateRef.current.birdHintFired) return;
    hintStateRef.current.birdHintFired = true;
    setBirdFirstUseHint(true);
    const t = setTimeout(() => setBirdFirstUseHint(false), 3000);
    return () => clearTimeout(t);
  }, [birdQuestion]);


// ── SESSION 18: UNIVERSAL CAPTURE SUBMIT ────────────────────
  // Routes input through universal routing (11F) → persists → triggers acknowledgment.
  // Now accepts CaptureSubmitPayload with context/confidence metadata.
  // Attribution rules:
  //   HIGH   → auto-attach silently
  //   MEDIUM → pass downstream, don't force
  //   LOW    → no attachment, pipeline resolves
  const handleUniversalCaptureSubmit = useCallback(async (payload: CaptureSubmitPayload) => {
    const text = payload.text;
    if (!data?.user) return;
    setCaptureSaving(true);

    try {
      const userId = data.user.id;

      // ── SESSION 2 + SESSION 4: Intent Resolution + Consequence Planning ──
      // Step 1: Classify the input using context metadata.
      const intent = resolveIntent({
        text,
        contextType: payload.contextType,
        contextId: payload.contextId ?? undefined,
        contextConfidence: payload.contextConfidence,
      });

      // Step 2: Plan consequences (Session 4).
      // Build entity state from available context for richer consequence planning.
      let entityState: ContextEntityState | undefined;
      if (payload.contextId) {
        entityState = {
          contextType: payload.contextType,
          contextId: payload.contextId,
        };

        // Enrich with related entity info if context is a task
        if (payload.contextType === 'task') {
          const { data: taskData } = await supabase
            .from('tasks')
            .select('item_id, meeting_id, status')
            .eq('id', payload.contextId)
            .eq('user_id', userId)
            .maybeSingle();
          if (taskData) {
            entityState.linkedItemId = taskData.item_id ?? undefined;
            entityState.taskStatus = taskData.status ?? undefined;
          }
        }

        // Enrich with related tasks if context is an event/meeting
        if (payload.contextType === 'event' || payload.contextType === 'meeting') {
          const { data: relatedTasks } = await supabase
            .from('tasks')
            .select('id')
            .eq('meeting_id', payload.contextId)
            .eq('user_id', userId)
            .in('status', ['pending', 'in_progress']);
          if (relatedTasks?.length) {
            entityState.relatedTaskIds = relatedTasks.map(t => t.id);
          }
        }
      }

      const plan = planConsequences(
        intent,
        text,
        payload.contextType,
        payload.contextId,
        entityState,
      );

      // Session 4: Log consequence plan for debugging
      logConsequencePlan(plan);

      // Step 3: Execute consequence plan (replaces direct executeIntent for high confidence).
      let intentMutated = false;
      if (intent.confidence === 'high' && payload.contextId) {
        const execution = await executeConsequencePlan(supabase, plan, userId, intent);
        intentMutated = execution.mutated;

        // Generate truthful, consequence-aware feedback
        const feedback = generateFeedback(intent, execution, payload.contextType);
        if (feedback) {
          console.debug('[intent-feedback]', feedback);
        }

        // Session 4: Log state summary
        if (execution.stateSummary) {
          console.debug('[state-summary]', execution.stateSummary);
        }

        // Session 4: Log followup suggestions (internal only, not auto-created)
        if (execution.followupSuggestions?.length) {
          console.debug('[followup-suggestions]', execution.followupSuggestions);
        }
      } else {
        // Low/medium confidence: still generate feedback from the plan
        const execution = {
          mutated: false,
          mode: 'interaction_only' as const,
          summary: plan.summary,
          stateSummary: plan.summary,
          secondaryActionsExecuted: 0,
        };
        const feedback = generateFeedback(intent, execution, payload.contextType);
        if (feedback) {
          console.debug('[intent-feedback]', feedback);
        }
      }

      // ── Step 3: Ingestion pipeline (memory/log) ───────────
      // CRITICAL: If executeIntent already mutated state,
      // the ingestion pipeline MUST NOT create duplicate entities.
      // Mutation = state change. Ingestion = memory/log. These must not conflict.

      if (!intentMutated) {
        // No mutation occurred → route through existing universal system
        const routed = routeUniversalIntent(text);

        if (routed) {
          // Resolve person first if detected
          let personId: string | null = null;
          if (routed.person) {
            const personResult = await findOrCreatePerson(supabase, userId, routed.person);
            if (personResult) personId = personResult.id;
          }

          // Create entities based on intent
          let itemId: string | null = null;

          if (routed.item) {
            const itemResult = await createItemFromIntent(supabase, userId, {
              name: routed.item.name,
            });
            if (itemResult) itemId = itemResult.id;
          }

          if (routed.intent === 'create_event' && routed.event) {
            await createEventFromIntent(supabase, userId, {
              title: routed.event.title,
              scheduledAt: routed.event.scheduledAt,
              eventType: routed.event.eventType,
              personId,
            });
          }

          if (routed.task) {
            await createTaskFromIntent(supabase, userId, {
              title: routed.task.title,
              dueAt: routed.task.dueAt,
              itemId: routed.links.taskToItem ? itemId : null,
              personId: routed.links.taskToPerson ? personId : null,
            });
          }

          // Item-only intent (no task) — already created above
        } else {
          // ── Fallback: store as a user task (accept anything) ────
          await createUserTask(supabase, userId, {
            title: text.charAt(0).toUpperCase() + text.slice(1),
          });
        }
      }
      // If intentMutated === true, we skip entity creation entirely.
      // The interaction/memory is still saved via the intent execution layer.

      // ── Environmental acknowledgment + bird soar ──────────
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          triggerEnvironmentalAcknowledgment({ source: 'bird' });
        });
      });

      // ── Refresh control panel after brief delay ───────────
      // Session 14F: Reduced from 800ms → 400ms for snappier capture→reflect loop
      debouncedRefresh();

    } catch (err) {
      console.error('Capture submit error:', err);
    } finally {
      setCaptureSaving(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, supabase]);

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

    // ── P3: SESSION 5 — TRUTH-DRIVEN FALLBACK ──────
    // Sun state is now driven by the truth engine.
    // Momentum influences tone only. Truth decides state.
    const hour = new Date().getHours();
    let fallback: string;

    // Session 5: If sunTruth provides a headline, use it as primary fallback
    if (sunTruth?.headline) {
      fallback = sunTruth.headline;
    } else if (dailyLoop.showMorningCue) {
      fallback = "Here\u2019s what matters today.";
    } else if (hour >= 5 && hour < 12) {
      fallback = "Whenever you\u2019re ready.";
    } else if (dailyLoop.isReturning && hour >= 12 && hour < 18) {
      // Midday re-entry: acknowledge return
      fallback = "Things have been moving.";
    } else if (hour >= 12 && hour < 17) {
      fallback = "You\u2019re set for the day.";
    } else if (dailyLoop.showClosure) {
      fallback = dailyLoop.closureMessage;
    } else if (hour >= 17 && hour < 21) {
      fallback = "Nothing urgent right now.";
    } else {
      fallback = "Rest well.";
    }

    return { type: 'fallback', text: fallback };
  }, [data, assistantTrigger, dailyLoop, sunTruth]);

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
      <AmbientBird signalCount={data?.signals.length ?? 0} reactionTrigger={birdReactionTrigger} reactionSourceRef={birdReactionSourceRef} positionRef={birdPositionRef} pulseTrigger={birdPulseTrigger} isInteractive={!!birdQuestion} firstUseHint={birdFirstUseHint} discoverPulse={birdDiscoverPulse} paused={!pageVisible || chatOpen || universalCapture.state.open} />

      {/* ── BIRD TAP HITBOX ──────────────────────────── */}
      {/* Always opens capture overlay */}
      <div
        ref={birdHitboxRef}
        onClick={() => {
          if (!universalCapture.state.open) {
            universalCapture.openFromBird();
          }
        }}
        onPointerDown={(e) => { (e.currentTarget as HTMLElement).style.transform = `${(e.currentTarget as HTMLElement).style.transform?.replace(/scale\([^)]*\)/, '') || ''} scale(0.9)`; }}
        onPointerUp={(e) => { (e.currentTarget as HTMLElement).style.transform = (e.currentTarget as HTMLElement).style.transform?.replace(/scale\([^)]*\)/, '') || ''; }}
        onPointerLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = (e.currentTarget as HTMLElement).style.transform?.replace(/scale\([^)]*\)/, '') || ''; }}
        style={{
          position:     'fixed',
          top:          0,
          left:         0,
          width:        44,
          height:       44,
          borderRadius: '50%',
          zIndex:       23,
          pointerEvents: 'auto',
          cursor:       'pointer',
          willChange:   'transform',
          WebkitTapHighlightColor: 'transparent',
          // Session 13C: Always show a subtle hitbox glow so bird feels tappable
          ...(birdQuestion ? {
            boxShadow: '0 0 14px 6px rgba(232,160,48,0.15)',
            animation: 'celestialGlow 4s ease-in-out infinite',
          } : {
            boxShadow: '0 0 8px 4px rgba(247,243,236,0.04)',
          }),
        }}
        aria-label={birdQuestion ? 'Tap bird to answer' : 'Tap bird to capture'}
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

      {/* ── ENVIRONMENTAL ACKNOWLEDGMENT: full-surface brightness lift ── */}
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
          {/* Session 6: first-use hint uses stronger pulse for ~8s, then reverts */}
          <div
            style={{
              position:     'absolute',
              left:         `calc(${sunCenterLeft} - 36px)`,
              top:          `calc(${sunCenterTop} - 36px)`,
              width:        72,
              height:       72,
              borderRadius: '50%',
              background:   isNight
                ? 'radial-gradient(circle, rgba(200,210,230,0.14) 0%, transparent 70%)'
                : 'radial-gradient(circle, rgba(250,200,70,0.14) 0%, transparent 70%)',
              zIndex:       14,
              pointerEvents:'none',
              animation:    sunFirstUseHint
                ? 'celestialGlowFirstUse 3.5s ease-in-out infinite'
                : isImminent
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
            onClick={() => { setFocusOverlayOpen(prev => !prev); dailyLoop.dismissMorningCue(); }}
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
            aria-label="What matters right now"
          >
          </div>

        </>
      ) : null}

      {/* ── OFFLINE BANNER (softened — Session 4) ──────── */}
      <div style={{
        position:   'absolute',
        top:        'env(safe-area-inset-top, 0px)',
        left:       16,
        right:      16,
        zIndex:     50,
        height:     isOffline ? 28 : 0,
        overflow:   'hidden',
        transition: 'height 0.3s ease',
      }}>
        <div style={{
          height:        28,
          background:    'rgba(224,88,64,0.7)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderRadius:  '0 0 12px 12px',
          display:       'flex',
          alignItems:    'center',
          justifyContent:'center',
        }}>
          <span style={{
            fontSize:   10,
            fontWeight: 400,
            color:      'rgba(255,255,255,0.9)',
            fontFamily: "'DM Sans', sans-serif",
          }}>
            You&apos;re offline — some features unavailable.
          </span>
        </div>
      </div>

      {/* Session 4: Top bar removed — environment owns the full canvas */}

      <div
        className="absolute inset-0 flex flex-col items-center"
        style={{ zIndex: 20, pointerEvents: 'none', paddingTop: 'calc(env(safe-area-inset-top, 0px) + 11vh)' }}
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
              opacity:       homepageIntelligenceLine.trigger ? 1 : 0.55,
              transition:    'opacity 0.4s ease',
              // Session 6: actionable state — subtle shimmer + underline
              ...(homepageIntelligenceLine.trigger ? {
                textDecoration: 'underline',
                textDecorationColor: scene.lightText ? 'rgba(252,246,234,0.22)' : 'rgba(40,30,20,0.18)',
                textUnderlineOffset: '3px',
                backgroundImage: scene.lightText
                  ? 'linear-gradient(90deg, transparent 0%, rgba(252,246,234,0.06) 50%, transparent 100%)'
                  : 'linear-gradient(90deg, transparent 0%, rgba(40,30,20,0.04) 50%, transparent 100%)',
                backgroundSize: '200% 100%',
                animation: 'intelligenceShimmer 6s ease-in-out infinite',
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

      {/* ── CONTROL SURFACE (Session 17B: gated — zero work when closed) ── */}
      {controlOpen && (
        <ControlSurface
          open={controlOpen}
          onClose={() => setControlOpen(false)}
          allDeals={data?.allDeals ?? []}
          urgentDeals={data?.urgentDeals ?? []}
          meetings={data?.meetings ?? []}
          userId={data?.user?.id ?? null}
          items={activeItems}
          people={people}
          completedTodayCount={completedTodayCount}
          closureMessage={dailyLoop.showClosure ? dailyLoop.closureMessage : null}
          onClosureDismiss={dailyLoop.dismissClosure}
          onOpenCapture={(ctx) => universalCapture.openFromControlPanel(ctx)}
          prioritization={prioritization}
          sunTruth={sunTruth}
        />
      )}

      {/* ── SESSION 13A: FOCUS OVERLAY (sun → instant clarity) ── */}
      <FocusOverlay
        open={focusOverlayOpen}
        onClose={() => setFocusOverlayOpen(false)}
        userId={data?.user?.id ?? null}
        urgentDeals={data?.urgentDeals ?? []}
        allDeals={data?.allDeals ?? []}
        onOpenCapture={(ctx) => universalCapture.openFromSun(ctx)}
      />

      {/* ── SURFACE RENDERER (deep surfaces: deals, meetings, ideas, etc.) ── */}
      <SurfaceRenderer />

      {/* ── UNIFIED INTERACTION BAR — floating object in the world ───────── */}
      {/* Session 6: chat bar is the primary action entry point.
          - Subtle settle animation on first load (chatBarHint)
          - Slightly boosted border glow during hint to increase salience */}
      {!chatOpen && (
        <div
          style={{
            position:       'fixed',
            bottom:         'calc(env(safe-area-inset-bottom, 0px) + 12px)',
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
              maxWidth:       480,
              pointerEvents:  'auto',
              WebkitTapHighlightColor: 'transparent',
              ...(chatBarHint ? {
                animation: 'chatBarSettle 1.2s ease-out forwards',
              } : {}),
            }}
          >
          <div
            style={{
              background:      'rgba(15,20,32,0.42)',
              backdropFilter:  'blur(32px) saturate(1.4)',
              WebkitBackdropFilter: 'blur(32px) saturate(1.4)',
              borderRadius:    24,
              border:          chatBarHint ? '0.5px solid rgba(240,235,224,0.16)' : '0.5px solid rgba(240,235,224,0.09)',
              borderTop:       chatBarHint ? '0.5px solid rgba(240,235,224,0.22)' : '0.5px solid rgba(240,235,224,0.14)',
              padding:         '5px 6px 5px 5px',
              display:         'flex',
              alignItems:      'center',
              gap:             0,
              boxShadow:       chatBarHint
                ? '0 6px 32px rgba(0,0,0,0.22), 0 2px 8px rgba(0,0,0,0.14), 0 0.5px 0 rgba(240,235,224,0.06) inset'
                : '0 6px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.12), 0 0.5px 0 rgba(240,235,224,0.03) inset',
              transition:      'border 0.6s ease, box-shadow 0.6s ease',
            }}
          >
            {/* Control surface entry — left side */}
            <div
              onClick={() => { setControlOpen(true); dailyLoop.dismissMorningCue(); }}
              onPointerDown={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(0.88)'; }}
              onPointerUp={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
              onPointerLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
              style={{
                width:          36,
                height:         36,
                borderRadius:   14,
                display:        'flex',
                alignItems:     'center',
                justifyContent: 'center',
                cursor:         'pointer',
                flexShrink:     0,
                transition:     'transform 0.15s ease, background 0.15s ease',
                background:     'rgba(240,235,224,0.07)',
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
                {dailyLoop.phase === 'morning' ? 'What\u2019s on your mind?' :
                 dailyLoop.phase === 'evening' || dailyLoop.phase === 'night' ? 'Anything to capture?' :
                 'What\u2019s going on?'}
              </span>
            </div>
          </div>
        </div>
        </div>
      )}

      {/* ── SESSION 15B: FULL-SCREEN CHAT ──────────────────── */}
      <FullScreenChat
        open={chatOpen}
        onClose={closeChat}
        messages={chatMessages}
        inputValue={chatInput}
        onInputChange={setChatInput}
        onSubmit={handleChatSubmit}
        processing={chatProcessing}
        streaming={chatStreaming}
        threads={chatThreads}
        activeThreadId={activeThreadId}
        onThreadSelect={handleThreadSelect}
        onNewThread={handleNewThread}
        placeholder={
          dailyLoop.phase === 'morning' ? 'What\u2019s on your mind?' :
          dailyLoop.phase === 'evening' || dailyLoop.phase === 'night' ? 'Anything to capture?' :
          'What\u2019s going on?'
        }
        renderInlineUI={(msg) => (
          <>
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
                  Just save it
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
                          placeholder="Name *"
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
                          placeholder="Organization *"
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
          </>
        )}
      />

      {/* ── FIRST VISIT OVERLAY ───────────────── */}
      {firstVisitVisible && (
        <div style={{
          position:       'fixed',
          inset:          0,
          zIndex:         110,
          background:     '#060a12',
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          opacity:        firstVisitOpacity,
          transition:     'opacity 0.7s ease',
          pointerEvents:  firstVisitOpacity < 1 ? 'none' : 'auto',
        }}>
          {/* Session 4: Logo removed — clean fade from dark to environment */}
        </div>
      )}


      {/* ── SESSION 18: UNIVERSAL CAPTURE ───────────── */}
      <UniversalCapture
        open={universalCapture.state.open}
        onClose={universalCapture.close}
        onSubmit={handleUniversalCaptureSubmit}
        mode={universalCapture.state.mode}
        title={universalCapture.state.title}
        subtitle={universalCapture.state.subtitle}
        contextType={universalCapture.state.contextType}
        contextId={universalCapture.state.contextId}
        contextConfidence={universalCapture.state.contextConfidence}
        source={universalCapture.state.source}
        suggestedPrompts={universalCapture.state.suggestedPrompts}
        saving={captureSaving}
      />

      {/* ── SESSION 13C: "Anything else?" hint after first capture ── */}
      {anythingElseHint && (
        <div
          style={{
            position: 'fixed',
            bottom: 'calc(env(safe-area-inset-bottom, 0px) + 72px)',
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'center',
            zIndex: 26,
            pointerEvents: 'none',
            animation: 'fadeUp 0.4s ease forwards',
          }}
        >
          <div
            style={{
              fontFamily: "'Cormorant Garamond', serif",
              fontSize: 14,
              fontWeight: 300,
              color: 'rgba(240,235,224,0.35)',
              letterSpacing: '0.2px',
            }}
          >
            Anything else?
          </div>
        </div>
      )}

    </div>
  );
}
