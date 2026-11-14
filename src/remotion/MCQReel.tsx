import React from "react";
import { Audio } from "@remotion/media";
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import chimeUrl from "./sfx/chime.wav?url";
import countdownUrl from "./sfx/countdown.wav?url";
import whooshUrl from "./sfx/whoosh.wav?url";
import { MUSIC } from "./music";
import { MCQThumbnail } from "./MCQThumbnail";
import { StudioScene } from "./studio";
import { EndScreen, FONT, LogoMark, bn, clamp, ease, useFontsReady } from "./shared";
import { COVER_SECONDS, type ReelProps, SEGMENTS, THINK_SECONDS, fit, themeOf, timeline } from "./types";

const Check: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M7.5 12.5l3 3 6-6.5" />
  </svg>
);

/** The video: the thumbnail as a still for COVER_SECONDS, then the animated reel (its own timeline starts there). */
export const MCQReel: React.FC<ReelProps> = (p) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const hold = Math.round(COVER_SECONDS * fps);
  return (
    <AbsoluteFill>
      <Sequence from={hold} premountFor={fps}>
        <ReelBody {...p} />
      </Sequence>
      {frame < hold ? <MCQThumbnail {...p} /> : null}
    </AbsoluteFill>
  );
};

const ReelBody: React.FC<ReelProps> = (p) => {
  const C = themeOf(p.theme);
  useFontsReady();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = (sec: number) => sec * fps;
  const T = timeline(p);
  // Options leave when the explanation arrives; with no explanation they stay until the CTA covers them.
  const optionsOut = T.explain ?? T.cta;
  const clips = SEGMENTS.flatMap((key) => {
    const clip = p.voice[key];
    const at = T.voiceAt[key];
    return clip && clip.sec > 0 && at !== null ? [{ key, url: clip.url, from: at, to: at + clip.sec }] : [];
  });
  const underVoice = (f: number) => clips.some((c) => f >= s(c.from - 0.15) && f < s(c.to + 0.15));

  const revealP = interpolate(frame, [s(T.reveal), s(T.reveal + 0.5)], [0, 1], { ...clamp, easing: ease });
  const revealed = revealP > 0.5;
  const explainP = T.explain === null ? 0 : interpolate(frame, [s(T.explain), s(T.explain + 0.6)], [0, 1], { ...clamp, easing: ease });
  const ctaP = interpolate(frame, [s(T.cta), s(T.cta + 0.6)], [0, 1], { ...clamp, easing: ease });
  const thinkP = interpolate(frame, [s(T.thinkStart), s(T.thinkEnd)], [0, 1], clamp);
  const secondsLeft = Math.max(0, Math.ceil(T.thinkEnd - frame / fps));
  const urgent = secondsLeft <= 2;

  const bodySize = fit(p.body.length, [[90, 54], [150, 48], [220, 42], [300, 38]], 34);
  const longestOption = Math.max(0, ...p.options.map((o) => o.text.length));
  const optionSize = fit(longestOption + p.options.length * 4, [[30, 44], [45, 40], [65, 36]], 32);
  const explainSize = fit(p.explanation.length, [[180, 40], [280, 36], [400, 32], [520, 29]], 26);
  const correct = p.options[p.correctIndex];

  const audio = (
    <>
      {p.music !== "none" ? (
        <Audio
          src={MUSIC[p.music].url}
          loop
          volume={(f) =>
            // Mild bed: quiet overall, dipped further under narration and the reveal chime.
            0.3 *
            interpolate(f, [0, s(0.8)], [0, 1], clamp) *
            interpolate(f, [s(T.end - 1.2), s(T.end)], [1, 0], clamp) *
            (underVoice(f) ? 0.3 : 1) *
            (f >= s(T.reveal) && f < s(T.reveal + 1.2) ? 0.6 : 1)
          }
        />
      ) : null}
      {/* premountFor loads each clip a second early so the player starts it on time (first word not swallowed). */}
      {clips.map((c) => (
        <Sequence key={c.key} from={Math.round(s(c.from))} durationInFrames={Math.ceil(s(c.to - c.from + 0.2))} premountFor={fps}>
          <Audio src={c.url} volume={1} />
        </Sequence>
      ))}
      {p.sfx ? (
        <>
          {/* One pre-mixed track with a tick on every second (last two louder): six 0.12s clips in
              their own short Sequences were too short for the player to start reliably, so ticks got skipped. */}
          <Sequence from={Math.round(s(T.thinkStart))} durationInFrames={Math.round(s(THINK_SECONDS + 0.2))} premountFor={fps}>
            <Audio src={countdownUrl} volume={1} />
          </Sequence>
          <Sequence from={Math.round(s(T.reveal))} durationInFrames={Math.round(s(1.6))} premountFor={fps}>
            <Audio src={chimeUrl} volume={0.55} />
          </Sequence>
          {T.explain !== null ? (
            <Sequence from={Math.round(s(T.explain - 0.45))} durationInFrames={Math.round(s(0.7))} premountFor={fps}>
              <Audio src={whooshUrl} volume={0.6} />
            </Sequence>
          ) : null}
          <Sequence from={Math.round(s(T.cta - 0.5))} durationInFrames={Math.round(s(0.7))} premountFor={fps}>
            <Audio src={whooshUrl} volume={0.6} />
          </Sequence>
        </>
      ) : null}
    </>
  );

  if (C.studio) return <StudioScene p={p} C={C} T={T} audio={audio} />;

  return (
    <AbsoluteFill style={{ backgroundColor: C.canvas, fontFamily: FONT, color: C.ink }}>
      {audio}
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
        <div style={{ display: "flex", alignItems: "center", gap: 12, height: 64 }}>
          <LogoMark size={58} C={C} />
          {/* Noto Serif Bengali sits high in its line box; lineHeight 1 + a small nudge centres the matra-to-baseline body on the mark. */}
          <div style={{ fontSize: 46, lineHeight: 1, fontWeight: 700, color: C.wordmark, translate: "0px 5px" }}>নির্ণয়</div>
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
              opacity: interpolate(frame, [s(optionsOut), s(optionsOut + 0.5)], [1, 0], clamp),
            }}
          >
            {p.options.map((o, i) => {
              const isCorrect = i === p.correctIndex;
              const on = isCorrect && revealed;
              const appear = interpolate(frame, [s(T.optionsIn + i * 0.12), s(T.optionsIn + 0.5 + i * 0.12)], [0, 1], { ...clamp, easing: ease });
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

      <EndScreen p={p} C={C} progress={ctaP} />
    </AbsoluteFill>
  );
};
