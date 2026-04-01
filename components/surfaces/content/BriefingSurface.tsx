'use client';

import { FONTS } from '@/lib/design-system';

// Session 14B: Briefing content is now unified into the control panel.
// This surface exists as a redirect notice only.
export default function BriefingSurface() {
  return (
    <div style={{
      padding: '48px 24px',
      textAlign: 'center',
    }}>
      <div style={{
        fontFamily: FONTS.serif,
        fontSize: 17,
        fontWeight: 300,
        color: 'rgba(252,246,234,0.40)',
        lineHeight: 1.5,
      }}>
        Everything you need is on the home surface.
      </div>
    </div>
  );
}
