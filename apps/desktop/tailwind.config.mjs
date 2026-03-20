import typography from '@tailwindcss/typography';

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // StreamFusion Brand Colors
        storm: {
          primary: '#ffffff',
          secondary: '#a3a3a3',
          accent: '#dc143c',
        },
        // Platform Colors
        twitch: {
          DEFAULT: '#9146ff',
          dark: '#772ce8',
          light: '#a970ff',
        },
        kick: {
          DEFAULT: '#53fc18',
          dark: '#3dd912',
          light: '#7aff4d',
        },
        // Background Colors (Dark Theme)
        background: {
          DEFAULT: '#0f0f0f',
          secondary: '#1a1a1a',
          tertiary: '#252525',
          elevated: '#2d2d2d',
        },
        // Text Colors
        foreground: {
          DEFAULT: '#ffffff',
          secondary: '#a0a0a0',
          muted: '#666666',
          category: '#b2b2b2',
        },
        // Tag Colors
        tag: {
          DEFAULT: '#35353b',
          hover: '#45454b',
          text: '#efeff1',
        },
        // UI Colors
        border: '#333333',
        ring: '#ffffff',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      borderRadius: {
        'sm': '4px',
        'md': '8px',
        'lg': '12px',
        'xl': '16px',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-in-out',
        'slide-up': 'slideUp 0.2s ease-out',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
      },
    },
  },
  plugins: [
    typography,
  ],
};
