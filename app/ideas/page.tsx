'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { COLORS } from '@/lib/design-system';
import type { IdeaRow, DealRow } from '@/lib/types';

const STATUS_CONFIG = {
  raw: {
    label:  'Raw',
    color:  'rgba(240,235,224,0.5)',
    bg:     'rgba(240,235,224,0.08)',
    border: 'rgba(240,235,224,0.15)',
  },
  developing: {
    label:  'Developing',
    color:  COLORS.amber,
    bg:     'rgba(232,160,48,0.1)',
    border: 'rgba(232,160,48,0.25)',
  },
  linked: {
    label:  'Linked',
    color:  COLORS.teal,
    bg:     'rgba(56,184,200,0.1)',
    border: 'rgba(56,184,200,0.25)',
  },
  archived: {
    label:  'Archived',
    color:  'rgba(26,20,16,0.28)',
    bg:     'rgba(26,20,16,0.04)',
    border: 'rgba(26,20,16,0.1)',
  },
};

export default function IdeasPage() {
  const router   = useRouter();
  const supabase = createClient();

  const [userId, setUserId]   = useState<string | null>(null);
  const [ideas, setIdeas]     = useState<IdeaRow[]>([]);
  const [deals, setDeals]     = useState<DealRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState<string>('all');
  const [converting, setConverting] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/'); return; }
    setUserId(user.id);

    const [ideasRes, dealsRes] = await Promise.all([
      supabase
        .from('ideas')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('deals')
        .select('id, name')
        .eq('user_id', user.id)
        .not('stage', 'in', '("Closed Won","Closed Lost")')
        .order('name'),
    ]);

    setIdeas((ideasRes.data ?? []) as IdeaRow[]);
    setDeals((dealsRes.data ?? []) as DealRow[]);
    setLoading(false);
  }, [supabase, router]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleStatusChange = async (idea: IdeaRow, newStatus: string) => {
    await supabase
      .from('ideas')
      .update({ status: newStatus })
      .eq('id', idea.id);
    setIdeas(prev => prev.map(i =>
      i.id === idea.id ? { ...i, status: newStatus as IdeaRow['status'] } : i
    ));
  };

  const handleConvertToDeal = async (idea: IdeaRow) => {
    if (!userId) return;
    setConverting(idea.id);

    // Get first account or create placeholder
    const { data: accounts } = await supabase
      .from('accounts')
      .select('id')
      .eq('user_id', userId)
      .limit(1);

    const accountId = accounts?.[0]?.id;
    if (!accountId) {
      setConverting(null);
      return;
    }

    const { data: newDeal } = await supabase
      .from('deals')
      .insert({
        user_id:    userId,
        account_id: accountId,
        name:       idea.content.slice(0, 80),
        stage:      'Prospect',
      })
      .select('id')
      .single();

    if (newDeal) {
      await supabase
        .from('ideas')
        .update({ status: 'linked', deal_id: newDeal.id })
        .eq('id', idea.id);
      setIdeas(prev => prev.map(i =>
        i.id === idea.id
          ? { ...i, status: 'linked' as const, deal_id: newDeal.id }
          : i
      ));
      router.push(`/deals/${newDeal.id}`);
    }
    setConverting(null);
  };

  const handleArchive = async (idea: IdeaRow) => {
    await supabase
      .from('ideas')
      .update({ status: 'archived' })
      .eq('id', idea.id);
    setIdeas(prev => prev.map(i =>
      i.id === idea.id ? { ...i, status: 'archived' as const } : i
    ));
  };

  const filtered = ideas.filter(i => {
    if (filter === 'all')     return i.status !== 'archived';
    if (filter === 'archived') return i.status === 'archived';
    return i.status === filter;
  });

  return (
    <div style={{
      minHeight:   '100vh',
      background:  '#F7F3EC',
      fontFamily:  "'DM Sans', sans-serif",
      maxWidth:    390,
      margin:      '0 auto',
      paddingBottom:60,
      animation:   'fadeIn 0.28s ease both',
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
          onClick={() => router.back()}
          style={{
            width:        34, height: 34, borderRadius: '50%',
            background:   'rgba(200,160,80,0.1)',
            border:       '0.5px solid rgba(200,160,80,0.22)',
            display:      'flex', alignItems: 'center', justifyContent: 'center',
            cursor:       'pointer', color: 'rgba(26,20,16,0.5)',
            fontSize:     19, flexShrink: 0,
          }}
        >‹</button>
        <h1 style={{
          flex:       1,
          fontFamily: "'Cormorant Garamond', serif",
          fontSize:   22, fontWeight: 400, color: '#1A1410', margin: 0,
        }}>
          Ideas
        </h1>
        <div style={{
          fontSize:     10, fontWeight: 600, letterSpacing: '1.5px',
          textTransform:'uppercase',
          color:        'rgba(26,20,16,0.3)',
        }}>
          {ideas.filter(i => i.status !== 'archived').length} active
        </div>
      </div>

      {/* Filter pills */}
      <div style={{
        display:    'flex',
        gap:        8,
        padding:    '14px 18px 0',
        overflowX:  'auto',
        scrollbarWidth: 'none',
      }}>
        {['all', 'raw', 'developing', 'linked', 'archived'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding:      '6px 14px',
              borderRadius: 20,
              border:       '0.5px solid',
              borderColor:  filter === f
                ? 'rgba(232,160,48,0.5)'
                : 'rgba(26,20,16,0.12)',
              background:   filter === f
                ? 'rgba(232,160,48,0.1)'
                : '#FFFFFF',
              color:        filter === f
                ? COLORS.amber
                : 'rgba(26,20,16,0.44)',
              fontSize:     11, fontWeight: filter === f ? 600 : 300,
              cursor:       'pointer',
              fontFamily:   "'DM Sans', sans-serif",
              textTransform:'capitalize',
              whiteSpace:   'nowrap',
              transition:   'all 0.18s',
            }}
          >
            {f === 'all' ? 'All active' : f}
          </button>
        ))}
      </div>

      {/* Ideas list */}
      <div style={{ padding: '14px 18px 0' }}>
        {loading && (
          <div style={{ padding: '40px 0', textAlign: 'center' }}>
            <div style={{
              width: 24, height: 24, borderRadius: '50%',
              border: '2px solid rgba(232,160,48,0.2)',
              borderTop: `2px solid ${COLORS.amber}`,
              animation: 'spin 0.8s linear infinite',
              margin: '0 auto',
            }} />
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '50px 0' }}>
            <p style={{
              fontFamily: "'Cormorant Garamond', serif",
              fontSize:   24, fontWeight: 300,
              color:      'rgba(26,20,16,0.4)', marginBottom: 8,
            }}>
              {filter === 'all'
                ? 'No ideas yet.'
                : `No ${filter} ideas.`}
            </p>
            <p style={{
              fontSize: 13, fontWeight: 300, color: 'rgba(26,20,16,0.3)',
            }}>
              {filter === 'all'
                ? 'Capture ideas with the 💡 tile on the home screen.'
                : 'Change the filter to see other ideas.'}
            </p>
          </div>
        )}

        {filtered.map(idea => {
          const config = STATUS_CONFIG[idea.status] ?? STATUS_CONFIG.raw;
          const linkedDeal = idea.deal_id
            ? deals.find(d => d.id === idea.deal_id)
            : null;

          return (
            <div
              key={idea.id}
              style={{
                background:   '#FFFFFF',
                border:       '0.5px solid rgba(200,160,80,0.16)',
                borderRadius: 14,
                padding:      '14px 16px',
                marginBottom: 10,
                boxShadow:    '0 1px 6px rgba(26,20,16,0.05)',
              }}
            >
              {/* Status badge + date */}
              <div style={{
                display:      'flex',
                alignItems:   'center',
                gap:          8,
                marginBottom: 8,
              }}>
                <div style={{
                  fontSize:     8, fontWeight: 700, letterSpacing: '1px',
                  textTransform:'uppercase',
                  color:        config.color,
                  background:   config.bg,
                  border:       `0.5px solid ${config.border}`,
                  borderRadius: 20,
                  padding:      '3px 9px',
                }}>
                  {config.label}
                </div>
                <span style={{
                  fontSize:   10, fontWeight: 300,
                  color:      'rgba(26,20,16,0.3)', marginLeft: 'auto',
                }}>
                  {new Date(idea.created_at).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric',
                  })}
                </span>
              </div>

              {/* Content */}
              <p style={{
                fontSize:   14, fontWeight: 300,
                color:      '#1A1410', lineHeight: 1.6,
                margin:     0, marginBottom: 12,
              }}>
                {idea.content}
              </p>

              {/* Linked deal */}
              {linkedDeal && (
                <div
                  onClick={() => router.push(`/deals/${linkedDeal.id}`)}
                  style={{
                    display:      'inline-flex',
                    alignItems:   'center',
                    gap:          5,
                    fontSize:     10, fontWeight: 600,
                    letterSpacing:'0.8px', textTransform: 'uppercase',
                    color:        COLORS.teal,
                    background:   'rgba(56,184,200,0.08)',
                    border:       '0.5px solid rgba(56,184,200,0.22)',
                    borderRadius: 20,
                    padding:      '4px 10px',
                    cursor:       'pointer',
                    marginBottom: 10,
                  }}
                >
                  → {linkedDeal.name}
                </div>
              )}

              {/* Actions */}
              {idea.status !== 'archived' && idea.status !== 'linked' && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {idea.status === 'raw' && (
                    <button
                      onClick={() => handleStatusChange(idea, 'developing')}
                      style={{
                        padding:      '6px 12px', borderRadius: 9,
                        border:       '0.5px solid rgba(232,160,48,0.3)',
                        background:   'rgba(232,160,48,0.06)',
                        color:        COLORS.amber,
                        fontSize:     9, fontWeight: 700,
                        letterSpacing:'1px', textTransform: 'uppercase',
                        cursor:       'pointer',
                        fontFamily:   "'DM Sans', sans-serif",
                      }}
                    >
                      Develop →
                    </button>
                  )}
                  <button
                    onClick={() => handleConvertToDeal(idea)}
                    disabled={converting === idea.id}
                    style={{
                      padding:      '6px 12px', borderRadius: 9,
                      border:       '0.5px solid rgba(56,184,200,0.3)',
                      background:   'rgba(56,184,200,0.06)',
                      color:        COLORS.teal,
                      fontSize:     9, fontWeight: 700,
                      letterSpacing:'1px', textTransform: 'uppercase',
                      cursor:       converting === idea.id ? 'default' : 'pointer',
                      fontFamily:   "'DM Sans', sans-serif",
                    }}
                  >
                    {converting === idea.id ? 'Creating...' : 'Create Deal →'}
                  </button>
                  <button
                    onClick={() => handleArchive(idea)}
                    style={{
                      padding:      '6px 12px', borderRadius: 9,
                      border:       '0.5px solid rgba(26,20,16,0.1)',
                      background:   'transparent',
                      color:        'rgba(26,20,16,0.3)',
                      fontSize:     9, fontWeight: 500,
                      letterSpacing:'1px', textTransform: 'uppercase',
                      cursor:       'pointer',
                      fontFamily:   "'DM Sans', sans-serif",
                    }}
                  >
                    Archive
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
