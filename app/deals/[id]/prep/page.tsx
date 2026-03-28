'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { COLORS, FONTS } from '@/lib/design-system';

// Simple markdown renderer — bold headings, inline bold, and numbered lists
function renderMarkdown(text: string): React.ReactNode[] {
  return text.split('\n').map((line, i) => {
    const trimmed = line.replace(/\*\*/g, '').trim();
    const isBoldHeading = line.startsWith('**') && line.endsWith('**') && trimmed.length > 0;
    const isNumber = /^\d+\./.test(line);

    if (isBoldHeading) {
      return (
        <div key={i} style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '1.5px',
          textTransform: 'uppercase',
          color: COLORS.amber,
          marginTop: 18,
          marginBottom: 6,
          fontFamily: FONTS.sans,
        }}>
          {trimmed}
        </div>
      );
    }
    if (isNumber) {
      return (
        <div key={i} style={{
          fontSize: 14,
          fontWeight: 300,
          color: 'rgba(26,20,16,0.7)',
          lineHeight: 1.65,
          paddingLeft: 16,
          marginBottom: 4,
          fontFamily: FONTS.sans,
        }}>
          {line}
        </div>
      );
    }
    if (!line.trim()) return <div key={i} style={{ height: 6 }} />;

    // Inline bold within regular text
    const parts = line.split(/\*\*(.*?)\*\*/g);
    return (
      <div key={i} style={{
        fontSize: 14,
        fontWeight: 300,
        color: 'rgba(26,20,16,0.7)',
        lineHeight: 1.65,
        marginBottom: 3,
        fontFamily: FONTS.sans,
      }}>
        {parts.map((part, j) =>
          j % 2 === 1
            ? <strong key={j} style={{ fontWeight: 600, color: 'rgba(26,20,16,0.85)' }}>{part}</strong>
            : <span key={j}>{part}</span>
        )}
      </div>
    );
  });
}

export default function PrepPage() {
  const router = useRouter();
  const params = useParams();
  const supabase = createClient();
  const dealId = params.id as string;

  const [brief, setBrief] = useState('');
  const [loading, setLoading] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [dealName, setDealName] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [copyConfirmed, setCopyConfirmed] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const generateBrief = useCallback(async (uid: string) => {
    setLoading(false);
    setStreaming(true);
    setBrief('');
    setFromCache(false);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch('/api/prep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dealId, userId: uid }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        setStreaming(false);
        setBrief('Could not generate brief. Please try again.');
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        fullText += chunk;
        setBrief(fullText);
      }

      // Cache result
      const today = new Date().toISOString().split('T')[0];
      const cacheKey = `jove_prep_${dealId}_${today}`;
      localStorage.setItem(cacheKey, fullText);

    } catch (err: unknown) {
      if ((err as Error).name !== 'AbortError') {
        setBrief('Could not generate brief. Please try again.');
      }
    } finally {
      setStreaming(false);
    }
  }, [dealId]);

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/'); return; }
      setUserId(user.id);

      const { data: deal } = await supabase
        .from('deals')
        .select('name')
        .eq('id', dealId)
        .eq('user_id', user.id)
        .single();
      setDealName(deal?.name ?? 'Deal');

      // Check cache
      const today = new Date().toISOString().split('T')[0];
      const cacheKey = `jove_prep_${dealId}_${today}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        setBrief(cached);
        setFromCache(true);
        setLoading(false);
        return;
      }

      await generateBrief(user.id);
    };
    init();

    return () => { abortRef.current?.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  const handleRegenerate = async () => {
    if (!userId) return;
    const today = new Date().toISOString().split('T')[0];
    const cacheKey = `jove_prep_${dealId}_${today}`;
    localStorage.removeItem(cacheKey);
    await generateBrief(userId);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(brief);
    setCopyConfirmed(true);
    setTimeout(() => setCopyConfirmed(false), 2000);
  };

  return (
    <>
    <div style={{
      height: '100vh',
      overflowY: 'auto',
      background: COLORS.cream,
      fontFamily: FONTS.sans,
      paddingBottom: 80,
      animation: 'pageReveal 0.28s cubic-bezier(0.22, 1, 0.36, 1) both',
    }}>

      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        paddingTop: 'calc(env(safe-area-inset-top) + 12px)',
        paddingLeft: '20px',
        paddingRight: '20px',
        paddingBottom: '16px',
        borderBottom: '0.5px solid rgba(200,160,80,0.16)',
        background: COLORS.cream,
        position: 'sticky',
        top: 0,
        zIndex: 20,
      }}>
        <button
          onClick={() => { abortRef.current?.abort(); router.back(); }}
          style={{
            width: 34, height: 34, borderRadius: '50%',
            background: 'rgba(200,160,80,0.1)',
            border: '0.5px solid rgba(200,160,80,0.22)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: 'rgba(26,20,16,0.5)',
            fontSize: 19, flexShrink: 0,
          }}
        >{'\u2039'}</button>
        <div style={{ flex: 1 }}>
          <div style={{
            fontFamily: FONTS.serif,
            fontSize: 18, fontWeight: 400, color: COLORS.ink,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {dealName}
          </div>
          <div style={{
            fontSize: 10, fontWeight: 600, letterSpacing: '1.5px',
            textTransform: 'uppercase', color: COLORS.inkLight,
            marginTop: 1,
          }}>
            Meeting Brief
          </div>
        </div>
        <button
          onClick={handleRegenerate}
          disabled={streaming}
          style={{
            background: 'none', border: 'none',
            cursor: streaming ? 'default' : 'pointer',
            fontSize: 11, fontWeight: 600, letterSpacing: '1px',
            textTransform: 'uppercase',
            color: streaming ? 'rgba(26,20,16,0.2)' : COLORS.amber,
            fontFamily: FONTS.sans, padding: 0,
          }}
        >
          {streaming ? 'Generating...' : 'Regenerate'}
        </button>
      </div>

      {/* Brief content */}
      <div style={{ padding: '20px 20px 0' }}>
        {fromCache && (
          <div style={{
            fontSize: 10, fontWeight: 500,
            color: COLORS.inkLight, marginBottom: 14,
            letterSpacing: '0.5px',
          }}>
            Generated earlier today — tap Regenerate for a fresh brief
          </div>
        )}

        {(loading || (streaming && brief === '')) && (
          <div style={{ paddingTop: 40, textAlign: 'center' }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%',
              border: '2px solid rgba(232,160,48,0.2)',
              borderTop: `2px solid ${COLORS.amber}`,
              animation: 'spin 0.8s linear infinite',
              margin: '0 auto 14px',
            }} />
            <p style={{
              fontSize: 13, fontWeight: 300,
              color: COLORS.inkMid,
            }}>
              Preparing your brief...
            </p>
          </div>
        )}

        {brief && (
          <div>
            {renderMarkdown(brief)}
            {brief === 'Could not generate brief. Please try again.' && !streaming && (
              <div style={{ textAlign: 'center', marginTop: 16 }}>
                <button
                  onClick={handleRegenerate}
                  style={{
                    padding:       '10px 24px',
                    borderRadius:  10,
                    border:        '0.5px solid rgba(232,160,48,0.4)',
                    background:    'rgba(232,160,48,0.08)',
                    color:         COLORS.amber,
                    fontSize:      11,
                    fontWeight:    700,
                    letterSpacing: '1.5px',
                    textTransform: 'uppercase',
                    cursor:        'pointer',
                    fontFamily:    FONTS.sans,
                  }}
                >
                  Try Again
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom bar */}
      {brief && !loading && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          background: COLORS.cream,
          borderTop: '0.5px solid rgba(200,160,80,0.18)',
          padding: '12px 18px 32px',
          zIndex: 30, display: 'flex', gap: 10,
        }}>
          <button
            onClick={handleCopy}
            style={{
              flex: 1, padding: '13px 0', borderRadius: 12,
              border: `0.5px solid ${copyConfirmed ? 'rgba(72,200,120,0.3)' : 'rgba(200,160,80,0.3)'}`,
              background: copyConfirmed ? 'rgba(72,200,120,0.08)' : 'transparent',
              color: copyConfirmed ? COLORS.green : COLORS.inkMid,
              fontSize: 11, fontWeight: 700, letterSpacing: '1.5px',
              textTransform: 'uppercase', cursor: 'pointer',
              fontFamily: FONTS.sans, transition: 'all 0.2s',
            }}
          >
            {copyConfirmed ? '\u2713 Copied' : 'Copy Brief'}
          </button>
          <button
            onClick={() => router.push(`/deals/${dealId}/chat`)}
            style={{
              flex: 1, padding: '13px 0', borderRadius: 12,
              border: 'none',
              background: 'linear-gradient(135deg, #C87820, #E09838)',
              color: 'white', fontSize: 11, fontWeight: 700,
              letterSpacing: '1.5px', textTransform: 'uppercase',
              cursor: 'pointer', fontFamily: FONTS.sans,
              boxShadow: '0 4px 16px rgba(200,120,32,0.28)',
            }}
          >
            {'Open Chat \u2192'}
          </button>
        </div>
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
    </>
  );
}
