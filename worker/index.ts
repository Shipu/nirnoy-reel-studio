import { createRemoteJWKSet, jwtVerify } from "jose";

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  NIRNOY_API_BASE: string;
  REEL_API_KEY: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ALLOW_NO_ACCESS?: string;
  /** Which TTS backend the studio uses: "elevenlabs" (default) or "azure". */
  TTS_PROVIDER?: string;
  /** ElevenLabs API key (secret) and model; Bangla needs eleven_v3. */
  ELEVENLABS_API_KEY?: string;
  ELEVENLABS_MODEL?: string;
  /** Azure Speech resource key (secret) and region, e.g. "southeastasia". */
  AZURE_SPEECH_KEY?: string;
  AZURE_SPEECH_REGION?: string;
  /** Test-only overrides of the provider URLs. */
  AZURE_TTS_ENDPOINT?: string;
  ELEVENLABS_ENDPOINT?: string;
}

type Voice = { id: string; label: string };

/** Bangla voices from the ElevenLabs Voice Library (add them to "My Voices" in ElevenLabs first). */
const ELEVENLABS_VOICES: Voice[] = [
  { id: "fCckJmWQH9jeEmbAYpxv", label: "Syed (পুরুষ, শান্ত, বর্ণনা)" },
  { id: "VizHiwkPO7hXc967v4tE", label: "Rakib (পুরুষ, গভীর, আত্মবিশ্বাসী)" },
  { id: "vvOYlSJHf8lTWIG4tDNP", label: "Rayhan (পুরুষ, প্রাণবন্ত)" },
  { id: "nUarI71Lei0IFt1ybDm1", label: "Swati S (মহিলা, reel/creator)" },
];

const AZURE_VOICES: Voice[] = [
  { id: "bn-BD-NabanitaNeural", label: "নবনীতা (মহিলা, বাংলাদেশ)" },
  { id: "bn-BD-PradeepNeural", label: "প্রদীপ (পুরুষ, বাংলাদেশ)" },
];

const provider = (env: Env) => (env.TTS_PROVIDER === "azure" ? "azure" : "elevenlabs");
const voicesFor = (env: Env) => (provider(env) === "azure" ? AZURE_VOICES : ELEVENLABS_VOICES);

const escapeXml = (t: string) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

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

async function synthesizeAzure(env: Env, text: string, voice: string, rate: number): Promise<Response> {
  if (!env.AZURE_SPEECH_KEY || (!env.AZURE_SPEECH_REGION && !env.AZURE_TTS_ENDPOINT)) {
    return json({ message: "Azure voice is not configured: set AZURE_SPEECH_KEY (secret) and AZURE_SPEECH_REGION." }, 500);
  }
  const ssml =
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${voice.slice(0, 5)}">` +
    `<voice name="${voice}"><prosody rate="${rate}%">${escapeXml(text)}</prosody></voice></speak>`;
  const endpoint = env.AZURE_TTS_ENDPOINT ?? `https://${env.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`;
  return fetch(endpoint, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": env.AZURE_SPEECH_KEY,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-96kbitrate-mono-mp3",
      "User-Agent": "nirnoy-reel-studio",
    },
    body: ssml,
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

  const p = provider(env);
  const key = await sha256(JSON.stringify([p, voice, p === "elevenlabs" ? env.ELEVENLABS_MODEL || "eleven_v3" : "", rate, text]));
  const cacheKey = new Request(`https://tts-cache.nirnoy.internal/${key}.mp3`);
  const hit = await caches.default.match(cacheKey);
  if (hit) return hit;

  const res = p === "azure" ? await synthesizeAzure(env, text, voice, rate) : await synthesizeElevenLabs(env, text, voice, rate);
  if (!res.ok) {
    if (res.headers.get("content-type")?.includes("application/json") && res.status === 500) return res;
    const detail = (await res.text()).slice(0, 300);
    const hint = res.status === 404 ? " The voice may not be in your ElevenLabs \"My Voices\" yet." : "";
    return json({ message: `${p} TTS failed (${res.status}).${hint} ${detail}` }, 502);
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

async function upstream(env: Env, path: string, params?: URLSearchParams): Promise<Response> {
  if (!env.REEL_API_KEY) return json({ message: "REEL_API_KEY secret is not set on the Worker." }, 500);

  const base = env.NIRNOY_API_BASE.replace(/\/$/, "");
  const url = `${base}/api/v1/reel${path}${params && [...params].length ? `?${params}` : ""}`;
  const res = await fetch(url, { headers: { "X-Reel-Key": env.REEL_API_KEY, Accept: "application/json" } });
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
    if (request.method === "GET" && url.pathname === "/api/tts/voices") return json({ provider: provider(env), voices: voicesFor(env) });

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
