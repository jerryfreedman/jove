'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import {
  COLORS,
  STAGE_STYLES,
  getDaysColor,
} from '@/lib/design-system';
import { PULSE_CHECK_DEFAULT_DAYS } from '@/lib/constants';
import type {
  DealRow,
  AccountRow,
  ContactRow,
} from '@/lib/types';

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
export default function DealsPage() {
  const router   = useRouter();
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
  const [longPressedDealId, setLongPressedDealId] = useState<string | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── FETCH DATA ────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    try {
      setFetchError(false);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/'); return; }
      setUserId(user.id);

      const [dealsRes, accountsRes, contactsRes] = await Promise.all([
        supabase
          .from('deals')
          .select('id, name, stage, last_activity_at, snoozed_until, next_action, account_id, user_id, intel_score')
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
  }, [supabase, router]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    document.body.style.backgroundColor = '#F7F3EC';
  }, []);

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

  // ── GROUP BY ACCOUNT ──────────────────────────────────────
  const grouped: GroupedDeals = {};
  for (const deal of filteredDeals) {
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

  // ── RENDER ─────────────────────────────────────────────────
  return (
    <>
    <div
      style={{
        height:     '100vh',
        overflowY:  'auto',
        background: '#F7F3EC',
        fontFamily: "'DM Sans', sans-serif",
        animation:  'pageReveal 0.28s cubic-bezier(0.22, 1, 0.36, 1) both',
      }}
    >

      {/* ── HEADER ─────────────────────────────────────── */}
      <div style={{
        display:      'flex',
        alignItems:   'center',
        gap:          14,
        paddingTop: 'calc(env(safe-area-inset-top) + 12px)', paddingLeft: '20px', paddingRight: '20px', paddingBottom: '16px',
        borderBottom: '0.5px solid rgba(200,160,80,0.16)',
        background:   '#F7F3EC',
        position:     'sticky',
        top:          0,
        zIndex:       20,
      }}>
        <button
          onClick={() => router.push('/home')}
          style={{
            width:        34,
            height:       34,
            borderRadius: '50%',
            background:   'rgba(200,160,80,0.1)',
            border:       '0.5px solid rgba(200,160,80,0.22)',
            display:      'flex',
            alignItems:   'center',
            justifyContent:'center',
            cursor:       'pointer',
            color:        'rgba(26,20,16,0.5)',
            fontSize:     19,
            flexShrink:   0,
          }}
          aria-label="Back to home"
        >
          ‹
        </button>
        <h1 style={{
          flex:       1,
          fontFamily: "'Cormorant Garamond', serif",
          fontSize:   22,
          fontWeight: 400,
          color:      '#1A1410',
          margin:     0,
        }}>
          Deals
        </h1>
        <button
          onClick={() => router.push('/ideas')}
          style={{
            fontSize:     10,
            fontWeight:   600,
            letterSpacing:'1.5px',
            textTransform:'uppercase',
            color:        'rgba(26,20,16,0.4)',
            padding:      '5px 12px',
            borderRadius: 20,
            border:       '0.5px solid rgba(26,20,16,0.12)',
            background:   'transparent',
            cursor:       'pointer',
            fontFamily:   "'DM Sans', sans-serif",
            marginRight:  6,
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
          border:       '0.5px solid rgba(200,120,32,0.22)',
          background:   'rgba(232,160,48,0.06)',
        }}>
          {activeCount} active
        </div>
      </div>

      {/* ── SEARCH ───────────────────────────────────────── */}
      <div style={{ padding: '14px 18px 0' }}>
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
            <circle cx="7" cy="7" r="5" stroke="#1A1410" strokeWidth="1.5"/>
            <line x1="11" y1="11" x2="14" y2="14"
              stroke="#1A1410" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search deals, accounts, contacts..."
            style={{
              width:        '100%',
              background:   'rgba(26,20,16,0.04)',
              border:       '0.5px solid rgba(26,20,16,0.1)',
              borderRadius: 12,
              padding:      '11px 36px 11px 38px',
              fontSize:     14,
              fontWeight:   300,
              color:        '#1A1410',
              outline:      'none',
              fontFamily:   "'DM Sans', sans-serif",
            }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={{
                position:   'absolute',
                right:      12,
                background: 'none',
                border:     'none',
                cursor:     'pointer',
                color:      'rgba(26,20,16,0.3)',
                fontSize:   18,
                lineHeight: 1,
                padding:    0,
              }}
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* ── SUMMARY STRIP ────────────────────────────────── */}
      <div style={{
        display:    'flex',
        gap:        0,
        margin:     '14px 18px 0',
        border:     '0.5px solid rgba(200,160,80,0.2)',
        borderRadius:14,
        overflow:   'hidden',
        background: '#FFFFFF',
      }}>
        {([
          {
            n:     activeCount,
            label: 'Active',
            mode:  'all' as FilterMode,
            alert: false,
          },
          {
            n:     attentionCount,
            label: 'Attention',
            mode:  'attention' as FilterMode,
            alert: attentionCount > 0,
          },
          {
            n:     accountCount,
            label: 'Accounts',
            mode:  null as FilterMode,
            alert: false,
          },
        ] as const).map((stat, i) => (
          <div
            key={stat.label}
            onClick={() => setFilterMode(
              filterMode === stat.mode ? null : stat.mode
            )}
            style={{
              flex:          1,
              padding:       '13px 0',
              textAlign:     'center',
              borderRight:   i < 2
                ? '0.5px solid rgba(200,160,80,0.15)'
                : 'none',
              cursor:        'pointer',
              background:    filterMode === stat.mode
                ? 'rgba(232,160,48,0.06)'
                : 'transparent',
              transition:    'background 0.18s',
            }}
          >
            <div style={{
              fontSize:   22,
              fontWeight: 300,
              color:      stat.alert
                ? COLORS.red
                : filterMode === stat.mode
                ? COLORS.amber
                : '#1A1410',
              lineHeight: 1,
            }}>
              {stat.n}
            </div>
            <div style={{
              fontSize:     9,
              fontWeight:   600,
              letterSpacing:'1px',
              textTransform:'uppercase',
              color:        'rgba(26,20,16,0.3)',
              marginTop:    4,
            }}>
              {stat.label}
            </div>
          </div>
        ))}
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
            {filterMode === 'attention' ? 'Needs attention' : 'Active deals'}
          </span>
          <button
            onClick={() => setFilterMode(null)}
            style={{
              background: 'none',
              border:     'none',
              color:      'rgba(26,20,16,0.3)',
              fontSize:   13,
              cursor:     'pointer',
              padding:    0,
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
              color:      'rgba(26,20,16,0.44)',
              marginBottom:14,
            }}>
              Couldn&apos;t load your deals.
            </p>
            <button
              onClick={() => { setLoading(true); fetchData(); }}
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
                  background:   'rgba(26,20,16,0.06)',
                  marginBottom: 8,
                  width:        '40%',
                }} />
                <div style={{
                  height:       64,
                  borderRadius: 14,
                  background:   'rgba(26,20,16,0.04)',
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
                  color:      'rgba(26,20,16,0.44)',
                  marginBottom:8,
                }}>
                  Nothing matched
                </p>
                <p style={{
                  fontSize:   13,
                  fontWeight: 300,
                  color:      'rgba(26,20,16,0.3)',
                }}>
                  &ldquo;{searchQuery}&rdquo; — try a contact name, account, or deal.
                </p>
              </>
            ) : (
              <>
                <p style={{
                  fontFamily: "'Cormorant Garamond', serif",
                  fontSize:   26,
                  fontWeight: 300,
                  color:      'rgba(26,20,16,0.44)',
                  marginBottom:8,
                }}>
                  Your pipeline is empty.
                </p>
                <p style={{
                  fontSize:   14,
                  fontWeight: 300,
                  color:      'rgba(26,20,16,0.3)',
                }}>
                  Add your first deal with the + button.
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
                color:        'rgba(26,20,16,0.36)',
              }}>
                {accountName}
              </span>
              <div style={{
                flex:       1,
                height:     '0.5px',
                background: 'rgba(26,20,16,0.1)',
              }} />
              <span style={{
                fontSize:   10,
                fontWeight: 300,
                color:      'rgba(26,20,16,0.28)',
              }}>
                {accountDeals.length}
              </span>
            </div>

            {/* Deal rows */}
            {accountDeals.map(deal => {
              const days      = getDaysSince(deal.last_activity_at);
              const daysColor = getDaysColor(days, true);
              const stage     = STAGE_STYLES[deal.stage] ?? STAGE_STYLES['Prospect'];
              const attention = isNeedsAttention(deal);

              return (
                <div
                  key={deal.id}
                  onClick={() => {
                    if (!longPressedDealId) router.push(`/deals/${deal.id}`);
                  }}
                  onMouseDown={() => {
                    longPressTimer.current = setTimeout(() => {
                      setLongPressedDealId(deal.id);
                    }, 500);
                  }}
                  onMouseUp={() => {
                    if (longPressTimer.current) clearTimeout(longPressTimer.current);
                  }}
                  onMouseLeave={() => {
                    if (longPressTimer.current) clearTimeout(longPressTimer.current);
                  }}
                  onTouchStart={() => {
                    longPressTimer.current = setTimeout(() => {
                      setLongPressedDealId(deal.id);
                    }, 500);
                  }}
                  onTouchEnd={() => {
                    if (longPressTimer.current) clearTimeout(longPressTimer.current);
                  }}
                  style={{
                    position:   'relative',
                    margin:     '0 18px 6px',
                    background: '#FFFFFF',
                    border:     attention
                      ? '0.5px solid rgba(224,88,64,0.22)'
                      : '0.5px solid rgba(200,160,80,0.14)',
                    borderRadius:14,
                    padding:    '14px 16px',
                    display:    'flex',
                    alignItems: 'center',
                    gap:        12,
                    cursor:     'pointer',
                    boxShadow:  '0 1px 6px rgba(26,20,16,0.05)',
                  }}
                >
                  {/* Left: name + next action */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontFamily:   "'Cormorant Garamond', serif",
                      fontSize:     17,
                      fontWeight:   400,
                      color:        '#1A1410',
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
                        color:        'rgba(26,20,16,0.44)',
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
                      color:        stage.color,
                      background:   stage.bg,
                      border:       `0.5px solid ${stage.border}`,
                      borderRadius: 20,
                      padding:      '3px 9px',
                      whiteSpace:   'nowrap',
                    }}>
                      {deal.stage}
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
                    color:      'rgba(26,20,16,0.2)',
                    fontSize:   16,
                    flexShrink: 0,
                  }}>
                    ›
                  </div>

                  {/* Long press overlay */}
                  {longPressedDealId === deal.id && (
                    <div
                      onClick={e => e.stopPropagation()}
                      style={{
                        position: 'absolute',
                        top: 0, left: 0, right: 0, bottom: 0,
                        background: 'rgba(247,243,236,0.96)',
                        borderRadius: 14,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 12,
                        zIndex: 10,
                      }}
                    >
                      <button
                        onClick={async () => {
                          setLongPressedDealId(null);
                          await supabase.from('deals').update({ stage: 'Closed Lost' })
                            .eq('id', deal.id).eq('user_id', userId!);
                          setDeals(prev => prev.filter(d => d.id !== deal.id));
                        }}
                        style={{
                          padding: '8px 16px', borderRadius: 9,
                          border: '0.5px solid rgba(26,20,16,0.15)',
                          background: 'transparent',
                          color: 'rgba(26,20,16,0.5)',
                          fontSize: 10, fontWeight: 700,
                          letterSpacing: '1px', textTransform: 'uppercase',
                          cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
                        }}
                      >Archive</button>
                      <button
                        onClick={async () => {
                          setLongPressedDealId(null);
                          await Promise.all([
                            supabase.from('signals').delete().eq('deal_id', deal.id).eq('user_id', userId!),
                            supabase.from('interactions').delete().eq('deal_id', deal.id).eq('user_id', userId!),
                          ]);
                          await supabase.from('deals').delete().eq('id', deal.id).eq('user_id', userId!);
                          setDeals(prev => prev.filter(d => d.id !== deal.id));
                        }}
                        style={{
                          padding: '8px 16px', borderRadius: 9,
                          border: '0.5px solid rgba(224,88,64,0.25)',
                          background: 'rgba(224,88,64,0.08)',
                          color: '#E05840',
                          fontSize: 10, fontWeight: 700,
                          letterSpacing: '1px', textTransform: 'uppercase',
                          cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
                        }}
                      >Delete</button>
                      <button
                        onClick={() => setLongPressedDealId(null)}
                        style={{
                          padding: '8px 12px', borderRadius: 9,
                          border: 'none', background: 'transparent',
                          color: 'rgba(26,20,16,0.3)',
                          fontSize: 16, cursor: 'pointer',
                        }}
                      >×</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* ── FLOATING + BUTTON ────────────────────────────── */}
      <div style={{
        position:   'fixed',
        bottom:     32,
        right:      'max(calc(50% - 195px + 20px), 20px)',
        zIndex:     30,
      }}>
        <button
          onClick={() => setShowAddDeal(true)}
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
          onClose={() => setShowAddDeal(false)}
          onSaved={() => {
            setShowAddDeal(false);
            fetchData();
          }}
        />
      )}

    </div>
    </>
  );
}

// ── ADD DEAL SHEET COMPONENT ───────────────────────────────
function AddDealSheet({
  userId,
  accounts,
  onClose,
  onSaved,
}: {
  userId:   string;
  accounts: AccountRow[];
  onClose:  () => void;
  onSaved:  () => void;
}) {
  const supabase = createClient();

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
          zIndex:        290,
          background:    'rgba(26,20,16,0.4)',
          backdropFilter:'blur(4px)',
          opacity:       visible ? 1 : 0,
          transition:    'opacity 0.2s ease',
        }}
      />
      <div style={{
        position:     'fixed',
        bottom:       0,
        left:         '50%',
        transform:    visible
          ? 'translateX(-50%) translateY(0)'
          : 'translateX(-50%) translateY(100%)',
        transition:   'transform 0.32s cubic-bezier(.32,.72,0,1)',
        zIndex:       300,
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
          New Deal
        </h2>

        {/* Deal name */}
        <input
          type="text"
          value={dealName}
          onChange={e => setDealName(e.target.value)}
          placeholder="Deal name"
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
                transition:   'all 0.18s',
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
            transition:    'all 0.2s',
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
