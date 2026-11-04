import { createRemoteJWKSet, jwtVerify } from "jose";

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  NIRNOY_API_BASE: string;
  REEL_API_KEY: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ALLOW_NO_ACCESS?: string;
  /** ElevenLabs API key (secret) and model; Bangla needs eleven_v3. */
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

async function synthesizeElevenLabs(env: Env, text: string, voice: string, rate: number): Promise<Response> {
  if (!env.ELEVENLABS_API_KEY) return json({ message: "ELEVENLABS_API_KEY secret is not set on the Worker." }, 500);
  const base = env.ELEVENLABS_ENDPOINT ?? "https://api.elevenlabs.io";
  return fetch(`${base}/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text: paceTag(rate) + text, model_id: env.ELEVENLABS_MODEL || "eleven_v3" }),
  });
}

/**
 * Bangla narration. Same provider + voice + model + speed + text is served
 * from the edge cache, so re-opening a question spends no credits.
 */
async function tts(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { text?: unknown; voice?: unknown; rate?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const voices = voicesFor(env);
  const voice = typeof body?.voice === "string" && voices.some((v) => v.id === body.voice) ? body.voice : voices[0].id;
  const rate = Math.max(-30, Math.min(30, Math.round(Number(body?.rate ?? 0)) || 0));
  if (!text || text.length > 1500) return json({ message: "text must be 1–1500 characters." }, 422);

  const key = await sha256(JSON.stringify(["elevenlabs", voice, env.ELEVENLABS_MODEL || "eleven_v3", rate, text]));
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

const FORWARDED = ["exam_name", "year", "topic_id", "include_subtopics", "require_explanation"] as const;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    const user = await authorize(request, env);
    if (!user) return json({ message: "Unauthorized. Sign in through Cloudflare Access." }, 401);

    if (request.method === "GET" && url.pathname === "/api/me") return json({ email: user });

    if (request.method === "POST" && url.pathname === "/api/tts") return tts(request, env, ctx);
    if (request.method === "GET" && url.pathname === "/api/tts/voices") return json({ provider: "elevenlabs", voices: voicesFor(env) });

    if (request.method === "GET" && url.pathname === "/api/questions/random") {
      const params = new URLSearchParams();
      for (const key of FORWARDED) {
        const value = url.searchParams.get(key);
        if (value) params.set(key, value);
      }
      if (url.searchParams.get("skip_used") !== "0") {
        const { results } = await env.DB.prepare("SELECT DISTINCT question_id FROM reels ORDER BY question_id LIMIT 1000").all<{
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

    if (url.pathname === "/api/reels" && request.method === "GET") {
      const { results } = await env.DB.prepare(
        "SELECT id, question_id, rendered_by, created_at FROM reels ORDER BY id DESC LIMIT 50",
      ).all();
      return json({ data: results });
    }

    if (url.pathname === "/api/reels" && request.method === "POST") {
      const body = (await request.json().catch(() => null)) as { question_id?: unknown } | null;
      const questionId = Number(body?.question_id);
      if (!Number.isInteger(questionId) || questionId <= 0) return json({ message: "question_id is required." }, 422);
      await env.DB.prepare("INSERT INTO reels (question_id, rendered_by) VALUES (?, ?)").bind(questionId, user).run();
      return json({ ok: true }, 201);
    }

    return json({ message: "Not found." }, 404);
  },
} satisfies ExportedHandler<Env>;
