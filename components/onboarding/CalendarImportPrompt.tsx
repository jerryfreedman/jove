'use client';

interface CalendarImportPromptProps {
  onImport: () => void;
  onSkip: () => void;
}

export default function CalendarImportPrompt({
  onImport,
  onSkip,
}: CalendarImportPromptProps) {
  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onSkip}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          zIndex: 108,
        }}
      />

      {/* Sheet */}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 109,
          background: '#1A1E28',
          borderRadius: '24px 24px 0 0',
          padding: '32px 24px',
          paddingBottom: 'calc(48px + env(safe-area-inset-bottom))',
          animation: 'slideUp 0.4s cubic-bezier(0.22, 1, 0.36, 1) both',
        }}
      >
        {/* Drag handle */}
        <span
          style={{
            width: 40,
            height: 4,
            background: 'rgba(255,255,255,0.15)',
            borderRadius: 2,
            margin: '0 auto 24px',
            display: 'block',
          }}
        />

        {/* Emoji */}
        <div style={{ fontSize: 32, textAlign: 'center', marginBottom: 12 }}>
          📅
        </div>

        {/* Heading */}
        <div
          style={{
            fontFamily: "'Cormorant Garamond', serif",
            fontSize: 26,
            color: '#F7F3EC',
            textAlign: 'center',
            marginBottom: 8,
          }}
        >
          Add your meetings?
        </div>

        {/* Body */}
        <div
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 14,
            color: 'rgba(247,243,236,0.6)',
            textAlign: 'center',
            lineHeight: 1.55,
            marginBottom: 28,
          }}
        >
          Import your calendar so Jove knows what&apos;s coming.
          Screenshot any calendar app — Outlook, Google Calendar,
          or anything else works.
        </div>

        {/* Import button */}
        <button
          onClick={onImport}
          style={{
            background: 'linear-gradient(135deg, #C87820, #E09838)',
            color: '#1A1410',
            fontSize: 15,
            fontWeight: 600,
            borderRadius: 14,
            height: 52,
            width: '100%',
            border: 'none',
            cursor: 'pointer',
            fontFamily: "'DM Sans', sans-serif",
            marginBottom: 10,
          }}
        >
          Import meetings &rarr;
        </button>

        {/* Skip button */}
        <button
          onClick={onSkip}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'rgba(247,243,236,0.36)',
            fontSize: 14,
            fontWeight: 300,
            height: 44,
            width: '100%',
            cursor: 'pointer',
            fontFamily: "'DM Sans', sans-serif",
          }}
        >
          Skip for now
        </button>
      </div>
    </>
  );
}
