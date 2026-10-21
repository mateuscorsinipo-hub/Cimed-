/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { 950: '#07080A', 900: '#0B0C0F', 850: '#101216', 800: '#14171C', 700: '#1B1F26', 600: '#252A33', 500: '#323844' },
        fg: { DEFAULT: '#F2F4F7', muted: '#9AA3B2', dim: '#6B7382' },
        gain: { DEFAULT: '#C6F432', dim: '#9BC21F' },
        loss: { DEFAULT: '#FF4F4F', dim: '#C93A3A' },
        data: { DEFAULT: '#4DA3FF', dim: '#2F7FD6' },
        warn: '#FFB547',
      },
      fontFamily: {
        sans: ['"Barlow"', 'system-ui', 'sans-serif'],
        display: ['"Barlow Semi Condensed"', '"Barlow"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: { panel: '10px' },
      keyframes: {
        draw: { from: { strokeDashoffset: 'var(--len, 4000)' }, to: { strokeDashoffset: '0' } },
        fadeUp: { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'none' } },
      },
      animation: {
        draw: 'draw 2.4s cubic-bezier(.6,.05,.25,1) forwards',
        fadeUp: 'fadeUp .5s ease both',
      },
    },
  },
  plugins: [],
};
