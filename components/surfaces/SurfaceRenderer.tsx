'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSurface } from './SurfaceManager';
import SurfaceContainer from './SurfaceContainer';
import DealsSurface from './content/DealsSurface';
import DealDetailSurface from './content/DealDetailSurface';
import DealChatSurface from './content/DealChatSurface';
import DealPrepSurface from './content/DealPrepSurface';
import MeetingsSurface from './content/MeetingsSurface';
import IdeasSurface from './content/IdeasSurface';
import ItemsSurface from './content/ItemsSurface';
import PeopleSurface from './content/PeopleSurface';
import SettingsSurface from './content/SettingsSurface';
import BriefingSurface from './content/BriefingSurface';
import { createClient } from '@/lib/supabase';
import { resolveUserDomainProfile, getEntityLabel, getEntityLabelSingular } from '@/lib/semantic-labels';
import type { UserDomainProfile } from '@/lib/types';

// ── SESSION 12: DOMAIN-AWARE SURFACE TITLES ─────────────────
function getSurfaceTitles(profile: UserDomainProfile): Record<string, string> {
  const primary = getEntityLabel('primary', profile);
  const primarySingular = getEntityLabelSingular('primary', profile);
  const contact = getEntityLabel('contact', profile);
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return {
    deals:        primary,
    'deal-detail': cap(primarySingular),
    'deal-chat':  'Chat',
    'deal-prep':  'Prep',
    meetings:     'Meetings',
    ideas:        'Ideas',
    items:        primary,
    people:       contact,
    settings:     'Settings',
    briefing:     'Briefing',
  };
}

export default function SurfaceRenderer() {
  const { activeSurface, goBack, closeAll, canGoBack } = useSurface();

  // Session 12: Domain-aware titles
  const [domainProfile, setDomainProfile] = useState<UserDomainProfile | null>(null);
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase
        .from('users')
        .select('domain_key')
        .eq('id', user.id)
        .single()
        .then(({ data }) => {
          if (data) setDomainProfile(resolveUserDomainProfile(data.domain_key));
        });
    });
  }, []);

  const surfaceTitles = useMemo(
    () => domainProfile ? getSurfaceTitles(domainProfile) : getSurfaceTitles(resolveUserDomainProfile('custom')),
    [domainProfile],
  );

  if (!activeSurface) return null;

  const title = surfaceTitles[activeSurface.id] || '';
  const params = activeSurface.params ?? {};

  // Determine if back is available
  const handleBack = canGoBack ? goBack : undefined;

  return (
    <SurfaceContainer
      open={true}
      onClose={closeAll}
      title={title}
      level={2}
      onBack={handleBack}
      maxHeight="92dvh"
    >
      {activeSurface.id === 'deals' && (
        <DealsSurface />
      )}
      {activeSurface.id === 'deal-detail' && (
        <DealDetailSurface dealId={params.dealId} />
      )}
      {activeSurface.id === 'deal-chat' && (
        <DealChatSurface dealId={params.dealId} />
      )}
      {activeSurface.id === 'deal-prep' && (
        <DealPrepSurface dealId={params.dealId} />
      )}
      {activeSurface.id === 'meetings' && (
        <MeetingsSurface />
      )}
      {activeSurface.id === 'ideas' && (
        <IdeasSurface />
      )}
      {activeSurface.id === 'items' && (
        <ItemsSurface />
      )}
      {activeSurface.id === 'people' && (
        <PeopleSurface />
      )}
      {activeSurface.id === 'settings' && (
        <SettingsSurface />
      )}
      {activeSurface.id === 'briefing' && (
        <BriefingSurface />
      )}
    </SurfaceContainer>
  );
}
