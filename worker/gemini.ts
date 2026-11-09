import type { Env } from "./index";

/**
 * Explanation check with Gemini: is the explanation (and the marked answer) right, what's wrong,
 * a corrected explanation and a short one — in Bangla, for a reel.
 *   POST /api/ai/explanation { body, options: [{label,text}], correctIndex, explanation, citations: [] }
 */

type Input = { body: string; options: { label: string; text: string }[]; correctIndex: number; explanation: string; citations: string[] };
export type ExplanationReview = {
  verdict: "ok" | "wrong" | "incomplete";
  answer_ok: boolean;
  answer_note: string;
  problems: string[];
  explanation: string;
  short: string;
};

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const SCHEMA = {
  type: "OBJECT",
  properties: {
    verdict: { type: "STRING", enum: ["ok", "wrong", "incomplete"] },
    answer_ok: { type: "BOOLEAN" },
    answer_note: { type: "STRING" },
    problems: { type: "ARRAY", items: { type: "STRING" } },
    explanation: { type: "STRING" },
    short: { type: "STRING" },
  },
  required: ["verdict", "answer_ok", "answer_note", "problems", "explanation", "short"],
};

function prompt(q: Input) {
  const options = q.options.map((o, i) => `${o.label}) ${o.text}${i === q.correctIndex ? "   ← চিহ্নিত সঠিক উত্তর" : ""}`).join("\n");
  return `তুমি বাংলাদেশের আইন ও চাকরি/পেশাগত পরীক্ষার (বার কাউন্সিল, বিজেএস ইত্যাদি) একজন অভিজ্ঞ শিক্ষক ও MCQ যাচাইকারী।
নিচের MCQ আর তার ব্যাখ্যা যাচাই করো। ব্যাখ্যাটি একটি ছোট ভিডিও রিলে দেখানো ও পড়ে শোনানো হবে।

প্রশ্ন: ${q.body}
অপশন:
${options}
সূত্র/তথ্য: ${q.citations.join(" · ") || "নেই"}
বর্তমান ব্যাখ্যা: ${q.explanation || "(খালি)"}

যা করবে:
1. চিহ্নিত সঠিক উত্তরটি বাংলাদেশের প্রচলিত আইন অনুযায়ী সত্যিই সঠিক কিনা দেখো (answer_ok)। সন্দেহ থাকলে answer_note-এ সংক্ষেপে কারণ লেখো, ঠিক থাকলে answer_note খালি রাখো।
2. বর্তমান ব্যাখ্যাটি সঠিক, প্রাসঙ্গিক ও যথেষ্ট কিনা বিচার করো:
   - "ok": তথ্যগতভাবে ঠিক এবং কেন উত্তরটি সঠিক তা বোঝায়।
   - "wrong": কোনো ভুল তথ্য, ভুল ধারা/আদেশ/বিধি, বা উত্তরের সাথে অসংগতি আছে।
   - "incomplete": ভুল নেই কিন্তু অস্পষ্ট, সাধারণ কথা ("সংশ্লিষ্ট বিধান অনুযায়ী…" ধরনের), বা আইনের উৎস উল্লেখ নেই।
3. problems: নির্দিষ্ট সমস্যাগুলোর তালিকা (বাংলায়, প্রতিটি এক বাক্যে)। "ok" হলে খালি তালিকা।
4. explanation: একটি সঠিক ব্যাখ্যা লেখো — ২–৪ বাক্য, সর্বোচ্চ ৪৫০ অক্ষর, সহজ বাংলায়। আইনের নাম ও ধারা/আদেশ/বিধি উল্লেখ করো যদি নিশ্চিত থাকো। "ok" হলে বর্তমান ব্যাখ্যাটি প্রায় অপরিবর্তিত রেখে শুধু ভাষা পরিষ্কার করো।
5. short: একই ব্যাখ্যার ছোট রূপ — ১–২ বাক্য, সর্বোচ্চ ২০০ অক্ষর।

নিয়ম:
- কোনো ধারা, আদেশ, বিধি বা মামলার নাম বানিয়ে লিখবে না। নিশ্চিত না হলে উৎস বাদ দাও এবং problems-এ জানাও।
- "সঠিক উত্তর: …" দিয়ে শুরু করবে না; উত্তরটি ভিডিওতে আলাদাভাবে দেখানো হয়। সরাসরি কারণ দিয়ে শুরু করো।
- ইংরেজি আইনের নাম বা পরিভাষা প্রয়োজনে রাখতে পারো, বাকি সব বাংলায়।`;
}

type GeminiReply = { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message?: string; status?: string; details?: { retryDelay?: string }[] } };

/**
 * Free key first; when it is out of quota (429 / RESOURCE_EXHAUSTED) the paid key takes over, and the
 * free key is skipped until its retry delay passes (per isolate; defaults to 5 minutes).
 */
let freeBlockedUntil = 0;
const isQuota = (status: number, e?: GeminiReply["error"]) => status === 429 || e?.status === "RESOURCE_EXHAUSTED";
const retryMs = (e?: GeminiReply["error"]) => {
  const d = e?.details?.find((x) => x.retryDelay)?.retryDelay;
  const sec = d ? Number.parseFloat(d) : Number.NaN;
  return Number.isFinite(sec) && sec > 0 ? sec * 1000 : 5 * 60_000;
};

export async function reviewExplanation(request: Request, env: Env): Promise<Response> {
  const keys = [
    ...(env.GEMINI_API_KEY ? [{ tier: "free" as const, key: env.GEMINI_API_KEY }] : []),
    ...(env.GEMINI_API_KEY_PAID ? [{ tier: "paid" as const, key: env.GEMINI_API_KEY_PAID }] : []),
  ];
  if (!keys.length) return json({ message: "GEMINI_API_KEY (free) / GEMINI_API_KEY_PAID secret is not set on the Worker." }, 500);
  const q = (await request.json().catch(() => null)) as Partial<Input> | null;
  if (!q || typeof q.body !== "string" || !Array.isArray(q.options) || typeof q.correctIndex !== "number") return json({ message: "Invalid request." }, 422);
  if (q.body.length > 3000 || (q.explanation ?? "").length > 5000 || q.options.length > 8) return json({ message: "Too long." }, 422);
  const input: Input = {
    body: q.body,
    options: q.options.map((o) => ({ label: String(o?.label ?? ""), text: String(o?.text ?? "").slice(0, 500) })),
    correctIndex: q.correctIndex,
    explanation: String(q.explanation ?? ""),
    citations: Array.isArray(q.citations) ? q.citations.map(String).slice(0, 6) : [],
  };

  const model = env.GEMINI_MODEL || "gemini-flash-latest";
  const base = env.GEMINI_ENDPOINT || "https://generativelanguage.googleapis.com";
  const payload = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt(input) }] }],
    generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseSchema: SCHEMA },
  });

  let res: Response | null = null;
  let data: GeminiReply = {};
  let tier: "free" | "paid" = "free";
  const usable = keys.filter((k) => !(k.tier === "free" && Date.now() < freeBlockedUntil && keys.length > 1));
  for (const k of usable) {
    tier = k.tier;
    res = await fetch(`${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": k.key },
      body: payload,
    });
    data = (await res.json().catch(() => ({}))) as GeminiReply;
    if (k.tier === "free" && isQuota(res.status, data.error)) {
      freeBlockedUntil = Date.now() + retryMs(data.error);
      continue; // free limit reached → try the paid key
    }
    break;
  }
  if (!res) return json({ message: "No Gemini key available." }, 500);
  if (!res.ok) return json({ message: `Gemini (${tier}): ${data.error?.message ?? `HTTP ${res.status}`}` }, 502);
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  try {
    const r = JSON.parse(text) as ExplanationReview;
    return json({ ...r, problems: Array.isArray(r.problems) ? r.problems : [], model, tier });
  } catch {
    return json({ message: "Gemini থেকে বোঝার মতো উত্তর আসেনি — আবার চেষ্টা করুন।" }, 502);
  }
}
