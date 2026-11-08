import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { channelToken } from "./channels";
import { facebookReelFinish, facebookReelStart, facebookReelStatus, facebookReelUpload, facebookThumbnail } from "./facebook";
import type { Env } from "./index";

/**
 * Posting a reel to a channel. One Workflow instance per publishes row: wait until scheduled_at,
 * upload the MP4 from R2, wait for the platform to process it, record the link.
 * Steps are checkpointed, so a retry never re-uploads a finished step. If it is unclear whether a
 * post went out, it is marked failed rather than posted again (no duplicate posts).
 *
 *   POST   /api/reels/:id/publish     { targets: [{ channel_id, caption }], scheduled_at? (ISO UTC) }
 *   GET    /api/publishes?reel_id=    rows for the list / editor
 *   POST   /api/publishes/:id/retry   failed → try again
 *   DELETE /api/publishes/:id         cancel a scheduled post
 */

type Params = { publishId: number };
type PublishRow = { id: number; reel_id: number; channel_id: number; platform: string; caption: string; scheduled_at: string | null; status: string; remote_id: string | null };

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const COLUMNS = "p.id, p.reel_id, p.channel_id, p.platform, p.caption, p.scheduled_at, p.status, p.remote_id, p.url, p.error, p.created_by, p.created_at, p.updated_at, c.name AS channel_name, c.picture AS channel_picture";

const setStatus = (env: Env, id: number, fields: Record<string, string | null>) => {
  const keys = Object.keys(fields);
  return env.DB.prepare(`UPDATE publishes SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`)
    .bind(...keys.map((k) => fields[k]), id)
    .run();
};

export class PublishWorkflow extends WorkflowEntrypoint<Env, Params> {
  async run(event: Readonly<WorkflowEvent<Params>>, step: WorkflowStep) {
    const id = event.payload.publishId;
    const row = await step.do("load", async () => {
      const r = await this.env.DB.prepare("SELECT * FROM publishes WHERE id = ?").bind(id).first<PublishRow>();
      if (!r) throw new Error("Publish row not found.");
      return r;
    });
    if (row.scheduled_at && Date.parse(`${row.scheduled_at.replace(" ", "T")}Z`) > Date.now()) {
      await step.sleepUntil("wait for the scheduled time", new Date(`${row.scheduled_at.replace(" ", "T")}Z`));
    }
    // Canceled (or channel removed) while waiting.
    const current = await step.do("check still wanted", async () => {
      const r = await this.env.DB.prepare("SELECT status FROM publishes WHERE id = ?").bind(id).first<{ status: string }>();
      return r?.status ?? "canceled";
    });
    if (current !== "scheduled") return { skipped: current };

    try {
      await step.do("mark publishing", async () => {
        await setStatus(this.env, id, { status: "publishing", error: null });
        return true;
      });

      if (row.platform !== "facebook") throw new Error(`No connector for ${row.platform} yet.`);

      // Upload + finish run as one step, so a half-sent upload is never "finished" later.
      // No automatic retries here: a retry after a successful "finish" would post the reel twice.
      // A failure lands as "failed" and you retry from the studio.
      const videoId = await step.do("upload to Facebook", { retries: { limit: 0, delay: "1 second" }, timeout: "10 minutes" }, async () => {
        const ch = await channelToken(this.env, row.channel_id);
        const video = await this.env.MEDIA.get(`reels/${row.reel_id}/video.mp4`);
        if (!video) throw new Error("Reel has no rendered video — render it first.");
        const vid = await facebookReelStart(this.env, ch.account_id, ch.token);
        await facebookReelUpload(this.env, vid, ch.token, await video.arrayBuffer());
        await facebookReelFinish(this.env, ch.account_id, vid, ch.token, row.caption);
        await setStatus(this.env, id, { remote_id: vid });
        const thumb = await this.env.MEDIA.get(`reels/${row.reel_id}/thumb.jpg`);
        if (thumb) await facebookThumbnail(this.env, vid, ch.token, await thumb.arrayBuffer());
        return vid;
      });

      // Facebook processes the video for a while; check every 20 s for up to ~20 minutes.
      let url: string | null = null;
      for (let i = 0; i < 60; i++) {
        const s = await step.do(`check processing ${i}`, { retries: { limit: 3, delay: "10 seconds" } }, async () => {
          const ch = await channelToken(this.env, row.channel_id);
          return facebookReelStatus(this.env, videoId, ch.token);
        });
        url = s.url ?? url;
        if (s.state === "error") throw new Error(s.error);
        if (s.state === "ready") break;
        if (i === 59) throw new Error("Facebook is still processing after 20 minutes — check the Page; it may appear later.");
        await step.sleep(`wait ${i}`, "20 seconds");
      }

      await step.do("mark published", async () => {
        await setStatus(this.env, id, { status: "published", url, error: null });
        await this.env.DB.prepare("UPDATE reels SET status = 'published', updated_at = datetime('now') WHERE id = ?").bind(row.reel_id).run();
        return true;
      });
      return { published: url };
    } catch (e) {
      await step.do("mark failed", async () => {
        await setStatus(this.env, id, { status: "failed", error: (e as Error).message.slice(0, 500) });
        return true;
      });
      return { failed: (e as Error).message };
    }
  }
}

async function start(env: Env, id: number) {
  await env.PUBLISH.create({ id: `publish-${id}-${Date.now()}`, params: { publishId: id } });
}

export async function publishApi(request: Request, env: Env, url: URL, user: string): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, "");

  const reel = path.match(/^\/api\/reels\/(\d+)\/publish$/);
  if (reel && request.method === "POST") {
    const reelId = Number(reel[1]);
    const body = (await request.json().catch(() => null)) as { targets?: { channel_id?: unknown; caption?: unknown }[]; scheduled_at?: unknown } | null;
    const targets = (body?.targets ?? []).filter((t) => Number.isInteger(Number(t.channel_id)) && typeof t.caption === "string");
    if (!targets.length) return json({ message: "কোনো channel বাছা হয়নি।" }, 422);
    if (!(await env.MEDIA.head(`reels/${reelId}/video.mp4`))) return json({ message: "আগে MP4 বানান — reel-এ কোনো video জমা নেই।" }, 422);
    let scheduled: string | null = null;
    if (body?.scheduled_at) {
      const t = Date.parse(String(body.scheduled_at));
      if (Number.isNaN(t)) return json({ message: "সময় বোঝা যায়নি।" }, 422);
      if (t > Date.now() + 60_000) scheduled = new Date(t).toISOString().replace("T", " ").slice(0, 19);
    }
    const created = [];
    for (const t of targets) {
      const ch = await env.DB.prepare("SELECT id, platform FROM channels WHERE id = ?").bind(Number(t.channel_id)).first<{ id: number; platform: string }>();
      if (!ch) continue;
      const row = await env.DB.prepare(
        "INSERT INTO publishes (reel_id, channel_id, platform, caption, scheduled_at, created_by) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
      )
        .bind(reelId, ch.id, ch.platform, String(t.caption), scheduled, user)
        .first<{ id: number }>();
      if (row) {
        await start(env, row.id);
        created.push(row.id);
      }
    }
    return json({ created }, 201);
  }

  if (path === "/api/publishes" && request.method === "GET") {
    const reelId = Number(url.searchParams.get("reel_id"));
    const where = Number.isInteger(reelId) && reelId > 0 ? "WHERE p.reel_id = ?" : "";
    const stmt = env.DB.prepare(`SELECT ${COLUMNS} FROM publishes p LEFT JOIN channels c ON c.id = p.channel_id ${where} ORDER BY p.id DESC LIMIT 500`);
    const { results } = await (where ? stmt.bind(reelId) : stmt).all();
    return json({ data: results });
  }

  const one = path.match(/^\/api\/publishes\/(\d+)(\/retry)?$/);
  if (one) {
    const id = Number(one[1]);
    const row = await env.DB.prepare("SELECT * FROM publishes WHERE id = ?").bind(id).first<PublishRow>();
    if (!row) return json({ message: "Not found." }, 404);
    if (one[2] && request.method === "POST") {
      if (row.status !== "failed") return json({ message: "শুধু ব্যর্থ post আবার চেষ্টা করা যায়।" }, 422);
      await setStatus(env, id, { status: "scheduled", error: null, scheduled_at: null });
      await start(env, id);
      return json({ ok: true });
    }
    if (!one[2] && request.method === "DELETE") {
      if (row.status !== "scheduled") return json({ message: "শুধু নির্ধারিত (এখনো যায়নি এমন) post বাতিল করা যায়।" }, 422);
      await setStatus(env, id, { status: "canceled" });
      return json({ ok: true });
    }
  }
  return json({ message: "Not found." }, 404);
}
