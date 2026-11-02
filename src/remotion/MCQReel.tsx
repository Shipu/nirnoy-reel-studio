import "@fontsource/noto-serif-bengali/bengali-400.css";
import "@fontsource/noto-serif-bengali/bengali-500.css";
import "@fontsource/noto-serif-bengali/bengali-600.css";
import "@fontsource/noto-serif-bengali/bengali-700.css";
import "@fontsource/noto-serif-bengali/latin-400.css";
import "@fontsource/noto-serif-bengali/latin-600.css";
import "@fontsource/noto-serif-bengali/latin-700.css";
import React, { useEffect, useState } from "react";
import { AbsoluteFill, Easing, continueRender, delayRender, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { type ReelProps, fit, timeline } from "./types";

// ---- Brand tokens (from nirnoy.pen, "mn-" set) ----
const C = {
  canvas: "#FAF8F4",
  card: "#FFFFFF",
  line: "#ECE8F0",
  ink: "#16142B",
  ink2: "#5B5872",
  ink3: "#9A97AE",
  muted: "#F1EFF5",
  primary: "#4F46E5",
  primarySoft: "#EEF2FF",
  wordmark: "#312E81",
  accent: "#F59E0B",
  accentSoft: "#FEF3C7",
  accentInk: "#7A4B00",
  success: "#16A34A",
  successSoft: "#DCFCE7",
  successInk: "#15803D",
  hero1: "#3730A3",
  hero2: "#1E1B4B",
  onHero2: "#C7D2FE",
};
const FONT = "'Noto Serif Bengali', serif";
const BN = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];
const bn = (n: number) => String(n).replace(/\d/g, (d) => BN[+d]);

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.bezier(0.16, 1, 0.3, 1);

const useFontsReady = () => {
  const [handle] = useState(() => delayRender("fonts"));
  useEffect(() => {
    Promise.all(
      [400, 500, 600, 700].map((w) => document.fonts.load(`${w} 40px 'Noto Serif Bengali'`, "অআক১")),
    ).then(() => continueRender(handle));
  }, [handle]);
};

// Logo / Primary from nirnoy.pen (viewBox 200x200)
const LogoMark: React.FC<{ size: number; reversed?: boolean }> = ({ size, reversed }) => (
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

const Check: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M7.5 12.5l3 3 6-6.5" />
  </svg>
);

export const MCQReel: React.FC<ReelProps> = (p) => {
  useFontsReady();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = (sec: number) => sec * fps;
  const T = timeline(p);

  const revealP = interpolate(frame, [s(T.reveal), s(T.reveal + 0.5)], [0, 1], { ...clamp, easing: ease });
  const revealed = revealP > 0.5;
  const explainP = interpolate(frame, [s(T.explain), s(T.explain + 0.6)], [0, 1], { ...clamp, easing: ease });
  const ctaP = interpolate(frame, [s(T.cta), s(T.cta + 0.6)], [0, 1], { ...clamp, easing: ease });
  const thinkP = interpolate(frame, [s(T.thinkStart), s(T.thinkEnd)], [0, 1], clamp);
  const secondsLeft = Math.max(0, Math.ceil(T.thinkEnd - frame / fps));
  const urgent = secondsLeft <= 2;

  const bodySize = fit(p.body.length, [[90, 54], [150, 48], [220, 42], [300, 38]], 34);
  const longestOption = Math.max(0, ...p.options.map((o) => o.text.length));
  const optionSize = fit(longestOption + p.options.length * 4, [[30, 44], [45, 40], [65, 36]], 32);
  const explainSize = fit(p.explanation.length, [[180, 40], [280, 36], [400, 32], [520, 29]], 26);
  const correct = p.options[p.correctIndex];

  return (
    <AbsoluteFill style={{ backgroundColor: C.canvas, fontFamily: FONT, color: C.ink }}>
      <div
        style={{
          position: "absolute",
          top: 110,
          left: 80,
          right: 80,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          opacity: interpolate(frame, [0, s(0.5)], [0, 1], clamp),
        }}
      >
        <div style={{ backgroundColor: C.accentSoft, color: C.accentInk, fontSize: 32, fontWeight: 600, borderRadius: 999, padding: "10px 28px" }}>
          আজকের MCQ
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <LogoMark size={64} />
          <div style={{ fontSize: 46, fontWeight: 700, color: C.wordmark }}>নির্ণয়</div>
        </div>
      </div>

      <div style={{ position: "absolute", top: 236, left: 80, right: 80, display: "flex", flexDirection: "column", gap: 40 }}>
        <div style={{ fontSize: 32, color: C.ink2, opacity: interpolate(frame, [s(0.2), s(0.8)], [0, 1], clamp) }}>
          {[p.act, p.source].filter(Boolean).join(" · ")}
        </div>

        <div
          style={{
            fontSize: bodySize,
            lineHeight: 1.55,
            fontWeight: 600,
            marginTop: -12,
            opacity: interpolate(frame, [s(0.3), s(1)], [0, 1], { ...clamp, easing: ease }),
            translate: interpolate(frame, [s(0.3), s(1)], ["0px 30px", "0px 0px"], { ...clamp, easing: ease }),
          }}
        >
          {p.body}
        </div>

        <div style={{ position: "relative" }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 22,
              opacity: interpolate(frame, [s(T.explain), s(T.explain + 0.5)], [1, 0], clamp),
            }}
          >
            {p.options.map((o, i) => {
              const isCorrect = i === p.correctIndex;
              const on = isCorrect && revealed;
              const appear = interpolate(frame, [s(0.7 + i * 0.12), s(1.2 + i * 0.12)], [0, 1], { ...clamp, easing: ease });
              return (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 26,
                    padding: "22px 30px",
                    borderRadius: 28,
                    backgroundColor: on ? C.successSoft : C.card,
                    border: `3px solid ${on ? C.success : C.line}`,
                    opacity: appear * (isCorrect ? 1 : interpolate(revealP, [0, 1], [1, 0.4])),
                    translate: interpolate(appear, [0, 1], ["40px 0px", "0px 0px"]),
                    scale: isCorrect ? interpolate(revealP, [0, 0.5, 1], [1, 1.04, 1]) : 1,
                  }}
                >
                  <div
                    style={{
                      width: 68,
                      height: 68,
                      borderRadius: 18,
                      backgroundColor: on ? C.success : C.muted,
                      color: on ? "#FFFFFF" : C.ink2,
                      fontSize: 36,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    {o.label}
                  </div>
                  <div style={{ fontSize: optionSize, lineHeight: 1.4, fontWeight: on ? 700 : 500, color: on ? C.successInk : C.ink }}>{o.text}</div>
                  {on ? (
                    <div style={{ marginLeft: "auto", display: "flex", flexShrink: 0 }}>
                      <Check size={52} color={C.success} />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              opacity: explainP * interpolate(frame, [s(T.cta), s(T.cta + 0.4)], [1, 0], clamp),
              translate: interpolate(explainP, [0, 1], ["0px 40px", "0px 0px"]),
            }}
          >
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 18,
                backgroundColor: C.successSoft,
                border: `3px solid ${C.success}`,
                color: C.successInk,
                borderRadius: 24,
                padding: "16px 30px",
                fontSize: 44,
                fontWeight: 700,
              }}
            >
              <Check size={46} color={C.success} />
              সঠিক উত্তর: {correct ? `${correct.label}) ${correct.text}` : ""}
            </div>
            <div style={{ marginTop: 34, backgroundColor: C.card, border: `3px solid ${C.line}`, borderRadius: 28, padding: "34px 36px" }}>
              <div style={{ fontSize: 32, color: C.primary, fontWeight: 700 }}>ব্যাখ্যা</div>
              <div style={{ marginTop: 14, fontSize: explainSize, lineHeight: 1.65, color: C.ink }}>{p.explanation}</div>
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          top: 1520,
          left: 80,
          right: 80,
          opacity:
            interpolate(frame, [s(T.thinkStart - 0.3), s(T.thinkStart)], [0, 1], clamp) *
            interpolate(frame, [s(T.thinkEnd), s(T.thinkEnd + 0.3)], [1, 0], clamp),
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 40, fontWeight: 600, marginBottom: 18 }}>
          <span>ভাবুন…</span>
          <span style={{ color: urgent ? C.accentInk : C.primary }}>{bn(secondsLeft)} সেকেন্ড</span>
        </div>
        <div style={{ height: 16, borderRadius: 999, backgroundColor: C.muted, overflow: "hidden" }}>
          <div style={{ width: `${(1 - thinkP) * 100}%`, height: "100%", backgroundColor: urgent ? C.accent : C.primary, borderRadius: 999 }} />
        </div>
        <div style={{ marginTop: 26, fontSize: 36, color: C.ink2 }}>আপনার উত্তর কমেন্টে লিখুন</div>
      </div>

      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, ${C.hero1} 0%, ${C.hero2} 100%)`,
          opacity: ctaP,
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
        <div style={{ scale: interpolate(ctaP, [0, 1], [0.85, 1]) }}>
          <LogoMark size={190} reversed />
        </div>
        <div style={{ fontSize: 96, fontWeight: 700 }}>নির্ণয়</div>
        <div style={{ fontSize: 44, lineHeight: 1.6, color: C.onHero2 }}>পেশাদার পরীক্ষার MCQ প্রস্তুতি, ব্যাখ্যাসহ</div>
        <div style={{ marginTop: 40, fontSize: 46, fontWeight: 600, color: "#FFFFFF" }}>{p.ctaLine}</div>
        <div style={{ backgroundColor: C.accent, color: C.hero2, fontSize: 50, fontWeight: 700, borderRadius: 999, padding: "22px 56px" }}>
          {p.ctaUrl}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
