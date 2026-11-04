import React from "react";
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import niruThinking from "./assets/niru-thinking.png";
import { NiruSuccess, NiruThinking, NiruWave } from "./mascots";
import { LogoMark, bn, clamp, ease } from "./shared";
import { type Palette, type ReelProps, type Stops, type StudioStyle, fit, timeline } from "./types";

/*
 * The "studio" layout, ported from the nirnoy.pen reel frames (Daily MCQ · Question / Answer,
 * Dark + Light, and the "Specific Relief" cover). Geometry is 1080x1920 like the pen file.
 */

type StrokeIconProps = React.PropsWithChildren<{ d: string[]; size: number; color: string }>;
const StrokeIcon: React.FC<StrokeIconProps> = ({ d, size, color, children }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    {d.map((path, i) => (
      <path key={i} d={path} />
    ))}
    {children}
  </svg>
);

// lucide paths
const SPARKLES = [
  "M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z",
  "M20 3v4", "M22 5h-4", "M4 17v2", "M5 18H3",
];
const BOOK_OPEN = ["M12 7v14", "M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"];
const LANDMARK = [
  "M10 18v-7", "M11.12 2.198a2 2 0 0 1 1.76.006l7.866 3.847c.476.233.31.949-.22.949H3.474c-.53 0-.695-.716-.22-.949z",
  "M14 18v-7", "M18 18v-7", "M3 22h18", "M6 18v-7",
];
const LIGHTBULB = ["M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5", "M9 18h6", "M10 22h4"];

const CircleCheck: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <StrokeIcon d={["m9 12 2 2 4-4"]} size={size} color={color}>
    <circle cx="12" cy="12" r="10" />
  </StrokeIcon>
);
const CirclePlay: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <StrokeIcon d={[]} size={size} color={color}>
    <circle cx="12" cy="12" r="10" />
    <path d="M10 8l6 4-6 4z" />
  </StrokeIcon>
);

// ---- Backdrop: gradient, OMR bubbles, corner bars, spotlight ----

/** Elliptical radial glow filling its box. */
const Glow: React.FC<{ id: string; stops: Stops; left: number; top: number; width: number; height: number; opacity?: number }> = ({
  id, stops, left, top, width, height, opacity,
}) => (
  <svg width={width} height={height} style={{ position: "absolute", left, top, opacity }}>
    <defs>
      <radialGradient id={id}>
        {stops.map(([c, o], i) => (
          <stop key={i} offset={o} stopColor={c.slice(0, 7)} stopOpacity={parseInt(c.slice(7, 9) || "ff", 16) / 255} />
        ))}
      </radialGradient>
    </defs>
    <ellipse cx={width / 2} cy={height / 2} rx={width / 2} ry={height / 2} fill={`url(#${id})`} />
  </svg>
);

/** [x of the first column, full rows, columns dropped on each trailing row] — the three bubble sheets in the pen file. */
const SHEETS: [number, number, number[]][] = [
  [564, 17, [1, 2, 3]],
  [728, 21, [3]],
  [892, 22, [2]],
];
const FADE_FROM = [0x10, 0x17, 0x1e];
const hash = (a: number, b: number) => {
  const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return x - Math.floor(x);
};
const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, "0");

const Bubbles: React.FC<{ st: StudioStyle }> = ({ st }) => {
  const rgb = (c: string) => `rgb(${c})`;
  const cells: React.ReactNode[] = [];
  SHEETS.forEach(([x0, fullRows, drops], sheet) => {
    const rows = fullRows + drops.length;
    for (let r = 0; r < rows; r++) {
      const dropped = r >= fullRows ? drops[r - fullRows] : 0;
      const alpha = FADE_FROM[sheet] - (FADE_FROM[sheet] - 4) * (r / rows);
      for (let c = dropped; c < 4; c++) {
        const cx = x0 + c * 34 + 10;
        const cy = 22 + r * 34 + 10;
        const on = hash(sheet * 100 + r, c) > 0.74;
        cells.push(
          on ? (
            <circle key={`${sheet}-${r}-${c}`} cx={cx} cy={cy} r={10} fill={rgb(st.bubbleOn)} fillOpacity={(alpha * 1.6) / 255} />
          ) : (
            <circle key={`${sheet}-${r}-${c}`} cx={cx} cy={cy} r={9} fill="none" stroke={rgb(st.bubble)} strokeOpacity={alpha / 255} strokeWidth={2} />
          ),
        );
      }
    }
  });
  return (
    <svg width={1080} height={1920} style={{ position: "absolute", inset: 0 }}>
      {cells}
    </svg>
  );
};

const CornerBars: React.FC = () => (
  <svg width={540} height={540} viewBox="0 0 200 200" style={{ display: "block" }}>
    <defs>
      <linearGradient id="bars-w" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0.35" stopColor="#FFFFFF" stopOpacity={0.11} />
        <stop offset="0.92" stopColor="#FFFFFF" stopOpacity={0} />
      </linearGradient>
      <linearGradient id="bars-a" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0.35" stopColor="#FBBF24" stopOpacity={0.18} />
        <stop offset="0.92" stopColor="#FBBF24" stopOpacity={0} />
      </linearGradient>
    </defs>
    <path
      fill="url(#bars-w)"
      d="M32.198 110.005l-7.988 45.301a17 17 0 0 0 33.484 5.904l7.988-45.301a17 17 0 0 0-33.484-5.904z m54.946-39.392l-14.934 84.693a17 17 0 0 0 33.484 5.904l14.933-84.693a17 17 0 0 0-33.483-5.904z"
    />
    <path fill="url(#bars-a)" d="M142.09 31.22l-21.88 124.086a17 17 0 0 0 33.484 5.904l21.879-124.085a17 17 0 0 0-33.483-5.905z" />
  </svg>
);

const Backdrop: React.FC<{ st: StudioStyle }> = ({ st }) => (
  <AbsoluteFill style={{ background: st.bg }}>
    <Bubbles st={st} />
    <div style={{ position: "absolute", left: -130, top: -200 }}>
      <CornerBars />
    </div>
  </AbsoluteFill>
);

/** Spotlight + rigged mascot. `size` is the pen frame size (420 for the reel mascots). */
const Niru: React.FC<React.PropsWithChildren<{ st: StudioStyle; top: number; left: number; opacity: number }>> = ({ st, top, left, opacity, children }) => (
  <>
    <Glow id="spot-reel" stops={st.spotlight} left={190} top={1270} width={640} height={600} opacity={opacity} />
    <div style={{ position: "absolute", left, top, width: 420, height: 420, opacity }}>{children}</div>
  </>
);

// ---- Building blocks ----

const Header: React.FC<{ C: Palette; st: StudioStyle }> = ({ C, st }) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", height: 95 }}>
    <div
      style={{
        display: "flex", alignItems: "center", gap: 12, height: 61, padding: "0 28px 0 22px", borderRadius: 999,
        backgroundColor: st.chipBg, border: `2px solid ${st.chipStroke}`,
      }}
    >
      <StrokeIcon d={SPARKLES} size={22} color={st.chipIcon} />
      <span style={{ fontSize: 26, fontWeight: 700, color: st.chipInk }}>আজকের MCQ</span>
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 18, height: 95 }}>
      <LogoMark size={76} C={C} reversed={st.reversedLogo} />
      <div style={{ fontSize: 52, lineHeight: 1, fontWeight: 700, color: C.wordmark, translate: "0px 5px" }}>নির্ণয়</div>
    </div>
  </div>
);

const Source: React.FC<{ C: Palette; st: StudioStyle; act: string; source: string }> = ({ C, st, act, source }) => {
  const item = (icon: string[], text: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
      <StrokeIcon d={icon} size={26} color={C.ink2} />
      <span style={{ fontSize: 27, fontWeight: 600, color: C.ink2, lineHeight: 1.3 }}>{text}</span>
    </div>
  );
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
      {act ? item(BOOK_OPEN, act) : null}
      {act && source ? <div style={{ width: 2, height: 26, backgroundColor: st.divider }} /> : null}
      {source ? item(LANDMARK, source) : null}
    </div>
  );
};

const OptionRow: React.FC<{
  C: Palette; st: StudioStyle; label: string; text: string; size: number; on?: boolean; opacity?: number; translate?: string; scale?: number;
}> = ({ C, st, label, text, size, on, opacity = 1, translate, scale }) => (
  <div
    style={{
      display: "flex", alignItems: "center", gap: 24, padding: "20px 26px", borderRadius: 24,
      backgroundColor: on ? st.correctBg : C.card, border: `2px solid ${on ? st.correctStroke : C.line}`,
      opacity, translate, scale,
    }}
  >
    <div
      style={{
        width: 60, height: 60, borderRadius: 999, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 28, fontWeight: 700, backgroundColor: on ? st.correctLetterBg : C.muted, color: on ? st.correctLetterInk : C.ink,
      }}
    >
      {label}
    </div>
    <div style={{ fontSize: size, lineHeight: 1.35, fontWeight: 600, color: C.ink, minWidth: 0 }}>{text}</div>
    {on ? (
      <div style={{ marginLeft: "auto", display: "flex" }}>
        <CircleCheck size={40} color={st.correctStroke} />
      </div>
    ) : null}
  </div>
);

const sizes = (p: ReelProps) => {
  const longest = Math.max(0, ...p.options.map((o) => o.text.length));
  return {
    body: fit(p.body.length, [[90, 54], [150, 48], [220, 42], [300, 38]], 34),
    option: fit(longest + p.options.length * 4, [[34, 40], [50, 38], [70, 34]], 30),
    explain: fit(p.explanation.length, [[180, 34], [280, 31], [400, 28], [520, 26]], 24),
    /** The mascot sits under the content; a tall question or option list would run into it. */
    roomForMascot: p.body.length <= 150 && longest <= 45,
  };
};

const Explanation: React.FC<{ st: StudioStyle; text: string; size: number }> = ({ st, text, size }) => (
  <div
    style={{
      position: "relative", overflow: "hidden", borderRadius: 28, background: st.explainBg, border: st.explainBorder, boxShadow: st.explainShadow,
    }}
  >
    {st.explainAccent ? (
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 8, background: "linear-gradient(180deg, #FBBF24, #F59E0B)" }} />
    ) : null}
    <div style={{ padding: st.explainBadge ? "26px 30px 28px 36px" : "28px 32px 30px 36px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: st.explainBadge ? 14 : 12 }}>
        {st.explainBadge ? (
          <div style={{ width: 48, height: 48, borderRadius: 999, backgroundColor: "#FBBF2429", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <StrokeIcon d={LIGHTBULB} size={26} color={st.explainLabel} />
          </div>
        ) : (
          <StrokeIcon d={LIGHTBULB} size={32} color={st.explainLabel} />
        )}
        <span style={{ fontSize: 32, fontWeight: 700, color: st.explainLabel }}>ব্যাখ্যা</span>
      </div>
      <div style={{ fontSize: size, lineHeight: 1.5, fontWeight: st.explainBadge ? 500 : 400, color: st.explainInk }}>{text}</div>
    </div>
  </div>
);

/** "সঠিক উত্তর: গ) ১০৪ ধারায়" pill that opens the explanation page. */
const AnswerPill: React.FC<{ st: StudioStyle; text: string }> = ({ st, text }) => (
  <div
    style={{
      alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 16, padding: "20px 32px 20px 24px", borderRadius: 24,
      backgroundColor: st.answerBg, border: `2px solid ${st.answerStroke}`,
    }}
  >
    <CircleCheck size={42} color={st.answerIcon} />
    <span style={{ fontSize: 40, lineHeight: 1.4, fontWeight: 700, color: st.answerInk }}>{text}</span>
  </div>
);

// ---- End screen ("FB Reel cover" frames) ----

/** "Early access পেতে এখনই ভিজিট করুন": a leading Latin phrase becomes a sparkle badge, the rest stays as text. */
const CtaLine: React.FC<{ st: StudioStyle; text: string; t: number }> = ({ st, text, t }) => {
  const e = st.end;
  const m = text.match(/^([A-Za-z][A-Za-z .'-]*[A-Za-z])\s+(.+)$/);
  if (!m) return <div style={{ fontSize: 31, fontWeight: 600, color: e.ctaRest }}>{text}</div>;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <div
        style={{
          display: "flex", alignItems: "center", gap: 8, height: 57, padding: "0 18px", borderRadius: 999,
          backgroundColor: e.badgeBg, border: `1.5px solid ${e.badgeStroke}`,
        }}
      >
        <div style={{ display: "flex", transform: `rotate(${Math.sin(t * 2.6) * 12}deg) scale(${1 + 0.12 * Math.max(0, Math.sin(t * 2.6))})` }}>
          <StrokeIcon d={SPARKLES} size={24} color={e.badgeIcon} />
        </div>
        <span style={{ fontSize: 28, fontWeight: 700, color: e.badgeInk }}>{m[1]}</span>
      </div>
      <span style={{ fontSize: 31, fontWeight: 600, color: e.ctaRest }}>{m[2]}</span>
    </div>
  );
};

/**
 * The nirnoy.app button. Pops in, types the URL, then loops: a halo ripple, a gentle breath,
 * a light sweep across the pill and an up-right nudge of the arrow.
 */
const UrlPill: React.FC<{ st: StudioStyle; url: string; t: number; fps: number }> = ({ st, url, t, fps }) => {
  const e = st.end;
  const enter = spring({ frame: Math.max(0, (t - 0.45) * fps), fps, config: { damping: 11, stiffness: 150, mass: 0.7 } });
  const typed = Math.max(0, Math.min(url.length, Math.floor((t - 0.75) * 20)));
  const done = 0.75 + url.length / 20;
  const arrowIn = spring({ frame: Math.max(0, (t - done) * fps), fps, config: { damping: 9, stiffness: 170, mass: 0.5 } });
  const loop = Math.max(0, t - done - 0.3);
  const ripple = (loop % 1.8) / 1.8; // 0..1
  const breathe = 1 + 0.025 * Math.sin(loop * 3.4);
  const sweep = (loop % 2.6) / 2.6; // light band position
  const nudge = loop > 0 ? Math.max(0, Math.sin((loop % 1.8) / 1.8 * Math.PI * 2)) * 4 : 0;

  return (
    <div style={{ position: "relative", transform: `scale(${(0.6 + 0.4 * enter) * breathe})`, opacity: Math.min(1, enter * 1.5) }}>
      {loop > 0 ? (
        <div
          style={{
            position: "absolute", inset: 0, borderRadius: 999, border: `3px solid ${e.ringStroke}`,
            transform: `scale(${1 + ripple * 0.22})`, opacity: (1 - ripple) * 0.9,
          }}
        />
      ) : null}
      <div style={{ padding: 10, borderRadius: 999, backgroundColor: e.ringBg, border: `1.5px solid ${e.ringStroke}` }}>
        <div
          style={{
            position: "relative", overflow: "hidden", display: "flex", alignItems: "center", gap: 24, height: 94, padding: "0 14px 0 44px",
            borderRadius: 999, backgroundColor: st.ctaBg, boxShadow: e.pillShadow,
          }}
        >
          {loop > 0 ? (
            <div
              style={{
                position: "absolute", top: 0, bottom: 0, width: 120, left: `${-30 + sweep * 160}%`,
                background: "linear-gradient(90deg, #FFFFFF00 0%, #FFFFFF73 50%, #FFFFFF00 100%)", transform: "skewX(-20deg)",
              }}
            />
          ) : null}
          <span style={{ position: "relative", fontFamily: "Inter, system-ui, sans-serif", fontSize: 46, fontWeight: 700, letterSpacing: 0.2, color: st.ctaInk }}>
            {url.slice(0, typed)}
            <span style={{ opacity: 0 }}>{url.slice(typed)}</span>
          </span>
          <div
            style={{
              position: "relative", width: 66, height: 66, borderRadius: 999, backgroundColor: e.arrowBg, display: "flex", alignItems: "center", justifyContent: "center",
              transform: `scale(${arrowIn}) rotate(${(1 - arrowIn) * -90}deg)`,
            }}
          >
            <div style={{ display: "flex", transform: `translate(${nudge}px, ${-nudge}px)` }}>
              <StrokeIcon d={ARROW_UP_RIGHT} size={34} color={e.arrowInk} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const ARROW_UP_RIGHT = ["M7 7h10v10", "M7 17 17 7"];

/** Last page: logo + slogan, big copy with a highlighted word, sub copy, URL pill and the waving mascot. */
export const StudioEnd: React.FC<{ p: ReelProps; C: Palette; progress: number; t: number; fps: number }> = ({ p, C, progress, t, fps }) => {
  const st = C.studio as StudioStyle;
  const e = st.end;
  const words = p.tagline.trim().split(/\s+/).filter(Boolean);
  const highlight = words.length > 1 ? words[words.length - 1] : "";
  const lead = highlight ? words.slice(0, -1).join(" ") : p.tagline;

  const comma = p.subline.indexOf(",");
  const muted = comma >= 0 ? p.subline.slice(0, comma + 1) : "";
  const accent = comma >= 0 ? p.subline.slice(comma + 1).trim() : p.subline;
  const [struck, ...restMuted] = muted.split(" ");

  return (
    <AbsoluteFill style={{ background: e.bg, opacity: progress }}>
      <Bubbles st={st} />
      <div style={{ position: "absolute", left: -130, top: -160 }}>
        <CornerBars />
      </div>

      <div style={{ position: "absolute", left: 193, top: 1186, width: 694, height: 694 }}>
        <Glow id="spot-end" stops={e.spotlight} left={-59} top={-45} width={803} height={774} />
        <div style={{ position: "absolute", left: 30, top: 30, width: 625, height: 625 }}>{t >= 0 ? <NiruWave t={t} fps={fps} /> : null}</div>
      </div>

      <div style={{ position: "absolute", top: 270, left: 80, right: 80, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 15 }}>
          <LogoMark size={64} C={C} reversed={st.reversedLogo} />
          <div style={{ fontSize: 44, lineHeight: 1, fontWeight: 700, color: C.wordmark, translate: "0px 4px" }}>নির্ণয়</div>
          {p.slogan ? (
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginLeft: 6 }}>
              <div style={{ width: 2, height: 40, backgroundColor: e.divider }} />
              <div style={{ fontSize: 26, fontWeight: 500, color: e.slogan }}>{p.slogan}</div>
            </div>
          ) : null}
        </div>

        <div style={{ marginTop: 64, width: 800, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
          <div style={{ fontSize: 88, lineHeight: 1.3, fontWeight: 700, color: e.copy }}>{lead}</div>
          {highlight ? (
            <div style={{ position: "relative", marginTop: -2 }}>
              <div style={{ position: "absolute", left: -4, right: -4, bottom: 15, height: 20, borderRadius: 7, backgroundColor: "#FBBF24", transform: "rotate(-0.8deg)" }} />
              <div style={{ position: "relative", fontSize: 112, lineHeight: 1.3, fontWeight: 700, color: e.highlight }}>{highlight}</div>
            </div>
          ) : null}
        </div>

        <div style={{ marginTop: 36, display: "flex", alignItems: "center", gap: 18, fontSize: 42, lineHeight: 1.3, fontWeight: 600 }}>
          {muted ? (
            <div style={{ color: e.muted, display: "flex", gap: 14 }}>
              <span style={{ position: "relative" }}>
                {struck}
                <span style={{ position: "absolute", left: -4, right: -3, top: 24, height: 12, borderRadius: 3, backgroundColor: "#F59E0B", transform: "rotate(-3deg)" }} />
              </span>
              {restMuted.length ? <span>{restMuted.join(" ")}</span> : null}
            </div>
          ) : null}
          <span style={{ color: e.accent }}>{accent}</span>
        </div>

        <div style={{ marginTop: 56, display: "flex", flexDirection: "column", alignItems: "center", gap: 24 }}>
          <CtaLine st={st} text={p.ctaLine} t={t} />
          <UrlPill st={st} url={p.ctaUrl} t={t} fps={fps} />
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---- Scenes ----

/** The animated reel (question → options → think → answer → explanation). Audio is passed in by MCQReel. */
export const StudioScene: React.FC<{ p: ReelProps; C: Palette; T: ReturnType<typeof timeline>; audio: React.ReactNode }> = ({ p, C, T, audio }) => {
  const st = C.studio as StudioStyle;
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = (sec: number) => sec * fps;
  const sz = sizes(p);

  const revealP = interpolate(frame, [s(T.reveal), s(T.reveal + 0.5)], [0, 1], { ...clamp, easing: ease });
  const revealed = revealP > 0.5;
  const explainP = T.explain === null ? 0 : interpolate(frame, [s(T.explain), s(T.explain + 0.6)], [0, 1], { ...clamp, easing: ease });
  const ctaP = interpolate(frame, [s(T.cta), s(T.cta + 0.6)], [0, 1], { ...clamp, easing: ease });
  const thinkIn = interpolate(frame, [s(T.thinkStart - 0.3), s(T.thinkStart)], [0, 1], clamp);
  const thinkOut = interpolate(frame, [s(T.thinkEnd), s(T.thinkEnd + 0.3)], [1, 0], clamp);
  const thinkP = interpolate(frame, [s(T.thinkStart), s(T.thinkEnd)], [0, 1], clamp);
  const secondsLeft = Math.max(0, Math.ceil(T.thinkEnd - frame / fps));
  const remaining = (1 - thinkP) * 6;

  const mascotOk = sz.roomForMascot;
  /** On the explanation page the mascot sits under the card; a long explanation would push it off screen. */
  const explainMascot = p.body.length <= 150 && p.explanation.length <= 330;
  const answerP = T.explain === null ? 0 : interpolate(frame, [s(T.explain), s(T.explain + 0.5)], [0, 1], { ...clamp, easing: ease });
  const cardP = T.explain === null ? 0 : interpolate(frame, [s(T.explain + 0.2), s(T.explain + 0.8)], [0, 1], { ...clamp, easing: ease });
  const correct = p.options[p.correctIndex];
  const mascotIn = interpolate(frame, [s(T.optionsIn), s(T.optionsIn + 0.6)], [0, 1], clamp);
  const now = frame / fps;
  const fade = interpolate(frame, [s(T.cta - 0.2), s(T.cta + 0.2)], [1, 0], clamp);

  return (
    <AbsoluteFill style={{ backgroundColor: C.canvas, color: C.ink }}>
      {audio}
      <Backdrop st={st} />
      {mascotOk ? (
        <>
          <Niru st={st} top={1330} left={300} opacity={mascotIn * (1 - revealP) * fade}>
            {revealP < 1 ? <NiruThinking t={now - T.optionsIn} fps={fps} /> : null}
          </Niru>
          <Niru st={st} top={1400} left={310} opacity={revealP * (1 - explainP) * fade}>
            {revealP > 0 && explainP < 1 ? <NiruSuccess t={now - T.reveal} fps={fps} /> : null}
          </Niru>
        </>
      ) : null}

      <div style={{ position: "absolute", top: 270, left: 72, right: 72, display: "flex", flexDirection: "column" }}>
        <div style={{ opacity: interpolate(frame, [0, s(0.5)], [0, 1], clamp) }}>
          <Header C={C} st={st} />
        </div>
        <div style={{ marginTop: 30, opacity: interpolate(frame, [s(0.2), s(0.8)], [0, 1], clamp) }}>
          <Source C={C} st={st} act={p.act} source={p.source} />
        </div>
        <div
          style={{
            marginTop: 24, fontSize: sz.body, lineHeight: 1.42, fontWeight: 700,
            opacity: interpolate(frame, [s(0.3), s(1)], [0, 1], { ...clamp, easing: ease }),
            translate: interpolate(frame, [s(0.3), s(1)], ["0px 30px", "0px 0px"], { ...clamp, easing: ease }),
          }}
        >
          {p.body}
        </div>

        {/* Question/answer page and explanation page share this slot and cross-fade. */}
        <div style={{ display: "grid" }}>
          <div style={{ gridArea: "1 / 1", alignSelf: "start", opacity: 1 - explainP, translate: interpolate(explainP, [0, 1], ["0px 0px", "0px -30px"]) }}>
            <div style={{ marginTop: 40, display: "flex", flexDirection: "column", gap: 18 }}>
              {p.options.map((o, i) => {
                const appear = interpolate(frame, [s(T.optionsIn + i * 0.12), s(T.optionsIn + 0.5 + i * 0.12)], [0, 1], { ...clamp, easing: ease });
                const isCorrect = i === p.correctIndex;
                return (
                  <OptionRow
                    key={i}
                    C={C}
                    st={st}
                    label={o.label}
                    text={o.text}
                    size={sz.option}
                    on={isCorrect && revealed}
                    opacity={appear * (isCorrect ? 1 : interpolate(revealP, [0, 1], [1, 0.45]))}
                    translate={interpolate(appear, [0, 1], ["40px 0px", "0px 0px"])}
                    scale={isCorrect ? interpolate(revealP, [0, 0.5, 1], [1, 1.03, 1]) : 1}
                  />
                );
              })}
            </div>

            <div style={{ marginTop: 36, display: "flex", alignItems: "center", gap: 28, height: 104, opacity: thinkIn * thinkOut }}>
              <div
                style={{
                  width: 104, height: 104, borderRadius: 28, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 54, fontWeight: 700, backgroundColor: st.timerBoxBg, color: st.timerBoxInk,
                }}
              >
                {bn(secondsLeft)}
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ fontSize: 40, fontWeight: 700 }}>ভাবুন…</div>
                <div style={{ display: "flex", gap: 10 }}>
                  {Array.from({ length: 6 }, (_, i) => (
                    <div key={i} style={{ flex: 1, height: 16, borderRadius: 8, backgroundColor: st.timerTrack, overflow: "hidden" }}>
                      <div style={{ width: `${Math.min(1, Math.max(0, remaining - i)) * 100}%`, height: "100%", backgroundColor: st.timerBoxBg, borderRadius: 8 }} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {T.explain !== null ? (
            <div style={{ gridArea: "1 / 1", alignSelf: "start", display: "flex", flexDirection: "column", opacity: explainP }}>
              <div style={{ marginTop: 52, display: "flex", translate: interpolate(answerP, [0, 1], ["0px 30px", "0px 0px"]), scale: interpolate(answerP, [0, 1], [0.94, 1]) }}>
                <AnswerPill st={st} text={correct ? `সঠিক উত্তর: ${correct.label}) ${correct.text}` : ""} />
              </div>
              <div style={{ marginTop: 32, opacity: cardP, translate: interpolate(cardP, [0, 1], ["0px 40px", "0px 0px"]) }}>
                <Explanation st={st} text={p.explanation} size={sz.explain} />
              </div>
              {explainMascot ? (
                <div style={{ position: "relative", marginTop: 8, height: 520, opacity: fade }}>
                  <Glow id="spot-explain" stops={st.spotlight} left={148} top={-20} width={640} height={600} />
                  <div style={{ position: "absolute", left: 278, top: 60, width: 420, height: 420 }}>
                    {explainP > 0 && now < T.cta + 0.3 ? <NiruSuccess t={now - T.reveal} fps={fps} /> : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <StudioEnd p={p} C={C} progress={ctaP} t={now - T.cta} fps={fps} />
    </AbsoluteFill>
  );
};

/** Still cover for Facebook: question + options, answer hidden, CTA pill, thinking mascot. */
export const StudioThumbnail: React.FC<{ p: ReelProps; C: Palette }> = ({ p, C }) => {
  const st = C.studio as StudioStyle;
  const sz = sizes(p);
  return (
    <AbsoluteFill style={{ backgroundColor: C.canvas, color: C.ink }}>
      <Backdrop st={st} />
      {sz.roomForMascot ? (
        <Niru st={st} top={1330} left={300} opacity={1}>
          <Img src={niruThinking} style={{ width: 420, height: 420 }} />
        </Niru>
      ) : null}
      <div style={{ position: "absolute", top: 290, left: 72, right: 72, display: "flex", flexDirection: "column" }}>
        <Header C={C} st={st} />
        <div style={{ marginTop: 30 }}>
          <Source C={C} st={st} act={p.act} source={p.source} />
        </div>
        <div style={{ marginTop: 24, fontSize: sz.body, lineHeight: 1.42, fontWeight: 700 }}>{p.body}</div>
        <div style={{ marginTop: 40, display: "flex", flexDirection: "column", gap: 18 }}>
          {p.options.map((o, i) => (
            <OptionRow key={i} C={C} st={st} label={o.label} text={o.text} size={sz.option} />
          ))}
        </div>
        <div
          style={{
            marginTop: 36, display: "flex", alignItems: "center", justifyContent: "center", gap: 16, padding: "28px 40px", borderRadius: 999,
            backgroundColor: st.ctaBg, color: st.ctaInk, boxShadow: st.ctaShadow, fontSize: 36, fontWeight: 700,
          }}
        >
          সঠিক উত্তর ভিডিওতে দেখুন
          <CirclePlay size={40} color={st.ctaInk} />
        </div>
      </div>
    </AbsoluteFill>
  );
};
