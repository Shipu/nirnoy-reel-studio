import type { Env } from "./index";

/**
 * Facebook Pages connector: OAuth (long-lived user token → never-expiring Page tokens) and
 * Page Reels publishing via the Graph API's video_reels upload (start → binary upload → finish).
 */

const GRAPH_VERSION = (env: Env) => env.META_GRAPH_VERSION || "v23.0";
export const graph = (env: Env) => `${env.META_GRAPH_BASE || "https://graph.facebook.com"}/${GRAPH_VERSION(env)}`;
export const rupload = (env: Env) => `${env.META_RUPLOAD_BASE || "https://rupload.facebook.com"}/video-upload/${GRAPH_VERSION(env)}`;

export const FACEBOOK_SCOPES = ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "business_management"];

export type FacebookPage = { id: string; name: string; picture: string | null; token: string };

export async function call<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number } };
  if (!res.ok || data.error) throw new Error(`Facebook: ${data.error?.message ?? `HTTP ${res.status}`}`);
  return data;
}

export function facebookAuthUrl(env: Env, redirectUri: string, state: string, scopes: string[] = FACEBOOK_SCOPES) {
  if (!env.META_APP_ID) throw new Error("META_APP_ID secret is not set on the Worker.");
  const u = new URL(`${env.META_DIALOG_BASE || "https://www.facebook.com"}/${GRAPH_VERSION(env)}/dialog/oauth`);
  u.searchParams.set("client_id", env.META_APP_ID);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", scopes.join(","));
  return u.toString();
}

/** OAuth code → long-lived user token (a Page token obtained from it does not expire). */
export async function metaUserToken(env: Env, code: string, redirectUri: string): Promise<string> {
  if (!env.META_APP_ID || !env.META_APP_SECRET) throw new Error("META_APP_ID / META_APP_SECRET secrets are not set on the Worker.");
  const base = graph(env);
  const short = await call<{ access_token: string }>(
    await fetch(`${base}/oauth/access_token?${new URLSearchParams({ client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, redirect_uri: redirectUri, code })}`),
  );
  const long = await call<{ access_token: string }>(
    await fetch(
      `${base}/oauth/access_token?${new URLSearchParams({ grant_type: "fb_exchange_token", client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, fb_exchange_token: short.access_token })}`,
    ),
  );
  return long.access_token;
}

export type MetaPageRow = {
  id: string;
  name: string;
  access_token: string;
  picture?: { data?: { url?: string } };
  instagram_business_account?: { id: string; username?: string; profile_picture_url?: string };
};

/** Every Page the user manages (paged), with the requested fields. */
export async function metaPages(env: Env, userToken: string, fields: string): Promise<MetaPageRow[]> {
  const rows: MetaPageRow[] = [];
  let next: string | undefined = `${graph(env)}/me/accounts?${new URLSearchParams({ fields, limit: "100", access_token: userToken })}`;
  while (next) {
    const page: { data: MetaPageRow[]; paging?: { next?: string } } = await call(await fetch(next));
    rows.push(...page.data);
    next = page.paging?.next;
  }
  return rows;
}

/** The Pages you manage, each with its own Page token. */
export async function facebookPages(env: Env, userToken: string): Promise<FacebookPage[]> {
  const rows = await metaPages(env, userToken, "id,name,access_token,picture{url}");
  return rows.map((p) => ({ id: p.id, name: p.name, picture: p.picture?.data?.url ?? null, token: p.access_token }));
}

/** Starts a Reel upload session; returns the video id. */
export async function facebookReelStart(env: Env, pageId: string, token: string) {
  const r = await call<{ video_id: string }>(
    await fetch(`${graph(env)}/${pageId}/video_reels`, { method: "POST", body: new URLSearchParams({ upload_phase: "start", access_token: token }) }),
  );
  return r.video_id;
}

export async function facebookReelUpload(env: Env, videoId: string, token: string, video: ArrayBuffer) {
  await call(
    await fetch(`${rupload(env)}/${videoId}`, {
      method: "POST",
      headers: { Authorization: `OAuth ${token}`, offset: "0", file_size: String(video.byteLength), "Content-Type": "application/octet-stream" },
      body: video,
    }),
  );
}

export async function facebookReelFinish(env: Env, pageId: string, videoId: string, token: string, caption: string) {
  await call(
    await fetch(`${graph(env)}/${pageId}/video_reels`, {
      method: "POST",
      body: new URLSearchParams({ upload_phase: "finish", video_id: videoId, video_state: "PUBLISHED", description: caption, access_token: token }),
    }),
  );
}

/** "ready" once Facebook has processed and published it, "error" with a reason, else still working. */
export async function facebookReelStatus(env: Env, videoId: string, token: string) {
  const r = await call<{ status?: { video_status?: string; processing_phase?: { status?: string; error?: { message?: string } }; publishing_phase?: { status?: string } }; permalink_url?: string }>(
    await fetch(`${graph(env)}/${videoId}?${new URLSearchParams({ fields: "status,permalink_url", access_token: token })}`),
  );
  const s = r.status;
  const url = r.permalink_url ? (r.permalink_url.startsWith("http") ? r.permalink_url : `https://www.facebook.com${r.permalink_url}`) : null;
  if (s?.video_status === "error" || s?.processing_phase?.status === "error") return { state: "error" as const, error: s?.processing_phase?.error?.message ?? "Facebook could not process the video.", url };
  if (s?.publishing_phase?.status === "complete" || s?.video_status === "published") return { state: "ready" as const, url };
  return { state: "working" as const, url };
}

/** Best-effort custom cover; Facebook may ignore it for Reels. */
export async function facebookThumbnail(env: Env, videoId: string, token: string, jpg: ArrayBuffer) {
  const form = new FormData();
  form.append("access_token", token);
  form.append("is_preferred", "true");
  form.append("source", new Blob([jpg], { type: "image/jpeg" }), "thumb.jpg");
  await fetch(`${graph(env)}/${videoId}/thumbnails`, { method: "POST", body: form }).catch(() => undefined);
}
