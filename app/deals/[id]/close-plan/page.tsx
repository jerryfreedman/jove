'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { COLORS } from '@/lib/design-system';
import ThemeColor from '@/components/ui/ThemeColor';

function renderMarkdown(text: string): React.ReactNode[] {
  return text.split('\n').map((line, i) => {
    const isBold   = line.startsWith('**') && line.includes('**', 2);
    const cleaned  = line.replace(/\*\*(.*?)\*\*/g, '$1');
    if (isBold && cleaned.trim()) {
      return (
        <div key={i} style={{
          fontSize:     11, fontWeight: 700, letterSpacing: '1.5px',
          textTransform:'uppercase', color: COLORS.amber,
          marginTop: 18, marginBottom: 6,
        }}>
          {cleaned}
        </div>
      );
    }
    if (!line.trim()) return <div key={i} style={{ height: 6 }} />;
    return (
      <div key={i} style={{
        fontSize:   14, fontWeight: 300,
        color:      'rgba(26,20,16,0.7)',
        lineHeight: 1.65, marginBottom: 3,
      }}>
        {cleaned}
      </div>
    );
  });
}

export default function ClosePlanPage() {
  const router   = useRouter();
  const params   = useParams();
  const supabase = createClient();
  const dealId   = params.id as string;

  const [plan, setPlan]           = useState('');
  const [loading, setLoading]     = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [dealName, setDealName]   = useState('');
  const [userId, setUserId]       = useState<string | null>(null);
  const [copyConfirmed, setCopyConfirmed] = useState(false);
  const [savedConfirmed, setSavedConfirmed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

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

      await generatePlan(user.id);
    };
    init();
    return () => { abortRef.current?.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  const generatePlan = async (uid: string) => {
    setLoading(false);
    setStreaming(true);
    setPlan('');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch('/api/close-plan', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ dealId, userId: uid }),
        signal:  controller.signal,
      });

      if (!response.ok || !response.body) {
        setPlan('Could not generate close plan. Please try again.');
        setStreaming(false);
        return;
      }

      const reader  = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText  = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });
        setPlan(fullText);
      }
    } catch (err: unknown) {
      if ((err as Error).name !== 'AbortError') {
        setPlan('Could not generate close plan. Please try again.');
      }
    } finally {
      setStreaming(false);
    }
  };

  const handleSave = async () => {
    if (!userId || !plan) return;
    await supabase.from('interactions').insert({
      user_id:          userId,
      deal_id:          dealId,
      type:             'note',
      raw_content:      plan,
      extraction_status:'pending',
    });
    setSavedConfirmed(true);
    setTimeout(() => setSavedConfirmed(false), 2000);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(plan);
    setCopyConfirmed(true);
    setTimeout(() => setCopyConfirmed(false), 2000);
  };

  return (
    <>
    <ThemeColor color="#F7F3EC" />
    <div style={{
      height:      '100vh',
      overflowY:   'auto',
      background:  '#F7F3EC',
      fontFamily:  "'DM Sans', sans-serif",
      paddingBottom:80,
    }}>
      {/* Header */}
      <div style={{
        display:      'flex',
        alignItems:   'center',
        gap:          12,
        padding:      '52px 20px 16px',
        borderBottom: '0.5px solid rgba(200,160,80,0.16)',
        background:   '#F7F3EC',
        position:     'sticky',
        top:          0,
        zIndex:       20,
      }}>
        <button
          onClick={() => { abortRef.current?.abort(); router.back(); }}
          style={{
            width: 34, height: 34, borderRadius: '50%',
            background:    'rgba(200,160,80,0.1)',
            border:        '0.5px solid rgba(200,160,80,0.22)',
            display:       'flex', alignItems: 'center', justifyContent: 'center',
            cursor:        'pointer', color: 'rgba(26,20,16,0.5)',
            fontSize:      19, flexShrink: 0,
          }}
        >&#8249;</button>
        <div style={{ flex: 1 }}>
          <div style={{
            fontFamily:   "'Cormorant Garamond', serif",
            fontSize:     18, fontWeight: 400, color: '#1A1410',
            whiteSpace:   'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {dealName}
          </div>
          <div style={{
            fontSize: 10, fontWeight: 600, letterSpacing: '1.5px',
            textTransform: 'uppercase', color: 'rgba(26,20,16,0.3)', marginTop: 1,
          }}>
            Close Plan
          </div>
        </div>
        <button
          onClick={() => userId && generatePlan(userId)}
          disabled={streaming}
          style={{
            background: 'none', border: 'none',
            cursor:     streaming ? 'default' : 'pointer',
            fontSize:   11, fontWeight: 600, letterSpacing: '1px',
            textTransform:'uppercase',
            color:      streaming ? 'rgba(26,20,16,0.2)' : COLORS.amber,
            fontFamily: "'DM Sans', sans-serif", padding: 0,
          }}
        >
          {streaming ? 'Generating...' : 'Regenerate'}
        </button>
      </div>

      {/* Content */}
      <div style={{ padding: '20px 20px 0' }}>
        {(loading || (streaming && plan === '')) && (
          <div style={{ paddingTop: 40, textAlign: 'center' }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%',
              border: '2px solid rgba(232,160,48,0.2)',
              borderTop: `2px solid ${COLORS.amber}`,
              animation: 'spin 0.8s linear infinite',
              margin: '0 auto 14px',
            }} />
            <p style={{
              fontSize: 13, fontWeight: 300, color: 'rgba(26,20,16,0.44)',
            }}>
              Building your close plan...
            </p>
          </div>
        )}
        {plan && <div>{renderMarkdown(plan)}</div>}
      </div>

      {/* Bottom bar */}
      {plan && !loading && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          background: '#F7F3EC',
          borderTop: '0.5px solid rgba(200,160,80,0.18)',
          padding: '12px 18px 32px',
          zIndex: 30, display: 'flex', gap: 10,
        }}>
          <button
            onClick={handleSave}
            style={{
              flex:          1, padding: '13px 0', borderRadius: 12,
              border:        `0.5px solid ${savedConfirmed ? 'rgba(72,200,120,0.3)' : 'rgba(200,160,80,0.3)'}`,
              background:    savedConfirmed ? 'rgba(72,200,120,0.08)' : 'transparent',
              color:         savedConfirmed ? COLORS.green : 'rgba(26,20,16,0.5)',
              fontSize:      11, fontWeight: 700, letterSpacing: '1.5px',
              textTransform: 'uppercase', cursor: 'pointer',
              fontFamily:    "'DM Sans', sans-serif", transition: 'all 0.2s',
            }}
          >
            {savedConfirmed ? '✓ Saved' : 'Save Plan'}
          </button>
          <button
            onClick={handleCopy}
            style={{
              flex:          1, padding: '13px 0', borderRadius: 12,
              border:        'none',
              background:    copyConfirmed
                ? 'rgba(72,200,120,0.12)'
                : 'linear-gradient(135deg, #C87820, #E09838)',
              color:         copyConfirmed ? COLORS.green : 'white',
              fontSize:      11, fontWeight: 700, letterSpacing: '1.5px',
              textTransform: 'uppercase', cursor: 'pointer',
              fontFamily:    "'DM Sans', sans-serif",
              boxShadow:     copyConfirmed ? 'none' : '0 4px 16px rgba(200,120,32,0.28)',
              transition:    'all 0.2s',
            }}
          >
            {copyConfirmed ? '✓ Copied' : 'Copy Plan'}
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
