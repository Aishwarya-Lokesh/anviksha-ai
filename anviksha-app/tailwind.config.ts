import type { Config } from "tailwindcss";

const config: Config = {
  // Colours that change between light and dark are CSS variables (see globals.css).
  darkMode: "class",
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#5B3FD9",
          light: "rgb(var(--brand-light) / <alpha-value>)",
          dark: "#4530B0",
          50: "rgb(var(--brand-50) / <alpha-value>)",
        },
        navy: {
          DEFAULT: "#0F1229",
          light: "#1A1F3A",
        },
        success: "#1F9D55",
        warning: "#E8A93B",
        danger: "#E5484D",
        info: "#3B82F6",
        surface: "rgb(var(--surface) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        gray: {
          50: "rgb(var(--gray-50) / <alpha-value>)",
          100: "rgb(var(--gray-100) / <alpha-value>)",
          200: "rgb(var(--gray-200) / <alpha-value>)",
          300: "rgb(var(--gray-300) / <alpha-value>)",
          400: "rgb(var(--gray-400) / <alpha-value>)",
          500: "rgb(var(--gray-500) / <alpha-value>)",
          600: "rgb(var(--gray-600) / <alpha-value>)",
          700: "rgb(var(--gray-700) / <alpha-value>)",
          800: "rgb(var(--gray-800) / <alpha-value>)",
          900: "rgb(var(--gray-900) / <alpha-value>)",
        },
      },
      // "White" as a surface follows the theme; white text stays white.
      backgroundColor: { white: "rgb(var(--card) / <alpha-value>)" },
      borderColor: { white: "rgb(var(--card) / <alpha-value>)" },
      gradientColorStops: { white: "rgb(var(--card) / <alpha-value>)" },
      textColor: {
        brand: { DEFAULT: "rgb(var(--brand-text) / <alpha-value>)", dark: "rgb(var(--brand-text-strong) / <alpha-value>)", light: "rgb(var(--brand-light) / <alpha-value>)", 50: "rgb(var(--brand-50) / <alpha-value>)" },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        display: ["Sora", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      borderRadius: {
        xl2: "1.125rem",
        xl3: "1.5rem",
      },
      boxShadow: {
        // layered, softer shadows — closer to macOS/iOS card elevation than a single flat drop-shadow
        card: "0 1px 2px rgba(15,18,41,0.04), 0 4px 12px rgba(15,18,41,0.05)",
        cardHover: "0 2px 6px rgba(15,18,41,0.06), 0 16px 36px rgba(15,18,41,0.12)",
        soft: "0 1px 3px rgba(15,18,41,0.05)",
        glow: "0 0 0 4px rgba(91,63,217,0.08)",
      },
      transitionTimingFunction: {
        // Apple's standard "ease-out-expo"-ish curve, used across macOS/iOS UI motion
        smooth: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
      backdropBlur: {
        xs: "2px",
      },
    },
  },
  plugins: [],
};
export default config;
