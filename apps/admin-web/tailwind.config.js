/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: '#0B1220',
        surface: '#111A2E',
        raised: '#17233D',
        line: '#26365A',
        ink: '#E8EEF8',
        muted: '#A3B3CC',
        accent: { DEFAULT: '#38BDF8', strong: '#7DD3FC', deep: '#0C4A6E' },
        danger: { DEFAULT: '#B91C1C', soft: '#FCA5A5' },
        ok: '#4ADE80',
        warn: '#FBBF24',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
