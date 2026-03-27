import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { SUPABASE_URL } from '@/lib/constants';

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
  const { error: upsertError } = await supabase
    .from('users')
    .upsert(
      {
        id: user.id,
        email: user.email ?? '',
        full_name: user.user_metadata?.full_name ?? null,
        avatar_url: user.user_metadata?.avatar_url ?? null,
        // company, role, industry are null until onboarding sets them
      },
      { onConflict: 'id', ignoreDuplicates: false }
    );

  if (upsertError) {
    console.error('User upsert error:', upsertError);
  }

  // Check onboarding status
  const { data: profile } = await supabase
    .from('users')
    .select('onboarding_completed')
    .eq('id', user.id)
    .single();

  const destination = profile?.onboarding_completed ? next : '/onboarding';

  return NextResponse.redirect(`${origin}${destination}`);
}
