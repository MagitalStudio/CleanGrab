// SPDX-License-Identifier: GPL-3.0-only
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Semantic colors: named by role, resolved per appearance in index.css.
      colors: {
        bg: token("bg"),
        surface: token("surface"),
        field: token("field"),
        elevated: token("elevated"),
        track: token("track"),
        pill: token("pill"),
        control: token("control-off"),
        line: token("line"),
        ink: { DEFAULT: token("ink"), 2: token("ink-2"), 3: token("ink-3") },
        accent: { DEFAULT: token("accent"), fill: token("accent-fill"), on: token("on-accent") },
        danger: token("danger"),
      },
      // Desktop type scale: 13px body, nothing below 11px.
      fontSize: {
        caption: ["11px", "14px"],
        body: ["13px", "18px"],
        headline: ["15px", "20px"],
        title: ["22px", "28px"],
        display: ["28px", "34px"],
      },
      fontFamily: {
        sans: [
          '"Segoe UI Variable Text"',
          '"Segoe UI"',
          "system-ui",
          "-apple-system",
          '"SF Pro Text"',
          "sans-serif",
        ],
        mono: ["ui-monospace", '"Cascadia Mono"', '"SF Mono"', "Menlo", "Consolas", "monospace"],
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "toast-in": {
          from: { opacity: "0", transform: "translateY(8px) scale(0.98)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        settle: {
          from: { opacity: "0", transform: "scale(0.88)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        indeterminate: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(250%)" },
        },
        // A check mark or badge that lands with a small overshoot.
        pop: {
          "0%": { opacity: "0", transform: "scale(0.5)" },
          "60%": { opacity: "1", transform: "scale(1.15)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "slide-in-right": {
          from: { opacity: "0", transform: "translateX(14px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        shake: {
          "0%, 100%": { transform: "translateX(0)" },
          "20%": { transform: "translateX(-4px)" },
          "40%": { transform: "translateX(4px)" },
          "60%": { transform: "translateX(-3px)" },
          "80%": { transform: "translateX(2px)" },
        },
        // A row leaving the list: fades, slides and folds away. The starting
        // height is set by the row itself (--row-height).
        "row-out": {
          from: { opacity: "1", maxHeight: "var(--row-height, 200px)" },
          to: {
            opacity: "0",
            maxHeight: "0px",
            paddingTop: "0px",
            paddingBottom: "0px",
            borderWidth: "0px",
            transform: "translateX(10px)",
          },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-3px)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.45s cubic-bezier(0.22, 1, 0.36, 1) both",
        "fade-in": "fade-in 0.3s ease-out both",
        "toast-in": "toast-in 0.22s cubic-bezier(0.22, 1, 0.36, 1) both",
        settle: "settle 0.55s cubic-bezier(0.22, 1, 0.36, 1) both",
        indeterminate: "indeterminate 1.4s ease-in-out infinite",
        pop: "pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both",
        "slide-in-right": "slide-in-right 0.4s cubic-bezier(0.22, 1, 0.36, 1) both",
        shake: "shake 0.4s ease-in-out both",
        "row-out": "row-out 0.24s cubic-bezier(0.4, 0, 0.2, 1) forwards",
        float: "float 4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
