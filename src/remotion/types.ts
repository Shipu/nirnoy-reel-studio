import type { MusicKey } from "./music";

export type Stops = [string, number][];

/** Extra styling for the nirnoy.pen "studio" layout (OMR-bubble backdrop, mascot, glass cards). */
export type StudioStyle = {
  bg: string;
  /** "r,g,b" for the OMR-bubble outlines and the filled ("marked") bubbles. */
  bubble: string;
  bubbleOn: string;
  /** Radial glow behind the mascot: [colour, offset 0..1] stops. Drawn as SVG — the web renderer has no CSS radial-gradient. */
  spotlight: Stops;
  chipBg: string;
  chipStroke: string;
  chipInk: string;
  chipIcon: string;
  divider: string;
  correctBg: string;
  correctStroke: string;
  correctLetterBg: string;
  correctLetterInk: string;
  timerBoxBg: string;
  timerBoxInk: string;
  timerTrack: string;
  ctaBg: string;
  ctaInk: string;
  ctaShadow: string;
  explainBg: string;
  explainBorder: string;
  explainAccent: boolean;
  /** Round tinted badge behind the lightbulb (dark) vs. a bare icon (light). */
  explainBadge: boolean;
  explainShadow: string;
  /** "সঠিক উত্তর: …" pill on the explanation page. */
  answerBg: string; answerStroke: string; answerInk: string; answerIcon: string;
  explainLabel: string;
  explainInk: string;
  /** White logo mark on dark backgrounds. */
  reversedLogo: boolean;
  /** End screen ("cover") colours. */
  end: {
    slogan: string; copy: string; highlight: string; muted: string; accent: string; cta: string;
    arrowBg: string; arrowInk: string; spotlight: Stops; bg: string;
    /** "Early access" badge, the rest of the CTA line, the halo ring around the URL pill and its glow. */
    divider: string;
    badgeBg: string; badgeStroke: string; badgeInk: string; badgeIcon: string; ctaRest: string; ringBg: string; ringStroke: string; pillShadow: string;
  };
};

export type Palette = {
  studio?: StudioStyle;
  canvas: string; card: string; line: string; ink: string; ink2: string; ink3: string; muted: string;
  primary: string; primarySoft: string; wordmark: string;
  accent: string; accentSoft: string; accentInk: string;
  success: string; successSoft: string; successInk: string;
  hero1: string; hero2: string; onHero2: string;
};

const green = { success: "#16A34A", successSoft: "#DCFCE7", successInk: "#15803D" };

/** Colour themes the studio can render a reel in. */
export const THEMES = {
  nirnoyDark: {
    label: "নির্ণয় ডার্ক (ডিফল্ট)",
    p: {
      canvas: "#1E1B4B", card: "#FFFFFF12", line: "#FFFFFF29", ink: "#FFFFFF", ink2: "#C7D2FE", ink3: "#A5B4FC", muted: "#FFFFFF1F",
      primary: "#FBBF24", primarySoft: "#FBBF2429", wordmark: "#FFFFFF",
      accent: "#FBBF24", accentSoft: "#FBBF2429", accentInk: "#FBBF24",
      success: "#4ADE80", successSoft: "#22C55E33", successInk: "#FFFFFF",
      hero1: "#3730A3", hero2: "#1E1B4B", onHero2: "#C7D2FE",
      studio: {
        bg: "linear-gradient(180deg, #3730A3 0%, #1E1B4B 100%)",
        bubble: "255,255,255", bubbleOn: "251,191,36",
        spotlight: [["#C7D2FED9", 0], ["#A5B4FC8C", 0.35], ["#818CF833", 0.7], ["#818CF800", 1]],
        chipBg: "#FBBF2429", chipStroke: "#FBBF2459", chipInk: "#FBBF24", chipIcon: "#FBBF24",
        divider: "#FFFFFF33",
        correctBg: "#22C55E33", correctStroke: "#4ADE80", correctLetterBg: "#4ADE80", correctLetterInk: "#1E1B4B",
        timerBoxBg: "#FBBF24", timerBoxInk: "#1E1B4B", timerTrack: "#FFFFFF1F",
        ctaBg: "#FBBF24", ctaInk: "#1E1B4B", ctaShadow: "0 8px 28px #FBBF2466",
        explainBg: "linear-gradient(135deg, #FFFFFF1F 0%, #FFFFFF0D 100%)", explainBorder: "1.5px solid #FFFFFF2E", explainAccent: true, explainBadge: true,
        explainShadow: "0 16px 40px #0B0A1F66",
        answerBg: "#22C55E2E", answerStroke: "#4ADE80", answerInk: "#BBF7D0", answerIcon: "#4ADE80",
        explainLabel: "#FBBF24", explainInk: "#FFFFFF",
        reversedLogo: true,
        end: {
          slogan: "#FFFFFFB3", copy: "#C7D2FE", highlight: "#FFFFFF", muted: "#FFFFFF99", accent: "#FBBF24", cta: "#C7D2FE",
          arrowBg: "#1E1B4B", arrowInk: "#FBBF24",
          divider: "#FFFFFF33",
          badgeBg: "#FBBF242E", badgeStroke: "#FBBF2480", badgeInk: "#FBBF24", badgeIcon: "#FBBF24", ctaRest: "#FFFFFF",
          ringBg: "#FBBF241F", ringStroke: "#FBBF2459", pillShadow: "0 12px 48px #FBBF24A6",
          spotlight: [["#C7D2FED9", 0], ["#A5B4FC8C", 0.45], ["#818CF833", 0.72], ["#818CF800", 1]],
          bg: "linear-gradient(180deg, #3730A3 0%, #1E1B4B 100%)",
        },
      },
    },
  },
  nirnoyLight: {
    label: "নির্ণয় লাইট",
    p: {
      canvas: "#FAF8F4", card: "#FFFFFF", line: "#ECE8F0", ink: "#16142B", ink2: "#5B5872", ink3: "#9A97AE", muted: "#F1EFF5",
      primary: "#4F46E5", primarySoft: "#EEF2FF", wordmark: "#16142B",
      accent: "#F59E0B", accentSoft: "#FEF3C7", accentInk: "#7A4B00", ...green,
      hero1: "#3730A3", hero2: "#1E1B4B", onHero2: "#C7D2FE",
      studio: {
        bg: "linear-gradient(180deg, #ECE9FF 0%, #FAF8F4 55%, #FAF8F4 100%)",
        bubble: "79,70,229", bubbleOn: "245,158,11",
        spotlight: [["#C7D2FE99", 0], ["#C7D2FE40", 0.55], ["#C7D2FE00", 1]],
        chipBg: "#FEF3C7", chipStroke: "#F59E0B55", chipInk: "#7A4B00", chipIcon: "#F59E0B",
        divider: "#ECE8F0",
        correctBg: "#DCFCE7", correctStroke: "#16A34A", correctLetterBg: "#16A34A", correctLetterInk: "#FFFFFF",
        timerBoxBg: "#4F46E5", timerBoxInk: "#FFFFFF", timerTrack: "#F1EFF5",
        ctaBg: "#4F46E5", ctaInk: "#FFFFFF", ctaShadow: "0 12px 32px #4F46E540",
        explainBg: "#16142B", explainBorder: "none", explainAccent: true, explainBadge: false,
        explainShadow: "none",
        answerBg: "#DCFCE7", answerStroke: "#16A34A", answerInk: "#15803D", answerIcon: "#16A34A",
        explainLabel: "#FBBF24", explainInk: "#C7D2FE",
        reversedLogo: false,
        end: {
          slogan: "#5B5872", copy: "#5B5872", highlight: "#16142B", muted: "#9A97AE", accent: "#4F46E5", cta: "#5B5872",
          arrowBg: "#FFFFFF", arrowInk: "#4F46E5",
          divider: "#9A97AE80",
          badgeBg: "#FEF3C7", badgeStroke: "#F59E0B66", badgeInk: "#7A4B00", badgeIcon: "#F59E0B", ctaRest: "#16142B",
          ringBg: "#4F46E514", ringStroke: "#4F46E540", pillShadow: "0 12px 48px #4F46E566",
          spotlight: [["#C7D2FE99", 0], ["#C7D2FE40", 0.5], ["#C7D2FE00", 1]],
          bg: "linear-gradient(180deg, #ECE9FF 0%, #FAF8F4 55%, #FAF8F4 100%)",
        },
      },
    },
  },
  indigo: {
    label: "ইন্ডিগো",
    p: {
      canvas: "#FAF8F4", card: "#FFFFFF", line: "#ECE8F0", ink: "#16142B", ink2: "#5B5872", ink3: "#9A97AE", muted: "#F1EFF5",
      primary: "#4F46E5", primarySoft: "#EEF2FF", wordmark: "#312E81",
      accent: "#F59E0B", accentSoft: "#FEF3C7", accentInk: "#7A4B00", ...green,
      hero1: "#3730A3", hero2: "#1E1B4B", onHero2: "#C7D2FE",
    },
  },
} satisfies Record<string, { label: string; p: Palette }>;

export type ThemeKey = keyof typeof THEMES;
export const themeOf = (key: string | undefined): Palette => (THEMES[key as ThemeKey] ?? THEMES.nirnoyDark).p;

/** The narrated parts of a reel, in the order they play. */
export const SEGMENTS = ["question", "options", "think", "answer", "explanation", "cta"] as const;
export type SegmentKey = (typeof SEGMENTS)[number];

/** One narrated clip: a playable URL, its length, where it came from, and its file name in R2 once saved. */
export type VoiceClip = { url: string; sec: number; source?: "tts" | "rec" | "file"; file?: string; builtin?: string };

/** Props the reel template renders. Every field is editable in the studio before rendering. */
export type ReelProps = {
  questionId: number;
  act: string;
  source: string;
  body: string;
  options: { label: string; text: string }[];
  correctIndex: number;
  /** Empty string = no explanation screen. */
  explanation: string;
  /** Colour theme, a key of THEMES. */
  theme: ThemeKey;
  /** Brand tagline on the end screen; the last word is highlighted in the nirnoy themes. */
  tagline: string;
  /** Short brand line next to the logo (nirnoy themes). */
  slogan: string;
  /** "মুখস্থ নয়, বুঝে পড়ুন।" — text up to the first comma is muted (first word struck through), the rest is highlighted (nirnoy themes). */
  subline: string;
  ctaLine: string;
  ctaUrl: string;
  /** Background music bed, a key of MUSIC (src/remotion/music.ts), or "none". */
  music: MusicKey | "none";
  /** Tick / chime / whoosh effects. */
  sfx: boolean;
  /** Bangla narration per segment; a missing clip falls back to a silent reading-time estimate. */
  voice: Partial<Record<SegmentKey, VoiceClip | null>>;
};

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;
export const THINK_SECONDS = 6;

/** Rough silent reading time for Bangla text, in seconds. */
const readSeconds = (text: string, perSecond: number, min: number, max: number) =>
  Math.min(max, Math.max(min, text.length / perSecond));

const clipSec = (p: ReelProps, key: SegmentKey) => {
  const clip = p.voice[key];
  return clip && clip.sec > 0 ? clip.sec : 0;
};

export const hasExplanation = (p: ReelProps) => p.explanation.trim().length > 0;

/**
 * When each beat happens (seconds). Narrated beats last as long as their
 * clip; without a clip the beat gets a reading-time estimate instead.
 *
 *  question → options (+ read aloud) → "এবার চিন্তা করুন" → 6s countdown →
 *  answer reveal (+ read) → explanation (+ read, optional) → CTA (+ read)
 */
export const timeline = (p: ReelProps) => {
  const anyVoice = SEGMENTS.some((k) => clipSec(p, k) > 0);

  const question = 1.0;
  const questionLen = clipSec(p, "question") || (anyVoice ? 2 : readSeconds(p.body, 18, 2, 6));

  const optionsIn = question + questionLen + 0.3;
  const optionsVoice = optionsIn + 0.5 + p.options.length * 0.12;
  const optionsLen = clipSec(p, "options") || (anyVoice ? 1.5 : 2);

  const thinkVoice = optionsVoice + optionsLen + 0.3;
  const thinkLen = clipSec(p, "think");

  const thinkStart = thinkVoice + thinkLen + (thinkLen ? 0.2 : 0);
  const thinkEnd = thinkStart + THINK_SECONDS;
  const reveal = thinkEnd;

  const answerVoice = reveal + 0.3;
  const answerLen = clipSec(p, "answer") || 1.6;

  const explain = hasExplanation(p) ? answerVoice + answerLen + 0.4 : null;
  const explainVoice = explain === null ? null : explain + 0.5;
  const explainLen = explain === null ? 0 : clipSec(p, "explanation") || readSeconds(p.explanation, 22, 6, 14);

  const cta = explainVoice !== null ? explainVoice + explainLen + 0.6 : answerVoice + answerLen + 1.0;
  // The end-screen whoosh runs cta - 0.5 … cta + 0.2 (audible until ~cta + 0.1); start talking as it ends — no overlap, no dead pause.
  const ctaVoice = cta + 0.25;
  const ctaLen = clipSec(p, "cta") || 1.9;
  const end = ctaVoice + ctaLen + 1.0;

  return {
    question,
    optionsIn,
    thinkStart,
    thinkEnd,
    reveal,
    explain,
    cta,
    end,
    /** Start time of each narrated clip. */
    voiceAt: {
      question,
      options: optionsVoice,
      think: thinkVoice,
      answer: answerVoice,
      explanation: explainVoice,
      cta: ctaVoice,
    } as Record<SegmentKey, number | null>,
  };
};

/**
 * The video opens on the thumbnail itself for this long, before the animated reel (whose timeline
 * above starts after it). YouTube Shorts and other feeds that pick a video frame as the cover then
 * get the question and options instead of an empty background.
 */
export const COVER_SECONDS = 0.6;

/**
 * A moment in the video that looks like the thumbnail: question and every option on screen, before
 * the countdown starts. Used as the Instagram cover (seconds, from the start of the video).
 */
export const coverMoment = (p: ReelProps) => {
  const t = timeline(p);
  const settled = t.optionsIn + 0.5 + Math.max(0, p.options.length - 1) * 0.12 + 0.7;
  return COVER_SECONDS + Math.max(t.optionsIn + 0.3, Math.min(settled, t.thinkStart - 0.1));
};

export const durationInFrames = (p: ReelProps) => Math.round((COVER_SECONDS + timeline(p).end) * FPS);

/** Shrinks text as it gets longer so nothing spills off the 1080x1920 frame. */
export const fit = (len: number, steps: [number, number][], min: number) => {
  for (const [max, size] of steps) if (len <= max) return size;
  return min;
};
