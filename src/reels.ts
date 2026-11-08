import type { Captions } from "./captions";
import type { ReelProps, SegmentKey, VoiceClip } from "./remotion/types";
import { builtinClip } from "./voices";

/** A reel as stored by the Worker (D1 row + optional studio state). */
export type ReelStatus = "draft" | "rendered" | "published";
export type ReelRow = {
  id: number;
  question_id: number;
  status: ReelStatus;
  title: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string | null;
  rendered_at: string | null;
  youtube_url: string | null;
};

type StoredVoice = { file?: string; builtin?: string; sec: number; source?: VoiceClip["source"] };
/** What the studio saves: everything on screen except blob URLs, plus the narration lines. */
export type ReelData = {
  props: Omit<ReelProps, "voice">;
  voice: Partial<Record<SegmentKey, StoredVoice | null>>;
  scripts: Record<SegmentKey, string> | null;
  /** Per-platform post text you edited; missing platforms use the generated caption. */
  captions?: Partial<Captions>;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { Accept: "application/json", ...(init?.headers ?? {}) } });
  const data = (await res.json().catch(() => ({}))) as { message?: string } & T;
  if (!res.ok) throw new Error(data.message ?? `Request failed (${res.status})`);
  return data;
}
const jsonBody = (body: unknown) => ({ headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const mediaUrl = (id: number, file: string, version?: string | null) =>
  `/api/reels/${id}/media/${file}${version ? `?v=${encodeURIComponent(version)}` : ""}`;

export const listReels = (filter: { status?: ReelStatus; question_id?: number } = {}) => {
  const q = new URLSearchParams();
  if (filter.status) q.set("status", filter.status);
  if (filter.question_id) q.set("question_id", String(filter.question_id));
  return request<{ data: ReelRow[] }>(`/api/reels?${q}`).then((r) => r.data);
};

export const getReel = (id: number) => request<{ data: ReelRow & { data: ReelData | null } }>(`/api/reels/${id}`).then((r) => r.data);

export const createReel = (questionId: number, data: ReelData) =>
  request<{ data: ReelRow }>("/api/reels", { method: "POST", ...jsonBody({ question_id: questionId, data }) }).then((r) => r.data);

export const updateReel = (id: number, patch: { data?: ReelData; status?: ReelStatus; youtube_url?: string | null; question_id?: number }) =>
  request<{ data: ReelRow }>(`/api/reels/${id}`, { method: "PATCH", ...jsonBody(patch) }).then((r) => r.data);

export const deleteReel = (id: number) => request(`/api/reels/${id}`, { method: "DELETE" });

export const duplicateReel = (id: number) => request<{ data: ReelRow }>(`/api/reels/${id}/duplicate`, { method: "POST" }).then((r) => r.data);

/** Uploads a voice clip (gets a fresh name back) or a fixed file like video.mp4 / thumb.jpg. */
export async function uploadMedia(id: number, blob: Blob, target: { segment: SegmentKey } | { file: "video.mp4" | "thumb.jpg" }) {
  const path = "segment" in target ? `/api/reels/${id}/media?name=voice-${target.segment}` : `/api/reels/${id}/media/${target.file}`;
  const type = blob.type || ("file" in target ? (target.file.endsWith(".mp4") ? "video/mp4" : "image/jpeg") : "audio/wav");
  return request<{ file: string }>(path, { method: "PUT", headers: { "content-type": type }, body: blob }).then((r) => r.file);
}

export const toData = (p: ReelProps, scripts: Record<SegmentKey, string> | null, captions: Partial<Captions> = {}): ReelData => {
  const { voice, ...props } = p;
  const stored: ReelData["voice"] = {};
  for (const [k, v] of Object.entries(voice) as [SegmentKey, VoiceClip | null | undefined][]) {
    if (v?.file) stored[k] = { file: v.file, sec: v.sec, source: v.source };
    else if (v?.builtin) stored[k] = { builtin: v.builtin, sec: v.sec, source: v.source };
  }
  return { props, voice: stored, scripts, captions };
};

export const fromData = (id: number, d: ReelData): ReelProps => {
  const voice: ReelProps["voice"] = {};
  for (const [k, v] of Object.entries(d.voice ?? {}) as [SegmentKey, StoredVoice | null][]) {
    if (v?.file) voice[k] = { url: mediaUrl(id, v.file), sec: v.sec, source: v.source, file: v.file };
    else if (v?.builtin) voice[k] = builtinClip(v.builtin);
  }
  return { ...d.props, voice };
};

/** Theme / music / effects you picked last time, used for new drafts. */
const PREFS = "reel-prefs";
export const loadPrefs = (): Partial<Pick<ReelProps, "theme" | "music" | "sfx">> => {
  try {
    return JSON.parse(localStorage.getItem(PREFS) ?? "{}");
  } catch {
    return {};
  }
};
export const savePrefs = (p: Pick<ReelProps, "theme" | "music" | "sfx">) =>
  localStorage.setItem(PREFS, JSON.stringify({ theme: p.theme, music: p.music, sfx: p.sfx }));

export const STATUS_LABEL: Record<ReelStatus, string> = { draft: "খসড়া", rendered: "তৈরি", published: "প্রকাশিত" };
