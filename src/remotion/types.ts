/** Props the reel template renders. Every field is editable in the studio before rendering. */
export type ReelProps = {
  questionId: number;
  act: string;
  source: string;
  body: string;
  options: { label: string; text: string }[];
  correctIndex: number;
  explanation: string;
  ctaLine: string;
  ctaUrl: string;
  /** Background music bed. */
  music: boolean;
  /** Tick / chime / whoosh effects. */
  sfx: boolean;
};

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;

/** Seconds on the explanation screen: ~22 Bangla characters per second, clamped to 6–14s. */
const explainSeconds = (text: string) => Math.min(14, Math.max(6, text.length / 22));

export const timeline = (p: ReelProps) => {
  const thinkStart = 1.2;
  const thinkEnd = thinkStart + 6;
  const explain = thinkEnd + 1.2;
  const cta = explain + explainSeconds(p.explanation);
  return { thinkStart, thinkEnd, reveal: thinkEnd, explain, cta, end: cta + 2.5 };
};

export const durationInFrames = (p: ReelProps) => Math.round(timeline(p).end * FPS);

/** Shrinks text as it gets longer so nothing spills off the 1080x1920 frame. */
export const fit = (len: number, steps: [number, number][], min: number) => {
  for (const [max, size] of steps) if (len <= max) return size;
  return min;
};
