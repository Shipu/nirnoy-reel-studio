import React from "react";
import { AbsoluteFill } from "remotion";
import { FONT, LogoMark, useFontsReady } from "./shared";
import { StudioThumbnail } from "./studio";
import { type ReelProps, fit, themeOf } from "./types";

/**
 * Still cover image for Facebook uploads: the question and its options, with
 * the answer left out so people have a reason to watch.
 */
export const MCQThumbnail: React.FC<ReelProps> = (p) => {
  useFontsReady();
  const C = themeOf(p.theme);
  if (C.studio) return <StudioThumbnail p={p} C={C} />;

  const longestOption = Math.max(0, ...p.options.map((o) => o.text.length));
  const bodySize = fit(p.body.length, [[90, 66], [150, 58], [220, 50], [300, 44]], 38);
  const optionSize = fit(longestOption + p.options.length * 4, [[30, 50], [45, 44], [65, 40]], 35);

  return (
    <AbsoluteFill style={{ backgroundColor: C.canvas, fontFamily: FONT, color: C.ink }}>
      <div style={{ position: "absolute", top: 110, left: 80, right: 80, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ backgroundColor: C.accentSoft, color: C.accentInk, fontSize: 32, fontWeight: 600, borderRadius: 999, padding: "10px 28px" }}>
          আজকের MCQ
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, height: 64 }}>
          <LogoMark size={58} C={C} />
          <div style={{ fontSize: 46, lineHeight: 1, fontWeight: 700, color: C.wordmark, translate: "0px 5px" }}>নির্ণয়</div>
        </div>
      </div>

      <div style={{ position: "absolute", top: 236, bottom: 280, left: 80, right: 80, display: "flex", flexDirection: "column", justifyContent: "center", gap: 40 }}>
        <div style={{ fontSize: 32, color: C.ink2 }}>{[p.act, p.source].filter(Boolean).join(" · ")}</div>
        <div style={{ fontSize: bodySize, lineHeight: 1.55, fontWeight: 600, marginTop: -12 }}>{p.body}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          {p.options.map((o, i) => (
            <div
              key={i}
              style={{ display: "flex", alignItems: "center", gap: 26, padding: "22px 30px", borderRadius: 28, backgroundColor: C.card, border: `3px solid ${C.line}` }}
            >
              <div
                style={{
                  width: 68, height: 68, borderRadius: 18, backgroundColor: C.muted, color: C.ink2, fontSize: 36, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}
              >
                {o.label}
              </div>
              <div style={{ fontSize: optionSize, lineHeight: 1.4, fontWeight: 500 }}>{o.text}</div>
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          position: "absolute", left: 80, right: 80, bottom: 120, textAlign: "center", backgroundColor: C.primary, color: C.canvas,
          fontSize: 40, fontWeight: 700, borderRadius: 999, padding: "26px 40px",
        }}
      >
        সঠিক উত্তর ভিডিওতে দেখুন ▶
      </div>
    </AbsoluteFill>
  );
};
