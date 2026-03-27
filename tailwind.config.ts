import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        'jove-cream': '#F7F3EC',
        'jove-white': '#FFFFFF',
        'jove-ink': '#1A1410',
        'jove-amber': '#E8A030',
        'jove-amber-light': '#F0C060',
        'jove-teal': '#38B8C8',
        'jove-green': '#48C878',
        'jove-red': '#E05840',
        'jove-bg': '#0D0F12',
        'jove-card': '#1A1E28',
        'jove-card-border': 'rgba(255,255,255,0.06)',
        'jove-mid': 'rgba(240,235,224,0.52)',
        'jove-light': 'rgba(240,235,224,0.28)',
      },
      fontFamily: {
        serif: ['Cormorant Garamond', 'serif'],
        sans: ['DM Sans', 'sans-serif'],
      },
      animation: {
        'breath': 'breath 5s ease-in-out infinite',
        'orb-pulse': 'orbPulse 5s ease-in-out infinite',
        'orb-glow': 'orbGlow 5s ease-in-out infinite',
        'dot-blink': 'dotBlink 3s ease-in-out infinite',
        'sun-glow': 'sunGlow 4s ease-in-out infinite',
        'sun-pulse': 'sunPulse 4s ease-in-out infinite',
        'refl-glow': 'reflGlow 6s ease-in-out infinite',
        'wave-flow': 'waveFlow 12s ease-in-out infinite',
        'haze-breath': 'hazeBreath 9s ease-in-out infinite',
        'star-twink': 'starTwink 3s ease-in-out infinite',
        'fade-up': 'fadeUp 0.45s ease both',
        'slide-sheet': 'slideSheet 0.32s cubic-bezier(.32,.72,0,1)',
      },
      keyframes: {
        breath: { '0%,100%': { transform: 'scale(1)' }, '50%': { transform: 'scale(1.022)' } },
        orbPulse: { '0%,100%': { opacity: '0.92', transform: 'scale(1)' }, '50%': { opacity: '0.58', transform: 'scale(0.94)' } },
        orbGlow: { '0%,100%': { opacity: '0.25' }, '50%': { opacity: '0.52' } },
        dotBlink: { '0%,100%': { opacity: '1', transform: 'scale(1)' }, '50%': { opacity: '0.22', transform: 'scale(0.6)' } },
        sunGlow: { '0%,100%': { opacity: '0.1' }, '50%': { opacity: '0.2' } },
        sunPulse: { '0%,100%': { opacity: '0.9' }, '50%': { opacity: '0.62' } },
        reflGlow: { '0%,100%': { width: '28px', opacity: '0.5' }, '50%': { width: '56px', opacity: '0.9' } },
        waveFlow: { '0%': { transform: 'translateX(-12px)', opacity: '0' }, '15%': { opacity: '1' }, '85%': { opacity: '1' }, '100%': { transform: 'translateX(18px)', opacity: '0' } },
        hazeBreath: { '0%,100%': { opacity: '0.65' }, '50%': { opacity: '1' } },
        starTwink: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.08' } },
        fadeUp: { from: { opacity: '0', transform: 'translateY(12px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        slideSheet: { from: { transform: 'translateY(100%)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
      },
    },
  },
  plugins: [],
};
export default config;
