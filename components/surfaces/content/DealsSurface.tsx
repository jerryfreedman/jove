'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSurface } from '@/components/surfaces/SurfaceManager';
import { createClient } from '@/lib/supabase';
import {
  COLORS,
  STAGE_STYLES,
  getDaysColor,
  TIMING,
  EASING,
  TRANSITIONS,
  LOADING,
} from '@/lib/design-system';
import { PULSE_CHECK_DEFAULT_DAYS } from '@/lib/constants';
import type {
  DealRow,
  AccountRow,
  ContactRow,
} from '@/lib/types';
import { DEFAULT_DOMAIN_PROFILE, getEntityLabel, resolveUserDomainProfile, getDomainAwareTerms } from '@/lib/semantic-labels';
import { dealStageToUniversalStatus } from '@/lib/types';
import { UNIVERSAL_STATUS_STYLES } from '@/lib/design-system';
import type { UserDomainProfile } from '@/lib/types';

// ── TYPES ──────────────────────────────────────────────────
interface DealWithAccountName extends DealRow {
  account_name: string;
}

interface GroupedDeals {
  [accountName: string]: DealWithAccountName[];
}

type FilterMode = 'all' | 'attention' | null;

// ── HELPERS ────────────────────────────────────────────────
function getDaysSince(dateStr: string): number {
  return Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24)
  );
}

function isNeedsAttention(deal: DealRow): boolean {
  const inactive = getDaysSince(deal.last_activity_at) > PULSE_CHECK_DEFAULT_DAYS;
  const notClosed = deal.stage !== 'Closed Won' && deal.stage !== 'Closed Lost';
  const notSnoozed = !deal.snoozed_until ||
    new Date(deal.snoozed_until) < new Date();
  return inactive && notClosed && notSnoozed;
}

// ── COMPONENT ──────────────────────────────────────────────
export default function DealsSurface() {
  const { navigateTo } = useSurface();
  const supabase = createClient();

  const [deals, setDeals]           = useState<DealWithAccountName[]>([]);
  const [accounts, setAccounts]     = useState<AccountRow[]>([]);
  const [contacts, setContacts]     = useState<ContactRow[]>([]);
  const [loading, setLoading]       = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<FilterMode>(null);
  const [showAddDeal, setShowAddDeal] = useState(false);
  const [userId, setUserId]         = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  // Session 12: Domain-aware display
  const [domainProfile, setDomainProfile] = useState<UserDomainProfile | null>(null);
  const domainTerms = domainProfile ? getDomainAwareTerms(domainProfile) : getDomainAwareTerms(DEFAULT_DOMAIN_PROFILE);
  const [valueDisplay, setValueDisplay] =
    useState<'mrr' | 'arr'>(() => {
      if (typeof window === 'undefined') return 'arr';
      return (localStorage.getItem('jove_value_display') as 'mrr' | 'arr') ?? 'arr';
    });

  // ── FETCH DATA ────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    try {
      setFetchError(false);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { window.location.href = '/'; return; }
      setUserId(user.id);

      // Session 12: Fetch domain profile for display
      const { data: userData } = await supabase.from('users').select('domain_key').eq('id', user.id).single();
      if (userData) setDomainProfile(resolveUserDomainProfile(userData.domain_key));

      const [dealsRes, accountsRes, contactsRes] = await Promise.all([
        supabase
          .from('deals')
          .select('id, name, stage, last_activity_at, snoozed_until, next_action, account_id, user_id, intel_score, value, value_type')
          .eq('user_id', user.id)
          .order('last_activity_at', { ascending: false }),
        supabase
          .from('accounts')
          .select('*')
          .eq('user_id', user.id)
          .order('name'),
        supabase
          .from('contacts')
          .select('id, name, account_id, user_id')
          .eq('user_id', user.id),
      ]);

      const fetchedAccounts = (accountsRes.data ?? []) as AccountRow[];
      const fetchedDeals    = (dealsRes.data    ?? []) as DealRow[];
      const fetchedContacts = (contactsRes.data ?? []) as ContactRow[];

      const dealsWithAccount: DealWithAccountName[] = fetchedDeals.map(deal => {
        const account = fetchedAccounts.find(a => a.id === deal.account_id);
        return { ...deal, account_name: account?.name ?? 'Unknown Account' };
      });

      setDeals(dealsWithAccount);
      setAccounts(fetchedAccounts);
      setContacts(fetchedContacts);
    } catch (err) {
      console.error('Deals fetch error:', err);
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, [supabase, navigateTo]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── REALTIME SUBSCRIPTION ─────────────────────────────────
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel('deals-realtime')
      .on(
        'postgres_changes',
        {
          event:  '*',
          schema: 'public',
          table:  'deals',
          filter: `user_id=eq.${userId}`,
        },
        () => { fetchData(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId, supabase, fetchData]);

  // ── STORAGE EVENT LISTENER ──────────────────────────────────
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'jove_deals_refresh') {
        fetchData();
      }
      if (e.key === 'jove_value_display' && e.newValue) {
        setValueDisplay(e.newValue as 'mrr' | 'arr');
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [fetchData]);

  // ── FILTERED DEALS ────────────────────────────────────────
  const filteredDeals = deals.filter(deal => {
    if (filterMode === 'attention' && !isNeedsAttention(deal)) return false;
    if (filterMode === 'all') {
      if (deal.stage === 'Closed Won' || deal.stage === 'Closed Lost') return false;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchDeal    = deal.name.toLowerCase().includes(q);
      const matchAccount = deal.account_name.toLowerCase().includes(q);
      const matchContact = contacts
        .filter(c => c.account_id === deal.account_id)
        .some(c => c.name.toLowerCase().includes(q));
      if (!matchDeal && !matchAccount && !matchContact) return false;
    }

    return true;
  });

  // ── SEPARATE CLOSED vs ACTIVE ─────────────────────────────
  const closedDeals = filteredDeals.filter(
    d => d.stage === 'Closed Won' || d.stage === 'Closed Lost'
  );
  const activeDeals = filteredDeals.filter(
    d => d.stage !== 'Closed Won' && d.stage !== 'Closed Lost'
  );

  // ── GROUP BY ACCOUNT ──────────────────────────────────────
  const grouped: GroupedDeals = {};
  for (const deal of activeDeals) {
    if (!grouped[deal.account_name]) grouped[deal.account_name] = [];
    grouped[deal.account_name].push(deal);
  }

  // ── STATS ─────────────────────────────────────────────────
  const activeCount    = deals.filter(
    d => d.stage !== 'Closed Won' && d.stage !== 'Closed Lost'
  ).length;
  const attentionCount = deals.filter(isNeedsAttention).length;
  const accountCount   = new Set(
    deals
      .filter(d => d.stage !== 'Closed Won' && d.stage !== 'Closed Lost')
      .map(d => d.account_id)
  ).size;

  function normalizeValue(d: DealWithAccountName): number {
    const raw = d.value ?? 0;
    if (raw === 0) return 0;
    const type = d.value_type ?? 'arr';
    if (type === 'one_time') return raw;
    if (type === valueDisplay) return raw;
    // Convert: MRR→ARR ×12, ARR→MRR ÷12
    return valueDisplay === 'arr' ? raw * 12 : raw / 12;
  }

  const pipelineValue = deals
    .filter(d =>
      d.stage !== 'Closed Won' &&
      d.stage !== 'Closed Lost'
    )
    .reduce((sum, d) => sum + normalizeValue(d), 0);

  const closedWonValue = deals
    .filter(d => d.stage === 'Closed Won')
    .reduce((sum, d) => sum + normalizeValue(d), 0);

  function formatPipelineValue(n: number): string {
    if (n === 0) return '—';
    if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000)    return `$${(n / 1000).toFixed(0)}K`;
    return `$${n.toLocaleString()}`;
  }

  let firstDealRefAttached = false;

  // ── RENDER ─────────────────────────────────────────────────
  return (
    <div
      style={{
        display:    'flex',
        flexDirection: 'column',
        height:     '100%',
        overflow:   'hidden',
        fontFamily: "'DM Sans', sans-serif",
        animation:  'surfaceReveal 0.28s cubic-bezier(0.22, 1, 0.36, 1) both',
      }}
    >

      {/* ── HEADER ─────────────────────────────────────── */}
      <div style={{
        display:      'flex',
        alignItems:   'center',
        gap:          14,
        flexShrink:   0,
        paddingTop:   '12px',
        paddingLeft:  '20px',
        paddingRight: '20px',
        paddingBottom: '16px',
        borderBottom: '0.5px solid rgba(252,246,234,0.12)',
        zIndex:       20,
      }}>
        <h1 style={{
          flex:       1,
          fontFamily: "'Cormorant Garamond', serif",
          fontSize:   22,
          fontWeight: 400,
          color:      'rgba(252,246,234,0.96)',
          margin:     0,
        }}>
          {getEntityLabel('primary', domainProfile ?? DEFAULT_DOMAIN_PROFILE)}
        </h1>
        <button
          onClick={() => navigateTo('ideas')}
          className="jove-tap"
          style={{
            fontSize:     10,
            fontWeight:   600,
            letterSpacing:'1.5px',
            textTransform:'uppercase',
            color:        'rgba(252,246,234,0.4)',
            padding:      '5px 12px',
            borderRadius: 20,
            border:       '0.5px solid rgba(252,246,234,0.12)',
            background:   'transparent',
            cursor:       'pointer',
            fontFamily:   "'DM Sans', sans-serif",
            marginRight:  6,
            transition:   TRANSITIONS.button,
          }}
        >
          Ideas
        </button>
        <div style={{
          fontSize:     10,
          fontWeight:   600,
          letterSpacing:'1.5px',
          textTransform:'uppercase',
          color:        'rgba(232,160,48,0.82)',
          padding:      '5px 12px',
          borderRadius: 20,
          border:       '0.5px solid rgba(232,160,48,0.22)',
          background:   'rgba(232,160,48,0.06)',
        }}>
          {activeCount} active
        </div>
      </div>

      {/* ── ZONE 2: SCROLLABLE CONTENT ─────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto' }}>

      {/* ── SEARCH ───────────────────────────────────────── */}
      <div
        style={{ padding: '14px 18px 0' }}>
        <div style={{
          position:   'relative',
          display:    'flex',
          alignItems: 'center',
        }}>
          <svg
            style={{
              position: 'absolute',
              left:     14,
              width:    16,
              height:   16,
              opacity:  0.3,
              flexShrink:0,
            }}
            viewBox="0 0 16 16" fill="none"
          >
            <circle cx="7" cy="7" r="5" stroke="rgba(252,246,234,0.6)" strokeWidth="1.5"/>
            <line x1="11" y1="11" x2="14" y2="14"
              stroke="rgba(252,246,234,0.6)" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={domainTerms.isSales ? "Search deals, accounts, contacts..." : "Search items, organizations, people..."}
            style={{
              width:        '100%',
              background:   'rgba(252,246,234,0.06)',
              border:       '0.5px solid rgba(252,246,234,0.12)',
              borderRadius: 12,
              padding:      '11px 36px 11px 38px',
              fontSize:     14,
              fontWeight:   300,
              color:        'rgba(252,246,234,0.88)',
              outline:      'none',
              fontFamily:   "'DM Sans', sans-serif",
            }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="jove-tap"
              style={{
                position:   'absolute',
                right:      12,
                background: 'none',
                border:     'none',
                cursor:     'pointer',
                color:      'rgba(252,246,234,0.3)',
                fontSize:   18,
                lineHeight: 1,
                padding:    0,
                transition: TRANSITIONS.button,
              }}
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* ── SUMMARY STRIP ────────────────────────────────── */}
      <div
        style={{
        display:             'grid',
        gridTemplateColumns: '1fr 1fr',
        margin:              '14px 18px 0',
        border:              '0.5px solid rgba(252,246,234,0.12)',
        borderRadius:        14,
        overflow:            'hidden',
        background:          'rgba(252,246,234,0.06)',
      }}>

        {/* Active */}
        <div
          onClick={() => setFilterMode(
            filterMode === 'all' ? null : 'all'
          )}
          className="jove-tap"
          style={{
            padding:      '13px 0',
            textAlign:    'center',
            borderRight:  '0.5px solid rgba(252,246,234,0.1)',
            borderBottom: '0.5px solid rgba(252,246,234,0.1)',
            cursor:       'pointer',
            background:   filterMode === 'all'
              ? 'rgba(232,160,48,0.08)'
              : 'transparent',
            transition:   TRANSITIONS.chip,
          }}
        >
          <div style={{
            fontSize:   22,
            fontWeight: 300,
            color:      filterMode === 'all'
              ? '#E8A030' : 'rgba(252,246,234,0.88)',
            lineHeight: 1,
          }}>
            {activeCount}
          </div>
          <div style={{
            fontSize:     9,
            fontWeight:   600,
            letterSpacing:'1px',
            textTransform:'uppercase',
            color:        'rgba(252,246,234,0.32)',
            marginTop:    4,
          }}>
            Active
          </div>
        </div>

        {/* Attention */}
        <div
          onClick={() => setFilterMode(
            filterMode === 'attention' ? null : 'attention'
          )}
          className="jove-tap"
          style={{
            padding:      '13px 0',
            textAlign:    'center',
            borderBottom: '0.5px solid rgba(252,246,234,0.1)',
            cursor:       'pointer',
            background:   filterMode === 'attention'
              ? 'rgba(232,160,48,0.08)'
              : 'transparent',
            transition:   TRANSITIONS.chip,
          }}
        >
          <div style={{
            fontSize:   22,
            fontWeight: 300,
            color:      attentionCount > 0
              ? '#E05840'
              : filterMode === 'attention'
              ? '#E8A030'
              : 'rgba(252,246,234,0.88)',
            lineHeight: 1,
          }}>
            {attentionCount}
          </div>
          <div style={{
            fontSize:     9,
            fontWeight:   600,
            letterSpacing:'1px',
            textTransform:'uppercase',
            color:        'rgba(252,246,234,0.32)',
            marginTop:    4,
          }}>
            Attention
          </div>
        </div>

        {/* Pipeline value */}
        <div style={{
          padding:     '13px 0',
          textAlign:   'center',
          borderRight: '0.5px solid rgba(252,246,234,0.1)',
          cursor:      'default',
        }}>
          <div style={{
            fontSize:   20,
            fontWeight: 300,
            color:      pipelineValue > 0
              ? '#E8A030'
              : 'rgba(252,246,234,0.28)',
            lineHeight: 1,
          }}>
            {formatPipelineValue(pipelineValue)}
          </div>
          <div style={{
            fontSize:     9,
            fontWeight:   600,
            letterSpacing:'1px',
            textTransform:'uppercase',
            color:        'rgba(252,246,234,0.32)',
            marginTop:    4,
          }}>
            {domainTerms.isSales ? 'Pipeline' : 'Total'} {valueDisplay.toUpperCase()}
          </div>
        </div>

        {/* Closed Won value */}
        <div style={{
          padding:  '13px 0',
          textAlign:'center',
          cursor:   'default',
        }}>
          <div style={{
            fontSize:   20,
            fontWeight: 300,
            color:      closedWonValue > 0
              ? '#48C878'
              : 'rgba(252,246,234,0.28)',
            lineHeight: 1,
          }}>
            {formatPipelineValue(closedWonValue)}
          </div>
          <div style={{
            fontSize:     9,
            fontWeight:   600,
            letterSpacing:'1px',
            textTransform:'uppercase',
            color:        'rgba(252,246,234,0.32)',
            marginTop:    4,
          }}>
            Won {valueDisplay.toUpperCase()}
          </div>
        </div>

      </div>

      {/* ── FILTER LABEL ─────────────────────────────────── */}
      {filterMode && (
        <div style={{
          padding:    '10px 20px 0',
          display:    'flex',
          alignItems: 'center',
          gap:        8,
        }}>
          <span style={{
            fontSize:   11,
            fontWeight: 500,
            color:      COLORS.amber,
          }}>
            {filterMode === 'attention' ? 'Needs attention' : domainTerms.activeEntities}
          </span>
          <button
            onClick={() => setFilterMode(null)}
            className="jove-tap"
            style={{
              background: 'none',
              border:     'none',
              color:      'rgba(252,246,234,0.3)',
              fontSize:   13,
              cursor:     'pointer',
              padding:    0,
              transition: TRANSITIONS.button,
            }}
          >
            ×  clear
          </button>
        </div>
      )}

      {/* ── DEAL LIST ────────────────────────────────────── */}
      <div style={{ padding: '16px 0 100px' }}>

        {fetchError && (
          <div style={{
            textAlign:  'center',
            padding:    '60px 32px',
          }}>
            <p style={{
              fontFamily: "'Cormorant Garamond', serif",
              fontSize:   22,
              fontWeight: 300,
              color:      'rgba(252,246,234,0.44)',
              marginBottom:14,
            }}>
              Couldn&apos;t load your deals.
            </p>
            <button
              onClick={() => { setLoading(true); fetchData(); }}
              className="jove-tap"
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
                fontFamily:    "'DM Sans', sans-serif",
                transition:    TRANSITIONS.button,
              }}
            >
              Retry
            </button>
          </div>
        )}

        {!fetchError && loading && (
          <div style={{ padding: '0 18px' }}>
            {[1,2,3].map(i => (
              <div key={i} style={{ marginBottom: 8 }}>
                <div style={{
                  height:       14,
                  borderRadius: 7,
                  background:   'rgba(252,246,234,0.06)',
                  marginBottom: 8,
                  width:        '40%',
                }} />
                <div style={{
                  height:       64,
                  borderRadius: 14,
                  background:   'rgba(252,246,234,0.04)',
                  marginBottom: 4,
                }} />
              </div>
            ))}
          </div>
        )}

        {!loading && !fetchError && filteredDeals.length === 0 && (
          <div style={{
            textAlign:  'center',
            padding:    '60px 32px',
          }}>
            {searchQuery ? (
              <>
                <p style={{
                  fontFamily: "'Cormorant Garamond', serif",
                  fontSize:   22,
                  fontWeight: 300,
                  color:      'rgba(252,246,234,0.44)',
                  marginBottom:8,
                }}>
                  Nothing matched
                </p>
                <p style={{
                  fontSize:   13,
                  fontWeight: 300,
                  color:      'rgba(252,246,234,0.3)',
                }}>
                  &ldquo;{searchQuery}&rdquo; — try a name, organization, or {domainTerms.isSales ? 'deal' : 'item'}.
                </p>
              </>
            ) : (
              <>
                <p style={{
                  fontFamily: "'Cormorant Garamond', serif",
                  fontSize:   26,
                  fontWeight: 300,
                  color:      'rgba(252,246,234,0.44)',
                  marginBottom:8,
                }}>
                  {domainTerms.isSales ? 'Your pipeline is empty.' : 'Nothing here yet.'}
                </p>
                <p style={{
                  fontSize:   14,
                  fontWeight: 300,
                  color:      'rgba(252,246,234,0.3)',
                }}>
                  {domainTerms.isSales ? 'Add your first deal with the + button.' : 'Add your first item with the + button.'}
                </p>
              </>
            )}
          </div>
        )}

        {!loading && !fetchError && Object.entries(grouped).map(([accountName, accountDeals]) => (
          <div key={accountName} style={{ marginBottom: 8 }}>

            {/* Account header */}
            <div style={{
              padding:      '0 20px 8px',
              display:      'flex',
              alignItems:   'center',
              gap:          8,
            }}>
              <span style={{
                fontSize:     11,
                fontWeight:   700,
                letterSpacing:'1.5px',
                textTransform:'uppercase',
                color:        'rgba(252,246,234,0.36)',
              }}>
                {accountName}
              </span>
              <div style={{
                flex:       1,
                height:     '0.5px',
                background: 'rgba(252,246,234,0.1)',
              }} />
              <span style={{
                fontSize:   10,
                fontWeight: 300,
                color:      'rgba(252,246,234,0.28)',
              }}>
                {accountDeals.length}
              </span>
            </div>

            {/* Deal rows */}
            {accountDeals.map(deal => {
              const days      = getDaysSince(deal.last_activity_at);
              const daysColor = getDaysColor(days, true);
              const attention = isNeedsAttention(deal);

              // Session 12: Domain-aware stage display
              const showSalesStage = domainTerms.showDealStages;
              const stageStyle = showSalesStage
                ? (STAGE_STYLES[deal.stage] ?? STAGE_STYLES['Prospect'])
                : UNIVERSAL_STATUS_STYLES[dealStageToUniversalStatus(deal.stage)];
              const stageLabel = showSalesStage
                ? deal.stage
                : UNIVERSAL_STATUS_STYLES[dealStageToUniversalStatus(deal.stage)].label;

              return (
                <div
                  key={deal.id}
                  ref={(() => { if (!firstDealRefAttached) { firstDealRefAttached = true; return undefined; } return undefined; })()}
                  onClick={() => navigateTo('deal-detail', { dealId: deal.id })}
                  className="jove-tap"
                  style={{
                    position:   'relative',
                    margin:     '0 18px 6px',
                    background: 'rgba(252,246,234,0.06)',
                    border:     attention
                      ? '0.5px solid rgba(224,88,64,0.22)'
                      : '0.5px solid rgba(252,246,234,0.12)',
                    borderRadius:14,
                    padding:    '14px 16px',
                    display:    'flex',
                    alignItems: 'center',
                    gap:        12,
                    cursor:     'pointer',
                    boxShadow:  '0 1px 6px rgba(0,0,0,0.1)',
                    transition: TRANSITIONS.row,
                  }}
                >
                  {/* Left: name + next action */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontFamily:   "'Cormorant Garamond', serif",
                      fontSize:     17,
                      fontWeight:   400,
                      color:        'rgba(252,246,234,0.96)',
                      marginBottom: deal.next_action ? 4 : 0,
                      whiteSpace:   'nowrap',
                      overflow:     'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {deal.name}
                    </div>
                    {deal.next_action && (
                      <div style={{
                        fontSize:     12,
                        fontWeight:   300,
                        color:        'rgba(252,246,234,0.44)',
                        whiteSpace:   'nowrap',
                        overflow:     'hidden',
                        textOverflow: 'ellipsis',
                      }}>
                        {deal.next_action}
                      </div>
                    )}
                  </div>

                  {/* Right: stage + days */}
                  <div style={{
                    display:        'flex',
                    flexDirection:  'column',
                    alignItems:     'flex-end',
                    gap:            5,
                    flexShrink:     0,
                  }}>
                    <div style={{
                      fontSize:     9,
                      fontWeight:   600,
                      letterSpacing:'0.8px',
                      textTransform:'uppercase',
                      color:        stageStyle.color,
                      background:   stageStyle.bg,
                      border:       `0.5px solid ${stageStyle.border}`,
                      borderRadius: 20,
                      padding:      '3px 9px',
                      whiteSpace:   'nowrap',
                    }}>
                      {stageLabel}
                    </div>
                    <div style={{
                      fontSize:   10,
                      fontWeight: 500,
                      color:      daysColor,
                    }}>
                      {days}d
                    </div>
                  </div>

                  {/* Chevron */}
                  <div style={{
                    color:      'rgba(252,246,234,0.2)',
                    fontSize:   16,
                    flexShrink: 0,
                  }}>
                    ›
                  </div>

                </div>
              );
            })}
          </div>
        ))}

        {/* ── CLOSED DEALS SECTION ──────────────────────── */}
        {closedDeals.length > 0 && (
          <div style={{ margin: '8px 18px 0' }}>
            <button
              onClick={() => setShowClosed(!showClosed)}
              className="jove-tap"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '12px 0',
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '1.5px',
                textTransform: 'uppercase',
                color: 'rgba(252,246,234,0.3)',
                fontFamily: "'DM Sans', sans-serif",
                width: '100%',
                transition: TRANSITIONS.button,
              }}
            >
              <span style={{
                display: 'inline-block',
                transform: showClosed ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: `transform ${TIMING.FAST}ms ${EASING.gentle}`,
                fontSize: 12,
              }}>›</span>
              {showClosed ? 'Hide' : `${closedDeals.length} closed deal${closedDeals.length !== 1 ? 's' : ''}`}
            </button>

            {showClosed && closedDeals.map(deal => {
              const stage = STAGE_STYLES[deal.stage] ?? STAGE_STYLES['Prospect'];
              return (
                <div
                  key={deal.id}
                  onClick={() => navigateTo('deal-detail', { dealId: deal.id })}
                  className="jove-tap"
                  style={{
                    margin: '0 0 6px',
                    background: 'rgba(252,246,234,0.06)',
                    border: '0.5px solid rgba(252,246,234,0.1)',
                    borderRadius: 14,
                    padding: '14px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    cursor: 'pointer',
                    opacity: 0.6,
                    boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
                    transition: TRANSITIONS.row,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontFamily: "'Cormorant Garamond', serif",
                      fontSize: 16,
                      fontWeight: 400,
                      color: 'rgba(252,246,234,0.88)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {deal.name}
                    </div>
                    <div style={{
                      fontSize: 11,
                      fontWeight: 300,
                      color: 'rgba(252,246,234,0.4)',
                      marginTop: 2,
                    }}>
                      {deal.account_name}
                    </div>
                  </div>
                  <div style={{
                    fontSize: 9,
                    fontWeight: 600,
                    letterSpacing: '0.8px',
                    textTransform: 'uppercase',
                    color: stage.color,
                    background: stage.bg,
                    border: `0.5px solid ${stage.border}`,
                    borderRadius: 20,
                    padding: '3px 9px',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}>
                    {deal.stage}
                  </div>
                  <div style={{
                    color: 'rgba(252,246,234,0.2)',
                    fontSize: 16,
                    flexShrink: 0,
                  }}>›</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      </div>

      {/* ── FLOATING + BUTTON ────────────────────────────── */}
      <div
        style={{
        position:   'fixed',
        bottom:     32,
        right:      'max(calc(50% - 195px + 20px), 20px)',
        zIndex:     30,
      }}>
        <button
          onClick={() => setShowAddDeal(true)}
          className="jove-tap"
          style={{
            width:        56,
            height:       56,
            borderRadius: '50%',
            background:   'linear-gradient(135deg, #C87820, #E09838)',
            border:       'none',
            display:      'flex',
            alignItems:   'center',
            justifyContent:'center',
            cursor:       'pointer',
            boxShadow:    '0 6px 24px rgba(200,120,32,0.36)',
            transition:   TRANSITIONS.button,
          }}
          aria-label="Add deal"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <line x1="10" y1="3" x2="10" y2="17"
              stroke="white" strokeWidth="2.2" strokeLinecap="round"/>
            <line x1="3" y1="10" x2="17" y2="10"
              stroke="white" strokeWidth="2.2" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {/* ── ADD DEAL SHEET ────────────────────────────────── */}
      {showAddDeal && userId && (
        <AddDealSheet
          userId={userId}
          accounts={accounts}
          domainProfile={domainProfile}
          onClose={() => setShowAddDeal(false)}
          onSaved={() => {
            setShowAddDeal(false);
            fetchData();
          }}
        />
      )}

    </div>
  );
}

// ── ADD DEAL SHEET COMPONENT ───────────────────────────────
function AddDealSheet({
  userId,
  accounts,
  domainProfile: profileProp,
  onClose,
  onSaved,
}: {
  userId:   string;
  accounts: AccountRow[];
  domainProfile: UserDomainProfile | null;
  onClose:  () => void;
  onSaved:  () => void;
}) {
  const supabase = createClient();
  const domainTerms = getDomainAwareTerms(profileProp ?? DEFAULT_DOMAIN_PROFILE);
  const domainProfile = profileProp;

  const [dealName, setDealName]     = useState('');
  const [accountId, setAccountId]   = useState<string>('');
  const [newAccountName, setNewAccountName] = useState('');
  const [stage, setStage]           = useState<string>('Prospect');
  const [nextAction, setNextAction] = useState('');
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');
  const [visible, setVisible]       = useState(false);

  const STAGES = ['Prospect', 'Discovery', 'POC', 'Proposal', 'Negotiation'];

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 30);
    return () => clearTimeout(t);
  }, []);

  const handleSave = async () => {
    if (!dealName.trim()) { setError('Deal name is required.'); return; }
    if (!accountId && !newAccountName.trim()) {
      setError('Please select or create an account.'); return;
    }

    setSaving(true);
    setError('');

    try {
      let finalAccountId = accountId;

      // Create new account if needed
      if (accountId === '__new__' && newAccountName.trim()) {
        const { data: newAccount, error: accountError } = await supabase
          .from('accounts')
          .insert({ user_id: userId, name: newAccountName.trim() })
          .select('id')
          .single();
        if (accountError) throw accountError;
        finalAccountId = newAccount.id;
      }

      // Create deal
      const { error: dealError } = await supabase
        .from('deals')
        .insert({
          user_id:    userId,
          account_id: finalAccountId,
          name:       dealName.trim(),
          stage,
          next_action: nextAction.trim() || null,
          last_activity_at: new Date().toISOString(),
        });

      if (dealError) throw dealError;
      onSaved();

    } catch (err) {
      console.error('Add deal error:', err);
      setError('Could not save deal. Please try again.');
      setSaving(false);
    }
  };

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position:      'fixed',
          inset:         0,
          zIndex:        86,
          background:    'rgba(26,20,16,0.4)',
          backdropFilter:'blur(4px)',
          opacity:       visible ? 1 : 0,
          transition:    `opacity ${TIMING.STANDARD}ms ${EASING.gentle}`,
        }}
      />
      <div style={{
        position:     'fixed',
        bottom:       0,
        left:         '50%',
        transform:    visible
          ? 'translateX(-50%) translateY(0)'
          : 'translateX(-50%) translateY(100%)',
        transition:   `transform ${TIMING.STANDARD}ms ${EASING.standard}`,
        zIndex:       87,
        width:        '100%',
        background:   '#F7F3EC',
        borderTop:    '0.5px solid rgba(200,160,80,0.3)',
        borderRadius: '22px 22px 0 0',
        padding:      '0 20px 48px',
        fontFamily:   "'DM Sans', sans-serif",
      }}>
        <div style={{
          width:        36,
          height:       4,
          borderRadius: 2,
          background:   'rgba(26,20,16,0.12)',
          margin:       '14px auto 20px',
        }} />

        <h2 style={{
          fontFamily:   "'Cormorant Garamond', serif",
          fontSize:     22,
          fontWeight:   400,
          color:        '#1A1410',
          marginBottom: 20,
        }}>
          {domainTerms.isSales ? 'New Deal' : `New ${getEntityLabel('primary', domainProfile ?? DEFAULT_DOMAIN_PROFILE).replace(/s$/, '')}`}
        </h2>

        {/* Entity name */}
        <input
          type="text"
          value={dealName}
          onChange={e => setDealName(e.target.value)}
          placeholder={domainTerms.isSales ? 'Deal name' : 'Name'}
          style={{
            width:        '100%',
            background:   '#FFFFFF',
            border:       '0.5px solid rgba(26,20,16,0.12)',
            borderRadius: 12,
            padding:      '13px 16px',
            fontSize:     15,
            fontWeight:   300,
            color:        '#1A1410',
            outline:      'none',
            marginBottom: 12,
            fontFamily:   "'DM Sans', sans-serif",
            boxSizing:    'border-box',
          }}
        />

        {/* Account selector */}
        <select
          value={accountId}
          onChange={e => setAccountId(e.target.value)}
          style={{
            width:        '100%',
            background:   '#FFFFFF',
            border:       '0.5px solid rgba(26,20,16,0.12)',
            borderRadius: 12,
            padding:      '13px 16px',
            fontSize:     14,
            fontWeight:   300,
            color:        accountId ? '#1A1410' : 'rgba(26,20,16,0.4)',
            outline:      'none',
            marginBottom: 12,
            fontFamily:   "'DM Sans', sans-serif",
            cursor:       'pointer',
            boxSizing:    'border-box',
          }}
        >
          <option value="">Select account...</option>
          {accounts.map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
          <option value="__new__">+ New account...</option>
        </select>

        {/* New account name */}
        {accountId === '__new__' && (
          <input
            type="text"
            value={newAccountName}
            onChange={e => setNewAccountName(e.target.value)}
            placeholder="Account name"
            style={{
              width:        '100%',
              background:   '#FFFFFF',
              border:       '0.5px solid rgba(26,20,16,0.12)',
              borderRadius: 12,
              padding:      '13px 16px',
              fontSize:     14,
              fontWeight:   300,
              color:        '#1A1410',
              outline:      'none',
              marginBottom: 12,
              fontFamily:   "'DM Sans', sans-serif",
              boxSizing:    'border-box',
            }}
          />
        )}

        {/* Stage selector */}
        <div style={{
          display:      'flex',
          gap:          6,
          marginBottom: 12,
          flexWrap:     'wrap',
        }}>
          {STAGES.map(s => (
            <button
              key={s}
              onClick={() => setStage(s)}
              className="jove-tap"
              style={{
                padding:      '7px 14px',
                borderRadius: 20,
                border:       '0.5px solid',
                borderColor:  stage === s
                  ? 'rgba(232,160,48,0.5)'
                  : 'rgba(26,20,16,0.12)',
                background:   stage === s
                  ? 'rgba(232,160,48,0.1)'
                  : '#FFFFFF',
                color:        stage === s
                  ? COLORS.amber
                  : 'rgba(26,20,16,0.44)',
                fontSize:     11,
                fontWeight:   stage === s ? 600 : 300,
                cursor:       'pointer',
                fontFamily:   "'DM Sans', sans-serif",
                transition:   TRANSITIONS.chip,
              }}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Next action */}
        <input
          type="text"
          value={nextAction}
          onChange={e => setNextAction(e.target.value)}
          placeholder="Next action (optional)"
          style={{
            width:        '100%',
            background:   '#FFFFFF',
            border:       '0.5px solid rgba(26,20,16,0.12)',
            borderRadius: 12,
            padding:      '13px 16px',
            fontSize:     14,
            fontWeight:   300,
            color:        '#1A1410',
            outline:      'none',
            marginBottom: 16,
            fontFamily:   "'DM Sans', sans-serif",
            boxSizing:    'border-box',
          }}
        />

        {error && (
          <p style={{
            fontSize:     12,
            color:        COLORS.red,
            marginBottom: 12,
          }}>
            {error}
          </p>
        )}

        <button
          onClick={handleSave}
          disabled={saving || !dealName.trim()}
          className="jove-tap"
          style={{
            width:         '100%',
            padding:       '15px 0',
            borderRadius:  14,
            border:        'none',
            background:    dealName.trim() && !saving
              ? 'linear-gradient(135deg, #C87820, #E09838)'
              : 'rgba(26,20,16,0.08)',
            color:         dealName.trim() && !saving
              ? 'white'
              : 'rgba(26,20,16,0.28)',
            fontSize:      11,
            fontWeight:    700,
            letterSpacing: '2px',
            textTransform: 'uppercase',
            cursor:        dealName.trim() && !saving ? 'pointer' : 'default',
            fontFamily:    "'DM Sans', sans-serif",
            transition:    TRANSITIONS.button,
            boxShadow:     dealName.trim() && !saving
              ? '0 6px 22px rgba(200,120,32,0.28)'
              : 'none',
          }}
        >
          {saving ? 'Saving...' : 'Add Deal →'}
        </button>
      </div>
    </>
  );
}
