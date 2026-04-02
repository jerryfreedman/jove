import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { SUPABASE_URL } from '@/lib/constants';
import { DEFAULT_DOMAIN_KEY, isValidDomainKey } from '@/lib/domain';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/home';

  if (!code) {
    return NextResponse.redirect(`${origin}/auth/error`);
  }

  const cookieStore = cookies();
  const supabase = createServerClient(
    SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          cookieStore.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          cookieStore.set({ name, value: '', ...options });
        },
      },
    }
  );

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session) {
    return NextResponse.redirect(`${origin}/auth/error`);
  }

  const user = data.session.user;

  // Upsert user row — creates on first login, updates on subsequent logins
  // Session 10: New users get domain_key = 'custom' (universal default, not sales)
  const { error: upsertError } = await supabase
    .from('users')
    .upsert(
      {
        id: user.id,
        email: user.email ?? '',
        full_name: user.user_metadata?.full_name ?? null,
        avatar_url: user.user_metadata?.avatar_url ?? null,
        domain_key: DEFAULT_DOMAIN_KEY,
      },
      { onConflict: 'id', ignoreDuplicates: false }
    );

  if (upsertError) {
    console.error('User upsert error:', upsertError);
  }

  // Check onboarding status + domain_key for existing users
  const { data: profile } = await supabase
    .from('users')
    .select('onboarding_completed, domain_key')
    .eq('id', user.id)
    .single();

  // Session 10: Safety backfill — if existing user has no valid domain_key, repair to 'custom'
  if (profile && !isValidDomainKey(profile.domain_key)) {
    console.log('[auth/callback] Repairing missing domain_key to custom for user:', user.id);
    await supabase
      .from('users')
      .update({ domain_key: DEFAULT_DOMAIN_KEY })
      .eq('id', user.id);
  }

  const destination = profile?.onboarding_completed ? next : '/onboarding';

  return NextResponse.redirect(`${origin}${destination}`);
}
