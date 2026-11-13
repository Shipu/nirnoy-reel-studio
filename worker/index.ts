import { createRemoteJWKSet, jwtVerify } from "jose";
import { channelsApi, oauthCallback } from "./channels";
import { reviewExplanation } from "./gemini";
import { publishApi } from "./publish";

export { PublishWorkflow } from "./publish";

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  /** Voice clips, rendered MP4s and thumbnails, under reels/<id>/. */
  MEDIA: R2Bucket;
  /** Posts a reel to a channel (worker/publish.ts). */
  PUBLISH: Workflow<{ publishId: number }>;
  /**
   * R2 S3-API credentials (read-only, this bucket) used to presign short-lived links to media,
   * e.g. the Instagram cover image. Without them Instagram picks a video moment as the cover.
   */
  R2_ACCOUNT_ID?: string;
  R2_BUCKET_NAME?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  /**
   * Google Gemini keys (secrets) and model for the explanation check: the free key is used first and
   * the paid key once the free quota runs out. GEMINI_ENDPOINT is test-only.
   */
  GEMINI_API_KEY?: string;
  GEMINI_API_KEY_PAID?: string;
  GEMINI_MODEL?: string;
  GEMINI_ENDPOINT?: string;
  /** 32 random bytes, base64: encrypts platform tokens at rest. */
  TOKEN_KEY?: string;
  /** Meta (Facebook / Instagram) app credentials, secrets. */
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  META_GRAPH_VERSION?: string;
  /** Test-only overrides of the Meta endpoints. */
  META_GRAPH_BASE?: string;
  META_RUPLOAD_BASE?: string;
  META_DIALOG_BASE?: string;
  /** Google OAuth client (secrets) for the YouTube connector. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Test-only overrides of the Google / YouTube endpoints. */
  GOOGLE_AUTH_BASE?: string;
  GOOGLE_TOKEN_URL?: string;
  YOUTUBE_API_BASE?: string;
  NIRNOY_API_BASE: string;
  REEL_API_KEY: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ALLOW_NO_ACCESS?: string;
  /** ElevenLabs API key (secret) and model (default eleven_v4; older multilingual models have no Bangla). */
  ELEVENLABS_API_KEY?: string;
  ELEVENLABS_MODEL?: string;
  /**
   * Optional JSON list of voices shown in the studio, e.g.
   * [{"id":"<voice id>","label":"আমার কণ্ঠ"}]. Overrides the default list.
   */
  ELEVENLABS_VOICES?: string;
  /** Test-only override of the ElevenLabs API base URL. */
  ELEVENLABS_ENDPOINT?: string;
}

type Voice = { id: string; label: string };

/** Bangla voices from the ElevenLabs Voice Library (add them to "My Voices" in ElevenLabs first). */
/**
 * Default voices. The Voice Library ones need a paid ElevenLabs plan for API use
 * ("Free users cannot use library voices via the API"); the premade ones work on
 * the free plan but speak Bangla with a foreign accent.
 */
const DEFAULT_VOICES: Voice[] = [
  { id: "fCckJmWQH9jeEmbAYpxv", label: "Syed (পুরুষ, শান্ত, বর্ণনা)" },
  { id: "VizHiwkPO7hXc967v4tE", label: "Rakib (পুরুষ, গভীর, আত্মবিশ্বাসী)" },
  { id: "vvOYlSJHf8lTWIG4tDNP", label: "Rayhan (পুরুষ, প্রাণবন্ত)" },
  { id: "nUarI71Lei0IFt1ybDm1", label: "Swati S (মহিলা, reel/creator)" },
  { id: "onwK4e9ZLuTAKqWW03F9", label: "Daniel (premade · free plan-এ চলে · বিদেশি উচ্চারণ)" },
  { id: "nPczCjzI2devNBz1zQrb", label: "Brian (premade · free plan-এ চলে · বিদেশি উচ্চারণ)" },
];

/**
 * Your own ElevenLabs voices (cloned, designed or added to "My Voices", e.g. "Shipu"), listed first.
 * Premade voices are skipped; cached for 10 minutes per isolate. Empty if the key can't list voices.
 */
let accountVoices: { at: number; voices: Voice[] } | null = null;
async function myVoices(env: Env): Promise<Voice[]> {
  if (!env.ELEVENLABS_API_KEY) return [];
  if (accountVoices && Date.now() - accountVoices.at < 10 * 60_000) return accountVoices.voices;
  try {
    const base = env.ELEVENLABS_ENDPOINT ?? "https://api.elevenlabs.io";
    const res = await fetch(`${base}/v1/voices`, { headers: { "xi-api-key": env.ELEVENLABS_API_KEY } });
    if (!res.ok) return [];
    const data = (await res.json()) as { voices?: { voice_id: string; name: string; category?: string }[] };
    const voices = (data.voices ?? [])
      .filter((v) => v.voice_id && v.category !== "premade")
      .map((v) => ({ id: v.voice_id, label: `${v.name} (আমার voice)` }));
    accountVoices = { at: Date.now(), voices };
    return voices;
  } catch {
    return [];
  }
}

/** Studio voice list: your own voices first, then ELEVENLABS_VOICES or the defaults (no duplicates). */
async function voiceList(env: Env): Promise<Voice[]> {
  const mine = await myVoices(env);
  const ids = new Set(mine.map((v) => v.id));
  return [...mine, ...voicesFor(env).filter((v) => !ids.has(v.id))];
}

/** Voices for the studio: ELEVENLABS_VOICES (JSON) when set and valid, else the defaults. */
function voicesFor(env: Env): Voice[] {
  if (!env.ELEVENLABS_VOICES) return DEFAULT_VOICES;
  try {
    const list = JSON.parse(env.ELEVENLABS_VOICES) as unknown;
    if (Array.isArray(list)) {
      const voices = list.filter(
        (v): v is Voice => typeof v?.id === "string" && v.id.length > 0 && typeof v?.label === "string",
      );
      if (voices.length) return voices;
    }
  } catch {
    // fall through to the defaults
  }
  return DEFAULT_VOICES;
}

const sha256 = async (text: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

/** Speed choice from the studio (-15 slow … +5 fast) → an Eleven v3 delivery tag. */
const paceTag = (rate: number) => (rate <= -10 ? "[slowly] " : "");

/** ElevenLabs model for narration; override with the ELEVENLABS_MODEL variable. */
const ttsModel = (env: Env) => env.ELEVENLABS_MODEL || "eleven_v4";

async function synthesizeElevenLabs(env: Env, text: string, voice: string, rate: number): Promise<Response> {
  if (!env.ELEVENLABS_API_KEY) return json({ message: "ELEVENLABS_API_KEY secret is not set on the Worker." }, 500);
  const base = env.ELEVENLABS_ENDPOINT ?? "https://api.elevenlabs.io";
  return fetch(`${base}/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text: paceTag(rate) + text, model_id: ttsModel(env) }),
  });
}

/**
 * Bangla narration. Same provider + voice + model + speed + text is served
 * from the edge cache, so re-opening a question spends no credits.
 */
async function tts(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { text?: unknown; voice?: unknown; rate?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const voices = await voiceList(env);
  const voice = typeof body?.voice === "string" && voices.some((v) => v.id === body.voice) ? body.voice : voices[0].id;
  const rate = Math.max(-30, Math.min(30, Math.round(Number(body?.rate ?? 0)) || 0));
  if (!text || text.length > 1500) return json({ message: "text must be 1–1500 characters." }, 422);

  const key = await sha256(JSON.stringify(["elevenlabs", voice, ttsModel(env), rate, text]));
  const cacheKey = new Request(`https://tts-cache.nirnoy.internal/${key}.mp3`);
  const hit = await caches.default.match(cacheKey);
  if (hit) return hit;

  const res = await synthesizeElevenLabs(env, text, voice, rate);
  if (!res.ok) {
    if (res.headers.get("content-type")?.includes("application/json") && res.status === 500) return res;
    const detail = (await res.text()).slice(0, 300);
    const hint =
      res.status === 404
        ? " The voice may not be in your ElevenLabs \"My Voices\" yet."
        : res.status === 402
          ? " Voice Library voices need a paid ElevenLabs plan; on the free plan pick a premade voice or your own designed voice."
          : "";
    return json({ message: `ElevenLabs TTS failed (${res.status}).${hint} ${detail}` }, 502);
  }

  const out = new Response(await res.arrayBuffer(), {
    headers: { "content-type": "audio/mpeg", "cache-control": "public, max-age=2592000" },
  });
  ctx.waitUntil(caches.default.put(cacheKey, out.clone()));
  return out;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/**
 * Verifies the Cloudflare Access JWT, returning the signed-in email.
 * Fails closed: if Access isn't configured, nothing under /api is served
 * (except locally, where .dev.vars sets ALLOW_NO_ACCESS=true).
 */
async function authorize(request: Request, env: Env): Promise<string | null> {
  if (env.ALLOW_NO_ACCESS === "true") return "local-dev";

  const team = env.ACCESS_TEAM_DOMAIN?.replace(/\/$/, "");
  const aud = env.ACCESS_AUD;
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!team || !aud || team.includes("REPLACE") || aud.includes("REPLACE") || !token) return null;

  let jwks = jwksCache.get(team);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${team}/cdn-cgi/access/certs`));
    jwksCache.set(team, jwks);
  }

  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: team, audience: aud });
    return typeof payload.email === "string" ? payload.email : "unknown";
  } catch {
    return null;
  }
}

async function upstream(env: Env, path: string, params?: URLSearchParams, init?: { method: string; body: string }): Promise<Response> {
  if (!env.REEL_API_KEY) return json({ message: "REEL_API_KEY secret is not set on the Worker." }, 500);

  const base = env.NIRNOY_API_BASE.replace(/\/$/, "");
  const url = `${base}/api/v1/reel${path}${params && [...params].length ? `?${params}` : ""}`;
  const res = await fetch(url, {
    method: init?.method ?? "GET",
    body: init?.body,
    headers: {
      "X-Reel-Key": env.REEL_API_KEY,
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const body = await res.text();

  return new Response(body, {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") ?? "application/json", "cache-control": "no-store" },
  });
}

// ---- Reels: drafts you can come back to, with their media in R2 ----

type ReelData = { props?: { body?: string }; voice?: Record<string, { file?: string } | null>; scripts?: unknown };
type ReelRow = {
  id: number;
  question_id: number;
  status: string;
  title: string | null;
  data: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string | null;
  rendered_at: string | null;
  youtube_url: string | null;
};

const STATUSES = ["draft", "rendered", "published"];
const LIST_COLUMNS = "id, question_id, status, title, created_by, updated_by, created_at, updated_at, rendered_at, youtube_url";
const prefix = (id: number) => `reels/${id}/`;
const voiceFiles = (data: ReelData | null) =>
  new Set(Object.values(data?.voice ?? {}).flatMap((v) => (v?.file ? [v.file] : [])));
const parseData = (raw: string | null): ReelData | null => {
  try {
    return raw ? (JSON.parse(raw) as ReelData) : null;
  } catch {
    return null;
  }
};
const titleOf = (data: ReelData | null) => (data?.props?.body ?? "").replace(/\s+/g, " ").trim().slice(0, 120) || null;
/** Only plain file names under a reel's folder, never paths. */
const SAFE_FILE = /^[a-z0-9][a-z0-9._-]{0,80}$/;
const EXT: Record<string, string> = {
  "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a",
  "audio/webm": "webm", "audio/ogg": "ogg", "video/mp4": "mp4", "image/jpeg": "jpg", "image/png": "png",
};

async function deleteFolder(env: Env, id: number) {
  let cursor: string | undefined;
  do {
    const list = await env.MEDIA.list({ prefix: prefix(id), cursor });
    if (list.objects.length) await env.MEDIA.delete(list.objects.map((o) => o.key));
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
}

async function reels(request: Request, env: Env, url: URL, user: string): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, "");
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);

  if (path === "/api/reels" && request.method === "GET") {
    const where: string[] = [];
    const binds: unknown[] = [];
    const status = url.searchParams.get("status");
    if (status && STATUSES.includes(status)) {
      where.push("status = ?");
      binds.push(status);
    }
    const q = Number(url.searchParams.get("question_id"));
    if (Number.isInteger(q) && q > 0) {
      where.push("question_id = ?");
      binds.push(q);
    }
    const { results } = await env.DB.prepare(
      `SELECT ${LIST_COLUMNS} FROM reels ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY COALESCE(updated_at, created_at) DESC, id DESC LIMIT 200`,
    )
      .bind(...binds)
      .all<ReelRow>();
    return json({ data: results });
  }

  if (path === "/api/reels" && request.method === "POST") {
    const body = (await request.json().catch(() => null)) as { question_id?: unknown; data?: ReelData } | null;
    const questionId = Number(body?.question_id);
    if (!Number.isInteger(questionId) || questionId <= 0) return json({ message: "question_id is required." }, 422);
    const data = body?.data ?? null;
    const row = await env.DB.prepare(
      `INSERT INTO reels (question_id, status, title, data, created_by, updated_by, rendered_by, created_at, updated_at)
       VALUES (?, 'draft', ?, ?, ?, ?, ?, ?, ?) RETURNING ${LIST_COLUMNS}`,
    )
      .bind(questionId, titleOf(data), data ? JSON.stringify(data) : null, user, user, user, now, now)
      .first<ReelRow>();
    return json({ data: row }, 201);
  }

  const m = path.match(/^\/api\/reels\/(\d+)(?:\/(duplicate|media)(?:\/([^/]+))?)?$/);
  if (!m) return json({ message: "Not found." }, 404);
  const id = Number(m[1]);
  const existing = await env.DB.prepare("SELECT * FROM reels WHERE id = ?").bind(id).first<ReelRow>();
  if (!existing) return json({ message: "Reel not found." }, 404);

  if (!m[2]) {
    if (request.method === "GET") return json({ data: { ...existing, data: parseData(existing.data) } });

    if (request.method === "PATCH") {
      const body = (await request.json().catch(() => null)) as { data?: ReelData; status?: string; youtube_url?: string | null; question_id?: unknown } | null;
      if (!body) return json({ message: "Invalid JSON." }, 422);
      const sets: string[] = ["updated_at = ?", "updated_by = ?"];
      const binds: unknown[] = [now, user];
      if (body.data) {
        sets.push("data = ?", "title = ?");
        binds.push(JSON.stringify(body.data), titleOf(body.data));
        // Voice clips that are no longer used by the draft are removed from R2.
        const keep = voiceFiles(body.data);
        const gone = [...voiceFiles(parseData(existing.data))].filter((f) => !keep.has(f));
        if (gone.length) await env.MEDIA.delete(gone.map((f) => prefix(id) + f));
      }
      if (body.status !== undefined) {
        if (!STATUSES.includes(body.status)) return json({ message: "Unknown status." }, 422);
        sets.push("status = ?");
        binds.push(body.status);
        if (body.status === "rendered") {
          sets.push("rendered_at = ?");
          binds.push(now);
        }
      }
      if (body.question_id !== undefined) {
        const q = Number(body.question_id);
        if (!Number.isInteger(q) || q <= 0) return json({ message: "question_id must be a positive integer." }, 422);
        sets.push("question_id = ?");
        binds.push(q);
      }
      if (body.youtube_url !== undefined) {
        sets.push("youtube_url = ?");
        binds.push(body.youtube_url || null);
      }
      const row = await env.DB.prepare(`UPDATE reels SET ${sets.join(", ")} WHERE id = ? RETURNING ${LIST_COLUMNS}`)
        .bind(...binds, id)
        .first<ReelRow>();
      return json({ data: row });
    }

    if (request.method === "DELETE") {
      await deleteFolder(env, id);
      await env.DB.prepare("DELETE FROM reels WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }
  }

  // A new draft with the same settings and voice clips (the render is not copied).
  if (m[2] === "duplicate" && request.method === "POST") {
    const data = parseData(existing.data);
    const row = await env.DB.prepare(
      `INSERT INTO reels (question_id, status, title, data, created_by, updated_by, rendered_by, created_at, updated_at)
       VALUES (?, 'draft', ?, ?, ?, ?, ?, ?, ?) RETURNING ${LIST_COLUMNS}`,
    )
      .bind(existing.question_id, existing.title, existing.data, user, user, user, now, now)
      .first<ReelRow>();
    if (row) {
      for (const file of voiceFiles(data)) {
        const obj = await env.MEDIA.get(prefix(id) + file);
        if (obj) await env.MEDIA.put(prefix(row.id) + file, await obj.arrayBuffer(), { httpMetadata: obj.httpMetadata });
      }
    }
    return json({ data: row }, 201);
  }

  if (m[2] === "media") {
    const file = m[3];
    // Upload: PUT /media/video.mp4 (fixed name) or PUT /media?name=voice-cta (a fresh versioned name is returned).
    if (request.method === "PUT") {
      const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      const ext = EXT[type];
      if (!ext) return json({ message: `Unsupported file type: ${type || "none"}.` }, 415);
      let name = file;
      if (!name) {
        const base = (url.searchParams.get("name") ?? "").toLowerCase();
        if (!/^voice-[a-z]+$/.test(base)) return json({ message: "name must look like voice-<segment>." }, 422);
        name = `${base}-${Date.now().toString(36)}.${ext}`;
      }
      if (!SAFE_FILE.test(name)) return json({ message: "Bad file name." }, 422);
      if (!request.body) return json({ message: "Empty body." }, 422);
      await env.MEDIA.put(prefix(id) + name, request.body, { httpMetadata: { contentType: type } });
      return json({ file: name }, 201);
    }

    if (!file || !SAFE_FILE.test(file)) return json({ message: "Bad file name." }, 422);

    if (request.method === "GET") {
      const obj = await env.MEDIA.get(prefix(id) + file, { range: request.headers, onlyIf: request.headers });
      if (!obj) return json({ message: "File not found." }, 404);
      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      headers.set("etag", obj.httpEtag);
      headers.set("accept-ranges", "bytes");
      headers.set("cache-control", "private, max-age=3600");
      if (url.searchParams.get("download")) headers.set("content-disposition", `attachment; filename="nirnoy-reel-${id}-${file}"`);
      if (!("body" in obj)) return new Response(null, { status: 304, headers });
      const range = obj.range as { offset?: number; length?: number } | undefined;
      if (range && request.headers.has("range")) {
        const start = range.offset ?? 0;
        const end = start + (range.length ?? obj.size - start) - 1;
        headers.set("content-range", `bytes ${start}-${end}/${obj.size}`);
        headers.set("content-length", String(end - start + 1));
        return new Response(obj.body, { status: 206, headers });
      }
      headers.set("content-length", String(obj.size));
      return new Response(obj.body, { headers });
    }

    if (request.method === "DELETE") {
      await env.MEDIA.delete(prefix(id) + file);
      return json({ ok: true });
    }
  }

  return json({ message: "Not found." }, 404);
}

const FORWARDED = ["exam_name", "year", "topic_id", "include_subtopics", "require_explanation"] as const;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    const isOauth = url.pathname.startsWith("/oauth/");
    if (!url.pathname.startsWith("/api/") && !isOauth) return env.ASSETS.fetch(request);

    const user = await authorize(request, env);
    if (!user) return json({ message: "Unauthorized. Sign in through Cloudflare Access." }, 401);

    if (request.method === "GET" && url.pathname === "/api/me") return json({ email: user });

    if (isOauth) return oauthCallback(request, env, url);
    if (url.pathname.startsWith("/api/channels")) return channelsApi(request, env, url, user);
    if (/^\/api\/reels\/\d+\/publish\/?$/.test(url.pathname) || url.pathname.startsWith("/api/publishes")) return publishApi(request, env, url, user);

    if (request.method === "POST" && url.pathname === "/api/tts") return tts(request, env, ctx);
    if (request.method === "POST" && url.pathname === "/api/ai/explanation") return reviewExplanation(request, env);
    if (request.method === "GET" && url.pathname === "/api/tts/voices") return json({ provider: "elevenlabs", voices: await voiceList(env) });

    if (request.method === "GET" && url.pathname === "/api/questions/random") {
      const params = new URLSearchParams();
      for (const key of FORWARDED) {
        const value = url.searchParams.get(key);
        if (value) params.set(key, value);
      }
      if (url.searchParams.get("skip_used") !== "0") {
        const { results } = await env.DB.prepare(
          "SELECT DISTINCT question_id FROM reels WHERE status != 'draft' ORDER BY question_id LIMIT 1000",
        ).all<{
          question_id: number;
        }>();
        if (results.length) params.set("exclude_ids", results.map((r) => r.question_id).join(","));
      }
      return upstream(env, "/questions/random", params);
    }

    const match = url.pathname.match(/^\/api\/questions\/(\d+)$/);
    if (request.method === "GET" && match) return upstream(env, `/questions/${match[1]}`);
    if (request.method === "PATCH" && match) {
      // Only wording and the correct option can be edited here; topics and status never pass through.
      const raw = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (!raw) return json({ message: "Invalid JSON." }, 422);
      const edit: Record<string, unknown> = {};
      for (const key of ["body", "explanation", "options", "correct_option_id"]) if (key in raw) edit[key] = raw[key];
      return upstream(env, `/questions/${match[1]}`, undefined, { method: "PATCH", body: JSON.stringify(edit) });
    }

    if (url.pathname.startsWith("/api/reels")) return reels(request, env, url, user);

    return json({ message: "Not found." }, 404);
  },
} satisfies ExportedHandler<Env>;
