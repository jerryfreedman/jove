'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';

// ── SURFACE IDS ─────────────────────────────────────────────
export type SurfaceId =
  | 'deals'       // deals list
  | 'deal-detail' // single deal view
  | 'deal-chat'   // deal conversation
  | 'deal-prep'   // deal meeting prep
  | 'meetings'    // meetings list
  | 'ideas'       // ideas list
  | 'items'       // Session 9: items list
  | 'people'      // Session 9: people list
  | 'settings'    // settings
  | 'briefing';   // daily briefing

export interface SurfaceState {
  id: SurfaceId;
  params?: Record<string, string>;
}

export interface SurfaceContextValue {
  /** Current active surface, or null if none open */
  activeSurface: SurfaceState | null;
  /** History stack for back navigation */
  history: SurfaceState[];
  /** Navigate to a surface (replaces active, pushes current to history) */
  navigateTo: (id: SurfaceId, params?: Record<string, string>) => void;
  /** Go back to previous surface in history */
  goBack: () => void;
  /** Close all surfaces */
  closeAll: () => void;
  /** Whether any surface is currently open */
  isOpen: boolean;
  /** Whether there's history to go back to */
  canGoBack: boolean;
}

const SurfaceContext = createContext<SurfaceContextValue | undefined>(undefined);

export function SurfaceProvider({ children }: { children: React.ReactNode }) {
  const [activeSurface, setActiveSurface] = useState<SurfaceState | null>(null);
  const [history, setHistory] = useState<SurfaceState[]>([]);

  const navigateTo = useCallback((id: SurfaceId, params?: Record<string, string>) => {
    setActiveSurface(prev => {
      if (prev) {
        setHistory(h => [...h, prev]);
      }
      return { id, ...(params ? { params } : {}) };
    });
  }, []);

  const goBack = useCallback(() => {
    setHistory(h => {
      if (h.length === 0) {
        setActiveSurface(null);
        return [];
      }
      const newHistory = [...h];
      const prev = newHistory.pop()!;
      setActiveSurface(prev);
      return newHistory;
    });
  }, []);

  const closeAll = useCallback(() => {
    setActiveSurface(null);
    setHistory([]);
  }, []);

  const value: SurfaceContextValue = {
    activeSurface,
    history,
    navigateTo,
    goBack,
    closeAll,
    isOpen: activeSurface !== null,
    canGoBack: history.length > 0,
  };

  return (
    <SurfaceContext.Provider value={value}>
      {children}
    </SurfaceContext.Provider>
  );
}

export function useSurface(): SurfaceContextValue {
  const ctx = useContext(SurfaceContext);
  if (!ctx) throw new Error('useSurface must be used within SurfaceProvider');
  return ctx;
}
