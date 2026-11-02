import type { ReelProps } from "./remotion/types";

export type ApiQuestion = {
  id: number;
  body: string;
  instruction: string | null;
  explanation: string | null;
  options: { id: number; label: string | null; text: string; is_correct: boolean }[];
  topics: { id: number; path: string; name: { en: string | null; bn: string | null } }[];
  criteria: {
    group_no: number;
    criteria: { key: string | null; label: Record<string, string> | null };
    attributes: { key: string | null; value: string | null; display: string }[];
    citation: string;
  }[];
};

export type RandomFilters = { exam_name: string; year: string; topic_id: string; skip_used: boolean };

const BN_LETTERS = ["ক", "খ", "গ", "ঘ", "ঙ", "চ"];

const plain = (html: string | null | undefined) => {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body.textContent ?? "").replace(/\s+\n/g, "\n").trim();
};

/** Drops a leading "সঠিক উত্তর: ঘ) ..." line — the reel already shows the answer. */
const stripAnswerLine = (text: string) => text.replace(/^\s*সঠিক উত্তর[^\n]*\n+/, "").trim();

export function toReelProps(q: ApiQuestion): ReelProps {
  const examGroup = q.criteria.find((c) => c.criteria.key === "exam") ?? q.criteria[0];
  const topic = q.topics[0];

  return {
    questionId: q.id,
    act: topic ? (topic.name.bn ?? topic.name.en ?? "") : "",
    source: examGroup?.citation ?? "",
    body: plain(q.body),
    options: q.options.map((o, i) => ({ label: o.label ?? BN_LETTERS[i] ?? String(i + 1), text: plain(o.text) })),
    correctIndex: Math.max(0, q.options.findIndex((o) => o.is_correct)),
    explanation: stripAnswerLine(plain(q.explanation)),
    ctaLine: "Early access পেতে এখনই join করুন",
    ctaUrl: "nirnoy.app",
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { Accept: "application/json", ...(init?.headers ?? {}) } });
  const data = (await res.json().catch(() => ({}))) as { message?: string } & T;
  if (!res.ok) throw new Error(data.message ?? `Request failed (${res.status})`);
  return data;
}

export const fetchQuestion = (id: number) => request<{ data: ApiQuestion }>(`/api/questions/${id}`).then((r) => r.data);

export const fetchRandom = (f: RandomFilters) => {
  const params = new URLSearchParams();
  if (f.exam_name) params.set("exam_name", f.exam_name);
  if (f.year) params.set("year", f.year);
  if (f.topic_id) params.set("topic_id", f.topic_id);
  params.set("skip_used", f.skip_used ? "1" : "0");
  return request<{ data: ApiQuestion }>(`/api/questions/random?${params}`).then((r) => r.data);
};

export type ReelLog = { id: number; question_id: number; rendered_by: string | null; created_at: string };

export const fetchReels = () => request<{ data: ReelLog[] }>("/api/reels").then((r) => r.data);

export const logReel = (questionId: number) =>
  request("/api/reels", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question_id: questionId }) });
