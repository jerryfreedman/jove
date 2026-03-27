'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { createClient } from '@/lib/supabase';
import { COLORS } from '@/lib/design-system';
import { PULSE_CHECK_DEFAULT_DAYS } from '@/lib/constants';
import type { UserRow, VoiceProfileRow, KnowledgeBaseRow } from '@/lib/types';

export default function SettingsPage() {
  const router   = useRouter();
  const supabase = createClient();

  const [user, setUser]               = useState<UserRow | null>(null);
  const [voice, setVoice]             = useState<VoiceProfileRow | null>(null);
  const [kb, setKb]                   = useState<KnowledgeBaseRow[]>([]);
  const [loading, setLoading]         = useState(true);
  const [userId, setUserId]           = useState<string | null>(null);

  // Profile edit state
  const [company, setCompany]         = useState('');
  const [role, setRole]               = useState('');
  const [industry, setIndustry]       = useState('');

  // Voice profile state
  const [refreshingVoice, setRefreshingVoice] = useState(false);
  const [voiceRefreshed, setVoiceRefreshed]   = useState(false);

  // Preferences state
  const [pulseDays, setPulseDays]     = useState(PULSE_CHECK_DEFAULT_DAYS);
  const [digestEnabled, setDigestEnabled] = useState(true);
  const [weatherEnabled, setWeatherEnabled] = useState(true);

  // KB state
  const [expandedKb, setExpandedKb]   = useState<string | null>(null);
  const [showAddKb, setShowAddKb]     = useState(false);
  const [newKbName, setNewKbName]     = useState('');
  const [newKbDesc, setNewKbDesc]     = useState('');
  const [newKbFeatures, setNewKbFeatures] = useState('');
  const [newKbUseCases, setNewKbUseCases] = useState('');
  const [savingKb, setSavingKb]       = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // ── FETCH DATA ─────────────────────────────────────────
  const fetchData = useCallback(async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) { router.push('/'); return; }
    setUserId(authUser.id);

    const [userRes, voiceRes, kbRes] = await Promise.all([
      supabase.from('users').select('*').eq('id', authUser.id).single(),
      supabase.from('voice_profile').select('*').eq('user_id', authUser.id).single(),
      supabase.from('knowledge_base').select('*').eq('user_id', authUser.id)
        .order('created_at', { ascending: true }),
    ]);

    const userData = userRes.data as UserRow | null;
    setUser(userData);
    setVoice(voiceRes.data as VoiceProfileRow | null);
    setKb((kbRes.data ?? []) as KnowledgeBaseRow[]);

    if (userData) {
      setCompany(userData.company ?? '');
      setRole(userData.role ?? '');
      setIndustry(userData.industry ?? '');
      setPulseDays(userData.pulse_check_days ?? PULSE_CHECK_DEFAULT_DAYS);
      setDigestEnabled(userData.morning_digest_enabled ?? true);
      setWeatherEnabled(userData.weather_enabled ?? true);
    }

    setLoading(false);
  }, [supabase, router]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Clean up delete confirmation timeout on unmount
  useEffect(() => {
    return () => {
      // deleteConfirm auto-clears via setTimeout already
    };
  }, []);

  // ── SAVE USER FIELD ────────────────────────────────────
  const saveUserField = async (field: string, value: unknown) => {
    if (!userId) return;
    await supabase
      .from('users')
      .update({ [field]: value })
      .eq('id', userId);
    setUser(u => u ? { ...u, [field]: value } as UserRow : u);
  };

  // ── PREFERENCE HANDLERS ────────────────────────────────
  const handlePulseDays = async (days: number) => {
    setPulseDays(days);
    localStorage.setItem('jove_pulse_check_days', String(days));
    await saveUserField('pulse_check_days', days);
  };

  const handleDigestToggle = async () => {
    const newVal = !digestEnabled;
    setDigestEnabled(newVal);
    await saveUserField('morning_digest_enabled', newVal);
  };

  const handleWeatherToggle = async () => {
    const newVal = !weatherEnabled;
    setWeatherEnabled(newVal);
    await saveUserField('weather_enabled', newVal);
  };

  // ── VOICE PROFILE REFRESH ──────────────────────────────
  const handleRefreshVoice = async () => {
    if (!userId) return;
    setRefreshingVoice(true);
    try {
      await fetch('/api/update-voice-profile', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ userId }),
      });
    } catch {
      // fail silently
    }
    setRefreshingVoice(false);
    setVoiceRefreshed(true);
    setTimeout(() => setVoiceRefreshed(false), 2000);
    // Refresh voice data
    const { data } = await supabase
      .from('voice_profile')
      .select('*')
      .eq('user_id', userId)
      .single();
    setVoice(data as VoiceProfileRow | null);
  };

  // ── KB HANDLERS ────────────────────────────────────────
  const handleAddKb = async () => {
    if (!newKbName.trim() || !newKbDesc.trim() || !userId) return;
    setSavingKb(true);

    const features  = newKbFeatures.split(',').map(s => s.trim()).filter(Boolean);
    const useCases  = newKbUseCases.split(',').map(s => s.trim()).filter(Boolean);

    const { data, error } = await supabase
      .from('knowledge_base')
      .insert({
        user_id:         userId,
        product_name:    newKbName.trim(),
        description:     newKbDesc.trim(),
        key_features:    features.length > 0 ? features : null,
        target_use_cases:useCases.length > 0 ? useCases : null,
        version:         1,
        is_active_deal:  false,
      })
      .select('*')
      .single();

    if (!error && data) {
      setKb(prev => [...prev, data as KnowledgeBaseRow]);
      setNewKbName('');
      setNewKbDesc('');
      setNewKbFeatures('');
      setNewKbUseCases('');
      setShowAddKb(false);
    }
    setSavingKb(false);
  };

  const handleDeleteKb = async (id: string) => {
    if (deleteConfirm !== id) {
      setDeleteConfirm(id);
      setTimeout(() => setDeleteConfirm(null), 3000);
      return;
    }
    await supabase.from('knowledge_base').delete().eq('id', id);
    setKb(prev => prev.filter(k => k.id !== id));
    setDeleteConfirm(null);
  };

  const handleToggleActiveDeal = async (item: KnowledgeBaseRow) => {
    const newVal = !item.is_active_deal;
    await supabase
      .from('knowledge_base')
      .update({ is_active_deal: newVal })
      .eq('id', item.id);
    setKb(prev => prev.map(k =>
      k.id === item.id ? { ...k, is_active_deal: newVal } : k
    ));
  };

  // ── SIGN OUT ───────────────────────────────────────────
  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  // ── STYLES ────────────────────────────────────────────
  const inputStyle: React.CSSProperties = {
    width:        '100%',
    background:   '#FFFFFF',
    border:       '0.5px solid rgba(26,20,16,0.12)',
    borderRadius: 10,
    padding:      '11px 13px',
    fontSize:     14,
    fontWeight:   300,
    color:        '#1A1410',
    outline:      'none',
    fontFamily:   "'DM Sans', sans-serif",
    marginBottom: 8,
    boxSizing:    'border-box',
  };

  const sectionLabel: React.CSSProperties = {
    fontSize:     9,
    fontWeight:   700,
    letterSpacing:'2.5px',
    textTransform:'uppercase',
    color:        'rgba(26,20,16,0.28)',
    paddingBottom:8,
    marginBottom: 14,
    borderBottom: '0.5px solid rgba(200,160,80,0.2)',
  };

  const Toggle = ({
    enabled,
    onToggle,
  }: {
    enabled: boolean;
    onToggle: () => void;
  }) => (
    <button
      onClick={onToggle}
      style={{
        width:        44,
        height:       26,
        borderRadius: 13,
        background:   enabled
          ? 'linear-gradient(135deg, #C87820, #E09838)'
          : 'rgba(26,20,16,0.12)',
        border:       'none',
        cursor:       'pointer',
        position:     'relative',
        transition:   'background 0.25s ease',
        flexShrink:   0,
      }}
    >
      <div style={{
        position:   'absolute',
        top:        3,
        left:       enabled ? 21 : 3,
        width:      20,
        height:     20,
        borderRadius:'50%',
        background: '#FFFFFF',
        boxShadow:  '0 1px 4px rgba(0,0,0,0.2)',
        transition: 'left 0.25s ease',
      }} />
    </button>
  );

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh', background: '#F7F3EC',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          border: '2px solid rgba(232,160,48,0.2)',
          borderTop: `2px solid ${COLORS.amber}`,
          animation: 'spin 0.8s linear infinite',
        }} />
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

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
          onClick={() => router.push('/home')}
          style={{
            width:        34, height: 34, borderRadius: '50%',
            background:   'rgba(200,160,80,0.1)',
            border:       '0.5px solid rgba(200,160,80,0.22)',
            display:      'flex', alignItems: 'center', justifyContent: 'center',
            cursor:       'pointer', color: 'rgba(26,20,16,0.5)',
            fontSize:     19, flexShrink: 0,
          }}
        >{'\u2039'}</button>
        <h1 style={{
          flex:       1,
          fontFamily: "'Cormorant Garamond', serif",
          fontSize:   22, fontWeight: 400, color: '#1A1410', margin: 0,
        }}>
          Settings
        </h1>
      </div>

      <div style={{ padding: '20px 18px 0' }}>

        {/* ── SECTION 1: PROFILE ─────────────────── */}
        <div style={{ marginBottom: 28 }}>
          <div style={sectionLabel}>Profile</div>

          {/* Avatar + name + email */}
          <div style={{
            display:      'flex',
            alignItems:   'center',
            gap:          14,
            marginBottom: 18,
            background:   '#FFFFFF',
            border:       '0.5px solid rgba(200,160,80,0.14)',
            borderRadius: 14,
            padding:      '14px 16px',
            boxShadow:    '0 1px 6px rgba(26,20,16,0.04)',
          }}>
            {user?.avatar_url ? (
              <Image
                src={user.avatar_url}
                alt=""
                width={44}
                height={44}
                style={{
                  borderRadius: '50%',
                  flexShrink:   0,
                  border:       '0.5px solid rgba(200,160,80,0.2)',
                }}
              />
            ) : (
              <div style={{
                width:          44, height: 44, borderRadius: '50%',
                background:     'linear-gradient(135deg, #C87820, #E09838)',
                display:        'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink:     0,
                color:          'white', fontSize: 18, fontWeight: 300,
                fontFamily:     "'Cormorant Garamond', serif",
              }}>
                {(user?.full_name ?? user?.email ?? 'J')[0].toUpperCase()}
              </div>
            )}
            <div>
              <div style={{
                fontSize: 15, fontWeight: 500, color: '#1A1410', marginBottom: 2,
              }}>
                {user?.full_name ?? 'Your Name'}
              </div>
              <div style={{
                fontSize: 12, fontWeight: 300, color: 'rgba(26,20,16,0.44)',
              }}>
                {user?.email ?? ''}
              </div>
            </div>
          </div>

          {/* Editable fields */}
          <input
            value={company}
            onChange={e => setCompany(e.target.value)}
            onBlur={() => saveUserField('company', company)}
            placeholder="Company you sell for"
            style={inputStyle}
          />
          <input
            value={role}
            onChange={e => setRole(e.target.value)}
            onBlur={() => saveUserField('role', role)}
            placeholder="Your role"
            style={inputStyle}
          />
          <input
            value={industry}
            onChange={e => setIndustry(e.target.value)}
            onBlur={() => saveUserField('industry', industry)}
            placeholder="Industry"
            style={{ ...inputStyle, marginBottom: 0 }}
          />
        </div>

        {/* ── SECTION 2: VOICE PROFILE ────────────── */}
        <div style={{ marginBottom: 28 }}>
          <div style={sectionLabel}>Writing Style</div>

          {voice && voice.sample_count > 0 ? (
            <div style={{
              background:   '#FFFFFF',
              border:       '0.5px solid rgba(200,160,80,0.14)',
              borderRadius: 14,
              padding:      '14px 16px',
              boxShadow:    '0 1px 6px rgba(26,20,16,0.04)',
            }}>
              <div style={{
                display:      'flex',
                alignItems:   'center',
                gap:          8,
                marginBottom: 12,
              }}>
                <div style={{
                  fontSize:     9, fontWeight: 600, letterSpacing: '1.5px',
                  textTransform:'uppercase', color: COLORS.amber,
                  background:   'rgba(232,160,48,0.1)',
                  border:       '0.5px solid rgba(232,160,48,0.24)',
                  borderRadius: 20, padding: '3px 9px',
                }}>
                  Learned from {voice.sample_count} email{voice.sample_count !== 1 ? 's' : ''}
                </div>
                <span style={{
                  fontSize: 10, fontWeight: 300, color: 'rgba(26,20,16,0.3)',
                  marginLeft: 'auto',
                }}>
                  {new Date(voice.last_updated_at).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric',
                  })}
                </span>
              </div>

              {[
                { label: 'Opening', value: voice.opening_style },
                { label: 'Closing', value: voice.closing_style },
                { label: 'Length',  value: voice.avg_length },
                { label: 'Tone',   value: voice.formality_level },
              ].map(row => row.value ? (
                <div key={row.label} style={{
                  display:      'flex',
                  gap:          10,
                  marginBottom: 8,
                  paddingBottom:8,
                  borderBottom: '0.5px solid rgba(26,20,16,0.05)',
                }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: '1px',
                    textTransform: 'uppercase', color: 'rgba(26,20,16,0.3)',
                    width: 56, flexShrink: 0, paddingTop: 1,
                  }}>
                    {row.label}
                  </span>
                  <span style={{
                    fontSize: 13, fontWeight: 300, color: 'rgba(26,20,16,0.7)',
                    lineHeight: 1.5,
                  }}>
                    {row.value}
                  </span>
                </div>
              ) : null)}

              {voice.common_phrases && voice.common_phrases.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                  {voice.common_phrases.map((phrase, i) => (
                    <div key={i} style={{
                      fontSize:     10, fontWeight: 300,
                      color:        'rgba(26,20,16,0.5)',
                      background:   'rgba(26,20,16,0.04)',
                      border:       '0.5px solid rgba(26,20,16,0.1)',
                      borderRadius: 20, padding: '4px 10px',
                    }}>
                      &ldquo;{phrase}&rdquo;
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={handleRefreshVoice}
                disabled={refreshingVoice}
                style={{
                  marginTop:     14, width: '100%', padding: '10px 0',
                  borderRadius:  10,
                  border:        '0.5px solid rgba(200,160,80,0.3)',
                  background:    voiceRefreshed ? 'rgba(72,200,120,0.08)' : 'transparent',
                  color:         voiceRefreshed
                    ? COLORS.green
                    : refreshingVoice
                    ? 'rgba(26,20,16,0.3)'
                    : COLORS.amber,
                  fontSize:      10, fontWeight: 700, letterSpacing: '1.5px',
                  textTransform: 'uppercase', cursor: refreshingVoice ? 'default' : 'pointer',
                  fontFamily:    "'DM Sans', sans-serif", transition: 'all 0.2s',
                }}
              >
                {voiceRefreshed
                  ? '\u2713 Updated'
                  : refreshingVoice
                  ? 'Updating...'
                  : 'Refresh Voice Profile'}
              </button>
            </div>
          ) : (
            <div style={{
              background:   '#FFFFFF',
              border:       '0.5px solid rgba(200,160,80,0.14)',
              borderRadius: 14,
              padding:      '16px',
              textAlign:    'center',
              boxShadow:    '0 1px 6px rgba(26,20,16,0.04)',
            }}>
              <p style={{
                fontSize: 13, fontWeight: 300,
                color:    'rgba(26,20,16,0.44)', lineHeight: 1.6,
                marginBottom: 12,
              }}>
                Jove is learning your style.
                Send a few emails via the Draft tile to get started.
              </p>
              <button
                onClick={handleRefreshVoice}
                disabled={refreshingVoice}
                style={{
                  padding:       '9px 20px', borderRadius: 10,
                  border:        '0.5px solid rgba(232,160,48,0.3)',
                  background:    'transparent',
                  color:         COLORS.amber,
                  fontSize:      10, fontWeight: 700, letterSpacing: '1.5px',
                  textTransform: 'uppercase',
                  cursor:        refreshingVoice ? 'default' : 'pointer',
                  fontFamily:    "'DM Sans', sans-serif",
                }}
              >
                {refreshingVoice ? 'Checking...' : 'Check for Emails'}
              </button>
            </div>
          )}
        </div>

        {/* ── SECTION 3: PREFERENCES ──────────────── */}
        <div style={{ marginBottom: 28 }}>
          <div style={sectionLabel}>Preferences</div>

          {/* Pulse check days */}
          <div style={{
            background:   '#FFFFFF',
            border:       '0.5px solid rgba(200,160,80,0.14)',
            borderRadius: 14,
            padding:      '14px 16px',
            marginBottom: 10,
            boxShadow:    '0 1px 6px rgba(26,20,16,0.04)',
          }}>
            <div style={{
              fontSize: 13, fontWeight: 400, color: '#1A1410', marginBottom: 10,
            }}>
              Follow-up reminder threshold
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {[7, 10, 14].map(d => (
                <button
                  key={d}
                  onClick={() => handlePulseDays(d)}
                  style={{
                    flex:         1, padding: '8px 0', borderRadius: 9,
                    border:       '0.5px solid',
                    borderColor:  pulseDays === d
                      ? 'rgba(232,160,48,0.5)'
                      : 'rgba(26,20,16,0.1)',
                    background:   pulseDays === d
                      ? 'rgba(232,160,48,0.1)'
                      : 'transparent',
                    color:        pulseDays === d
                      ? COLORS.amber
                      : 'rgba(26,20,16,0.44)',
                    fontSize:     12, fontWeight: pulseDays === d ? 600 : 300,
                    cursor:       'pointer',
                    fontFamily:   "'DM Sans', sans-serif",
                    transition:   'all 0.18s',
                  }}
                >
                  {d} days
                </button>
              ))}
            </div>
          </div>

          {/* Toggles */}
          {[
            {
              label:   'Daily briefing suggestion',
              sub:     'Generate "Do This First" on briefing open',
              value:   digestEnabled,
              toggle:  handleDigestToggle,
            },
            {
              label:   'Weather on home screen',
              sub:     'Show temperature and conditions',
              value:   weatherEnabled,
              toggle:  handleWeatherToggle,
            },
          ].map(pref => (
            <div
              key={pref.label}
              style={{
                display:      'flex',
                alignItems:   'center',
                gap:          14,
                background:   '#FFFFFF',
                border:       '0.5px solid rgba(200,160,80,0.14)',
                borderRadius: 14,
                padding:      '14px 16px',
                marginBottom: 10,
                boxShadow:    '0 1px 6px rgba(26,20,16,0.04)',
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{
                  fontSize: 13, fontWeight: 400, color: '#1A1410', marginBottom: 2,
                }}>
                  {pref.label}
                </div>
                <div style={{
                  fontSize: 11, fontWeight: 300, color: 'rgba(26,20,16,0.4)',
                }}>
                  {pref.sub}
                </div>
              </div>
              <Toggle enabled={pref.value} onToggle={pref.toggle} />
            </div>
          ))}
        </div>

        {/* ── SECTION 4: KNOWLEDGE BASE ────────────── */}
        <div style={{ marginBottom: 28 }}>
          <div style={{
            display:      'flex',
            alignItems:   'center',
            paddingBottom:8,
            marginBottom: 14,
            borderBottom: '0.5px solid rgba(200,160,80,0.2)',
          }}>
            <div style={{
              flex:         1,
              fontSize:     9, fontWeight: 700, letterSpacing: '2.5px',
              textTransform:'uppercase', color: 'rgba(26,20,16,0.28)',
            }}>
              Product Knowledge Base
            </div>
            <button
              onClick={() => setShowAddKb(!showAddKb)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize:   11, fontWeight: 600, letterSpacing: '1px',
                textTransform:'uppercase', color: COLORS.amber,
                fontFamily: "'DM Sans', sans-serif", padding: 0,
              }}
            >
              + Add
            </button>
          </div>

          {/* Add KB form */}
          {showAddKb && (
            <div style={{
              background:   '#FFFFFF',
              border:       '0.5px solid rgba(232,160,48,0.28)',
              borderRadius: 14,
              padding:      '14px 16px',
              marginBottom: 12,
            }}>
              <input
                autoFocus
                value={newKbName}
                onChange={e => setNewKbName(e.target.value)}
                placeholder="Product or service name"
                style={inputStyle}
              />
              <textarea
                value={newKbDesc}
                onChange={e => setNewKbDesc(e.target.value)}
                placeholder="Description — what it does, who it's for"
                rows={3}
                style={{
                  ...inputStyle,
                  resize:   'none',
                  lineHeight:1.55,
                }}
              />
              <input
                value={newKbFeatures}
                onChange={e => setNewKbFeatures(e.target.value)}
                placeholder="Key features (comma separated)"
                style={inputStyle}
              />
              <input
                value={newKbUseCases}
                onChange={e => setNewKbUseCases(e.target.value)}
                placeholder="Target use cases (comma separated)"
                style={{ ...inputStyle, marginBottom: 12 }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={handleAddKb}
                  disabled={savingKb || !newKbName.trim() || !newKbDesc.trim()}
                  style={{
                    flex:          1, padding: '10px 0', borderRadius: 10,
                    border:        'none',
                    background:    newKbName.trim() && newKbDesc.trim() && !savingKb
                      ? 'linear-gradient(135deg, #C87820, #E09838)'
                      : 'rgba(26,20,16,0.08)',
                    color:         newKbName.trim() && newKbDesc.trim() && !savingKb
                      ? 'white' : 'rgba(26,20,16,0.3)',
                    fontSize:      11, fontWeight: 700, letterSpacing: '1.5px',
                    textTransform: 'uppercase',
                    cursor:        newKbName.trim() && newKbDesc.trim() && !savingKb
                      ? 'pointer' : 'default',
                    fontFamily:    "'DM Sans', sans-serif",
                  }}
                >
                  {savingKb ? 'Saving...' : 'Add Product \u2192'}
                </button>
                <button
                  onClick={() => setShowAddKb(false)}
                  style={{
                    padding:    '10px 14px', borderRadius: 10,
                    border:     '0.5px solid rgba(26,20,16,0.12)',
                    background: 'transparent', color: 'rgba(26,20,16,0.4)',
                    fontSize:   11, fontWeight: 500, cursor: 'pointer',
                    fontFamily: "'DM Sans', sans-serif",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {kb.length === 0 && !showAddKb && (
            <div style={{
              background:   '#FFFFFF',
              border:       '0.5px solid rgba(200,160,80,0.14)',
              borderRadius: 14,
              padding:      '20px 16px',
              textAlign:    'center',
              boxShadow:    '0 1px 6px rgba(26,20,16,0.04)',
            }}>
              <p style={{
                fontSize: 13, fontWeight: 300,
                color:    'rgba(26,20,16,0.44)', marginBottom: 4,
              }}>
                No products added yet.
              </p>
              <p style={{
                fontSize: 11, fontWeight: 300,
                color:    'rgba(26,20,16,0.3)', lineHeight: 1.5,
              }}>
                Add what you sell so Jove can reference it in
                prep responses, emails, and chat answers.
              </p>
            </div>
          )}

          {kb.map(item => (
            <div
              key={item.id}
              style={{
                background:   '#FFFFFF',
                border:       item.is_active_deal
                  ? '0.5px solid rgba(56,184,200,0.3)'
                  : '0.5px solid rgba(200,160,80,0.14)',
                borderRadius: 14,
                padding:      '13px 16px',
                marginBottom: 8,
                boxShadow:    '0 1px 6px rgba(26,20,16,0.04)',
                cursor:       'pointer',
              }}
              onClick={() => setExpandedKb(
                expandedKb === item.id ? null : item.id
              )}
            >
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontSize: 14, fontWeight: 500, color: '#1A1410',
                    marginBottom: 2,
                  }}>
                    {item.product_name}
                  </div>
                  {expandedKb !== item.id && (
                    <div style={{
                      fontSize: 12, fontWeight: 300,
                      color:    'rgba(26,20,16,0.44)',
                      overflow: 'hidden', whiteSpace: 'nowrap',
                      textOverflow: 'ellipsis',
                    }}>
                      {item.description}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {item.is_active_deal && (
                    <div style={{
                      fontSize:     8, fontWeight: 700, letterSpacing: '1px',
                      textTransform:'uppercase', color: COLORS.teal,
                      background:   'rgba(56,184,200,0.1)',
                      border:       '0.5px solid rgba(56,184,200,0.24)',
                      borderRadius: 20, padding: '2px 7px',
                    }}>
                      Active
                    </div>
                  )}
                  <div style={{
                    fontSize:     8, fontWeight: 600, color: 'rgba(26,20,16,0.3)',
                    background:   'rgba(26,20,16,0.05)',
                    borderRadius: 20, padding: '2px 7px',
                  }}>
                    v{item.version}
                  </div>
                </div>
              </div>

              {expandedKb === item.id && (
                <div
                  style={{ marginTop: 12 }}
                  onClick={e => e.stopPropagation()}
                >
                  <p style={{
                    fontSize: 13, fontWeight: 300, color: 'rgba(26,20,16,0.7)',
                    lineHeight: 1.6, marginBottom: 10,
                  }}>
                    {item.description}
                  </p>
                  {item.key_features && item.key_features.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: '1px',
                        textTransform: 'uppercase', color: 'rgba(26,20,16,0.3)',
                        marginBottom: 5,
                      }}>
                        Features
                      </div>
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        {item.key_features.map((f, i) => (
                          <div key={i} style={{
                            fontSize:     10, fontWeight: 300,
                            color:        'rgba(26,20,16,0.5)',
                            background:   'rgba(26,20,16,0.04)',
                            border:       '0.5px solid rgba(26,20,16,0.1)',
                            borderRadius: 20, padding: '3px 9px',
                          }}>
                            {f}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {item.target_use_cases && item.target_use_cases.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: '1px',
                        textTransform: 'uppercase', color: 'rgba(26,20,16,0.3)',
                        marginBottom: 5,
                      }}>
                        Use Cases
                      </div>
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        {item.target_use_cases.map((uc, i) => (
                          <div key={i} style={{
                            fontSize:     10, fontWeight: 300,
                            color:        'rgba(26,20,16,0.5)',
                            background:   'rgba(26,20,16,0.04)',
                            border:       '0.5px solid rgba(26,20,16,0.1)',
                            borderRadius: 20, padding: '3px 9px',
                          }}>
                            {uc}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div style={{
                    display: 'flex', gap: 8, marginTop: 12,
                    paddingTop: 10, borderTop: '0.5px solid rgba(26,20,16,0.06)',
                  }}>
                    <button
                      onClick={() => handleToggleActiveDeal(item)}
                      style={{
                        flex:          1, padding: '8px 0', borderRadius: 9,
                        border:        `0.5px solid ${item.is_active_deal
                          ? 'rgba(56,184,200,0.3)'
                          : 'rgba(26,20,16,0.1)'}`,
                        background:    item.is_active_deal
                          ? 'rgba(56,184,200,0.08)'
                          : 'transparent',
                        color:         item.is_active_deal
                          ? COLORS.teal : 'rgba(26,20,16,0.4)',
                        fontSize:      9, fontWeight: 700,
                        letterSpacing: '1px', textTransform: 'uppercase',
                        cursor:        'pointer',
                        fontFamily:    "'DM Sans', sans-serif",
                        transition:    'all 0.18s',
                      }}
                    >
                      {item.is_active_deal ? '\u2713 Active Deal' : 'Mark Active'}
                    </button>
                    <button
                      onClick={() => handleDeleteKb(item.id)}
                      style={{
                        padding:      '8px 14px', borderRadius: 9,
                        border:       `0.5px solid ${deleteConfirm === item.id
                          ? 'rgba(224,88,64,0.4)' : 'rgba(26,20,16,0.1)'}`,
                        background:   deleteConfirm === item.id
                          ? 'rgba(224,88,64,0.08)' : 'transparent',
                        color:        deleteConfirm === item.id
                          ? COLORS.red : 'rgba(26,20,16,0.3)',
                        fontSize:     9, fontWeight: 700,
                        letterSpacing:'1px', textTransform: 'uppercase',
                        cursor:       'pointer',
                        fontFamily:   "'DM Sans', sans-serif",
                        transition:   'all 0.2s',
                      }}
                    >
                      {deleteConfirm === item.id ? 'Confirm Delete' : 'Delete'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* ── SECTION 5: ACCOUNT ───────────────────── */}
        <div style={{ marginBottom: 20 }}>
          <div style={sectionLabel}>Account</div>

          <button
            onClick={handleSignOut}
            style={{
              width:         '100%', padding: '14px 0', borderRadius: 14,
              border:        '0.5px solid rgba(224,88,64,0.3)',
              background:    'rgba(224,88,64,0.06)',
              color:         COLORS.red,
              fontSize:      11, fontWeight: 700, letterSpacing: '2px',
              textTransform: 'uppercase', cursor: 'pointer',
              fontFamily:    "'DM Sans', sans-serif",
              marginBottom:  14,
              transition:    'all 0.2s',
            }}
          >
            Sign Out
          </button>

          <div style={{ textAlign: 'center' }}>
            <p style={{
              fontSize: 10, fontWeight: 300,
              color:    'rgba(26,20,16,0.28)', marginBottom: 2,
            }}>
              Jove &middot; v1.0
            </p>
            <p style={{
              fontSize: 10, fontWeight: 300,
              color:    'rgba(26,20,16,0.22)',
            }}>
              Your data is private to your account.
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}
