'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import {
  COLORS,
  STAGE_STYLES,
  getDaysColor,
} from '@/lib/design-system';
import type {
  DealRow,
  DealStage,
  AccountRow,
  ContactRow,
  InteractionRow,
  InteractionType,
} from '@/lib/types';
import SpotlightTour, { TourStop } from '@/components/onboarding/SpotlightTour';

// ── HELPERS ────────────────────────────────────────────────
function getDaysSince(dateStr: string): number {
  return Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24)
  );
}

function formatDate(dateStr: string): string {
  const d    = new Date(dateStr);
  const now  = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getInteractionIcon(type: InteractionType): string {
  const icons: Record<InteractionType, string> = {
    debrief:        '🎙',
    email_received: '✉️',
    email_sent:     '📤',
    draft:          '✍️',
    idea:           '💡',
    note:           '📝',
    meeting_log:    '🤝',
  };
  return icons[type] ?? '📝';
}

function getIntelColor(score: number): string {
  if (score > 70) return COLORS.green;
  if (score > 40) return COLORS.amber;
  return COLORS.red;
}

// ── COMPONENT ──────────────────────────────────────────────
export default function DealDetailPage() {
  const router   = useRouter();
  const params   = useParams();
  const supabase = createClient();
  const dealId   = params.id as string;

  const [deal, setDeal]         = useState<DealRow | null>(null);
  const [account, setAccount]   = useState<AccountRow | null>(null);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [interactions, setInteractions] = useState<InteractionRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [userId, setUserId]     = useState<string | null>(null);

  // Inline edit states
  const [editingName, setEditingName]           = useState(false);
  const [editingNextAction, setEditingNextAction] = useState(false);
  const [editingValue, setEditingValue]         = useState(false);
  const [editingStage, setEditingStage]         = useState(false);
  const [editingAccount, setEditingAccount]     = useState(false);
  const [accountInput, setAccountInput]         = useState('');
  const [savingAccount, setSavingAccount]       = useState(false);
  const [accountConfirm, setAccountConfirm]     = useState('');
  const [nameInput, setNameInput]               = useState('');
  const [nextActionInput, setNextActionInput]   = useState('');
  const [valueInput, setValueInput]             = useState('');
  const [notesInput, setNotesInput]             = useState('');

  // Contacts state
  const [showAddContact, setShowAddContact]     = useState(false);
  const [newContactName, setNewContactName]     = useState('');
  const [newContactTitle, setNewContactTitle]   = useState('');
  const [newContactEmail, setNewContactEmail]   = useState('');
  const [newContactChampion, setNewContactChampion] = useState(false);
  const [savingContact, setSavingContact]       = useState(false);

  // History state
  const [showLogSheet, setShowLogSheet]         = useState(false);
  const [expandedInteractions, setExpandedInteractions] = useState<Set<string>>(new Set());

  // Log sheet state
  const [logType, setLogType]     = useState<'email' | 'call' | 'meeting' | 'note'>('note');
  const [logContent, setLogContent] = useState('');
  const [savingLog, setSavingLog] = useState(false);

  const [copyConfirmed, setCopyConfirmed] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close deal state
  const [showCloseScreen, setShowCloseScreen] = useState(false);
  const [closeType, setCloseType]           = useState<'Closed Won' | 'Closed Lost' | null>(null);
  const [closeReason, setCloseReason]       = useState('');

  // Tour state
  const [isNewUser, setIsNewUser]           = useState(false);
  const [showDrawerTour, setShowDrawerTour] = useState(false);
  const chatRef  = useRef<HTMLDivElement>(null);

  // ── FETCH DATA ─────────────────────────────────────────
  const fetchData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/'); return; }
    setUserId(user.id);

    const [dealRes, interactionsRes] = await Promise.all([
      supabase
        .from('deals')
        .select('*, accounts(*)')
        .eq('id', dealId)
        .eq('user_id', user.id)
        .single(),
      supabase
        .from('interactions')
        .select('*')
        .eq('deal_id', dealId)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(15),
    ]);

    if (dealRes.error || !dealRes.data) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    const dealData = dealRes.data as DealRow & {
      accounts: AccountRow;
    };

    // Fetch contacts via account_id (contacts belong to accounts, not deals)
    const { data: contactsData } = await supabase
      .from('contacts')
      .select('*')
      .eq('account_id', dealData.account_id)
      .eq('user_id', user.id);

    setDeal(dealData);
    setAccount(dealData.accounts);
    setContacts((contactsData ?? []) as ContactRow[]);
    setInteractions((interactionsRes.data ?? []) as InteractionRow[]);

    // Init edit inputs
    setNameInput(dealData.name);
    setNextActionInput(dealData.next_action ?? '');
    setValueInput(dealData.value ? String(dealData.value) : '');
    setNotesInput(dealData.notes ?? '');

    // Check if new user (< 7 days)
    const { data: userData } = await supabase
      .from('users')
      .select('created_at')
      .eq('id', user.id)
      .single();
    const createdAt = userData?.created_at
      ? new Date(userData.created_at)
      : new Date();
    const daysSinceCreation =
      (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
    setIsNewUser(daysSinceCreation <= 7);

    setLoading(false);
  }, [supabase, dealId, router]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    document.body.style.backgroundColor = '#F7F3EC';
  }, []);

  // Tour trigger — only for new users
  useEffect(() => {
    if (!isNewUser) return;
    if (localStorage.getItem('jove_tour_deal_drawer') === 'true') return;
    const timer = setTimeout(() => setShowDrawerTour(true), 600);
    return () => clearTimeout(timer);
  }, [isNewUser]);

  // ── REALTIME — interactions update when extraction completes ──
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`deal-${dealId}-interactions`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'interactions',
        filter: `deal_id=eq.${dealId}`,
      }, () => { fetchData(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, dealId, supabase, fetchData]);

  // ── INLINE SAVES ──────────────────────────────────────────
  const saveDealField = async (field: string, value: unknown) => {
    if (!deal || !userId) return;
    await supabase
      .from('deals')
      .update({ [field]: value })
      .eq('id', dealId)
      .eq('user_id', userId);
    setDeal(d => d ? { ...d, [field]: value } as DealRow : d);
  };

  const handleSaveName = async () => {
    if (!nameInput.trim()) return;
    await saveDealField('name', nameInput.trim());
    setEditingName(false);
  };

  const handleSaveNextAction = async () => {
    if (!nextActionInput.trim()) return;
    await supabase
      .from('deals')
      .update({
        next_action:           nextActionInput.trim(),
        next_action_confirmed: true,
      })
      .eq('id', dealId)
      .eq('user_id', userId!);
    setDeal(d => d ? {
      ...d,
      next_action:           nextActionInput.trim(),
      next_action_confirmed: true,
    } : d);
    setEditingNextAction(false);
  };

  const handleSaveValue = async () => {
    const num = parseFloat(valueInput);
    await saveDealField('value', isNaN(num) ? null : num);
    setEditingValue(false);
    localStorage.setItem('jove_deals_refresh', String(Date.now()));
  };

  const handleSaveValueType = async (
    type: 'mrr' | 'arr' | 'one_time'
  ) => {
    if (!userId) return;
    await supabase
      .from('deals')
      .update({ value_type: type })
      .eq('id', dealId)
      .eq('user_id', userId);
    setDeal(d => d ? { ...d, value_type: type } : d);
    localStorage.setItem('jove_deals_refresh', String(Date.now()));
  };

  const handleNotesChange = (val: string) => {
    setNotesInput(val);
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(async () => {
      await saveDealField('notes', val);
    }, 600);
  };

  // ── STAGE SAVE ────────────────────────────────────────────
  const handleSaveStage = async (newStage: DealStage) => {
    await saveDealField('stage', newStage);
    setEditingStage(false);
    localStorage.setItem('jove_deals_refresh', String(Date.now()));
  };

  // ── ACCOUNT ASSOCIATION SAVE ─────────────────────────────
  const handleSaveAccount = async () => {
    if (!userId || !deal) return;
    const trimmed = accountInput.trim();
    if (!trimmed) {
      setEditingAccount(false);
      return;
    }
    // If identical to current account name (case-insensitive), exit without write
    if (account?.name && trimmed.toLowerCase() === account.name.trim().toLowerCase()) {
      setEditingAccount(false);
      return;
    }
    setSavingAccount(true);
    // Search for existing account (case-insensitive, user-scoped)
    const { data: matchedAccounts } = await supabase
      .from('accounts')
      .select('id, name')
      .eq('user_id', userId)
      .ilike('name', trimmed);

    let targetAccountId: string;
    let targetAccountName: string;

    if (matchedAccounts && matchedAccounts.length > 0) {
      // Use the first match
      targetAccountId = matchedAccounts[0].id;
      targetAccountName = matchedAccounts[0].name;
    } else {
      // Create new account with minimal fields
      const { data: newAccount, error } = await supabase
        .from('accounts')
        .insert({ user_id: userId, name: trimmed })
        .select('id, name')
        .single();
      if (error || !newAccount) {
        setSavingAccount(false);
        return;
      }
      targetAccountId = newAccount.id;
      targetAccountName = newAccount.name;
    }

    // Update deal.account_id (no last_activity_at)
    await supabase
      .from('deals')
      .update({ account_id: targetAccountId })
      .eq('id', dealId)
      .eq('user_id', userId);

    // Update local state immediately
    setDeal(d => d ? { ...d, account_id: targetAccountId } as DealRow : d);
    setAccount(prev => prev
      ? { ...prev, id: targetAccountId, name: targetAccountName }
      : { id: targetAccountId, user_id: userId, name: targetAccountName, industry: null, website: null, notes: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() } as AccountRow
    );
    setAccountInput(targetAccountName);
    setSavingAccount(false);
    setEditingAccount(false);
    setAccountConfirm('Account updated');
    setTimeout(() => setAccountConfirm(''), 2000);
  };

  // ── COPY STATUS ───────────────────────────────────────────
  const handleCopyStatus = () => {
    if (!deal) return;
    const days = getDaysSince(deal.last_activity_at);
    const text = `${deal.name} — ${deal.stage} — ${
      deal.next_action ?? 'No next action'
    } — Last activity: ${days} days ago`;
    navigator.clipboard.writeText(text);
    setCopyConfirmed(true);
    setTimeout(() => setCopyConfirmed(false), 1800);
  };

  // ── CLOSE DEAL ──────────────────────────────────────────────
  const handleCloseDeal = async () => {
    if (!userId || !closeType) return;

    setShowCloseScreen(false);
    setCloseType(null);
    setCloseReason('');

    // Save close reason as a signal
    if (closeReason.trim()) {
      const { data: closeInteraction } = await supabase.from('interactions').insert({
        user_id:           userId,
        deal_id:           dealId,
        type:              'note',
        raw_content:       `${closeType}: ${closeReason.trim()}`,
        extraction_status: 'pending',
        // ── Session 2: Memory upgrade fields ──
        source_surface:    'deal_chat',
        origin:            'user',
        intent_type:       'capture',
      }).select('id').single();

      // Fire extraction for close reason — fire and forget
      if (closeInteraction?.id) {
        fetch('/api/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            interactionId: closeInteraction.id,
            userId,
          }),
        }).catch(() => {});
      }
    }

    // Update deal stage
    await supabase
      .from('deals')
      .update({
        stage:            closeType,
        last_activity_at: new Date().toISOString(),
      })
      .eq('id', dealId)
      .eq('user_id', userId);

    // If Closed Won — trigger logo bloom
    if (closeType === 'Closed Won') {
      localStorage.setItem('jove_bloom_trigger', String(Date.now()));
    }

    router.push('/deals');
  };

  // ── DELETE DEAL ─────────────────────────────────────────────
  const handleDeleteDeal = async () => {
    if (!userId) return;
    await Promise.all([
      supabase.from('signals').delete()
        .eq('deal_id', dealId).eq('user_id', userId),
      supabase.from('interactions').delete()
        .eq('deal_id', dealId).eq('user_id', userId),
    ]);
    await supabase.from('deals').delete()
      .eq('id', dealId).eq('user_id', userId);
    router.push('/deals');
  };

  // ── CHAMPION TOGGLE ───────────────────────────────────────
  const handleToggleChampion = async (contact: ContactRow) => {
    await supabase
      .from('contacts')
      .update({ is_champion: !contact.is_champion })
      .eq('id', contact.id);
    setContacts(cs => cs.map(c =>
      c.id === contact.id ? { ...c, is_champion: !c.is_champion } : c
    ));
  };

  // ── ADD CONTACT ───────────────────────────────────────────
  const handleAddContact = async () => {
    if (!newContactName.trim() || !userId || !account) return;
    setSavingContact(true);
    const { data, error } = await supabase
      .from('contacts')
      .insert({
        user_id:    userId,
        account_id: account.id,
        name:       newContactName.trim(),
        title:      newContactTitle.trim() || null,
        email:      newContactEmail.trim() || null,
        is_champion:newContactChampion,
      })
      .select('*')
      .single();

    if (!error && data) {
      setContacts(cs => [...cs, data as ContactRow]);
      setNewContactName('');
      setNewContactTitle('');
      setNewContactEmail('');
      setNewContactChampion(false);
      setShowAddContact(false);
    }
    setSavingContact(false);
  };

  // ── LOG INTERACTION ───────────────────────────────────────
  const handleLogInteraction = async () => {
    if (!logContent.trim() || !userId) return;
    setSavingLog(true);

    const typeMap: Record<string, InteractionType> = {
      email:   'email_sent',
      call:    'debrief',
      meeting: 'meeting_log',
      note:    'note',
    };

    const { data, error } = await supabase
      .from('interactions')
      .insert({
        user_id:          userId,
        deal_id:          dealId,
        type:             typeMap[logType],
        raw_content:      logContent.trim(),
        extraction_status:'pending',
      })
      .select('*')
      .single();

    if (!error && data) {
      setInteractions(prev => [data as InteractionRow, ...prev]);
      await supabase
        .from('deals')
        .update({ last_activity_at: new Date().toISOString() })
        .eq('id', dealId)
        .eq('user_id', userId);
      setLogContent('');
      setShowLogSheet(false);

      // Fire extraction in background
      fetch('/api/extract', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          interactionId: (data as InteractionRow).id,
          userId,
        }),
      }).catch(console.error);
    }
    setSavingLog(false);
  };

  // ── TOGGLE EXPAND INTERACTION ─────────────────────────────
  const toggleExpand = (id: string) => {
    setExpandedInteractions(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  };

  // ── INPUT STYLE ───────────────────────────────────────────
  const inputStyle: React.CSSProperties = {
    width:        '100%',
    background:   '#FFFFFF',
    border:       '0.5px solid rgba(232,160,48,0.4)',
    borderRadius: 10,
    padding:      '10px 13px',
    fontSize:     14,
    fontWeight:   300,
    color:        '#1A1410',
    outline:      'none',
    fontFamily:   "'DM Sans', sans-serif",
  };

  if (loading) {
    return (
      <div style={{
        height:     '100vh',
        background: '#F7F3EC',
        paddingTop: 'calc(env(safe-area-inset-top) + 12px)', paddingLeft: '20px', paddingRight: '20px',
      }}>
        {[1,2,3].map(i => (
          <div key={i} style={{
            height:       20,
            borderRadius: 10,
            background:   'rgba(26,20,16,0.06)',
            marginBottom: 14,
            width:        i === 3 ? '60%' : '90%',
          }} />
        ))}
      </div>
    );
  }

  if (notFound || !deal) {
    return (
      <div style={{
        height:     '100vh',
        background: '#F7F3EC',
        display:    'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap:        16,
        fontFamily: "'DM Sans', sans-serif",
      }}>
        <div style={{
          fontFamily: "'Cormorant Garamond', serif",
          fontSize:   24,
          fontWeight: 300,
          color:      'rgba(26,20,16,0.44)',
        }}>
          Deal not found.
        </div>
        <button
          onClick={() => router.push('/deals')}
          style={{
            padding:       '10px 24px',
            borderRadius:  10,
            border:        '0.5px solid rgba(200,160,80,0.3)',
            background:    'rgba(200,160,80,0.08)',
            color:         'rgba(26,20,16,0.5)',
            fontSize:      12,
            fontWeight:    500,
            cursor:        'pointer',
            fontFamily:    "'DM Sans', sans-serif",
          }}
        >
          Back to Deals
        </button>
      </div>
    );
  }

  const days      = getDaysSince(deal.last_activity_at);
  const daysColor = getDaysColor(days, true);
  const stage     = STAGE_STYLES[deal.stage] ?? STAGE_STYLES['Prospect'];
  const intelColor = getIntelColor(deal.intel_score ?? 0);

  return (
    <>
    <div style={{
      display:       'flex',
      flexDirection: 'column',
      height:        '100dvh',
      overflow:      'hidden',
      fontFamily:    "'DM Sans', sans-serif",
      animation:     'pageReveal 0.28s cubic-bezier(0.22, 1, 0.36, 1) both',
      background:    '#F7F3EC',
    }}>

      {/* ── HEADER ────────────────────────────────────── */}
      <div style={{
        paddingTop: 'calc(env(safe-area-inset-top) + 12px)', paddingLeft: '20px', paddingRight: '20px', paddingBottom: '16px',
        borderBottom: '0.5px solid rgba(200,160,80,0.16)',
        background:   '#F7F3EC',
        flexShrink:   0,
        zIndex:       20,
      }}>
        <div style={{
          display:      'flex',
          alignItems:   'center',
          marginBottom: 16,
        }}>
          <button
            onClick={() => router.back()}
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
              marginRight:  12,
            }}
          >
            ‹
          </button>

          {/* Deal name — editable */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {editingName ? (
              <input
                autoFocus
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                onBlur={handleSaveName}
                onKeyDown={e => { if (e.key === 'Enter') handleSaveName(); }}
                style={{
                  ...inputStyle,
                  fontSize:   20,
                  fontFamily: "'Cormorant Garamond', serif",
                  fontWeight: 400,
                }}
              />
            ) : (
              <h1
                onClick={() => setEditingName(true)}
                style={{
                  fontFamily:   "'Cormorant Garamond', serif",
                  fontSize:     22,
                  fontWeight:   400,
                  color:        '#1A1410',
                  cursor:       'text',
                  whiteSpace:   'nowrap',
                  overflow:     'hidden',
                  textOverflow: 'ellipsis',
                  margin:       0,
                }}
              >
                {deal.name}
              </h1>
            )}
            {editingAccount ? (
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <input
                  autoFocus
                  value={accountInput}
                  onChange={e => setAccountInput(e.target.value)}
                  onBlur={handleSaveAccount}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleSaveAccount();
                    if (e.key === 'Escape') { setEditingAccount(false); setAccountInput(account?.name ?? ''); }
                  }}
                  placeholder="Account name"
                  disabled={savingAccount}
                  style={{
                    ...inputStyle,
                    fontSize:   13,
                    padding:    '4px 8px',
                    fontWeight: 300,
                  }}
                />
              </div>
            ) : (
              <p
                onClick={() => { setAccountInput(account?.name ?? ''); setEditingAccount(true); }}
                style={{
                  fontSize:   13,
                  fontWeight: 300,
                  color:      'rgba(26,20,16,0.44)',
                  marginTop:  2,
                  cursor:     'text',
                }}
              >
                {account?.name || 'Set account...'}
                {accountConfirm && (
                  <span style={{
                    marginLeft: 8,
                    fontSize:   10,
                    fontWeight: 500,
                    color:      '#48C878',
                  }}>
                    {accountConfirm}
                  </span>
                )}
              </p>
            )}
          </div>

          {/* Copy status button */}
          <button
            onClick={handleCopyStatus}
            title="Copy status"
            style={{
              flexShrink:   0,
              marginLeft:   10,
              background:   copyConfirmed
                ? 'rgba(72,200,120,0.1)'
                : 'rgba(200,160,80,0.08)',
              border:       `0.5px solid ${copyConfirmed
                ? 'rgba(72,200,120,0.3)'
                : 'rgba(200,160,80,0.2)'}`,
              borderRadius: 10,
              padding:      '6px 12px',
              cursor:       'pointer',
              fontSize:     10,
              fontWeight:   600,
              letterSpacing:'1px',
              textTransform:'uppercase',
              color:        copyConfirmed
                ? COLORS.green
                : 'rgba(26,20,16,0.4)',
              fontFamily:   "'DM Sans', sans-serif",
              transition:   'all 0.2s',
            }}
          >
            {copyConfirmed ? '✓ Copied' : 'Copy'}
          </button>
        </div>

        {/* Stage + days + intel */}
        <div style={{
          display:    'flex',
          alignItems: 'center',
          gap:        10,
          flexWrap:   'wrap',
        }}>
          <div style={{ position: 'relative' }}>
            <div
              onClick={() => setEditingStage(!editingStage)}
              style={{
                fontSize:     9,
                fontWeight:   600,
                letterSpacing:'0.8px',
                textTransform:'uppercase',
                color:        stage.color,
                background:   stage.bg,
                border:       `0.5px solid ${stage.border}`,
                borderRadius: 20,
                padding:      '4px 11px',
                cursor:       'pointer',
              }}
            >
              {deal.stage}
            </div>
            {editingStage && (
              <>
              <div
                onClick={() => setEditingStage(false)}
                style={{ position: 'fixed', inset: 0, zIndex: 49 }}
              />
              <div style={{
                position:     'absolute',
                top:          '100%',
                left:         0,
                marginTop:    6,
                background:   '#FFFFFF',
                border:       '0.5px solid rgba(200,160,80,0.28)',
                borderRadius: 12,
                padding:      '6px 0',
                zIndex:       50,
                boxShadow:    '0 8px 24px rgba(26,20,16,0.12)',
                minWidth:     140,
              }}>
                {(['Prospect','Discovery','POC','Proposal','Negotiation','Closed Won','Closed Lost'] as DealStage[]).map(s => {
                  const sStyle = STAGE_STYLES[s] ?? STAGE_STYLES['Prospect'];
                  return (
                    <button
                      key={s}
                      onClick={() => handleSaveStage(s)}
                      style={{
                        display:       'block',
                        width:         '100%',
                        padding:       '8px 14px',
                        background:    deal.stage === s ? sStyle.bg : 'transparent',
                        border:        'none',
                        cursor:        'pointer',
                        fontSize:      11,
                        fontWeight:    deal.stage === s ? 600 : 400,
                        color:         sStyle.color,
                        textAlign:     'left',
                        fontFamily:    "'DM Sans', sans-serif",
                        letterSpacing: '0.3px',
                      }}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
              </>
            )}
          </div>
          <span style={{
            fontSize:   11,
            fontWeight: 500,
            color:      daysColor,
          }}>
            {days}d ago
          </span>

          {/* Intel score bar */}
          {(deal.intel_score ?? 0) > 0 && (
            <div style={{
              display:    'flex',
              alignItems: 'center',
              gap:        6,
              marginLeft: 'auto',
            }}>
              <span style={{
                fontSize:   9,
                fontWeight: 600,
                letterSpacing:'1px',
                textTransform:'uppercase',
                color:      'rgba(26,20,16,0.3)',
              }}>
                Intel
              </span>
              <div style={{
                width:        60,
                height:       4,
                borderRadius: 2,
                background:   'rgba(26,20,16,0.08)',
                overflow:     'hidden',
              }}>
                <div style={{
                  height:       '100%',
                  width:        `${deal.intel_score ?? 0}%`,
                  borderRadius: 2,
                  background:   intelColor,
                  transition:   'width 0.5s ease',
                }} />
              </div>
              <span style={{
                fontSize:   9,
                fontWeight: 600,
                color:      intelColor,
              }}>
                {Math.round(deal.intel_score ?? 0)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── SCROLLABLE CONTENT ────────────────────────────────── */}
      <div style={{
        flex:       1,
        overflowY:  'auto',
      }}>

      {/* ── NEXT ACTION ───────────────────────────────── */}
      <div style={{
        margin:  '14px 18px 0',
        background:'#FFFFFF',
        border:  '0.5px solid rgba(200,160,80,0.16)',
        borderRadius:14,
        padding: '14px 16px',
        boxShadow:'0 1px 6px rgba(26,20,16,0.04)',
      }}>
        <div style={{
          fontSize:     9,
          fontWeight:   700,
          letterSpacing:'2px',
          textTransform:'uppercase',
          color:        'rgba(26,20,16,0.28)',
          marginBottom: 8,
        }}>
          Next Action
        </div>

        {editingNextAction ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              autoFocus
              value={nextActionInput}
              onChange={e => setNextActionInput(e.target.value)}
              onBlur={handleSaveNextAction}
              onKeyDown={e => { if (e.key === 'Enter') handleSaveNextAction(); }}
              placeholder="What's the next step?"
              style={{ ...inputStyle, flex: 1 }}
            />
          </div>
        ) : (
          <div
            onClick={() => setEditingNextAction(true)}
            style={{
              display:    'flex',
              alignItems: 'flex-start',
              gap:        8,
              cursor:     'text',
            }}
          >
            <span style={{
              color:    COLORS.amber,
              fontSize: 14,
              flexShrink:0,
              marginTop:1,
            }}>
              →
            </span>
            <span style={{
              fontSize:   14,
              fontWeight: deal.next_action ? 400 : 300,
              color:      deal.next_action
                ? '#1A1410'
                : 'rgba(26,20,16,0.3)',
              lineHeight: 1.5,
            }}>
              {deal.next_action ?? 'Set a next action...'}
            </span>
          </div>
        )}
      </div>

      {/* ── VALUE + NOTES ─────────────────────────────── */}
      <div style={{
        margin:  '10px 18px 0',
        display: 'flex',
        gap:     10,
      }}>
        {/* Value */}
        <div style={{
          flex:        '0 0 auto',
          background:  '#FFFFFF',
          border:      '0.5px solid rgba(200,160,80,0.16)',
          borderRadius:12,
          padding:     '12px 14px',
          boxShadow:   '0 1px 6px rgba(26,20,16,0.04)',
          minWidth:    100,
        }}>
          <div style={{
            fontSize:     8,
            fontWeight:   700,
            letterSpacing:'2px',
            textTransform:'uppercase',
            color:        'rgba(26,20,16,0.28)',
            marginBottom: 6,
          }}>
            Value
          </div>
          {editingValue ? (
            <div>
              <input
                autoFocus
                type="number"
                value={valueInput}
                onChange={e => setValueInput(e.target.value)}
                onBlur={handleSaveValue}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleSaveValue();
                }}
                placeholder="0"
                style={{
                  ...inputStyle,
                  padding:      '6px 8px',
                  fontSize:     14,
                  width:        '100%',
                  marginBottom: 8,
                }}
              />
              <div style={{ display: 'flex', gap: 6 }}>
                {([
                  { key: 'mrr' as const,      label: 'MRR'      },
                  { key: 'arr' as const,      label: 'ARR'      },
                  { key: 'one_time' as const, label: 'One-time' },
                ]).map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => handleSaveValueType(key)}
                    style={{
                      flex:          1,
                      padding:       '6px 0',
                      borderRadius:  8,
                      border:        '0.5px solid',
                      borderColor:   (deal?.value_type ?? 'arr') === key
                        ? 'rgba(232,160,48,0.5)'
                        : 'rgba(26,20,16,0.1)',
                      background:    (deal?.value_type ?? 'arr') === key
                        ? 'rgba(232,160,48,0.1)'
                        : 'transparent',
                      color:         (deal?.value_type ?? 'arr') === key
                        ? '#E8A030'
                        : 'rgba(26,20,16,0.4)',
                      fontSize:      9,
                      fontWeight:    (deal?.value_type ?? 'arr') === key
                        ? 700 : 300,
                      cursor:        'pointer',
                      fontFamily:    "'DM Sans', sans-serif",
                      textTransform: 'uppercase' as const,
                      letterSpacing: '1px',
                      transition:    'all 0.18s',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div
              onClick={() => setEditingValue(true)}
              style={{ cursor: 'text' }}
            >
              <div style={{
                display:    'flex',
                alignItems: 'baseline',
                gap:        6,
              }}>
                <span style={{
                  fontSize:   15,
                  fontWeight: 300,
                  color:      deal?.value
                    ? '#1A1410'
                    : 'rgba(26,20,16,0.28)',
                }}>
                  {deal?.value
                    ? `$${Number(deal.value).toLocaleString()}`
                    : '—'}
                </span>
                {deal?.value && (
                  <span style={{
                    fontSize:     9,
                    fontWeight:   600,
                    letterSpacing:'1px',
                    textTransform:'uppercase',
                    color:        'rgba(26,20,16,0.36)',
                  }}>
                    {deal.value_type === 'one_time'
                      ? 'One-time'
                      : (deal.value_type ?? 'arr').toUpperCase()}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Notes */}
        <div style={{
          flex:        1,
          background:  '#FFFFFF',
          border:      '0.5px solid rgba(200,160,80,0.16)',
          borderRadius:12,
          padding:     '12px 14px',
          boxShadow:   '0 1px 6px rgba(26,20,16,0.04)',
        }}>
          <div style={{
            fontSize:     8,
            fontWeight:   700,
            letterSpacing:'2px',
            textTransform:'uppercase',
            color:        'rgba(26,20,16,0.28)',
            marginBottom: 6,
          }}>
            Notes
          </div>
          <textarea
            value={notesInput}
            onChange={e => handleNotesChange(e.target.value)}
            placeholder="Standing context — budget, timeline, key constraints. For activity, use Capture."
            rows={2}
            style={{
              width:      '100%',
              background: 'transparent',
              border:     'none',
              outline:    'none',
              fontSize:   13,
              fontWeight: 300,
              color:      notesInput ? '#1A1410' : 'rgba(26,20,16,0.3)',
              fontFamily: "'DM Sans', sans-serif",
              resize:     'none',
              lineHeight: 1.55,
              padding:    0,
            }}
          />
        </div>
      </div>

      {/* ── CONTACTS SECTION ──────────────────────────── */}
      <div style={{ margin: '18px 18px 0' }}>
        <div style={{
          display:      'flex',
          alignItems:   'center',
          marginBottom: 10,
        }}>
          <h2 style={{
            flex:       1,
            fontFamily: "'Cormorant Garamond', serif",
            fontSize:   19,
            fontWeight: 400,
            color:      '#1A1410',
            margin:     0,
          }}>
            Contacts
          </h2>
          <button
            onClick={() => setShowAddContact(!showAddContact)}
            style={{
              background:   'none',
              border:       'none',
              cursor:       'pointer',
              fontSize:     11,
              fontWeight:   600,
              letterSpacing:'1px',
              textTransform:'uppercase',
              color:        COLORS.amber,
              fontFamily:   "'DM Sans', sans-serif",
              padding:      0,
            }}
          >
            + Add
          </button>
        </div>

        {/* Add contact form */}
        {showAddContact && (
          <div style={{
            background:   '#FFFFFF',
            border:       '0.5px solid rgba(232,160,48,0.28)',
            borderRadius: 14,
            padding:      '14px 16px',
            marginBottom: 10,
          }}>
            <input
              autoFocus
              value={newContactName}
              onChange={e => setNewContactName(e.target.value)}
              placeholder="Name (required)"
              style={{ ...inputStyle, marginBottom: 8 }}
            />
            <input
              value={newContactTitle}
              onChange={e => setNewContactTitle(e.target.value)}
              placeholder="Title (optional)"
              style={{ ...inputStyle, marginBottom: 8 }}
            />
            <input
              value={newContactEmail}
              onChange={e => setNewContactEmail(e.target.value)}
              placeholder="Email (optional)"
              type="email"
              style={{ ...inputStyle, marginBottom: 10 }}
            />
            <div style={{
              display:      'flex',
              alignItems:   'center',
              gap:          10,
              marginBottom: 12,
            }}>
              <button
                onClick={() => setNewContactChampion(!newContactChampion)}
                style={{
                  background: 'none',
                  border:     'none',
                  cursor:     'pointer',
                  fontSize:   18,
                  padding:    0,
                }}
              >
                {newContactChampion ? '⭐' : '☆'}
              </button>
              <span style={{
                fontSize:   12,
                fontWeight: 300,
                color:      'rgba(26,20,16,0.5)',
              }}>
                Mark as champion
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleAddContact}
                disabled={savingContact || !newContactName.trim()}
                style={{
                  flex:          1,
                  padding:       '10px 0',
                  borderRadius:  10,
                  border:        'none',
                  background:    newContactName.trim()
                    ? 'linear-gradient(135deg, #C87820, #E09838)'
                    : 'rgba(26,20,16,0.08)',
                  color:         newContactName.trim() ? 'white' : 'rgba(26,20,16,0.3)',
                  fontSize:      11,
                  fontWeight:    700,
                  letterSpacing: '1.5px',
                  textTransform: 'uppercase',
                  cursor:        newContactName.trim() ? 'pointer' : 'default',
                  fontFamily:    "'DM Sans', sans-serif",
                }}
              >
                {savingContact ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => {
                  setShowAddContact(false);
                  setNewContactName('');
                  setNewContactTitle('');
                  setNewContactEmail('');
                }}
                style={{
                  padding:    '10px 16px',
                  borderRadius:10,
                  border:     '0.5px solid rgba(26,20,16,0.12)',
                  background: 'transparent',
                  color:      'rgba(26,20,16,0.4)',
                  fontSize:   11,
                  fontWeight: 500,
                  cursor:     'pointer',
                  fontFamily: "'DM Sans', sans-serif",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {contacts.length === 0 && !showAddContact && (
          <p style={{
            fontSize:   13,
            fontWeight: 300,
            color:      'rgba(26,20,16,0.36)',
            padding:    '8px 0',
          }}>
            No contacts yet — tap + Add to add someone.
          </p>
        )}

        {contacts.map(contact => (
          <div
            key={contact.id}
            style={{
              background:   '#FFFFFF',
              border:       '0.5px solid rgba(200,160,80,0.14)',
              borderRadius: 14,
              padding:      '13px 16px',
              marginBottom: 8,
              boxShadow:    '0 1px 5px rgba(26,20,16,0.04)',
            }}
          >
            <div style={{
              display:     'flex',
              alignItems:  'flex-start',
              gap:         10,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize:   15,
                  fontWeight: 500,
                  color:      '#1A1410',
                  marginBottom:2,
                }}>
                  {contact.name}
                </div>
                {contact.title && (
                  <div style={{
                    fontSize:   12,
                    fontWeight: 300,
                    color:      'rgba(26,20,16,0.44)',
                    marginBottom:contact.email ? 3 : 0,
                  }}>
                    {contact.title}
                  </div>
                )}
                {contact.email && (
                  <div
                    onClick={() => navigator.clipboard.writeText(contact.email!)}
                    style={{
                      fontSize:   11,
                      fontWeight: 300,
                      color:      COLORS.amber,
                      cursor:     'pointer',
                      marginBottom:contact.relationship_summary ? 6 : 0,
                    }}
                    title="Tap to copy email"
                  >
                    {contact.email}
                  </div>
                )}
                {contact.relationship_summary && (
                  <div style={{
                    fontSize:   12,
                    fontWeight: 300,
                    color:      'rgba(26,20,16,0.52)',
                    lineHeight: 1.55,
                    marginTop:  4,
                    paddingTop: 8,
                    borderTop:  '0.5px solid rgba(26,20,16,0.06)',
                  }}>
                    {contact.relationship_summary}
                  </div>
                )}
              </div>

              {/* Champion star */}
              <button
                onClick={() => handleToggleChampion(contact)}
                style={{
                  background: 'none',
                  border:     'none',
                  cursor:     'pointer',
                  fontSize:   20,
                  padding:    0,
                  flexShrink: 0,
                  lineHeight: 1,
                }}
                title={contact.is_champion ? 'Remove champion' : 'Mark as champion'}
              >
                {contact.is_champion ? '⭐' : '☆'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* ── HISTORY SECTION ───────────────────────────── */}
      <div style={{ margin: '18px 18px 0' }}>
        <div style={{
          display:      'flex',
          alignItems:   'center',
          marginBottom: 10,
        }}>
          <h2 style={{
            flex:       1,
            fontFamily: "'Cormorant Garamond', serif",
            fontSize:   19,
            fontWeight: 400,
            color:      '#1A1410',
            margin:     0,
          }}>
            History
          </h2>
          <button
            onClick={() => setShowLogSheet(true)}
            style={{
              background:   'none',
              border:       'none',
              cursor:       'pointer',
              fontSize:     11,
              fontWeight:   600,
              letterSpacing:'1px',
              textTransform:'uppercase',
              color:        COLORS.amber,
              fontFamily:   "'DM Sans', sans-serif",
              padding:      0,
            }}
          >
            + Log
          </button>
        </div>

        {interactions.length === 0 && (
          <p style={{
            fontSize:   13,
            fontWeight: 300,
            color:      'rgba(26,20,16,0.36)',
            lineHeight: 1.6,
          }}>
            No history yet — debrief after your first meeting to start building history.
          </p>
        )}

        {interactions.map(interaction => {
          const expanded = expandedInteractions.has(interaction.id);
          const isPending = interaction.extraction_status === 'pending' ||
            interaction.extraction_status === 'processing';
          const content = interaction.raw_content;
          const isLong  = content.length > 120;

          return (
            <div
              key={interaction.id}
              style={{
                background:   '#FFFFFF',
                border:       '0.5px solid rgba(200,160,80,0.14)',
                borderRadius: 12,
                padding:      '12px 14px',
                marginBottom: 8,
                boxShadow:    '0 1px 5px rgba(26,20,16,0.04)',
              }}
            >
              <div style={{
                display:      'flex',
                alignItems:   'flex-start',
                gap:          10,
                marginBottom: 5,
              }}>
                <span style={{ fontSize: 16, flexShrink: 0, lineHeight: 1.3 }}>
                  {getInteractionIcon(interaction.type)}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    display:    'flex',
                    alignItems: 'center',
                    gap:        8,
                    marginBottom:4,
                  }}>
                    <span style={{
                      fontSize:   11,
                      fontWeight: 500,
                      color:      'rgba(26,20,16,0.44)',
                    }}>
                      {formatDate(interaction.created_at)}
                    </span>
                    {isPending && (
                      <span style={{
                        fontSize:     9,
                        fontWeight:   600,
                        letterSpacing:'1px',
                        textTransform:'uppercase',
                        color:        COLORS.amber,
                      }}>
                        Processing...
                      </span>
                    )}
                  </div>
                  <p style={{
                    fontSize:   13,
                    fontWeight: 300,
                    color:      'rgba(26,20,16,0.7)',
                    lineHeight: 1.58,
                    margin:     0,
                    overflow:   expanded ? 'visible' : 'hidden',
                    display:    expanded ? 'block' : '-webkit-box',
                    WebkitLineClamp: expanded ? undefined : 2,
                    WebkitBoxOrient:'vertical',
                  } as React.CSSProperties}>
                    {content}
                  </p>
                  {isLong && (
                    <button
                      onClick={() => toggleExpand(interaction.id)}
                      style={{
                        background: 'none',
                        border:     'none',
                        cursor:     'pointer',
                        fontSize:   11,
                        fontWeight: 500,
                        color:      COLORS.amber,
                        padding:    '4px 0 0',
                        fontFamily: "'DM Sans', sans-serif",
                      }}
                    >
                      {expanded ? 'Show less' : 'Show more'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── CLOSE DEAL — subtle, deliberate ─────────── */}
      <div style={{
        textAlign:  'center',
        padding:    '24px 0 8px',
      }}>
        <button
          onClick={() => setShowCloseScreen(true)}
          style={{
            background:  'none',
            border:      'none',
            color:       'rgba(26,20,16,0.28)',
            fontSize:    12,
            fontWeight:  300,
            fontFamily:  "'DM Sans', sans-serif",
            cursor:      'pointer',
            letterSpacing: '0.3px',
          }}
        >
          Close deal
        </button>
      </div>
      </div>

      {/* ── BOTTOM ACTION BAR ─────────────────────────── */}
      <div style={{
        flexShrink: 0,
        background: '#F7F3EC',
        borderTop:  '0.5px solid rgba(200,160,80,0.2)',
        padding:    '12px 18px env(safe-area-inset-bottom)',
        zIndex:     30,
        display:    'flex',
        gap:        10,
      }}>
        {/* Prep Me */}
        <button
          onClick={() => router.push(`/deals/${dealId}/prep`)}
          style={{
            flex:          1,
            padding:       '13px 0',
            borderRadius:  12,
            border:        'none',
            background:    'linear-gradient(135deg, #C87820, #E09838)',
            color:         'white',
            fontSize:      11,
            fontWeight:    700,
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
            cursor:        'pointer',
            fontFamily:    "'DM Sans', sans-serif",
            boxShadow:     '0 4px 16px rgba(200,120,32,0.28)',
          }}
        >
          Prep Me
        </button>

        {/* Chat */}
        <div ref={chatRef}>
          <button
            onClick={() => router.push(`/deals/${dealId}/chat`)}
            style={{
              flex:          1,
              padding:       '13px 0',
              borderRadius:  12,
              border:        '0.5px solid rgba(200,160,80,0.3)',
              background:    'transparent',
              color:         'rgba(26,20,16,0.6)',
              fontSize:      11,
              fontWeight:    700,
              letterSpacing: '1.5px',
              textTransform: 'uppercase',
              cursor:        'pointer',
              fontFamily:    "'DM Sans', sans-serif",
            }}
          >
            Chat
          </button>
        </div>

      </div>
    </div>

    {/* ── LOG INTERACTION SHEET ─────────────────────── */}
    {showLogSheet && (
      <>
        <div
          onClick={() => setShowLogSheet(false)}
          style={{
            position:      'fixed',
            inset:         0,
            zIndex:        290,
            background:    'rgba(26,20,16,0.4)',
            backdropFilter:'blur(4px)',
          }}
        />
        <div style={{
          position:     'fixed',
          bottom:       0,
          left:         '50%',
          transform:    'translateX(-50%)',
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
          <h3 style={{
            fontFamily:   "'Cormorant Garamond', serif",
            fontSize:     20,
            fontWeight:   400,
            color:        '#1A1410',
            marginBottom: 16,
          }}>
            Log Interaction
          </h3>

          {/* Type selector */}
          <div style={{
            display:      'flex',
            gap:          8,
            marginBottom: 14,
          }}>
            {(['email','call','meeting','note'] as const).map(t => (
              <button
                key={t}
                onClick={() => setLogType(t)}
                style={{
                  padding:      '7px 14px',
                  borderRadius: 20,
                  border:       '0.5px solid',
                  borderColor:  logType === t
                    ? 'rgba(232,160,48,0.5)'
                    : 'rgba(26,20,16,0.12)',
                  background:   logType === t
                    ? 'rgba(232,160,48,0.1)'
                    : '#FFFFFF',
                  color:        logType === t
                    ? COLORS.amber
                    : 'rgba(26,20,16,0.44)',
                  fontSize:     11,
                  fontWeight:   logType === t ? 600 : 300,
                  cursor:       'pointer',
                  fontFamily:   "'DM Sans', sans-serif",
                  textTransform:'capitalize',
                  transition:   'all 0.18s',
                }}
              >
                {t}
              </button>
            ))}
          </div>

          <textarea
            autoFocus
            value={logContent}
            onChange={e => setLogContent(e.target.value)}
            placeholder="What happened?"
            rows={4}
            style={{
              width:        '100%',
              background:   '#FFFFFF',
              border:       '0.5px solid rgba(200,160,80,0.28)',
              borderRadius: 14,
              padding:      '14px 16px',
              fontSize:     14,
              fontWeight:   300,
              color:        '#1A1410',
              outline:      'none',
              resize:       'none',
              lineHeight:   1.65,
              marginBottom: 14,
              fontFamily:   "'DM Sans', sans-serif",
            }}
            onFocus={e => { e.target.style.borderColor = 'rgba(232,160,48,0.4)'; }}
            onBlur={e => { e.target.style.borderColor = 'rgba(200,160,80,0.28)'; }}
          />

          <button
            onClick={handleLogInteraction}
            disabled={savingLog || !logContent.trim()}
            style={{
              width:         '100%',
              padding:       '14px 0',
              borderRadius:  14,
              border:        'none',
              background:    logContent.trim() && !savingLog
                ? 'linear-gradient(135deg, #C87820, #E09838)'
                : 'rgba(26,20,16,0.08)',
              color:         logContent.trim() && !savingLog
                ? 'white'
                : 'rgba(26,20,16,0.28)',
              fontSize:      11,
              fontWeight:    700,
              letterSpacing: '2px',
              textTransform: 'uppercase',
              cursor:        logContent.trim() && !savingLog
                ? 'pointer'
                : 'default',
              fontFamily:    "'DM Sans', sans-serif",
              transition:    'all 0.2s',
            }}
          >
            {savingLog ? 'Saving...' : 'Log It →'}
          </button>
        </div>
      </>
    )}

    {/* Deal Drawer Tour */}
    {showDrawerTour && (
      <SpotlightTour
        stops={[
          { ref: chatRef, copy: 'Ask Jove anything about this deal.', position: 'above' as const },
        ]}
        storageKey="jove_tour_deal_drawer"
        onComplete={() => setShowDrawerTour(false)}
      />
    )}

    {/* ── CLOSE DEAL FULL-SCREEN OVERLAY ─────────── */}
    {showCloseScreen && (
      <div style={{
        position:   'fixed',
        inset:       0,
        zIndex:      150,
        background: '#F7F3EC',
        display:    'flex',
        flexDirection: 'column',
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
        {/* Header */}
        <div style={{
          padding:     '16px 20px 12px',
          borderBottom: '0.5px solid rgba(26,20,16,0.08)',
          display:     'flex',
          alignItems:  'center',
          justifyContent: 'space-between',
        }}>
          <span style={{
            fontFamily: "'Cormorant Garamond', serif",
            fontSize:   22,
            fontWeight: 500,
            color:      '#1A1410',
          }}>
            Close deal
          </span>
          <button
            onClick={() => {
              setShowCloseScreen(false);
              setCloseType(null);
              setCloseReason('');
            }}
            style={{
              background: 'none', border: 'none',
              color: 'rgba(26,20,16,0.4)',
              fontSize: 14, cursor: 'pointer',
              fontFamily: "'DM Sans', sans-serif",
              padding: '8px',
            }}
          >
            Cancel
          </button>
        </div>

        {/* Deal name */}
        <div style={{
          padding:    '20px 20px 0',
          fontSize:   13,
          fontWeight: 300,
          color:      'rgba(26,20,16,0.5)',
          fontFamily: "'DM Sans', sans-serif",
        }}>
          {deal?.name}
        </div>

        {/* Won / Lost choice */}
        <div style={{
          padding: '20px',
          display: 'flex',
          gap:     12,
        }}>
          {/* Won */}
          <button
            onClick={() => setCloseType('Closed Won')}
            style={{
              flex:         1,
              padding:      '16px 0',
              borderRadius: 14,
              border:       '1.5px solid',
              borderColor:  closeType === 'Closed Won'
                ? '#48C878' : 'rgba(26,20,16,0.1)',
              background:   closeType === 'Closed Won'
                ? 'rgba(72,200,120,0.08)' : 'transparent',
              color:        closeType === 'Closed Won'
                ? '#48C878' : 'rgba(26,20,16,0.4)',
              fontSize:     13,
              fontWeight:   closeType === 'Closed Won' ? 600 : 300,
              fontFamily:   "'DM Sans', sans-serif",
              cursor:       'pointer',
              letterSpacing: '0.5px',
              transition:   'all 0.2s ease',
            }}
          >
            Closed Won
          </button>

          {/* Lost */}
          <button
            onClick={() => setCloseType('Closed Lost')}
            style={{
              flex:         1,
              padding:      '16px 0',
              borderRadius: 14,
              border:       '1.5px solid',
              borderColor:  closeType === 'Closed Lost'
                ? '#E05840' : 'rgba(26,20,16,0.1)',
              background:   closeType === 'Closed Lost'
                ? 'rgba(224,88,64,0.08)' : 'transparent',
              color:        closeType === 'Closed Lost'
                ? '#E05840' : 'rgba(26,20,16,0.4)',
              fontSize:     13,
              fontWeight:   closeType === 'Closed Lost' ? 600 : 300,
              fontFamily:   "'DM Sans', sans-serif",
              cursor:       'pointer',
              letterSpacing: '0.5px',
              transition:   'all 0.2s ease',
            }}
          >
            Closed Lost
          </button>
        </div>

        {/* Reason textarea — always visible */}
        <div style={{ padding: '0 20px' }}>
          <textarea
            value={closeReason}
            onChange={e => setCloseReason(e.target.value)}
            placeholder={
              closeType === 'Closed Won'
                ? "What made this a win? (optional)"
                : closeType === 'Closed Lost'
                  ? "Why did this close lost? (optional)"
                  : "Add context... (optional)"
            }
            rows={4}
            style={{
              width:      '100%',
              background: 'white',
              border:     '0.5px solid rgba(26,20,16,0.12)',
              borderRadius: 12,
              padding:    '12px 14px',
              fontSize:   14,
              fontWeight: 300,
              color:      '#1A1410',
              fontFamily: "'DM Sans', sans-serif",
              resize:     'none',
              outline:    'none',
              lineHeight: 1.55,
              boxSizing:  'border-box',
            }}
          />
        </div>

        {/* Confirm button — only active when Won or Lost selected */}
        <div style={{ padding: '16px 20px' }}>
          <button
            onClick={closeType ? handleCloseDeal : undefined}
            disabled={!closeType}
            style={{
              width:        '100%',
              padding:      '16px 0',
              borderRadius: 14,
              border:       'none',
              background:   !closeType
                ? 'rgba(26,20,16,0.08)'
                : closeType === 'Closed Won'
                  ? 'linear-gradient(135deg, #38A85A, #48C878)'
                  : 'linear-gradient(135deg, #C04830, #E05840)',
              color:        !closeType
                ? 'rgba(26,20,16,0.28)' : 'white',
              fontSize:     15,
              fontWeight:   600,
              fontFamily:   "'DM Sans', sans-serif",
              cursor:       closeType ? 'pointer' : 'default',
              transition:   'all 0.2s ease',
              letterSpacing: '0.3px',
            }}
          >
            {!closeType
              ? 'Select Won or Lost'
              : closeType === 'Closed Won'
                ? 'Confirm Win'
                : 'Confirm Loss'}
          </button>
        </div>

        {/* Spacer to push delete deal to bottom */}
        <div style={{ flex: 1 }} />

        {/* Delete deal — buried at very bottom */}
        <div style={{
          padding:    '0 20px 24px',
          textAlign:  'center',
        }}>
          <button
            onClick={() => setConfirmDelete(true)}
            style={{
              background:  'none',
              border:      'none',
              color:       'rgba(224,88,64,0.35)',
              fontSize:    11,
              fontWeight:  300,
              fontFamily:  "'DM Sans', sans-serif",
              cursor:      'pointer',
              letterSpacing: '0.3px',
            }}
          >
            Delete this deal permanently
          </button>

          {confirmDelete && (
            <div style={{
              marginTop:    12,
              padding:      '14px 16px',
              background:   'rgba(224,88,64,0.06)',
              borderRadius: 12,
              border:       '0.5px solid rgba(224,88,64,0.2)',
            }}>
              <div style={{
                fontSize:     13,
                fontWeight:   300,
                color:        '#E05840',
                marginBottom: 12,
                fontFamily:   "'DM Sans', sans-serif",
                lineHeight:   1.5,
              }}>
                Permanently delete this deal and all its history?
                This cannot be undone.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={handleDeleteDeal}
                  style={{
                    flex: 1, padding: '10px 0',
                    borderRadius: 10, border: 'none',
                    background: '#E05840', color: 'white',
                    fontSize: 12, fontWeight: 600,
                    fontFamily: "'DM Sans', sans-serif",
                    cursor: 'pointer',
                  }}
                >
                  Yes, Delete
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  style={{
                    flex: 1, padding: '10px 0',
                    borderRadius: 10,
                    border: '0.5px solid rgba(26,20,16,0.12)',
                    background: 'transparent',
                    color: 'rgba(26,20,16,0.5)',
                    fontSize: 12, fontWeight: 300,
                    fontFamily: "'DM Sans', sans-serif",
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    )}

    </>
  );
}
