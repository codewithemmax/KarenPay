import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}",
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
        "primary-hover": "var(--primary-hover)",
        sun: "var(--sun)",
        peach: "var(--peach)",
        coral: "var(--coral)",
        ink: "var(--ink)",
        "balance-card": "var(--balance-card)",
        danger: "var(--danger)",
        "warning-bg": "var(--warning-bg)",
        "warning-text": "var(--warning-text)",
        "input-border": "var(--input-border)",
        divider: "var(--divider)",
        "focus-ring": "var(--focus-ring)",
      },
      fontFamily: {
        sans: [
          "var(--font-sans)",
          "Atkinson Hyperlegible",
          "system-ui",
          "sans-serif",
        ],
        num: ["var(--font-num)", "Inter", "monospace"],
      },
      borderRadius: {
        card: "20px",
        input: "14px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(31, 13, 9, 0.06), 0 8px 24px rgba(31, 13, 9, 0.06)",
      },
    },
  },
  plugins: [],
};

export default config;
