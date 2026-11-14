import { channelToken } from "./channels";
import { graph } from "./facebook";
import type { Env } from "./index";
import { youtubeAccessToken } from "./youtube";

/**
 * Analytics: the numbers of every published post, fetched from each platform and kept in D1
 * (post_stats, one row per fetch, so history builds up).
 *   GET  /api/analytics           every published post with its latest numbers
 *   POST /api/analytics/refresh   fetch now (the stalest posts first, within the request budget)
 * A cron trigger runs the same refresh a few times a day.
 *
 * Facebook: video_insights (plays, reach, avg watch time) + likes/comments counts — needs read_insights.
 * Instagram: media insights (views, reach, likes, comments, shares, saves, avg watch time) —
 * needs instagram_manage_insights. YouTube: videos.list statistics (views, likes, comments).
 */

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

type Stats = {
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  avg_watch_ms: number | null;
  raw: unknown;
  /** Why some numbers are missing (e.g. the insights permission), shown on the row. */
  note?: string;
};

/** Stored as stats_error for posts the platform no longer has; those are not fetched again. */
const GONE = "Platform-এ post-টি আর নেই (মুছে ফেলা হয়েছে?)।";
const isGone = (m: string) => /does not exist|nonexisting node|Unsupported get request/i.test(m) && !/field/i.test(m);
const isPermission = (m: string) => /permission|\(#10\)|\(#200\)|nonexisting field \(video_insights\)/i.test(m);
const PERMISSION_NOTE = "শুধু likes/comments — বাকি সংখ্যার জন্য Meta app-এ insights permission দিয়ে channel আবার connect করুন।";
type Post = { id: number; channel_id: number; platform: string; remote_id: string };

/**
 * One Worker invocation may make only 50 outgoing requests on the free plan; refreshes stay under
 * this many and leave the rest for the next run.
 */
const BUDGET = 40;

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const raw = await res.text();
  let data = {} as T & { error?: { message?: string; code?: number } | string };
  try {
    data = JSON.parse(raw);
  } catch {
    // not JSON
  }
  if (!res.ok || (data as { error?: unknown }).error) {
    const e = (data as { error?: { message?: string } | string }).error;
    throw new Error(typeof e === "string" ? e : (e?.message ?? `HTTP ${res.status}: ${raw.slice(0, 200)}`));
  }
  return data;
}

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Math.round(Number(v));
  return null;
};
const sumObject = (v: unknown): number | null =>
  v && typeof v === "object" ? Object.values(v as Record<string, unknown>).reduce<number>((a, x) => a + (num(x) ?? 0), 0) : num(v);

type Insight = { name: string; values?: { value?: unknown }[]; total_value?: { value?: unknown } };
const insightMap = (rows: Insight[] | undefined) => {
  const m = new Map<string, unknown>();
  for (const r of rows ?? []) m.set(r.name, r.total_value?.value ?? r.values?.[r.values.length - 1]?.value);
  return m;
};

/** Facebook Reel: 2 requests (insights, then likes/comments counts). */
async function facebookStats(env: Env, videoId: string, token: string): Promise<Stats> {
  const base = graph(env);
  let ins: { data?: Insight[] } = {};
  let note: string | undefined;
  try {
    ins = await getJson<{ data?: Insight[] }>(`${base}/${videoId}/video_insights?${new URLSearchParams({ access_token: token })}`);
  } catch (e) {
    // No read_insights yet: still get likes / comments below.
    if (!isPermission((e as Error).message)) throw e;
    note = PERMISSION_NOTE;
  }
  const m = insightMap(ins.data);
  const counts = await getJson<{ likes?: { summary?: { total_count?: number } }; comments?: { summary?: { total_count?: number } } }>(
    `${base}/${videoId}?${new URLSearchParams({ fields: "likes.limit(0).summary(true),comments.limit(0).summary(true)", access_token: token })}`,
  );
  const social = m.get("post_video_social_actions") as Record<string, unknown> | undefined;
  return {
    views: num(m.get("fb_reels_total_plays")) ?? num(m.get("blue_reels_play_count")) ?? num(m.get("post_video_views")),
    reach: num(m.get("post_impressions_unique")),
    likes: num(counts.likes?.summary?.total_count) ?? sumObject(m.get("post_video_likes_by_reaction_type")),
    comments: num(counts.comments?.summary?.total_count) ?? num(social?.comment),
    shares: num(social?.share),
    saves: null,
    avg_watch_ms: num(m.get("post_video_avg_time_watched")),
    raw: { insights: ins.data?.map((r) => ({ name: r.name, value: r.total_value?.value ?? r.values?.[r.values.length - 1]?.value })), counts },
    note,
  };
}

const IG_METRICS = ["views", "reach", "likes", "comments", "shares", "saved", "ig_reels_avg_watch_time"];
const IG_BASIC = ["reach", "likes", "comments", "shares", "saved"];

/** Instagram Reel: 1 request (up to 3 with the fallbacks). */
async function instagramStats(env: Env, mediaId: string, token: string): Promise<Stats> {
  const ask = (metrics: string[]) => getJson<{ data?: Insight[] }>(`${graph(env)}/${mediaId}/insights?${new URLSearchParams({ metric: metrics.join(","), access_token: token })}`);
  let r: { data?: Insight[] };
  try {
    try {
      r = await ask(IG_METRICS);
    } catch (e) {
      if (isPermission((e as Error).message) || isGone((e as Error).message)) throw e;
      // Metric names change between Graph versions; fall back to the long-standing ones.
      console.error(`instagram insights ${mediaId}: ${(e as Error).message} — retrying with basic metrics`);
      r = await ask(IG_BASIC);
    }
  } catch (e) {
    // No instagram_manage_insights yet: likes / comments come with the basic permission.
    if (!isPermission((e as Error).message)) throw e;
    const c = await getJson<{ like_count?: number; comments_count?: number }>(
      `${graph(env)}/${mediaId}?${new URLSearchParams({ fields: "like_count,comments_count", access_token: token })}`,
    );
    return { views: null, reach: null, likes: num(c.like_count), comments: num(c.comments_count), shares: null, saves: null, avg_watch_ms: null, raw: c, note: PERMISSION_NOTE };
  }
  const m = insightMap(r.data);
  return {
    views: num(m.get("views")),
    reach: num(m.get("reach")),
    likes: num(m.get("likes")),
    comments: num(m.get("comments")),
    shares: num(m.get("shares")),
    saves: num(m.get("saved")),
    avg_watch_ms: num(m.get("ig_reels_avg_watch_time")),
    raw: Object.fromEntries(m),
  };
}

/** YouTube: 1 token request per channel + 1 request per 50 videos. */
const ytBase = (env: Env) => env.YOUTUBE_API_BASE || "https://www.googleapis.com";

/** YouTube's video id from a link: /shorts/ID, watch?v=ID, youtu.be/ID. */
const youtubeId = (url: string) => url.match(/(?:shorts\/|[?&]v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/)?.[1] ?? null;

/**
 * Brings the channel's own uploads (made outside the studio) into analytics as published posts:
 * linked to the reel whose "YouTube link" matches, else to no reel (reel_id 0) with the video title.
 * Costs 1 request + 1 per 50 uploads (up to 200 newest).
 */
async function importYoutubeUploads(env: Env, channel: { id: number; account_id: string }, token: string): Promise<{ added: number; requests: number }> {
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  const ch = await getJson<{ items?: { contentDetails?: { relatedPlaylists?: { uploads?: string } } }[] }>(
    `${ytBase(env)}/youtube/v3/channels?part=contentDetails&id=${encodeURIComponent(channel.account_id)}`,
    auth,
  );
  let requests = 1;
  const uploads = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) return { added: 0, requests };

  const known = new Set(
    (await env.DB.prepare("SELECT remote_id FROM publishes WHERE platform = 'youtube' AND remote_id IS NOT NULL").all<{ remote_id: string }>()).results.map((r) => r.remote_id),
  );
  const videos: { id: string; title: string; at: string }[] = [];
  let page = "";
  for (let i = 0; i < 4; i++) {
    const r = await getJson<{ nextPageToken?: string; items?: { snippet?: { title?: string; publishedAt?: string }; contentDetails?: { videoId?: string; videoPublishedAt?: string } }[] }>(
      `${ytBase(env)}/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=${encodeURIComponent(uploads)}${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`,
      auth,
    );
    requests++;
    for (const it of r.items ?? []) {
      const id = it.contentDetails?.videoId;
      if (id) videos.push({ id, title: it.snippet?.title ?? id, at: it.contentDetails?.videoPublishedAt ?? it.snippet?.publishedAt ?? "" });
    }
    // Newest first: once a page reaches videos we already have, the rest are older and known too.
    if (!r.nextPageToken || (r.items ?? []).some((it) => known.has(it.contentDetails?.videoId ?? ""))) break;
    page = r.nextPageToken;
  }

  const reelOf = new Map<string, number>();
  for (const r of (await env.DB.prepare("SELECT id, youtube_url FROM reels WHERE youtube_url IS NOT NULL").all<{ id: number; youtube_url: string }>()).results) {
    const vid = youtubeId(r.youtube_url);
    if (vid) reelOf.set(vid, r.id);
  }

  let added = 0;
  for (const v of videos) {
    if (known.has(v.id)) continue;
    // "2026-11-10T08:00:00Z" → D1's "2026-11-10 08:00:00"; unknown dates fall back to now.
    const at = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v.at) ? v.at.slice(0, 19).replace("T", " ") : null;
    await env.DB.prepare(
      `INSERT INTO publishes (reel_id, channel_id, account_id, platform, caption, title, status, remote_id, url, created_by, created_at, updated_at)
       VALUES (?, ?, ?, 'youtube', '', ?, 'published', ?, ?, 'youtube-import', COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))`,
    )
      .bind(reelOf.get(v.id) ?? 0, channel.id, channel.account_id, v.title.slice(0, 200), v.id, `https://www.youtube.com/shorts/${v.id}`, at, at)
      .run();
    added++;
  }
  return { added, requests };
}

type MetaItem = { id: string; title: string; at: string | null; url: string | null; thumb: string | null };

/**
 * Brings Reels posted on the Facebook Page / Instagram account outside the studio into analytics
 * (reel_id 0, titled by the first line of the caption), and refreshes every listed post's cover link
 * (platform CDN links expire). Pages through newest first until it reaches known posts.
 */
async function importMeta(env: Env, channel: { id: number; platform: string; account_id: string }, token: string): Promise<{ added: number; requests: number }> {
  const fb = channel.platform === "facebook";
  const known = new Set(
    (await env.DB.prepare("SELECT remote_id FROM publishes WHERE platform = ? AND remote_id IS NOT NULL").bind(channel.platform).all<{ remote_id: string }>()).results.map(
      (r) => r.remote_id,
    ),
  );
  const fields = fb ? "id,description,created_time,permalink_url,picture" : "id,caption,media_type,media_product_type,timestamp,permalink,thumbnail_url";
  let next: string | undefined = `${graph(env)}/${channel.account_id}/${fb ? "video_reels" : "media"}?${new URLSearchParams({ fields, limit: "50", access_token: token })}`;
  const items: MetaItem[] = [];
  let requests = 0;
  for (let i = 0; i < 4 && next; i++) {
    const r: { data?: Record<string, string>[]; paging?: { next?: string } } = await getJson(next);
    requests++;
    for (const d of r.data ?? []) {
      // Instagram: Reels only (the studio makes reels; photos have other metrics).
      if (!fb && d.media_product_type !== "REELS") continue;
      const text = (fb ? d.description : d.caption) ?? "";
      const link = fb ? d.permalink_url : d.permalink;
      items.push({
        id: d.id,
        title: text.split("\n").find((l) => l.trim())?.trim().slice(0, 120) ?? "",
        at: fb ? d.created_time : d.timestamp,
        url: link ? (link.startsWith("http") ? link : `https://www.facebook.com${link}`) : null,
        thumb: (fb ? d.picture : d.thumbnail_url) ?? null,
      });
    }
    if ((r.data ?? []).some((d) => known.has(d.id))) break;
    next = r.paging?.next;
  }

  let added = 0;
  for (const it of items) {
    if (known.has(it.id)) {
      if (it.thumb) await env.DB.prepare("UPDATE publishes SET thumb_url = ? WHERE platform = ? AND remote_id = ?").bind(it.thumb, channel.platform, it.id).run();
      continue;
    }
    // "2026-11-10T08:00:00+0000" → "2026-11-10 08:00:00" (UTC)
    const at = it.at && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(it.at) ? new Date(it.at).toISOString().slice(0, 19).replace("T", " ") : null;
    await env.DB.prepare(
      `INSERT INTO publishes (reel_id, channel_id, account_id, platform, caption, title, status, remote_id, url, thumb_url, created_by, created_at, updated_at)
       VALUES (0, ?, ?, ?, '', ?, 'published', ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))`,
    )
      .bind(channel.id, channel.account_id, channel.platform, it.title || null, it.id, it.url, it.thumb, `${channel.platform}-import`, at, at)
      .run();
    known.add(it.id);
    added++;
  }
  return { added, requests };
}

async function youtubeStats(env: Env, token: string, videoIds: string[]): Promise<Map<string, Stats>> {
  const out = new Map<string, Stats>();
  const base = ytBase(env);
  for (let i = 0; i < videoIds.length; i += 50) {
    const ids = videoIds.slice(i, i + 50);
    const r = await getJson<{ items?: { id: string; statistics?: Record<string, string> }[] }>(
      `${base}/youtube/v3/videos?part=statistics&id=${ids.map(encodeURIComponent).join(",")}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    for (const v of r.items ?? []) {
      const s = v.statistics ?? {};
      out.set(v.id, { views: num(s.viewCount), reach: null, likes: num(s.likeCount), comments: num(s.commentCount), shares: null, saves: null, avg_watch_ms: null, raw: s });
    }
  }
  return out;
}

async function save(env: Env, publishId: number, s: Stats) {
  await env.DB.prepare(
    "INSERT INTO post_stats (publish_id, views, reach, likes, comments, shares, saves, avg_watch_ms, raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(publishId, s.views, s.reach, s.likes, s.comments, s.shares, s.saves, s.avg_watch_ms, JSON.stringify(s.raw).slice(0, 4000))
    .run();
  await env.DB.prepare("UPDATE publishes SET stats_at = datetime('now'), stats_error = ? WHERE id = ?").bind(s.note ?? null, publishId).run();
}

const fail = (env: Env, publishId: number, message: string) =>
  env.DB.prepare("UPDATE publishes SET stats_at = datetime('now'), stats_error = ? WHERE id = ?").bind(message.slice(0, 300), publishId).run();

/**
 * Fetches numbers for the posts that were updated longest ago (never-fetched first), within the
 * request budget. Returns how many were updated and how many are still waiting for a turn.
 */
export async function refreshStats(env: Env, minAgeMinutes = 0): Promise<{ updated: number; failed: number; remaining: number; imported: number }> {
  let budget = BUDGET;
  let imported = 0;

  // YouTube channels: one access token each (reused below), and pick up uploads made outside the studio.
  const ytTokens = new Map<number, string>();
  const ytChannels = (await env.DB.prepare("SELECT id, account_id FROM channels WHERE platform = 'youtube'").all<{ id: number; account_id: string }>()).results;
  for (const c of ytChannels) {
    if (budget < 8) break;
    try {
      const ch = await channelToken(env, c.id);
      ytTokens.set(c.id, await youtubeAccessToken(env, ch.token));
      budget -= 1;
      const r = await importYoutubeUploads(env, c, ytTokens.get(c.id)!);
      budget -= r.requests;
      imported += r.added;
    } catch (e) {
      budget -= 2;
      console.error(`youtube import for channel ${c.id}: ${(e as Error).message}`);
    }
  }

  // Facebook Pages and Instagram accounts: Reels posted outside the studio.
  const metaChannels = (await env.DB.prepare("SELECT id, platform, account_id FROM channels WHERE platform IN ('facebook', 'instagram')").all<{
    id: number;
    platform: string;
    account_id: string;
  }>()).results;
  for (const c of metaChannels) {
    if (budget < 10) break;
    try {
      const ch = await channelToken(env, c.id);
      const r = await importMeta(env, c, ch.token);
      budget -= r.requests;
      imported += r.added;
    } catch (e) {
      budget -= 1;
      console.error(`${c.platform} import for channel ${c.id}: ${(e as Error).message}`);
    }
  }

  const { results } = await env.DB.prepare(
    `SELECT id, channel_id, platform, remote_id FROM publishes
     WHERE status = 'published' AND remote_id IS NOT NULL
       AND (stats_at IS NULL OR stats_at < datetime('now', ?))
       AND channel_id IN (SELECT id FROM channels)
       AND (stats_error IS NULL OR stats_error != ?)
     ORDER BY stats_at IS NOT NULL, stats_at, id`,
  )
    .bind(`-${minAgeMinutes} minutes`, GONE)
    .all<Post>();

  let updated = 0;
  let failed = 0;
  const done = new Set<number>();

  // YouTube first, grouped by channel: cheap (one token + one request per 50 videos).
  const yt = new Map<number, Post[]>();
  for (const p of results) if (p.platform === "youtube") yt.set(p.channel_id, [...(yt.get(p.channel_id) ?? []), p]);
  for (const [channelId, posts] of yt) {
    const cost = (ytTokens.has(channelId) ? 0 : 1) + Math.ceil(posts.length / 50);
    if (budget < cost) break;
    budget -= cost;
    try {
      let token = ytTokens.get(channelId);
      if (!token) token = await youtubeAccessToken(env, (await channelToken(env, channelId)).token);
      const stats = await youtubeStats(env, token, posts.map((p) => p.remote_id));
      for (const p of posts) {
        const s = stats.get(p.remote_id);
        if (s) {
          await save(env, p.id, s);
          updated++;
        } else {
          await fail(env, p.id, "YouTube-এ video-টি পাওয়া যায়নি (মুছে ফেলা বা private?)।");
          failed++;
        }
        done.add(p.id);
      }
    } catch (e) {
      for (const p of posts) {
        await fail(env, p.id, (e as Error).message);
        done.add(p.id);
      }
      failed += posts.length;
    }
  }

  for (const p of results) {
    if (done.has(p.id) || p.platform === "youtube") continue;
    const cost = p.platform === "facebook" ? 2 : 3; // Instagram: 1, up to 3 with the fallbacks
    if (budget < cost) break;
    budget -= cost;
    try {
      const ch = await channelToken(env, p.channel_id);
      const s = p.platform === "facebook" ? await facebookStats(env, p.remote_id, ch.token) : await instagramStats(env, p.remote_id, ch.token);
      await save(env, p.id, s);
      updated++;
    } catch (e) {
      const m = (e as Error).message;
      console.error(`stats for publish ${p.id} (${p.platform}): ${m}`);
      await fail(env, p.id, isGone(m) ? GONE : m);
      failed++;
    }
    done.add(p.id);
  }

  return { updated, failed, remaining: results.length - done.size, imported };
}

export async function analyticsApi(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, "");

  if (path === "/api/analytics" && request.method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT p.id, p.reel_id, p.platform, p.url, p.created_at, p.updated_at AS published_at, p.stats_at, p.stats_error,
              c.name AS channel_name, COALESCE(r.title, p.title) AS reel_title, r.question_id, r.rendered_at, p.remote_id, p.thumb_url,
              s.views, s.reach, s.likes, s.comments, s.shares, s.saves, s.avg_watch_ms
       FROM publishes p
       LEFT JOIN channels c ON c.id = p.channel_id
       LEFT JOIN reels r ON r.id = p.reel_id
       LEFT JOIN post_stats s ON s.id = (SELECT id FROM post_stats WHERE publish_id = p.id ORDER BY fetched_at DESC, id DESC LIMIT 1)
       WHERE p.status = 'published' AND (p.stats_error IS NULL OR p.stats_error != ?)
       ORDER BY p.updated_at DESC
       LIMIT 1000`,
    )
      // Posts removed on the platform are left out.
      .bind(GONE)
      .all();
    return json({ data: results });
  }

  if (path === "/api/analytics/refresh" && request.method === "POST") {
    // Button: skip posts fetched in the last 5 minutes so repeated clicks move on to the rest.
    return json(await refreshStats(env, 5));
  }

  return json({ message: "Not found." }, 404);
}
