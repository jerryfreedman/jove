'use client';

import { createContext, useContext, useState, useRef, type ReactNode } from 'react';
import type { ChatThread } from '@/components/home/FullScreenChat';
import { generateThreadId } from '@/lib/chat-persistence';

// ── Chat message type (mirrors HomePageInner's ChatMessage) ──
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  classification?: any;
  saved?: boolean;
  uiMode?: 'clarification' | 'new_deal_confirm' | 'new_deal_form' | 'deal_picker';
  pendingMessageId?: string;
}

export type ChatSaveState = {
  hasSaved: boolean;
};

interface NewDealForm {
  dealName: string;
  accountName: string;
  value: string;
  originalText: string;
}

interface ChatControllerContextValue {
  // ── State ──
  chatOpen: boolean;
  setChatOpen: (open: boolean) => void;
  chatMessages: ChatMessage[];
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  chatInput: string;
  setChatInput: (input: string) => void;
  chatProcessing: boolean;
  setChatProcessing: (processing: boolean) => void;
  chatStreaming: boolean;
  setChatStreaming: (streaming: boolean) => void;
  chatThreads: ChatThread[];
  setChatThreads: React.Dispatch<React.SetStateAction<ChatThread[]>>;
  activeThreadId: string;
  setActiveThreadId: (id: string) => void;
  newDealForm: NewDealForm | null;
  setNewDealForm: React.Dispatch<React.SetStateAction<NewDealForm | null>>;

  // ── Refs ──
  chatInputRef: React.RefObject<HTMLInputElement | null>;
  chatScrollRef: React.RefObject<HTMLDivElement | null>;
  chatIdCounter: React.MutableRefObject<number>;
  chatSaveStateRef: React.MutableRefObject<ChatSaveState>;
  chatThreadIdRef: React.MutableRefObject<string>;
  pendingClarificationRef: React.MutableRefObject<{
    messageId: string;
    originalText: string;
    classification: any;
    savedInteractionId: string | null;
  } | null>;
}

const ChatControllerContext = createContext<ChatControllerContextValue | null>(null);

export function useChatController(): ChatControllerContextValue {
  const ctx = useContext(ChatControllerContext);
  if (!ctx) throw new Error('useChatController must be used within ChatControllerProvider');
  return ctx;
}

export function ChatControllerProvider({ children }: { children: ReactNode }) {
  // ── State ──
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatProcessing, setChatProcessing] = useState(false);
  const [chatStreaming, setChatStreaming] = useState(false);
  const [chatThreads, setChatThreads] = useState<ChatThread[]>([]);
  const chatThreadIdRef = useRef<string>(generateThreadId('home_chat'));
  const [activeThreadId, setActiveThreadId] = useState<string>(chatThreadIdRef.current);
  const [newDealForm, setNewDealForm] = useState<NewDealForm | null>(null);

  // ── Refs ──
  const chatInputRef = useRef<HTMLInputElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const chatIdCounter = useRef(0);
  const chatSaveStateRef = useRef<ChatSaveState>({ hasSaved: false });
  const pendingClarificationRef = useRef<{
    messageId: string;
    originalText: string;
    classification: any;
    savedInteractionId: string | null;
  } | null>(null);

  const value: ChatControllerContextValue = {
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
  };

  return (
    <ChatControllerContext.Provider value={value}>
      {children}
    </ChatControllerContext.Provider>
  );
}
