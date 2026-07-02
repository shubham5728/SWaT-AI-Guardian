import type { Config } from "tailwindcss";

/**
 * Design tokens ported 1:1 from the original Streamlit `app_kafka_live.py` CSS
 * so the React UI is visually identical to the dashboard it replaces.
 */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0B0F14", // app background
        surface: "#111827", // matte-card background
        "surface-2": "#1F2937",
        border: "rgba(255,255,255,0.05)",
        text: {
          DEFAULT: "#E0E0E0",
          strong: "#FFFFFF",
          muted: "#9CA3AF",
          faint: "#6B7280",
        },
        // Severity palette
        normal: "#10B981",
        warning: "#F59E0B",
        critical: "#EF4444",
        accent: "#3B82F6",
      },
      fontFamily: {
        sans: ["Outfit", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        card: "0 4px 6px -1px rgba(0,0,0,0.1)",
        glow: "0 0 5px rgba(0,242,195,0.3)",
      },
      keyframes: {
        "pulse-ring": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.4" },
        },
      },
      animation: {
        "pulse-ring": "pulse-ring 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
