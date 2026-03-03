/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx,js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        // Cyberpunk static tokens
        "neon-red": "#FF1A3C",
        "neon-cyan": "#00F0FF",
      },
      fontFamily: {
        orbitron: ["Orbitron", "sans-serif"],
        rajdhani: ["Rajdhani", "system-ui", "sans-serif"],
      },
      boxShadow: {
        "neon-red":        "0 0 15px #FF1A3C, 0 0 30px rgba(255, 26, 60, 0.35)",
        "neon-red-intense":"0 0 20px #FF1A3C, 0 0 50px rgba(255, 26, 60, 0.55), 0 0 80px rgba(255, 26, 60, 0.2)",
        "neon-cyan":       "0 0 15px #00F0FF, 0 0 30px rgba(0, 240, 255, 0.35)",
        "neon-red-inset":  "inset 0 0 20px rgba(255, 26, 60, 0.08)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      animation: {
        "neon-pulse": "neon-pulse 2.4s ease-in-out infinite",
        "border-flicker": "border-flicker 8s ease-in-out infinite",
      },
      keyframes: {
        "neon-pulse": {
          "0%, 100%": {
            filter: "drop-shadow(0 0 6px #FF1A3C) drop-shadow(0 0 14px rgba(255,26,60,0.6))",
          },
          "50%": {
            filter:
              "drop-shadow(0 0 14px #FF1A3C) drop-shadow(0 0 32px rgba(255,26,60,0.85)) drop-shadow(0 0 56px rgba(255,26,60,0.3))",
          },
        },
        "border-flicker": {
          "0%, 95%, 100%": { opacity: "1" },
          "96%":            { opacity: "0.6" },
          "98%":            { opacity: "0.85" },
        },
      },
    },
  },
  plugins: [],
};
