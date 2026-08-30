import type { Config } from "tailwindcss";

// Los tokens visuales de Mundo Marítimo viven como variables CSS en globals.css.
// Tailwind los expone como utilidades para maquetación puntual.
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: "var(--navy)",
        blue: { DEFAULT: "var(--blue)", dark: "var(--blue-dark)" },
        green: "var(--green)",
        orange: "var(--orange)",
        red: "var(--red)",
        muted: "var(--muted)",
        line: "var(--line)",
        paper: "var(--paper)",
        bg: "var(--bg)",
      },
      fontFamily: {
        display: ["var(--font-display)", "Space Grotesk", "sans-serif"],
        sans: ["var(--font-sans)", "Inter", "system-ui", "sans-serif"],
      },
      borderRadius: {
        lg: "var(--radius-lg)",
        md: "var(--radius-md)",
        sm: "var(--radius-sm)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
      },
    },
  },
  plugins: [],
};

export default config;
