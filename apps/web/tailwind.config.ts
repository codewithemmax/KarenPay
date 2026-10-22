import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        "surface-tint": "var(--surface-tint)",
        text: "var(--text)",
        "text-muted": "var(--text-muted)",
        primary: "var(--primary)",
        "primary-strong": "var(--primary-strong)",
        "balance-card": "var(--balance-card)",
        danger: "var(--danger)",
        "danger-strong": "var(--danger-strong)",
        success: "var(--success)",
        "success-strong": "var(--success-strong)",
        "warning-bg": "var(--warning-bg)",
        "warning-text": "var(--warning-text)",
        "input-border": "var(--input-border)",
        divider: "var(--divider)",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "20px",
        input: "14px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(11, 31, 26, 0.06), 0 8px 24px rgba(11, 31, 26, 0.06)",
      },
    },
  },
  plugins: [],
};

export default config;
