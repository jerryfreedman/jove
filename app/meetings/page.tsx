'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { COLORS } from '@/lib/design-system';
import type { MeetingRow, DealRow } from '@/lib/types';

function formatScheduledAt(dateStr: string): string {
  const d    = new Date(dateStr);
  const now  = new Date();
  const diff = Math.floor((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const time = d.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit',
  });
  if (diff === 0)  return `Today · ${time}`;
  if (diff === 1)  return `Tomorrow · ${time}`;
  if (diff === -1) return `Yesterday · ${time}`;
  if (diff < 0)   return `${d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  })} · ${time}`;
  return `${d.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })} · ${time}`;
}

export default function MeetingsPage() {
  const router   = useRouter();
  const supabase = createClient();
  const fileRef  = useRef<HTMLInputElement>(null);

  const [userId, setUserId]       = useState<string | null>(null);
  const [meetings, setMeetings]   = useState<MeetingRow[]>([]);
  const [deals, setDeals]         = useState<DealRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showAdd, setShowAdd]     = useState(false);

  // Add meeting form
  const [newTitle, setNewTitle]       = useState('');
  const [newDate, setNewDate]         = useState('');
  const [newTime, setNewTime]         = useState('');
  const [newDealId, setNewDealId]     = useState('');
  const [newAttendees, setNewAttendees] = useState('');
  const [saving, setSaving]           = useState(false);
  const [editingMeeting, setEditingMeeting] = useState<MeetingRow | null>(null);
  const [showPast, setShowPast]       = useState(false);

  // Screenshot import
  const [importing, setImporting]     = useState(false);
  const [detectedMeetings, setDetectedMeetings] = useState<Array<{
    title: string; date: string; time: string;
    duration_minutes: number; attendees: string | null;
    selected: boolean; dealId: string;
  }>>([]);
  const [showConfirm, setShowConfirm] = useState(false);
  const [bulkSaving, setBulkSaving]   = useState(false);

  const fetchData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/'); return; }
    setUserId(user.id);

    const [meetingsRes, dealsRes] = await Promise.all([
      supabase
        .from('meetings')
        .select('*')
        .eq('user_id', user.id)
        .order('scheduled_at', { ascending: true }),
      supabase
        .from('deals')
        .select('*')
        .eq('user_id', user.id)
        .not('stage', 'in', '("Closed Won","Closed Lost")')
        .order('name'),
    ]);

    setMeetings((meetingsRes.data ?? []) as MeetingRow[]);
    setDeals((dealsRes.data ?? []) as DealRow[]);
    setLoading(false);
  }, [supabase, router]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    document.body.style.backgroundColor = '#F7F3EC';
  }, []);

  const handleAddMeeting = async () => {
    if (!newTitle.trim() || !newDate || !newTime || !userId) return;
    setSaving(true);

    const scheduledAt = new Date(`${newDate}T${newTime}`).toISOString();

    const { error } = await supabase.from('meetings').insert({
      user_id:      userId,
      title:        newTitle.trim(),
      scheduled_at: scheduledAt,
      deal_id:      newDealId || null,
      attendees:    newAttendees.trim() || null,
      source:       'manual',
    });

    if (!error) {
      setNewTitle('');
      setNewDate('');
      setNewTime('');
      setNewDealId('');
      setNewAttendees('');
      setShowAdd(false);
      fetchData();
    }
    setSaving(false);
  };

  const handleScreenshot = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl    = ev.target?.result as string;
      const base64     = dataUrl.split(',')[1];
      const mimeType   = file.type;

      try {
        const response = await fetch('/api/import-meetings', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ imageBase64: base64, mimeType }),
        });
        const data = await response.json();
        const detected = (data.meetings ?? []).map((m: {
          title: string; date: string; time: string;
          duration_minutes: number; attendees: string | null;
        }) => ({
          ...m,
          selected: true,
          dealId:   '',
        }));
        setDetectedMeetings(detected);
        setShowConfirm(detected.length > 0);
      } catch {
        // Fail silently
      } finally {
        setImporting(false);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleBulkSave = async () => {
    if (!userId) return;
    setBulkSaving(true);

    const toSave = detectedMeetings.filter(m => m.selected);
    for (const m of toSave) {
      const scheduledAt = new Date(`${m.date}T${m.time || '09:00'}`).toISOString();
      await supabase.from('meetings').insert({
        user_id:      userId,
        title:        m.title,
        scheduled_at: scheduledAt,
        deal_id:      m.dealId || null,
        attendees:    m.attendees || null,
        source:       'calendar_screenshot',
      });
    }

    setShowConfirm(false);
    setDetectedMeetings([]);
    setBulkSaving(false);
    fetchData();
  };

  const now      = new Date();
  const upcoming = meetings.filter(m => new Date(m.scheduled_at) >= now);
  const past     = meetings.filter(m => new Date(m.scheduled_at) < now);

  const inputStyle: React.CSSProperties = {
    width:        '100%',
    background:   '#FFFFFF',
    border:       '0.5px solid rgba(26,20,16,0.12)',
    borderRadius: 12,
    padding:      '12px 14px',
    fontSize:     14,
    fontWeight:   300,
    color:        '#1A1410',
    outline:      'none',
    fontFamily:   "'DM Sans', sans-serif",
    marginBottom: 10,
  };

  const MeetingCard = ({ meeting, onTap }: { meeting: MeetingRow; onTap: () => void }) => {
    const linkedDeal = deals.find(d => d.id === meeting.deal_id);
    return (
      <div
        onClick={onTap}
        style={{
          background:   '#FFFFFF',
          border:       '0.5px solid rgba(200,160,80,0.16)',
          borderRadius: 14,
          padding:      '13px 16px',
          marginBottom: 8,
          boxShadow:    '0 1px 6px rgba(26,20,16,0.05)',
          cursor:       'pointer',
        }}>
        <div style={{
          fontFamily:   "'Cormorant Garamond', serif",
          fontSize:     17,
          fontWeight:   400,
          color:        '#1A1410',
          marginBottom: 4,
        }}>
          {meeting.title}
        </div>
        <div style={{
          fontSize:     11,
          fontWeight:   500,
          color:        COLORS.teal,
          marginBottom: meeting.attendees || linkedDeal ? 6 : 0,
        }}>
          {formatScheduledAt(meeting.scheduled_at)}
        </div>
        {meeting.attendees && (
          <div style={{
            fontSize:   12,
            fontWeight: 300,
            color:      'rgba(26,20,16,0.44)',
            marginBottom: linkedDeal ? 4 : 0,
          }}>
            {meeting.attendees}
          </div>
        )}
        {linkedDeal && (
          <div style={{
            display:      'inline-block',
            fontSize:     9,
            fontWeight:   600,
            letterSpacing:'0.8px',
            textTransform:'uppercase',
            color:        COLORS.amber,
            background:   'rgba(232,160,48,0.1)',
            border:       '0.5px solid rgba(232,160,48,0.24)',
            borderRadius: 20,
            padding:      '3px 9px',
          }}>
            {linkedDeal.name}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
    <div style={{
      height:      '100vh',
      overflowY:   'auto',
      background:  '#F7F3EC',
      fontFamily:  "'DM Sans', sans-serif",
      paddingBottom:100,
      animation:   'pageReveal 0.28s cubic-bezier(0.22, 1, 0.36, 1) both',
    }}>
      {/* Header */}
      <div style={{
        display:      'flex',
        alignItems:   'center',
        gap:          12,
        paddingTop: 'calc(env(safe-area-inset-top) + 12px)', paddingLeft: '20px', paddingRight: '20px', paddingBottom: '16px',
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
        >&#8249;</button>
        <h1 style={{
          flex: 1,
          fontFamily: "'Cormorant Garamond', serif",
          fontSize: 22, fontWeight: 400, color: '#1A1410', margin: 0,
        }}>
          Meetings
        </h1>
        {/* Camera icon for screenshot import */}
        <button
          onClick={() => fileRef.current?.click()}
          disabled={importing}
          style={{
            background:   'rgba(200,160,80,0.08)',
            border:       '0.5px solid rgba(200,160,80,0.22)',
            borderRadius: 10,
            padding:      '7px 12px',
            cursor:       'pointer',
            fontSize:     10,
            fontWeight:   600,
            letterSpacing:'1px',
            textTransform:'uppercase',
            color:        importing ? 'rgba(26,20,16,0.3)' : COLORS.amber,
            fontFamily:   "'DM Sans', sans-serif",
          }}
        >
          {importing ? 'Reading...' : 'Import'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleScreenshot}
        />
      </div>

      <div style={{ padding: '16px 18px 0' }}>

        {/* Screenshot confirmation screen */}
        {showConfirm && (
          <div style={{
            background:   '#FFFFFF',
            border:       '0.5px solid rgba(232,160,48,0.3)',
            borderRadius: 16,
            padding:      '16px',
            marginBottom: 20,
          }}>
            <div style={{
              fontSize:     11,
              fontWeight:   700,
              letterSpacing:'1.5px',
              textTransform:'uppercase',
              color:        COLORS.amber,
              marginBottom: 12,
            }}>
              {detectedMeetings.length} meetings detected
            </div>
            {detectedMeetings.map((m, i) => (
              <div key={i} style={{
                display:      'flex',
                alignItems:   'flex-start',
                gap:          10,
                marginBottom: 10,
                padding:      '10px 0',
                borderBottom: i < detectedMeetings.length - 1
                  ? '0.5px solid rgba(26,20,16,0.06)'
                  : 'none',
              }}>
                <input
                  type="checkbox"
                  checked={m.selected}
                  onChange={e => setDetectedMeetings(prev =>
                    prev.map((dm, di) =>
                      di === i ? { ...dm, selected: e.target.checked } : dm
                    )
                  )}
                  style={{ marginTop: 3, accentColor: COLORS.amber, flexShrink: 0 }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontSize: 14, fontWeight: 400, color: '#1A1410',
                    marginBottom: 3,
                  }}>
                    {m.title}
                  </div>
                  <div style={{
                    fontSize: 11, color: COLORS.teal, marginBottom: 6,
                  }}>
                    {m.date} · {m.time || 'Time not detected'}
                  </div>
                  <select
                    value={m.dealId}
                    onChange={e => setDetectedMeetings(prev =>
                      prev.map((dm, di) =>
                        di === i ? { ...dm, dealId: e.target.value } : dm
                      )
                    )}
                    style={{
                      background:   '#F7F3EC',
                      border:       '0.5px solid rgba(26,20,16,0.1)',
                      borderRadius: 8,
                      padding:      '5px 10px',
                      fontSize:     11,
                      color:        'rgba(26,20,16,0.6)',
                      outline:      'none',
                      width:        '100%',
                      fontFamily:   "'DM Sans', sans-serif",
                    }}
                  >
                    <option value="">Link to deal (optional)</option>
                    {deals.map(d => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button
                onClick={handleBulkSave}
                disabled={bulkSaving}
                style={{
                  flex:          1, padding: '12px 0', borderRadius: 12,
                  border:        'none',
                  background:    'linear-gradient(135deg, #C87820, #E09838)',
                  color:         'white', fontSize: 11, fontWeight: 700,
                  letterSpacing: '1.5px', textTransform: 'uppercase',
                  cursor:        'pointer',
                  fontFamily:    "'DM Sans', sans-serif",
                }}
              >
                {bulkSaving
                  ? 'Saving...'
                  : `Add ${detectedMeetings.filter(m => m.selected).length} Meetings`}
              </button>
              <button
                onClick={() => { setShowConfirm(false); setDetectedMeetings([]); }}
                style={{
                  padding:      '12px 16px', borderRadius: 12,
                  border:       '0.5px solid rgba(26,20,16,0.12)',
                  background:   'transparent', color: 'rgba(26,20,16,0.4)',
                  fontSize:     11, fontWeight: 500, cursor: 'pointer',
                  fontFamily:   "'DM Sans', sans-serif",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Upcoming */}
        {upcoming.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{
              fontSize:     9, fontWeight: 700, letterSpacing: '2px',
              textTransform:'uppercase', color: 'rgba(26,20,16,0.3)',
              marginBottom: 10,
            }}>
              Upcoming
            </div>
            {upcoming.map(m => <MeetingCard key={m.id} meeting={m} onTap={() => setEditingMeeting(m)} />)}
          </div>
        )}

        {/* Past — collapsed by default */}
        {past.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <button
              onClick={() => setShowPast(!showPast)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 0',
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '1.5px',
                textTransform: 'uppercase',
                color: 'rgba(26,20,16,0.36)',
                fontFamily: "'DM Sans', sans-serif",
              }}
            >
              <span style={{
                display: 'inline-block',
                transform: showPast ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s ease',
                fontSize: 12,
              }}>›</span>
              {showPast ? 'Hide' : `${past.length} past meeting${past.length !== 1 ? 's' : ''}`}
            </button>

            {showPast && past.slice(0, 20).map(m => (
              <div key={m.id} style={{ opacity: 0.55 }}>
                <MeetingCard meeting={m} onTap={() => setEditingMeeting(m)} />
              </div>
            ))}
          </div>
        )}

        {!loading && meetings.length === 0 && !showConfirm && (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <p style={{
              fontFamily: "'Cormorant Garamond', serif",
              fontSize:   24, fontWeight: 300,
              color:      'rgba(26,20,16,0.4)', marginBottom: 8,
            }}>
              No meetings yet.
            </p>
            <p style={{
              fontSize: 13, fontWeight: 300, color: 'rgba(26,20,16,0.3)',
            }}>
              Add one with + or import from a screenshot.
            </p>
          </div>
        )}
      </div>

    </div>

      {/* Floating + button — outside scroll container for proper fixed positioning */}
      <div style={{
        position: 'fixed', bottom: 32,
        right: 20,
        zIndex: 30,
      }}>
        <button
          onClick={() => setShowAdd(true)}
          style={{
            width:        56, height: 56, borderRadius: '50%',
            background:   'linear-gradient(135deg, #C87820, #E09838)',
            border:       'none',
            display:      'flex', alignItems: 'center', justifyContent: 'center',
            cursor:       'pointer',
            boxShadow:    '0 6px 24px rgba(200,120,32,0.36)',
          }}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <line x1="10" y1="3" x2="10" y2="17"
              stroke="white" strokeWidth="2.2" strokeLinecap="round"/>
            <line x1="3" y1="10" x2="17" y2="10"
              stroke="white" strokeWidth="2.2" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {/* Add meeting sheet */}
      {showAdd && (
        <>
          <div
            onClick={() => setShowAdd(false)}
            style={{
              position: 'fixed', inset: 0, zIndex: 290,
              background: 'rgba(26,20,16,0.4)',
              backdropFilter: 'blur(4px)',
            }}
          />
          <div style={{
            position:     'fixed', bottom: 0,
            left:         '50%', transform: 'translateX(-50%)',
            zIndex:       300, width: '100%',
            background:   '#F7F3EC',
            borderTop:    '0.5px solid rgba(200,160,80,0.3)',
            borderRadius: '22px 22px 0 0',
            padding:      '0 20px 48px',
            fontFamily:   "'DM Sans', sans-serif",
          }}>
            <div style={{
              width: 36, height: 4, borderRadius: 2,
              background: 'rgba(26,20,16,0.12)',
              margin: '14px auto 20px',
            }} />
            <h3 style={{
              fontFamily: "'Cormorant Garamond', serif",
              fontSize: 20, fontWeight: 400, color: '#1A1410', marginBottom: 16,
            }}>
              Add Meeting
            </h3>
            <input
              autoFocus
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder="Meeting title"
              style={inputStyle}
              onFocus={e => { e.target.style.borderColor = 'rgba(232,160,48,0.5)'; }}
              onBlur={e  => { e.target.style.borderColor = 'rgba(26,20,16,0.12)'; }}
            />
            <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
              <input
                type="date"
                value={newDate}
                onChange={e => setNewDate(e.target.value)}
                style={{ ...inputStyle, flex: 1, marginBottom: 0 }}
                onFocus={e => { e.target.style.borderColor = 'rgba(232,160,48,0.5)'; }}
                onBlur={e  => { e.target.style.borderColor = 'rgba(26,20,16,0.12)'; }}
              />
              <input
                type="time"
                value={newTime}
                onChange={e => setNewTime(e.target.value)}
                style={{ ...inputStyle, flex: 1, marginBottom: 0 }}
                onFocus={e => { e.target.style.borderColor = 'rgba(232,160,48,0.5)'; }}
                onBlur={e  => { e.target.style.borderColor = 'rgba(26,20,16,0.12)'; }}
              />
            </div>
            <select
              value={newDealId}
              onChange={e => setNewDealId(e.target.value)}
              style={{ ...inputStyle, color: newDealId ? '#1A1410' : 'rgba(26,20,16,0.4)' }}
            >
              <option value="">Link to deal (optional)</option>
              {deals.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            <input
              value={newAttendees}
              onChange={e => setNewAttendees(e.target.value)}
              placeholder="Attendees (optional)"
              style={inputStyle}
              onFocus={e => { e.target.style.borderColor = 'rgba(232,160,48,0.5)'; }}
              onBlur={e  => { e.target.style.borderColor = 'rgba(26,20,16,0.12)'; }}
            />
            <button
              onClick={handleAddMeeting}
              disabled={saving || !newTitle.trim() || !newDate || !newTime}
              style={{
                width:         '100%', padding: '14px 0', borderRadius: 14,
                border:        'none',
                background:    newTitle.trim() && newDate && newTime && !saving
                  ? 'linear-gradient(135deg, #C87820, #E09838)'
                  : 'rgba(26,20,16,0.08)',
                color:         newTitle.trim() && newDate && newTime && !saving
                  ? 'white' : 'rgba(26,20,16,0.28)',
                fontSize:      11, fontWeight: 700, letterSpacing: '2px',
                textTransform: 'uppercase',
                cursor:        newTitle.trim() && newDate && newTime && !saving
                  ? 'pointer' : 'default',
                fontFamily:    "'DM Sans', sans-serif", transition: 'all 0.2s',
              }}
            >
              {saving ? 'Saving...' : 'Add Meeting →'}
            </button>
          </div>
        </>
      )}

    {/* Meeting Edit Sheet */}
    {editingMeeting && (
      <MeetingEditSheet
        meeting={editingMeeting}
        deals={deals}
        onSave={async (updates) => {
          if (!userId) return;
          const { error } = await supabase
            .from('meetings')
            .update(updates)
            .eq('id', editingMeeting.id)
            .eq('user_id', userId);
          if (!error) {
            // Update deal last_activity_at if deal linked
            if (updates.deal_id) {
              await supabase
                .from('deals')
                .update({ last_activity_at: new Date().toISOString() })
                .eq('id', updates.deal_id)
                .eq('user_id', userId);
            }
            setEditingMeeting(null);
            fetchData();
          }
        }}
        onDelete={async () => {
          if (!userId) return;
          await supabase
            .from('meetings')
            .delete()
            .eq('id', editingMeeting.id)
            .eq('user_id', userId);
          setEditingMeeting(null);
          setMeetings(prev => prev.filter(m => m.id !== editingMeeting.id));
        }}
        onClose={() => setEditingMeeting(null)}
      />
    )}
    </>
  );
}

// ── MEETING EDIT SHEET COMPONENT ──────────────────────────────
function MeetingEditSheet({
  meeting,
  deals,
  onSave,
  onDelete,
  onClose,
}: {
  meeting: MeetingRow;
  deals: DealRow[];
  onSave: (updates: {
    title: string;
    scheduled_at: string;
    deal_id: string | null;
    attendees: string | null;
  }) => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}) {
  const scheduled = new Date(meeting.scheduled_at);
  const [title, setTitle] = useState(meeting.title);
  const [date, setDate] = useState(
    `${scheduled.getFullYear()}-${String(scheduled.getMonth() + 1).padStart(2, '0')}-${String(scheduled.getDate()).padStart(2, '0')}`
  );
  const [time, setTime] = useState(
    `${String(scheduled.getHours()).padStart(2, '0')}:${String(scheduled.getMinutes()).padStart(2, '0')}`
  );
  const [dealId, setDealId] = useState(meeting.deal_id ?? '');
  const [attendees, setAttendees] = useState(meeting.attendees ?? '');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 30);
    return () => clearTimeout(t);
  }, []);

  const handleSave = async () => {
    if (!title.trim() || !date || !time) return;
    setSaving(true);
    const scheduledAt = new Date(`${date}T${time}`).toISOString();
    await onSave({
      title: title.trim(),
      scheduled_at: scheduledAt,
      deal_id: dealId || null,
      attendees: attendees.trim() || null,
    });
    setSaving(false);
  };

  const handleDelete = async () => {
    setDeleting(true);
    await onDelete();
    setDeleting(false);
  };

  const editInputStyle: React.CSSProperties = {
    width: '100%',
    background: '#FFFFFF',
    border: '0.5px solid rgba(26,20,16,0.12)',
    borderRadius: 12,
    padding: '12px 14px',
    fontSize: 14,
    fontWeight: 300,
    color: '#1A1410',
    outline: 'none',
    fontFamily: "'DM Sans', sans-serif",
    marginBottom: 10,
    boxSizing: 'border-box',
  };

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 290,
          background: 'rgba(26,20,16,0.4)',
          backdropFilter: 'blur(4px)',
          opacity: visible ? 1 : 0,
          transition: 'opacity 0.2s ease',
        }}
      />
      <div style={{
        position: 'fixed', bottom: 0,
        left: '50%',
        transform: visible
          ? 'translateX(-50%) translateY(0)'
          : 'translateX(-50%) translateY(100%)',
        transition: 'transform 0.32s cubic-bezier(.32,.72,0,1)',
        zIndex: 300, width: '100%',
        background: '#F7F3EC',
        borderTop: '0.5px solid rgba(200,160,80,0.3)',
        borderRadius: '22px 22px 0 0',
        padding: '0 20px 48px',
        fontFamily: "'DM Sans', sans-serif",
      }}>
        <div style={{
          width: 36, height: 4, borderRadius: 2,
          background: 'rgba(26,20,16,0.12)',
          margin: '14px auto 20px',
        }} />

        {/* Title */}
        <input
          autoFocus
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Meeting title"
          style={{
            ...editInputStyle,
            fontFamily: "'Cormorant Garamond', serif",
            fontSize: 20,
            fontWeight: 400,
            marginBottom: 14,
          }}
        />

        {/* Date + Time */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            style={{ ...editInputStyle, flex: 1, marginBottom: 0 }}
          />
          <input
            type="time"
            value={time}
            onChange={e => setTime(e.target.value)}
            style={{ ...editInputStyle, flex: 1, marginBottom: 0 }}
          />
        </div>

        {/* Link to Deal */}
        <select
          value={dealId}
          onChange={e => setDealId(e.target.value)}
          style={{
            ...editInputStyle,
            color: dealId ? '#1A1410' : 'rgba(26,20,16,0.4)',
            cursor: 'pointer',
          }}
        >
          <option value="">No deal linked</option>
          {deals.map(d => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>

        {/* Attendees */}
        <input
          value={attendees}
          onChange={e => setAttendees(e.target.value)}
          placeholder="Who was there?"
          style={editInputStyle}
        />

        {/* Save */}
        <button
          onClick={handleSave}
          disabled={saving || !title.trim() || !date || !time}
          style={{
            width: '100%', padding: '14px 0', borderRadius: 14,
            border: 'none',
            background: title.trim() && date && time && !saving
              ? 'linear-gradient(135deg, #C87820, #E09838)'
              : 'rgba(26,20,16,0.08)',
            color: title.trim() && date && time && !saving
              ? 'white' : 'rgba(26,20,16,0.28)',
            fontSize: 11, fontWeight: 700, letterSpacing: '2px',
            textTransform: 'uppercase',
            cursor: title.trim() && date && time && !saving
              ? 'pointer' : 'default',
            fontFamily: "'DM Sans', sans-serif", transition: 'all 0.2s',
          }}
        >
          {saving ? 'Saving...' : 'Save Changes →'}
        </button>

        {/* Delete */}
        {!confirmDelete ? (
          <button
            onClick={() => {
              setConfirmDelete(true);
              if (deleteTimer.current) clearTimeout(deleteTimer.current);
              deleteTimer.current = setTimeout(() => setConfirmDelete(false), 3000);
            }}
            style={{
              display: 'block',
              margin: '14px auto 0',
              background: 'none', border: 'none',
              cursor: 'pointer',
              fontSize: 12, fontWeight: 400,
              color: 'rgba(224,88,64,0.5)',
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            Delete meeting
          </button>
        ) : (
          <div style={{
            marginTop: 14, textAlign: 'center',
          }}>
            <p style={{
              fontSize: 12, fontWeight: 300,
              color: 'rgba(26,20,16,0.5)', marginBottom: 8,
            }}>
              Are you sure? This cannot be undone.
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 16 }}>
              <button
                onClick={handleDelete}
                disabled={deleting}
                style={{
                  background: 'none', border: 'none',
                  cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  color: '#E05840',
                  fontFamily: "'DM Sans', sans-serif",
                }}
              >
                {deleting ? 'Deleting...' : 'Yes, delete'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                style={{
                  background: 'none', border: 'none',
                  cursor: 'pointer', fontSize: 12, fontWeight: 400,
                  color: 'rgba(26,20,16,0.4)',
                  fontFamily: "'DM Sans', sans-serif",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
