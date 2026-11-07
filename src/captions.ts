import type { ReelProps } from "./remotion/types";

/**
 * Ready-to-paste post text for each platform, built from the reel's question. Each platform gets its
 * own shape: X has a hard 280 limit, Instagram/TikTok links aren't clickable, LinkedIn reads better
 * with a calmer tone, YouTube needs a separate title. Anything can be edited per reel.
 */

export const PLATFORMS = ["facebook", "instagram", "linkedin", "tiktok", "x", "youtubeTitle", "youtube"] as const;
export type Platform = (typeof PLATFORMS)[number];
export type Captions = Record<Platform, string>;

export const PLATFORM_INFO: Record<Platform, { label: string; limit: number }> = {
  facebook: { label: "Facebook", limit: 63206 },
  instagram: { label: "Instagram", limit: 2200 },
  linkedin: { label: "LinkedIn", limit: 3000 },
  tiktok: { label: "TikTok", limit: 4000 },
  x: { label: "X", limit: 280 },
  youtubeTitle: { label: "YouTube title", limit: 100 },
  youtube: { label: "YouTube description", limit: 5000 },
};

/** Editor tabs: YouTube's title and description share one tab. */
export const CAPTION_TABS = [
  { key: "facebook", label: "Facebook", fields: ["facebook"] },
  { key: "instagram", label: "Instagram", fields: ["instagram"] },
  { key: "linkedin", label: "LinkedIn", fields: ["linkedin"] },
  { key: "tiktok", label: "TikTok", fields: ["tiktok"] },
  { key: "x", label: "X", fields: ["x"] },
  { key: "youtube", label: "YouTube", fields: ["youtubeTitle", "youtube"] },
] as const satisfies readonly { key: string; label: string; fields: readonly Platform[] }[];
export type CaptionTab = (typeof CAPTION_TABS)[number]["key"];

type Source = Pick<ReelProps, "body" | "options" | "act" | "source" | "ctaLine" | "ctaUrl">;

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const tag = (s: string) => `#${s.replace(/[\s,،।()'’‘"-]+/g, "")}`;
const unique = (a: string[]) => [...new Set(a.filter((x) => x.length > 1))];

function hashtags(p: Source, extra: string[]) {
  const act = p.act ? tag(p.act.split(/[,،]/)[0]) : "";
  const exam = /বার কাউন্সিল/.test(p.source) ? "#BarCouncil" : /জুডিশিয়াল|বিজেএস/i.test(p.source) ? "#BJS" : "";
  return unique(["#MCQ", "#নির্ণয়", exam, act, ...extra]);
}

/** X counts every URL as 23 characters; Bengali letters count as 1. */
export const xLength = (text: string) => text.replace(/(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?/gi, "x".repeat(23)).length;

export function generateCaptions(p: Source): Captions {
  const body = clean(p.body);
  const options = p.options.map((o) => `${o.label}) ${clean(o.text)}`);
  const link = /^https?:\/\//.test(p.ctaUrl) ? p.ctaUrl : `https://${p.ctaUrl}`;
  const cta = clean(p.ctaLine);
  const source = p.source ? `উৎস: ${clean(p.source)}` : "";
  const join = (...parts: (string | false)[]) =>
    parts
      .filter((x): x is string => x !== false)
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

  const facebook = join(
    "🧠 আজকের MCQ",
    "",
    body,
    "",
    ...options,
    "",
    "আপনার উত্তর কমেন্টে লিখুন 👇 সঠিক উত্তর ও ব্যাখ্যা ভিডিওর শেষে।",
    source,
    "",
    `${cta} 👉 ${link}`,
    "",
    hashtags(p, ["#আইন", "#পরীক্ষাপ্রস্তুতি"]).join(" "),
  );

  const instagram = join(
    "🧠 আজকের MCQ",
    "",
    body,
    "",
    ...options,
    "",
    "উত্তর কমেন্টে লিখুন 👇 সঠিক উত্তর ও ব্যাখ্যা রিলের শেষে।",
    "আপনার বন্ধুকে ট্যাগ করুন যে এটা পারবে 🤝",
    source,
    "",
    `${cta} — লিংক বায়োতে 🔗 (${p.ctaUrl})`,
    "",
    "·",
    hashtags(p, ["#আইন", "#পরীক্ষাপ্রস্তুতি", "#চাকরিরপরীক্ষা", "#LawMCQ", "#StudyReels", "#Bangladesh"]).join(" "),
  );

  const linkedin = join(
    "আজকের MCQ — আপনার উত্তর কী?",
    "",
    body,
    "",
    ...options,
    "",
    "কমেন্টে আপনার উত্তর ও যুক্তি লিখুন। সঠিক উত্তর ও সংক্ষিপ্ত ব্যাখ্যা ভিডিওতে আছে।",
    source,
    "",
    `পেশাগত ও চাকরির পরীক্ষার প্রস্তুতিতে ব্যাখ্যাসহ MCQ — ${link}`,
    "",
    hashtags(p, ["#Law", "#ExamPreparation", "#Bangladesh"]).join(" "),
  );

  const tiktok = join(
    `${body} 🤔`,
    "",
    "উত্তর কমেন্টে লিখুন, শেষ পর্যন্ত দেখুন ✅",
    `${cta} — লিংক বায়োতে`,
    "",
    hashtags(p, ["#পরীক্ষাপ্রস্তুতি", "#LawTok", "#fyp"]).join(" "),
  );

  // X: 280 hard limit. Try with options, then without, then shorten the question.
  const xTags = hashtags(p, []).slice(0, 3).join(" ");
  const xWith = (q: string, withOptions: boolean) =>
    join(`🧠 আজকের MCQ: ${q}`, withOptions && "", ...(withOptions ? options : []), "", `উত্তর কমেন্টে 👇 ${link}`, xTags);
  let x = xWith(body, true);
  if (xLength(x) > 280) x = xWith(body, false);
  if (xLength(x) > 280) {
    const over = xLength(x) - 280;
    x = xWith(`${body.slice(0, Math.max(20, body.length - over - 1))}…`, false);
  }

  const head = "আজকের MCQ: ";
  const room = 100 - head.length - " #Shorts".length;
  const youtubeTitle = `${head}${body.length > room ? `${body.slice(0, room - 1)}…` : body} #Shorts`;
  const youtube = join(
    body,
    "",
    ...options,
    "",
    "আপনার উত্তর কমেন্টে লিখুন — সঠিক উত্তর ও ব্যাখ্যা ভিডিওতে।",
    source,
    "",
    `${cta} 👉 ${link}`,
    "",
    hashtags(p, ["#Shorts"]).join(" "),
  );

  return { facebook, instagram, linkedin, tiktok, x, youtubeTitle, youtube };
}

/** Generated captions with this reel's edits on top. */
export const captionsFor = (p: Source, overrides?: Partial<Captions> | null): Captions => ({ ...generateCaptions(p), ...(overrides ?? {}) });

export const captionLength = (platform: Platform, text: string) => (platform === "x" ? xLength(text) : [...text].length);
