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

type Stats = { views: number | null; reach: number | null; likes: number | null; comments: number | null; shares: number | null; saves: number | null; avg_watch_ms: number | null; raw: unknown };
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

/** Facebook Reel: 2 requests. */
async function facebookStats(env: Env, videoId: string, token: string): Promise<Stats> {
  const base = graph(env);
  const ins = await getJson<{ data?: Insight[] }>(`${base}/${videoId}/video_insights?${new URLSearchParams({ access_token: token })}`);
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
  };
}

const IG_METRICS = ["views", "reach", "likes", "comments", "shares", "saved", "ig_reels_avg_watch_time"];
const IG_BASIC = ["reach", "likes", "comments", "shares", "saved"];

/** Instagram Reel: 1 request (2 if Meta rejects a metric name). */
async function instagramStats(env: Env, mediaId: string, token: string): Promise<Stats> {
  const ask = (metrics: string[]) => getJson<{ data?: Insight[] }>(`${graph(env)}/${mediaId}/insights?${new URLSearchParams({ metric: metrics.join(","), access_token: token })}`);
  let r: { data?: Insight[] };
  try {
    r = await ask(IG_METRICS);
  } catch (e) {
    // Metric names change between Graph versions; fall back to the long-standing ones.
    console.error(`instagram insights ${mediaId}: ${(e as Error).message} — retrying with basic metrics`);
    r = await ask(IG_BASIC);
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
async function youtubeStats(env: Env, refreshToken: string, videoIds: string[]): Promise<Map<string, Stats>> {
  const token = await youtubeAccessToken(env, refreshToken);
  const out = new Map<string, Stats>();
  const base = env.YOUTUBE_API_BASE || "https://www.googleapis.com";
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
  await env.DB.prepare("UPDATE publishes SET stats_at = datetime('now'), stats_error = NULL WHERE id = ?").bind(publishId).run();
}

const fail = (env: Env, publishId: number, message: string) =>
  env.DB.prepare("UPDATE publishes SET stats_at = datetime('now'), stats_error = ? WHERE id = ?").bind(message.slice(0, 300), publishId).run();

/**
 * Fetches numbers for the posts that were updated longest ago (never-fetched first), within the
 * request budget. Returns how many were updated and how many are still waiting for a turn.
 */
export async function refreshStats(env: Env, minAgeMinutes = 0): Promise<{ updated: number; failed: number; remaining: number }> {
  const { results } = await env.DB.prepare(
    `SELECT id, channel_id, platform, remote_id FROM publishes
     WHERE status = 'published' AND remote_id IS NOT NULL
       AND (stats_at IS NULL OR stats_at < datetime('now', ?))
       AND channel_id IN (SELECT id FROM channels)
     ORDER BY stats_at IS NOT NULL, stats_at, id`,
  )
    .bind(`-${minAgeMinutes} minutes`)
    .all<Post>();

  let budget = BUDGET;
  let updated = 0;
  let failed = 0;
  const done = new Set<number>();

  // YouTube first, grouped by channel: cheap (one token + one request per 50 videos).
  const yt = new Map<number, Post[]>();
  for (const p of results) if (p.platform === "youtube") yt.set(p.channel_id, [...(yt.get(p.channel_id) ?? []), p]);
  for (const [channelId, posts] of yt) {
    const cost = 1 + Math.ceil(posts.length / 50);
    if (budget < cost) break;
    budget -= cost;
    try {
      const ch = await channelToken(env, channelId);
      const stats = await youtubeStats(env, ch.token, posts.map((p) => p.remote_id));
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
    const cost = 2; // Facebook: 2; Instagram: 1, or 2 with the metric fallback
    if (budget < cost) break;
    budget -= cost;
    try {
      const ch = await channelToken(env, p.channel_id);
      const s = p.platform === "facebook" ? await facebookStats(env, p.remote_id, ch.token) : await instagramStats(env, p.remote_id, ch.token);
      await save(env, p.id, s);
      updated++;
    } catch (e) {
      console.error(`stats for publish ${p.id} (${p.platform}): ${(e as Error).message}`);
      await fail(env, p.id, (e as Error).message);
      failed++;
    }
    done.add(p.id);
  }

  return { updated, failed, remaining: results.length - done.size };
}

export async function analyticsApi(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, "");

  if (path === "/api/analytics" && request.method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT p.id, p.reel_id, p.platform, p.url, p.created_at, p.updated_at AS published_at, p.stats_at, p.stats_error,
              c.name AS channel_name, r.title AS reel_title, r.question_id,
              s.views, s.reach, s.likes, s.comments, s.shares, s.saves, s.avg_watch_ms
       FROM publishes p
       LEFT JOIN channels c ON c.id = p.channel_id
       LEFT JOIN reels r ON r.id = p.reel_id
       LEFT JOIN post_stats s ON s.id = (SELECT id FROM post_stats WHERE publish_id = p.id ORDER BY fetched_at DESC, id DESC LIMIT 1)
       WHERE p.status = 'published'
       ORDER BY p.updated_at DESC
       LIMIT 1000`,
    ).all();
    return json({ data: results });
  }

  if (path === "/api/analytics/refresh" && request.method === "POST") {
    // Button: skip posts fetched in the last 5 minutes so repeated clicks move on to the rest.
    return json(await refreshStats(env, 5));
  }

  return json({ message: "Not found." }, 404);
}
