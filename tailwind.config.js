/** @type {import('tailwindcss').Config} */
// Neutral colors come from CSS variables (see src/index.css), so one class works in both the dark and light theme.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // FLUXORA palette
        white: v('fg'),
        slate: { 100: v('s100'), 200: v('s200'), 300: v('s300'), 400: v('s400'), 500: v('s500'), 600: v('s600') },
        volt: '#8257FF',
        neon: '#27D9FF',
        flux: { pink: '#FF55B8', green: '#20D6A0' },
        navy: { 950: v('n950'), 900: v('n900'), 800: v('n800'), 700: v('n700'), 600: v('n600') },
        cyan: { neon: '#27D9FF' },
      },
      fontFamily: {
        display: ['"Space Grotesk"', '"DM Sans"', 'sans-serif'],
        sans: ['"DM Sans"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Menlo', 'monospace'],
      },
      boxShadow: {
        glow: 'none',
        cyan: 'none',
        pink: 'none',
        card: '0 12px 32px -16px rgba(0,0,0,0.45)',
      },
      keyframes: {
        drift1: { '0%,100%': { transform: 'translate3d(0,0,0) scale(1)' }, '50%': { transform: 'translate3d(6%,8%,0) scale(1.12)' } },
        drift2: { '0%,100%': { transform: 'translate3d(0,0,0) scale(1.05)' }, '50%': { transform: 'translate3d(-8%,6%,0) scale(0.95)' } },
        drift3: { '0%,100%': { transform: 'translate3d(0,0,0)' }, '50%': { transform: 'translate3d(5%,-9%,0) scale(1.1)' } },
        pan: { '0%': { backgroundPosition: '0% 50%' }, '100%': { backgroundPosition: '200% 50%' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        pulseRing: { '0%': { transform: 'scale(0.8)', opacity: '0.8' }, '100%': { transform: 'scale(2.2)', opacity: '0' } },
        rise: { '0%': { opacity: '0', transform: 'translateY(6px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
      },
      animation: {
        drift1: 'drift1 22s ease-in-out infinite',
        drift2: 'drift2 28s ease-in-out infinite',
        drift3: 'drift3 25s ease-in-out infinite',
        pan: 'pan 8s linear infinite',
        pulseRing: 'pulseRing 2s ease-out infinite',
        rise: 'rise .22s cubic-bezier(.2,.8,.2,1) both',
      },
    },
  },
  plugins: [],
}
