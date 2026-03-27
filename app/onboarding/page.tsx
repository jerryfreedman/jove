'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import SceneBackground from '@/components/home/SceneBackground';
import Logo from '@/components/ui/Logo';
import { getGreeting, getSceneForHour, COLORS } from '@/lib/design-system';

// ── TYPES ──────────────────────────────────────────────────
type Step = 'q1_company' | 'q2_role' | 'q3_deal' | 'saving' | 'ready';

interface OnboardingState {
  company:  string;
  industry: string;
  role:     string;
  deal:     string;
}

// ── HELPERS ────────────────────────────────────────────────
function extractCompanyFromDeal(dealText: string): string {
  // Simple extraction — look for "at", "with", "for" keywords
  // e.g. "Cloud expansion at Acme Corp" → "Acme Corp"
  const patterns = [
    /\bat\s+([A-Z][^,.\n]+)/,
    /\bwith\s+([A-Z][^,.\n]+)/,
    /\bfor\s+([A-Z][^,.\n]+)/,
  ];
  for (const pattern of patterns) {
    const match = dealText.match(pattern);
    if (match) return match[1].trim();
  }
  return 'First Account';
}

// ── COMPONENT ──────────────────────────────────────────────
export default function OnboardingPage() {
  const router   = useRouter();
  const supabase = createClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const [step, setStep]       = useState<Step>('q1_company');
  const [data, setData]       = useState<OnboardingState>({
    company: '', industry: '', role: '', deal: '',
  });
  const [input, setInput]         = useState('');
  const [subInput, setSubInput]   = useState(''); // for industry on q1
  const [visible, setVisible]     = useState(false);
  const [readyVisible, setReadyVisible] = useState(false);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');

  const h        = new Date().getHours();
  const scene    = getSceneForHour(h);
  const greeting = getGreeting(h);

  // Fade in on mount
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 120);
    return () => clearTimeout(t);
  }, []);

  // Auto-focus input when step changes
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 340);
    return () => clearTimeout(t);
  }, [step]);

  // Text color adapts to sky brightness — same logic as home screen
  const textPrimary   = scene.lightText
    ? 'rgba(252,246,234,0.94)'
    : 'rgba(26,20,16,0.88)';
  const textSecondary = scene.lightText
    ? 'rgba(240,235,224,0.52)'
    : 'rgba(26,20,16,0.44)';
  const inputBg       = scene.lightText
    ? 'rgba(255,252,244,0.08)'
    : 'rgba(26,20,16,0.06)';
  const inputBorder   = scene.lightText
    ? 'rgba(232,160,48,0.28)'
    : 'rgba(26,20,16,0.2)';

  // ── QUESTIONS ────────────────────────────────────────────
  const QUESTIONS: Record<string, string> = {
    q1_company: 'What company do you sell for?',
    q2_role:    'What\'s your role?',
    q3_deal:    'What\'s one deal you\'re working on right now?',
  };

  const HINTS: Record<string, string> = {
    q1_company: 'e.g. Acme Corp, Stripe, ServiceNow...',
    q2_role:    'e.g. Account Manager, Sales Director, BDR, Founder...',
    q3_deal:    'e.g. Cloud migration at Acme, Enterprise renewal with TechCorp...',
  };

  // ── HANDLERS ─────────────────────────────────────────────
  const handleNext = async () => {
    if (!input.trim()) return;
    setError('');

    if (step === 'q1_company') {
      setData(d => ({ ...d, company: input.trim(), industry: subInput.trim() }));
      setInput('');
      setSubInput('');
      setStep('q2_role');
      return;
    }

    if (step === 'q2_role') {
      setData(d => ({ ...d, role: input.trim() }));
      setInput('');
      setStep('q3_deal');
      return;
    }

    if (step === 'q3_deal') {
      const finalData = { ...data, deal: input.trim() };
      setData(finalData);
      await saveOnboarding(finalData);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleNext();
    }
  };

  // ── SAVE TO SUPABASE ──────────────────────────────────────
  const saveOnboarding = async (finalData: OnboardingState) => {
    setSaving(true);
    setStep('saving');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No user session');

      // 1. Update users table
      const { error: userError } = await supabase
        .from('users')
        .update({
          company:               finalData.company || null,
          industry:              finalData.industry || null,
          role:                  finalData.role || null,
          onboarding_completed:  true,
        })
        .eq('id', user.id);

      if (userError) throw userError;

      // 2. Create voice profile row (empty — learns over time)
      const { error: vpError } = await supabase
        .from('voice_profile')
        .upsert({
          user_id:      user.id,
          sample_count: 0,
        }, { onConflict: 'user_id', ignoreDuplicates: true });

      if (vpError) console.error('Voice profile error:', vpError);

      // 3. Create account row from deal description
      const accountName = finalData.company ||
        extractCompanyFromDeal(finalData.deal);

      const { data: accountData, error: accountError } = await supabase
        .from('accounts')
        .insert({
          user_id:  user.id,
          name:     accountName,
          industry: finalData.industry || null,
        })
        .select('id')
        .single();

      if (accountError) throw accountError;

      // 4. Create first deal
      if (finalData.deal.trim()) {
        const { error: dealError } = await supabase
          .from('deals')
          .insert({
            user_id:    user.id,
            account_id: accountData.id,
            name:       finalData.deal.trim(),
            stage:      'Prospect',
            next_action_confirmed: false,
          });

        if (dealError) throw dealError;
      }

      // 5. Play "Jove is ready." moment
      setSaving(false);
      setStep('ready');
      setReadyVisible(true);

      setTimeout(() => {
        setReadyVisible(false);
        setTimeout(() => router.push('/home'), 600);
      }, 2200);

    } catch (err) {
      console.error('Onboarding save error:', err);
      setError('Something went wrong. Please try again.');
      setSaving(false);
      setStep('q3_deal');
    }
  };

  // ── RENDER ───────────────────────────────────────────────
  return (
    <div
      className="relative min-h-screen overflow-hidden"
      style={{ fontFamily: "'DM Sans', sans-serif" }}
    >
      <SceneBackground />

      {/* "Jove is ready." overlay */}
      {step === 'ready' && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center"
          style={{
            zIndex:     100,
            background: 'rgba(13,15,18,0.92)',
            opacity:    readyVisible ? 1 : 0,
            transition: 'opacity 0.6s ease',
          }}
        >
          <div style={{ animation: 'breath 5s ease-in-out infinite', marginBottom: 28 }}>
            <Logo light showWordmark={false} size={80} onClick={() => {}} />
          </div>
          <p
            style={{
              fontFamily:    "'Cormorant Garamond', serif",
              fontSize:      32,
              fontWeight:    300,
              color:         'rgba(252,246,234,0.94)',
              letterSpacing: '0.5px',
              animation:     'fadeUp 0.7s ease both',
              animationDelay:'0.3s',
              opacity:       0,
            }}
          >
            Jove is ready.
          </p>
        </div>
      )}

      {/* Main onboarding UI */}
      {step !== 'ready' && (
        <div
          className="relative z-10 flex flex-col justify-center min-h-screen px-8"
          style={{
            maxWidth:   480,
            margin:     '0 auto',
            opacity:    visible ? 1 : 0,
            transform:  visible ? 'translateY(0)' : 'translateY(14px)',
            transition: 'opacity 0.65s ease, transform 0.65s ease',
          }}
        >

          {/* Logo top left */}
          <div style={{ position: 'absolute', top: 52, left: 32 }}>
            <Logo light={scene.lightText} showWordmark size={26} onClick={() => {}} />
          </div>

          {/* Step indicator */}
          <div
            style={{
              display:        'flex',
              gap:            8,
              marginBottom:   40,
              justifyContent: 'center',
            }}
          >
            {(['q1_company', 'q2_role', 'q3_deal'] as const).map((s) => (
              <div
                key={s}
                style={{
                  width:        step === s ? 24 : 8,
                  height:       8,
                  borderRadius: 4,
                  background:   step === s
                    ? COLORS.amber
                    : 'rgba(232,160,48,0.25)',
                  transition:   'all 0.4s ease',
                }}
              />
            ))}
          </div>

          {/* Greeting — first step only */}
          {step === 'q1_company' && (
            <p
              style={{
                fontFamily:   "'Cormorant Garamond', serif",
                fontSize:     16,
                fontWeight:   300,
                color:        textSecondary,
                marginBottom: 6,
              }}
            >
              {greeting}
            </p>
          )}

          {/* Question */}
          <h2
            style={{
              fontFamily:    "'Cormorant Garamond', serif",
              fontSize:      step === 'q1_company' ? 44 : 36,
              fontWeight:    300,
              color:         textPrimary,
              lineHeight:    1.1,
              letterSpacing: '-0.5px',
              marginBottom:  32,
              textShadow:    scene.lightText
                ? '0 2px 20px rgba(0,0,0,0.18)'
                : 'none',
            }}
          >
            {QUESTIONS[step] ?? 'Almost done...'}
          </h2>

          {/* Main input */}
          {step !== 'saving' && (
            <>
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={HINTS[step] ?? ''}
                style={{
                  width:          '100%',
                  background:     inputBg,
                  border:         `0.5px solid ${inputBorder}`,
                  borderRadius:   14,
                  padding:        '16px 20px',
                  fontSize:       16,
                  fontWeight:     300,
                  color:          textPrimary,
                  outline:        'none',
                  fontFamily:     "'DM Sans', sans-serif",
                  marginBottom:   step === 'q1_company' ? 12 : 24,
                  backdropFilter: 'blur(8px)',
                  caretColor:     COLORS.amber,
                }}
                onFocus={e => {
                  e.target.style.borderColor = 'rgba(232,160,48,0.5)';
                }}
                onBlur={e => {
                  e.target.style.borderColor = inputBorder;
                }}
              />

              {/* Sub-input for industry — only on q1 */}
              {step === 'q1_company' && (
                <input
                  type="text"
                  value={subInput}
                  onChange={e => setSubInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="And what industry? (optional)"
                  style={{
                    width:          '100%',
                    background:     inputBg,
                    border:         `0.5px solid ${inputBorder}`,
                    borderRadius:   14,
                    padding:        '14px 20px',
                    fontSize:       14,
                    fontWeight:     300,
                    color:          textSecondary,
                    outline:        'none',
                    fontFamily:     "'DM Sans', sans-serif",
                    marginBottom:   24,
                    backdropFilter: 'blur(8px)',
                    caretColor:     COLORS.amber,
                  }}
                  onFocus={e => {
                    e.target.style.borderColor = 'rgba(232,160,48,0.5)';
                  }}
                  onBlur={e => {
                    e.target.style.borderColor = inputBorder;
                  }}
                />
              )}

              {/* Error message */}
              {error && (
                <p style={{
                  fontSize:     13,
                  color:        COLORS.red,
                  marginBottom: 16,
                  fontWeight:   300,
                }}>
                  {error}
                </p>
              )}

              {/* Continue button */}
              <button
                onClick={handleNext}
                disabled={!input.trim()}
                style={{
                  width:          '100%',
                  padding:        '15px 0',
                  borderRadius:   14,
                  border:         'none',
                  background:     input.trim()
                    ? 'linear-gradient(135deg, #C87820, #E09838)'
                    : 'rgba(232,160,48,0.15)',
                  color:          input.trim()
                    ? 'white'
                    : 'rgba(232,160,48,0.4)',
                  fontSize:       11,
                  fontWeight:     700,
                  letterSpacing:  '2.5px',
                  textTransform:  'uppercase',
                  cursor:         input.trim() ? 'pointer' : 'default',
                  fontFamily:     "'DM Sans', sans-serif",
                  transition:     'all 0.2s ease',
                  boxShadow:      input.trim()
                    ? '0 6px 24px rgba(200,120,32,0.3)'
                    : 'none',
                }}
              >
                {step === 'q3_deal' ? 'Let\'s go \u2192' : 'Continue \u2192'}
              </button>

              {/* Skip hint — deal step only */}
              {step === 'q3_deal' && (
                <p
                  onClick={() => {
                    setInput('My first deal');
                    setTimeout(handleNext, 50);
                  }}
                  style={{
                    fontSize:   12,
                    fontWeight: 300,
                    color:      textSecondary,
                    textAlign:  'center',
                    marginTop:  16,
                    cursor:     'pointer',
                    opacity:    0.7,
                  }}
                >
                  Skip for now
                </p>
              )}
            </>
          )}

          {/* Saving state */}
          {step === 'saving' && (
            <div style={{ textAlign: 'center' }}>
              <div
                style={{
                  width:        48,
                  height:       48,
                  borderRadius: '50%',
                  border:       '2px solid rgba(232,160,48,0.2)',
                  borderTop:    `2px solid ${COLORS.amber}`,
                  animation:    'spin 0.8s linear infinite',
                  margin:       '0 auto 20px',
                }}
              />
              <p style={{
                fontSize:   14,
                fontWeight: 300,
                color:      textSecondary,
              }}>
                Setting up your workspace...
              </p>
            </div>
          )}

        </div>
      )}

      {/* Keyframes */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes breath {
          0%, 100% { transform: scale(1); }
          50%      { transform: scale(1.04); }
        }
      `}</style>
    </div>
  );
}
