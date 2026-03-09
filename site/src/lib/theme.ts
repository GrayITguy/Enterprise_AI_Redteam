import type { CSSProperties } from "react";

/* ── Cyberpunk color tokens ─────────────────────────────────────────── */
export const NEON_RED = "#FF1A3C";
export const NEON_CYAN = "#00F0FF";
export const NEON_ORANGE = "#FF8C1A";

/* ── Font families ──────────────────────────────────────────────────── */
export const FONT_DISPLAY = "'Orbitron', sans-serif";
export const FONT_UI = "'Rajdhani', sans-serif";

/* ── Reusable style objects ─────────────────────────────────────────── */

/** Glass-morphism card background. */
export const cyberCardStyle: CSSProperties = {
  background: "rgba(10, 10, 10, 0.9)",
  backdropFilter: "blur(14px)",
  WebkitBackdropFilter: "blur(14px)",
  border: `1px solid rgba(255,26,60,0.2)`,
  boxShadow: "inset 0 0 30px rgba(255,26,60,0.03)",
};

/** Tooltip shared style for Recharts. */
export const TOOLTIP_STYLE: CSSProperties = {
  backgroundColor: "rgba(10, 0, 3, 0.95)",
  border: "1px solid rgba(255, 26, 60, 0.4)",
  borderRadius: "4px",
  color: "#e5e5e5",
  fontFamily: FONT_UI,
  fontSize: "13px",
  boxShadow: "0 0 20px rgba(255,26,60,0.2)",
};

/** Primary CTA button style (red glow). */
export const primaryButtonStyle: CSSProperties = {
  background: NEON_RED,
  fontFamily: FONT_UI,
  letterSpacing: "0.12em",
  boxShadow: `0 0 15px rgba(255,26,60,0.55), 0 0 30px rgba(255,26,60,0.25)`,
  border: "1px solid rgba(255,26,60,0.6)",
};

/** Primary CTA hover box-shadow. */
export const PRIMARY_BUTTON_HOVER_SHADOW =
  "0 0 22px rgba(255,26,60,0.8), 0 0 50px rgba(255,26,60,0.4)";

/** Primary CTA default box-shadow. */
export const PRIMARY_BUTTON_SHADOW =
  "0 0 15px rgba(255,26,60,0.55), 0 0 30px rgba(255,26,60,0.25)";
