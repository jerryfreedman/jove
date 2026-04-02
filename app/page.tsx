import { createServerSupabaseClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import SignInClient from '@/components/ui/SignInClient';
import { DEFAULT_DOMAIN_KEY, isValidDomainKey } from '@/lib/domain';

export default async function RootPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session) {
    const { data: profile } = await supabase
      .from('users')
      .select('onboarding_completed, domain_key')
      .eq('id', session.user.id)
      .single();

    // Session 10: Safety backfill — repair missing domain_key to 'custom'
    if (profile && !isValidDomainKey(profile.domain_key)) {
      console.log('[root] Repairing missing domain_key to custom for user:', session.user.id);
      await supabase
        .from('users')
        .update({ domain_key: DEFAULT_DOMAIN_KEY })
        .eq('id', session.user.id);
    }

    if (profile?.onboarding_completed) {
      redirect('/home');
    } else {
      redirect('/onboarding');
    }
  }

  return <SignInClient />;
}
