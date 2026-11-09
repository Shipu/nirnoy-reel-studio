import { type FacebookPage, call, graph, metaPages } from "./facebook";
import type { Env } from "./index";

/**
 * Instagram (professional accounts linked to a Facebook Page), through the same Meta app and
 * Facebook Login as the Facebook connector. Publishing uses the Content Publishing API with a
 * resumable upload, so the video is sent straight from R2 (no public URL needed):
 *   create REELS container (upload_type=resumable) → upload bytes → wait FINISHED → media_publish.
 * The Page token is used for the Instagram account's calls.
 */

export const INSTAGRAM_SCOPES = ["pages_show_list", "pages_read_engagement", "business_management", "instagram_basic", "instagram_content_publish"];

/** Instagram accounts linked to your Pages; the token is the linked Page's token. */
export async function instagramAccounts(env: Env, userToken: string): Promise<FacebookPage[]> {
  const rows = await metaPages(env, userToken, "id,name,access_token,instagram_business_account{id,username,profile_picture_url}");
  return rows
    .filter((p) => p.instagram_business_account?.id)
    .map((p) => {
      const ig = p.instagram_business_account!;
      return { id: ig.id, name: ig.username ? `@${ig.username}` : `${p.name} (Instagram)`, picture: ig.profile_picture_url ?? null, token: p.access_token };
    });
}

/**
 * Creates a Reels container for a resumable upload; returns its id and the upload URL.
 * Instagram takes a cover image only by public URL, so the studio passes a short-lived presigned
 * R2 link to the thumbnail when R2 credentials are set, or else a video moment (thumb_offset).
 */
export async function instagramContainer(env: Env, igUserId: string, token: string, caption: string, cover: { url?: string | null; offsetMs?: number | null }) {
  const body = new URLSearchParams({ media_type: "REELS", upload_type: "resumable", caption, share_to_feed: "true", access_token: token });
  // An exact cover image (presigned R2 link to the studio thumbnail) wins; else a video moment.
  if (cover.url) body.set("cover_url", cover.url);
  else if (cover.offsetMs != null) body.set("thumb_offset", String(cover.offsetMs));
  const r = await call<{ id: string; uri?: string }>(await fetch(`${graph(env)}/${igUserId}/media`, { method: "POST", body }));
  const base = env.META_RUPLOAD_BASE || "https://rupload.facebook.com";
  const version = env.META_GRAPH_VERSION || "v23.0";
  return { id: r.id, uri: r.uri ?? `${base}/ig-api-upload/${version}/${r.id}` };
}

export async function instagramUpload(uri: string, token: string, video: ArrayBuffer) {
  await call(
    await fetch(uri, {
      method: "POST",
      headers: { Authorization: `OAuth ${token}`, offset: "0", file_size: String(video.byteLength) },
      body: video,
    }),
  );
}

/** FINISHED when Instagram has processed the upload, ERROR with a reason, else still working. */
export async function instagramContainerStatus(env: Env, containerId: string, token: string) {
  const r = await call<{ status_code?: string; status?: string }>(
    await fetch(`${graph(env)}/${containerId}?${new URLSearchParams({ fields: "status_code,status", access_token: token })}`),
  );
  if (r.status_code === "FINISHED") return { state: "ready" as const };
  if (r.status_code === "ERROR" || r.status_code === "EXPIRED") return { state: "error" as const, error: `Instagram: ${r.status ?? r.status_code}` };
  return { state: "working" as const };
}

export async function instagramPublish(env: Env, igUserId: string, containerId: string, token: string) {
  const r = await call<{ id: string }>(
    await fetch(`${graph(env)}/${igUserId}/media_publish`, { method: "POST", body: new URLSearchParams({ creation_id: containerId, access_token: token }) }),
  );
  const media = await call<{ permalink?: string }>(await fetch(`${graph(env)}/${r.id}?${new URLSearchParams({ fields: "permalink", access_token: token })}`)).catch(() => ({ permalink: undefined }));
  return { mediaId: r.id, url: media.permalink ?? null };
}
