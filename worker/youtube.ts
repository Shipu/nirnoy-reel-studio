import type { FacebookPage } from "./facebook";
import type { Env } from "./index";

/**
 * YouTube connector (Google OAuth + YouTube Data API v3). A vertical video under 3 minutes is
 * published as a Short on its own. The stored "token" is the Google refresh token; each call gets a
 * fresh access token from it.
 *   upload: resumable videos.insert (metadata → upload URL → bytes), then thumbnails.set (best effort)
 *   schedule: uploaded right away as private with status.publishAt — YouTube makes it public itself
 *   cancel: videos.delete
 */

// `youtube` covers upload, reading the channel, thumbnails and deleting a scheduled video.
export const YOUTUBE_SCOPES = ["https://www.googleapis.com/auth/youtube"];

const AUTH = (env: Env) => env.GOOGLE_AUTH_BASE || "https://accounts.google.com";
const TOKEN = (env: Env) => env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token";
const API = (env: Env) => env.YOUTUBE_API_BASE || "https://www.googleapis.com";

type GoogleError = { error?: string | { message?: string; errors?: { reason?: string; message?: string }[] }; error_description?: string };

async function call<T>(res: Response): Promise<T> {
  const raw = await res.text().catch(() => "");
  let data = {} as T & GoogleError;
  try {
    data = raw ? JSON.parse(raw) : data;
  } catch {
    // not JSON
  }
  if (!res.ok) {
    const e = data.error;
    const why = typeof e === "string" ? (data.error_description ?? e) : (e?.errors?.[0]?.message ?? e?.message ?? raw.slice(0, 300));
    console.error(`YouTube HTTP ${res.status}: ${raw.slice(0, 1000)}`);
    throw new Error(`YouTube: ${why || `HTTP ${res.status}`}`);
  }
  return data;
}

function credentials(env: Env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET secrets are not set on the Worker.");
  return { client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET };
}

export function youtubeAuthUrl(env: Env, redirectUri: string, state: string) {
  const u = new URL(`${AUTH(env)}/o/oauth2/v2/auth`);
  u.searchParams.set("client_id", credentials(env).client_id);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", YOUTUBE_SCOPES.join(" "));
  u.searchParams.set("state", state);
  // offline + consent: Google returns a refresh token every time, so reconnecting renews it.
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("include_granted_scopes", "true");
  return u.toString();
}

/** OAuth code → the channel(s) of the account chosen at login, each carrying the refresh token. */
export async function youtubeChannels(env: Env, code: string, redirectUri: string): Promise<FacebookPage[]> {
  const t = await call<{ access_token: string; refresh_token?: string }>(
    await fetch(TOKEN(env), { method: "POST", body: new URLSearchParams({ ...credentials(env), code, redirect_uri: redirectUri, grant_type: "authorization_code" }) }),
  );
  if (!t.refresh_token) throw new Error("Google did not return a refresh token — remove the app's access in your Google account and connect again.");
  const r = await call<{ items?: { id: string; snippet?: { title?: string; thumbnails?: { default?: { url?: string } } } }[] }>(
    await fetch(`${API(env)}/youtube/v3/channels?part=snippet&mine=true`, { headers: { Authorization: `Bearer ${t.access_token}` } }),
  );
  return (r.items ?? []).map((c) => ({ id: c.id, name: c.snippet?.title ?? c.id, picture: c.snippet?.thumbnails?.default?.url ?? null, token: t.refresh_token! }));
}

export async function youtubeAccessToken(env: Env, refreshToken: string) {
  const t = await call<{ access_token: string }>(
    await fetch(TOKEN(env), { method: "POST", body: new URLSearchParams({ ...credentials(env), refresh_token: refreshToken, grant_type: "refresh_token" }) }),
  );
  return t.access_token;
}

/** YouTube rejects "<" and ">" in titles and descriptions; titles are capped at 100 characters. */
const clean = (s: string) => s.replace(/[<>]/g, "");
const cap = (s: string, n: number) => ([...s].length > n ? `${[...s].slice(0, n - 1).join("")}…` : s);

/**
 * Uploads the video and returns its id. With `publishAt` (ISO) it goes up private and YouTube
 * publishes it at that time; otherwise it is public right away.
 */
export async function youtubeUpload(env: Env, accessToken: string, video: ArrayBuffer, meta: { title: string; description: string; publishAt?: string }) {
  const body = {
    snippet: { title: cap(clean(meta.title).trim() || "Nirnoy MCQ", 100), description: cap(clean(meta.description), 5000), categoryId: "27", defaultLanguage: "bn" },
    status: { privacyStatus: meta.publishAt ? "private" : "public", ...(meta.publishAt ? { publishAt: meta.publishAt } : {}), selfDeclaredMadeForKids: false },
  };
  const start = await fetch(`${API(env)}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": "video/mp4",
      "X-Upload-Content-Length": String(video.byteLength),
    },
    body: JSON.stringify(body),
  });
  if (!start.ok) await call(start);
  const location = start.headers.get("location");
  if (!location) throw new Error("YouTube did not return an upload URL.");
  const done = await call<{ id: string; status?: { privacyStatus?: string; uploadStatus?: string } }>(
    await fetch(location, { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: video }),
  );
  return done.id;
}

/** Custom thumbnail; needs a verified channel, and Shorts may still show a video frame. Best effort. */
export async function youtubeThumbnail(env: Env, accessToken: string, videoId: string, jpg: ArrayBuffer) {
  const res = await fetch(`${API(env)}/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "image/jpeg" },
    body: jpg,
  });
  if (!res.ok) console.error(`youtube thumbnail not set for ${videoId}: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 500)}`);
  return res.ok;
}

/** Processing / privacy state of an uploaded video. */
export async function youtubeVideoStatus(env: Env, accessToken: string, videoId: string) {
  const r = await call<{ items?: { status?: { uploadStatus?: string; privacyStatus?: string; failureReason?: string; rejectionReason?: string; publishAt?: string } }[] }>(
    await fetch(`${API(env)}/youtube/v3/videos?part=status&id=${encodeURIComponent(videoId)}`, { headers: { Authorization: `Bearer ${accessToken}` } }),
  );
  const s = r.items?.[0]?.status;
  if (!s) return { state: "gone" as const };
  if (s.uploadStatus === "failed" || s.uploadStatus === "rejected" || s.uploadStatus === "deleted")
    return { state: "error" as const, error: `YouTube: ${s.failureReason ?? s.rejectionReason ?? s.uploadStatus}` };
  return { state: s.uploadStatus === "processed" ? ("processed" as const) : ("working" as const), privacy: s.privacyStatus ?? "", publishAt: s.publishAt ?? null };
}

export async function youtubeDelete(env: Env, accessToken: string, videoId: string) {
  const res = await fetch(`${API(env)}/youtube/v3/videos?id=${encodeURIComponent(videoId)}`, { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok && res.status !== 404) await call(res);
}

export const youtubeUrl = (videoId: string) => `https://www.youtube.com/shorts/${videoId}`;
