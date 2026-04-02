'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { COLORS, TIMING, EASING, TRANSITIONS, LOADING } from '@/lib/design-system';
import { useSurface } from '@/components/surfaces/SurfaceManager';
import type { IdeaRow, DealRow, UserDomainProfile } from '@/lib/types';
import { resolveUserDomainProfile, getEntityLabelSingular } from '@/lib/semantic-labels';

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
    color:  'rgba(240,235,224,0.28)',
    bg:     'rgba(240,235,224,0.04)',
    border: 'rgba(240,235,224,0.1)',
  },
};

export default function IdeasSurface() {
  const router = useRouter();
  const { navigateTo } = useSurface();
  const supabase = createClient();

  const [userId, setUserId]   = useState<string | null>(null);
  const [ideas, setIdeas]     = useState<IdeaRow[]>([]);
  const [deals, setDeals]     = useState<DealRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState<string>('all');
  const [converting, setConverting] = useState<string | null>(null);
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null);
  // Session 12: Domain-aware language
  const [domainProfile, setDomainProfile] = useState<UserDomainProfile | null>(null);
  const entitySingular = domainProfile
    ? getEntityLabelSingular('primary', domainProfile)
    : 'item';
  const entityCapitalized = entitySingular.charAt(0).toUpperCase() + entitySingular.slice(1);

  const fetchData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/'); return; }
    setUserId(user.id);

    // Session 12: Fetch domain for labelling
    const { data: userData } = await supabase.from('users').select('domain_key').eq('id', user.id).single();
    if (userData) setDomainProfile(resolveUserDomainProfile(userData.domain_key));

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

  // Load data on mount
  useState(() => { fetchData(); });

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
      navigateTo('deal-detail', { dealId: newDeal.id });
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
      display:      'flex',
      flexDirection:'column',
      height:       '100%',
      overflow:     'hidden',
      fontFamily:   "'DM Sans', sans-serif",
    }}>
      {/* Zone 1: Header */}
      <div style={{
        display:      'flex',
        alignItems:   'center',
        gap:          12,
        paddingTop:   '12px',
        paddingLeft:  '20px',
        paddingRight: '20px',
        paddingBottom:'16px',
        borderBottom: '0.5px solid rgba(200,160,80,0.16)',
        flexShrink:   0,
        zIndex:       20,
      }}>
        <h1 style={{
          flex:       1,
          fontFamily: "'Cormorant Garamond', serif",
          fontSize:   22, fontWeight: 400, color: 'rgba(252,246,234,0.98)', margin: 0,
        }}>
          Ideas
        </h1>
        <div style={{
          fontSize:     10, fontWeight: 600, letterSpacing: '1.5px',
          textTransform:'uppercase',
          color:        'rgba(252,246,234,0.3)',
        }}>
          {ideas.filter(i => i.status !== 'archived').length} active
        </div>
      </div>

      {/* Zone 2: Scrollable content */}
      <div style={{
        flex:       1,
        overflowY:  'auto',
      }}>
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
              className="jove-tap"
              onClick={() => setFilter(f)}
              style={{
                padding:      '6px 14px',
                borderRadius: 20,
                border:       '0.5px solid',
                borderColor:  filter === f
                  ? 'rgba(232,160,48,0.5)'
                  : 'rgba(240,235,224,0.12)',
                background:   filter === f
                  ? 'rgba(232,160,48,0.1)'
                  : 'rgba(240,235,224,0.05)',
                color:        filter === f
                  ? COLORS.amber
                  : 'rgba(240,235,224,0.44)',
                fontSize:     11, fontWeight: filter === f ? 600 : 300,
                cursor:       'pointer',
                fontFamily:   "'DM Sans', sans-serif",
                textTransform:'capitalize',
                whiteSpace:   'nowrap',
                transition:   TRANSITIONS.chip,
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
                color:      'rgba(252,246,234,0.4)', marginBottom: 8,
              }}>
                {filter === 'all'
                  ? 'No ideas yet.'
                  : `No ${filter} ideas.`}
              </p>
              <p style={{
                fontSize: 13, fontWeight: 300, color: 'rgba(252,246,234,0.3)',
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
                className="jove-tap"
                style={{
                  background:   'rgba(240,235,224,0.06)',
                  border:       '0.5px solid rgba(200,160,80,0.16)',
                  borderRadius: 14,
                  padding:      '14px 16px',
                  marginBottom: 10,
                  boxShadow:    '0 1px 6px rgba(0,0,0,0.1)',
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
                    color:      'rgba(252,246,234,0.3)', marginLeft: 'auto',
                  }}>
                    {new Date(idea.created_at).toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric',
                    })}
                  </span>
                </div>

                {/* Content */}
                <p style={{
                  fontSize:   14, fontWeight: 300,
                  color:      'rgba(252,246,234,0.88)', lineHeight: 1.6,
                  margin:     0, marginBottom: 12,
                }}>
                  {idea.content}
                </p>

                {/* Linked deal */}
                {linkedDeal && (
                  <div
                    className="jove-tap"
                    onClick={() => navigateTo('deal-detail', { dealId: linkedDeal.id })}
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
                      transition:   TRANSITIONS.chip,
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
                        className="jove-tap"
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
                          transition:   TRANSITIONS.button,
                        }}
                      >
                        Develop →
                      </button>
                    )}
                    <button
                      className="jove-tap"
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
                        transition:   TRANSITIONS.button,
                      }}
                    >
                      {converting === idea.id ? 'Creating...' : `Create ${entityCapitalized} →`}
                    </button>
                    <button
                      className="jove-tap"
                      onClick={() => {
                        if (confirmArchiveId === idea.id) {
                          handleArchive(idea);
                          setConfirmArchiveId(null);
                        } else {
                          setConfirmArchiveId(idea.id);
                          setTimeout(() => setConfirmArchiveId(prev =>
                            prev === idea.id ? null : prev
                          ), 3000);
                        }
                      }}
                      style={{
                        padding:      '6px 12px', borderRadius: 9,
                        border:       confirmArchiveId === idea.id
                          ? '0.5px solid rgba(232,160,48,0.5)'
                          : '0.5px solid rgba(240,235,224,0.1)',
                        background:   confirmArchiveId === idea.id
                          ? 'rgba(232,160,48,0.06)'
                          : 'transparent',
                        color:        confirmArchiveId === idea.id
                          ? '#C87820'
                          : 'rgba(240,235,224,0.3)',
                        fontSize:     9, fontWeight: 500,
                        letterSpacing:'1px', textTransform: 'uppercase',
                        cursor:       'pointer',
                        fontFamily:   "'DM Sans', sans-serif",
                        transition:   TRANSITIONS.button,
                      }}
                    >
                      {confirmArchiveId === idea.id ? 'Archive — tap to confirm' : 'Archive'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
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
