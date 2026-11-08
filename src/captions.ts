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
/** Option text as shown in posts: stray " ." and a trailing danda/full stop from the source data are dropped. */
const cleanOption = (s: string) =>
  clean(s)
    .replace(/\s+\.(?=\s|$)/g, "")
    .replace(/[\s।.]+$/, "")
    .trim();
const tag = (s: string) => `#${s.replace(/[\s,،।()'’‘"-]+/g, "")}`;
const unique = (a: string[]) => [...new Set(a.filter((x) => x.length > 1))];

type Exam = { tag: string; en: string; bn: string };
/** Which exam the question is from, for hashtags and the English / Bangla keyword lines. */
function examOf(p: Source): Exam {
  if (/বার কাউন্সিল/.test(p.source)) return { tag: "#BarCouncil", en: "Bangladesh Bar Council MCQ", bn: "বার কাউন্সিল MCQ" };
  if (/জুডিশিয়াল|বিজেএস/i.test(p.source)) return { tag: "#BJS", en: "Bangladesh Judicial Service (BJS) MCQ", bn: "বিজেএস MCQ" };
  return { tag: "", en: "Bangladesh job & professional exam MCQ", bn: "MCQ" };
}

/**
 * Search keywords in English (people search in both languages; the brand is "Nirnoy" in Latin
 * script), placed just before the hashtags.
 */
const keywordLine = (e: Exam) => `${e.en} · Law exam preparation · Nirnoy`;

/** X counts every URL as 23 characters; Bengali letters count as 1. */
export const xLength = (text: string) => text.replace(/(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?/gi, "x".repeat(23)).length;

export function generateCaptions(p: Source): Captions {
  const body = clean(p.body);
  const options = p.options.map((o) => `${o.label}) ${cleanOption(o.text)}`);
  // Posts link to the reel landing page (https://nirnoy.app/reel); a full URL in "বোতামের লেখা" is used as is.
  const site = /^https?:\/\//.test(p.ctaUrl) ? p.ctaUrl : `https://${p.ctaUrl.replace(/\/+$/, "")}`;
  const link = /^https?:\/\/[^/]+\/?$/.test(site) ? `${site.replace(/\/+$/, "")}/reel` : site;
  const cta = clean(p.ctaLine);
  const source = p.source ? `উৎস: ${clean(p.source)}` : "";
  const exam = examOf(p);
  const act = p.act ? tag(p.act.split(/[,،]/)[0]) : "";
  const keywords = keywordLine(exam);
  const join = (...parts: (string | false)[]) =>
    parts
      .filter((x): x is string => x !== false)
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

  const facebook = join(
    body,
    "",
    ...options,
    "",
    "আপনার উত্তর কমেন্টে লিখুন 👇 সঠিক উত্তর ও ব্যাখ্যা ভিডিওর শেষে।",
    source,
    "",
    `${cta} 👇`,
    link,
    "",
    keywords,
    unique(["#নির্ণয়", exam.tag, "#MCQ", act]).join(" "),
  );

  // Instagram favours 3–5 relevant hashtags.
  const instagram = join(
    body,
    "",
    ...options,
    "",
    "উত্তর কমেন্টে লিখুন 👇 সঠিক উত্তর ও ব্যাখ্যা রিলের শেষে।",
    "আপনার বন্ধুকে ট্যাগ করুন যে এটা পারবে 🤝",
    source,
    "",
    cta,
    `লিংক বায়োতে 🔗 (${p.ctaUrl})`,
    "",
    keywords,
    unique(["#নির্ণয়", exam.tag, "#MCQ", act, "#পরীক্ষাপ্রস্তুতি"]).slice(0, 5).join(" "),
  );

  const linkedin = join(
    body,
    "",
    ...options,
    "",
    "কমেন্টে আপনার উত্তর ও যুক্তি লিখুন। সঠিক উত্তর ও সংক্ষিপ্ত ব্যাখ্যা ভিডিওতে আছে।",
    source,
    "",
    `পেশাগত ও চাকরির পরীক্ষার প্রস্তুতিতে ব্যাখ্যাসহ MCQ — ${link}`,
    "",
    keywords,
    unique([exam.tag, "#Law", "#ExamPreparation"]).slice(0, 3).join(" "),
  );

  // TikTok search reads the caption text, so the exam keywords go right under the question.
  const tiktok = join(
    `${body} 🤔`,
    p.source ? `${clean(p.source).replace(/,\s*/, " ")}-এর MCQ` : exam.bn,
    "",
    "উত্তর কমেন্টে লিখুন, শেষ পর্যন্ত দেখুন ✅",
    cta,
    "লিংক বায়োতে 🔗",
    "",
    unique(["#নির্ণয়", exam.tag, "#MCQ", act, "#LawTok"]).slice(0, 5).join(" "),
  );

  // X: 280 hard limit. Try with options, then without, then shorten the question.
  const xTags = unique(["#MCQ", "#নির্ণয়", exam.tag]).slice(0, 3).join(" ");
  const xWith = (q: string, withOptions: boolean) =>
    join(q, withOptions && "", ...(withOptions ? options : []), "", `উত্তর কমেন্টে 👇 ${link}`, xTags);
  let x = xWith(body, true);
  if (xLength(x) > 280) x = xWith(body, false);
  if (xLength(x) > 280) {
    const over = xLength(x) - 280;
    x = xWith(`${body.slice(0, Math.max(20, body.length - over - 1))}…`, false);
  }

  // YouTube detects Shorts on its own, so the title spends its room on search words instead of #Shorts.
  const suffix = ` | ${exam.bn}`;
  const youtubeTitle = body.length + suffix.length <= 100 ? `${body}${suffix}` : body.length > 100 ? `${body.slice(0, 99)}…` : body;
  const youtube = join(
    body,
    "",
    ...options,
    "",
    "আপনার উত্তর কমেন্টে লিখুন — সঠিক উত্তর ও ব্যাখ্যা ভিডিওতে।",
    source,
    "",
    `${cta} 👇`,
    link,
    "",
    keywords,
    unique(["#Shorts", "#নির্ণয়", exam.tag, "#MCQ", act]).join(" "),
  );


  return { facebook, instagram, linkedin, tiktok, x, youtubeTitle, youtube };
}

/** Generated captions with this reel's edits on top. */
export const captionsFor = (p: Source, overrides?: Partial<Captions> | null): Captions => ({ ...generateCaptions(p), ...(overrides ?? {}) });

export const captionLength = (platform: Platform, text: string) => (platform === "x" ? xLength(text) : [...text].length);
