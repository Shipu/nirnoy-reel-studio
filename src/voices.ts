import ctaShipuUrl from "./remotion/sfx/cta-shipu.mp3?url";
import thinkShipuUrl from "./remotion/sfx/think-shipu.mp3?url";
import type { ReelProps, SegmentKey, VoiceClip } from "./remotion/types";

/** Default narration lines that have a recording by Shipu (src/remotion/sfx/*-shipu.mp3). */
export const DEFAULT_THINK_TEXT = "এবার চিন্তা করুন। আপনার হাতে ছয় সেকেন্ড।";
export const DEFAULT_CTA_TEXT = "চাকরি ও পেশাগত পরীক্ষার MCQ প্রস্তুতির আর্লি অ্যাক্সেস পেতে এখনই ভিজিট করুন, নির্ণয় ডট অ্যাপ।";

/** Recordings that ship with the studio, keyed by name; a reel stores only the name. */
export const BUILTIN_VOICES: Record<string, { url: string; sec: number; segment: SegmentKey; text: string }> = {
  "think-shipu": { url: thinkShipuUrl, sec: 3.47, segment: "think", text: DEFAULT_THINK_TEXT },
  "cta-shipu": { url: ctaShipuUrl, sec: 7.08, segment: "cta", text: DEFAULT_CTA_TEXT },
};

export const builtinClip = (name: string): VoiceClip | null => {
  const b = BUILTIN_VOICES[name];
  return b ? { url: b.url, sec: b.sec, source: "rec", builtin: name } : null;
};

/**
 * Keeps recorded lines in step with their text: a default line always gets Shipu's recording
 * (unless another clip is already there), and that recording is dropped once the line is changed.
 */
export function syncBuiltinVoices(p: ReelProps, scripts: Partial<Record<SegmentKey, string>> | null | undefined): ReelProps {
  let voice = p.voice;
  for (const [name, b] of Object.entries(BUILTIN_VOICES)) {
    const clip = voice[b.segment];
    const isDefault = (scripts?.[b.segment] ?? "").trim() === b.text;
    if (isDefault && !clip) voice = { ...voice, [b.segment]: builtinClip(name) };
    else if (!isDefault && clip?.builtin === name) voice = { ...voice, [b.segment]: null };
  }
  return voice === p.voice ? p : { ...p, voice };
}
