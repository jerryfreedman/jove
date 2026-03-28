import { createServerSupabaseClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import SignInClient from '@/components/ui/SignInClient';

export default async function RootPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session) {
    const { data: profile } = await supabase
      .from('users')
      .select('onboarding_completed')
      .eq('id', session.user.id)
      .single();

    if (profile?.onboarding_completed) {
      redirect('/home');
    } else {
      redirect('/onboarding');
    }
  }

  return <SignInClient />;
}
