/** The narrated parts of a reel, in the order they play. */
export const SEGMENTS = ["question", "options", "think", "answer", "explanation", "cta"] as const;
export type SegmentKey = (typeof SEGMENTS)[number];

/** One narrated clip: an object URL for the audio and its measured length in seconds. */
export type VoiceClip = { url: string; sec: number };

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
  /** Brand tagline under the logo on the end screen. */
  tagline: string;
  ctaLine: string;
  ctaUrl: string;
  /** Background music bed. */
  music: boolean;
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
  const ctaVoice = cta + 0.6;
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

export const durationInFrames = (p: ReelProps) => Math.round(timeline(p).end * FPS);

/** Shrinks text as it gets longer so nothing spills off the 1080x1920 frame. */
export const fit = (len: number, steps: [number, number][], min: number) => {
  for (const [max, size] of steps) if (len <= max) return size;
  return min;
};
