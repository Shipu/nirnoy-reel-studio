import "@fontsource/noto-serif-bengali/bengali-400.css";
import "@fontsource/noto-serif-bengali/bengali-500.css";
import "@fontsource/noto-serif-bengali/bengali-600.css";
import "@fontsource/noto-serif-bengali/bengali-700.css";
import "@fontsource/noto-serif-bengali/latin-400.css";
import "@fontsource/noto-serif-bengali/latin-600.css";
import "@fontsource/noto-serif-bengali/latin-700.css";
import "@fontsource/inter/latin-700.css";
import React, { useEffect, useState } from "react";
import { AbsoluteFill, Easing, continueRender, delayRender, interpolate } from "remotion";
import { type Palette, type ReelProps } from "./types";

// ---- Brand tokens (from nirnoy.pen, "mn-" set) ----
export const FONT = "'Noto Serif Bengali', serif";
/** Noto Serif Bengali's Latin glyphs run larger than its Bengali ones; shrink Latin runs so mixed lines sit evenly. */
export const Mixed: React.FC<{ text: string }> = ({ text }) => (
  <>
    {text.split(/([A-Za-z][A-Za-z0-9 .'-]*[A-Za-z0-9]|[A-Za-z])/).map((part, i) =>
      i % 2 ? (
        <span key={i} style={{ fontSize: "0.88em" }}>
          {part}
        </span>
      ) : (
        part
      ),
    )}
  </>
);
export const BN = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];
export const bn = (n: number) => String(n).replace(/\d/g, (d) => BN[+d]);

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
export const ease = Easing.bezier(0.16, 1, 0.3, 1);

export const useFontsReady = () => {
  const [handle] = useState(() => delayRender("fonts"));
  useEffect(() => {
    Promise.all(
      [
        ...[400, 500, 600, 700].map((w) => document.fonts.load(`${w} 40px 'Noto Serif Bengali'`, "অআক১")),
        document.fonts.load("700 36px Inter", "nirnoy.app"),
      ],
    ).then(() => continueRender(handle));
  }, [handle]);
};

// Logo / Primary from nirnoy.pen (viewBox 200x200)
export const LogoMark: React.FC<{ size: number; C: Palette; reversed?: boolean }> = ({ size, C, reversed }) => (
  <svg width={size} height={size} viewBox="0 0 200 200">
    <path
      fill={reversed ? "#FFFFFF" : C.primary}
      d="M32.198 110.005l-7.988 45.301a17 17 0 0 0 33.484 5.904l7.988-45.301a17 17 0 0 0-33.484-5.904z m54.946-39.392l-14.934 84.693a17 17 0 0 0 33.484 5.904l14.933-84.693a17 17 0 0 0-33.483-5.904z"
    />
    <path
      fill={C.accent}
      d="M142.09 31.22l-21.88 124.086a17 17 0 0 0 33.484 5.904l21.879-124.085a17 17 0 0 0-33.483-5.905z"
    />
  </svg>
);

/** Closing brand screen, fades in over everything at `progress` 0..1. */
export const EndScreen: React.FC<{ p: ReelProps; C: Palette; progress: number }> = ({ p, C, progress }) => (
  <AbsoluteFill
    style={{
      background: `linear-gradient(180deg, ${C.hero1} 0%, ${C.hero2} 100%)`,
      opacity: progress,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 30,
      padding: "0 80px",
      textAlign: "center",
      color: "#FFFFFF",
    }}
  >
    <div style={{ scale: interpolate(progress, [0, 1], [0.85, 1]) }}>
      <LogoMark size={190} C={C} reversed />
    </div>
    <div style={{ fontSize: 96, fontWeight: 700 }}>নির্ণয়</div>
    <div style={{ fontSize: 44, lineHeight: 1.6, color: C.onHero2 }}>
      <Mixed text={p.tagline} />
    </div>
    <div style={{ marginTop: 40, fontSize: 46, fontWeight: 600, color: "#FFFFFF" }}>
      <Mixed text={p.ctaLine} />
    </div>
    <div style={{ backgroundColor: C.accent, color: C.hero2, fontSize: 50, fontWeight: 700, borderRadius: 999, padding: "22px 56px" }}>
      {p.ctaUrl}
    </div>
  </AbsoluteFill>
);
