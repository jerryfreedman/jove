// ── SESSION 18: UNIVERSAL CAPTURE STATE ──────────────────────
// Manages the state for opening UniversalCapture from any entry point.
// Used by the home page to coordinate Bird, Sun, and Control Panel opens.

import { useState, useCallback, useRef } from 'react';
import type {
  CaptureMode,
  CaptureContextType,
  CaptureContextConfidence,
  CaptureSource,
  CaptureContext,
} from '@/lib/universal-capture-types';

// ── STATE SHAPE ──────────────────────────────────────────────
export interface UniversalCaptureState {
  open: boolean;
  mode: CaptureMode;
  title?: string;
  subtitle?: string;
  contextType: CaptureContextType;
  contextId?: string;
  contextConfidence: CaptureContextConfidence;
  source: CaptureSource;
  suggestedPrompts?: string[];
}

const INITIAL_STATE: UniversalCaptureState = {
  open: false,
  mode: 'default',
  contextType: 'none',
  contextConfidence: 'low',
  source: 'bird',
};

// ── HOOK ─────────────────────────────────────────────────────
export function useUniversalCapture() {
  const [state, setState] = useState<UniversalCaptureState>(INITIAL_STATE);

  // ── Open from Bird (default mode, no context) ──────────────
  const openFromBird = useCallback(() => {
    setState({
      open: true,
      mode: 'default',
      contextType: 'none',
      contextConfidence: 'low',
      source: 'bird',
    });
  }, []);

  // ── Open from Sun action (action mode with context) ────────
  const openFromSun = useCallback((context: Partial<CaptureContext>) => {
    setState({
      open: true,
      mode: 'action',
      title: context.title,
      subtitle: context.subtitle,
      contextType: context.contextType ?? 'none',
      contextId: context.contextId,
      contextConfidence: context.contextConfidence ?? 'medium',
      source: 'sun',
      suggestedPrompts: context.suggestedPrompts,
    });
  }, []);

  // ── Open from Control Panel item (action mode with context) ─
  const openFromControlPanel = useCallback((context: Partial<CaptureContext>) => {
    setState({
      open: true,
      mode: 'action',
      title: context.title,
      subtitle: context.subtitle,
      contextType: context.contextType ?? 'none',
      contextId: context.contextId,
      contextConfidence: context.contextConfidence ?? 'medium',
      source: 'control_panel',
      suggestedPrompts: context.suggestedPrompts,
    });
  }, []);

  // ── Generic open with full context ─────────────────────────
  const openWithContext = useCallback((context: CaptureContext) => {
    setState({
      open: true,
      ...context,
    });
  }, []);

  // ── Close ──────────────────────────────────────────────────
  const close = useCallback(() => {
    setState(prev => ({ ...prev, open: false }));
  }, []);

  return {
    state,
    openFromBird,
    openFromSun,
    openFromControlPanel,
    openWithContext,
    close,
  };
}
