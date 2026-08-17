/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./public/index.html",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: "#3c85ee",
        "primary-hover": "#326bcc",
        "white-hover": "#f6f5fd",
        "gray-primary": "#637381",
        "gray-secondary": "#e8eef2",
        "gray-third": "#ebe9f9",
        "light-primary": "rgba(60, 133, 238, 0.4)",
        
        // Neo AI Colors
        "ai-cyan": "#00f0ff",
        "ai-violet": "#8b5cf6",
        "ai-fuchsia": "#d946ef",
        "ai-surface": "rgba(13, 18, 30, 0.65)",
        "ai-surface-hover": "rgba(20, 25, 40, 0.85)",
        "ai-border": "rgba(139, 92, 246, 0.3)",
        "ai-glow": "rgba(0, 240, 255, 0.4)",
      },
      animation: {
        'float': 'float 6s ease-in-out infinite',
        'pulse-glow': 'pulse-glow 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'gradient-x': 'gradient-x 10s ease infinite',
        'slide-up': 'slide-up 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        'pulse-glow': {
          '0%, 100%': { opacity: 0.8, boxShadow: '0 0 20px rgba(0, 240, 255, 0.3)' },
          '50%': { opacity: 1, boxShadow: '0 0 40px rgba(139, 92, 246, 0.6)' },
        },
        'gradient-x': {
          '0%, 100%': {
            'background-size': '200% 200%',
            'background-position': 'left center',
          },
          '50%': {
            'background-size': '200% 200%',
            'background-position': 'right center',
          },
        },
        'slide-up': {
          '0%': { opacity: 0, transform: 'translateY(20px) scale(0.95)' },
          '100%': { opacity: 1, transform: 'translateY(0) scale(1)' },
        }
      },
      backdropBlur: {
        'glass': '16px',
        'glass-heavy': '24px',
      }
    },
    screens: {
      quickAccessOne: "1000px",
      quickAccessTwo: "1210px",
      quickAccessThree: "1420px",
      quickAccessFour: "1600px",
      xxs: "360px",
      xs: "480px",
      sm: "640px",
      md: "768px",
      lg: "1024px",
      xl: "1280px",
      xxl: "1536px",
      fileTextXL: "1600px",
      fileTextLG: "1400px",
      fileTextMD: "1200px",
      fileTextSM: "1000px",
      fileTextXSM: "900px",
      fileListShowDetails: "680px",
      desktopMode: "1100px",
    },
  },
  plugins: [],
};
