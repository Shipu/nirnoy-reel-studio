import { createRemoteJWKSet, jwtVerify } from "jose";

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  NIRNOY_API_BASE: string;
  REEL_API_KEY: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ALLOW_NO_ACCESS?: string;
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
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    const user = await authorize(request, env);
    if (!user) return json({ message: "Unauthorized. Sign in through Cloudflare Access." }, 401);

    if (request.method === "GET" && url.pathname === "/api/me") return json({ email: user });

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
