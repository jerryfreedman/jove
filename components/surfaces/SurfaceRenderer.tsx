'use client';

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

// ── SURFACE TITLES ──────────────────────────────────────────
const SURFACE_TITLES: Record<string, string> = {
  deals:        'Deals',
  'deal-detail':'Deal',
  'deal-chat':  'Chat',
  'deal-prep':  'Prep',
  meetings:     'Meetings',
  ideas:        'Ideas',
  items:        'Items',
  people:       'People',
  settings:     'Settings',
  briefing:     'Briefing',
};

export default function SurfaceRenderer() {
  const { activeSurface, goBack, closeAll, canGoBack } = useSurface();

  if (!activeSurface) return null;

  const title = SURFACE_TITLES[activeSurface.id] || '';
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
