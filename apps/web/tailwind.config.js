/** @type {import('tailwindcss').Config} */
const path = require('node:path');

module.exports = {
  content: [
    path.join(__dirname, 'src/**/*.ts'),
    path.join(__dirname, 'src/**/*.ejs')
  ],
  theme: {
    extend: {
      fontFamily: {
        inter: ['Inter', 'system-ui', 'sans-serif'],
        space: ['Space Grotesk', 'sans-serif']
      },
      colors: {
        'bg-dark': '#03040a',
        panel: 'rgba(6, 8, 18, 0.6)',
        'panel-strong': 'rgba(18, 21, 36, 0.95)',
        'panel-muted': 'rgba(10, 12, 20, 0.85)',
        accent: '#a66dff',
        'accent-strong': '#7f3bff',
        'accent-soft': '#5c45ff',
        success: '#00d1a7',
        warn: '#ffcb42',
        danger: '#ff6b78'
      },
      boxShadow: {
        glow: '0 25px 60px rgba(5, 5, 15, 0.55)',
        card: '0 12px 28px rgba(0, 0, 0, 0.35)',
        hover: '0 16px 32px rgba(0, 0, 0, 0.45)'
      },
      keyframes: {
        glowPulse: {
          '0%, 100%': { opacity: '0', transform: 'scale(0.95)' },
          '50%': { opacity: '1', transform: 'scale(1.05)' }
        }
      },
      animation: {
        glowPulse: 'glowPulse 3s ease-in-out infinite'
      }
    }
  },
  plugins: []
};
