import { decrypt, encrypt, randomToken } from "./crypto";
import { facebookAuthUrl, facebookPages } from "./facebook";
import type { Env } from "./index";

/**
 * Channels: connect a platform (OAuth), tick which accounts to add, list / remove them.
 *   GET  /api/channels                       list (never returns tokens)
 *   GET  /api/channels/:platform/connect     → platform login
 *   GET  /oauth/callback/:platform           ← platform login, then /channels?pick=<state>
 *   GET  /api/channels/pending/:state        accounts found, to choose from
 *   POST /api/channels/pending/:state        { account_ids } → add them
 *   DELETE /api/channels/:id
 */

export const PLATFORMS = ["facebook"] as const;
type Platform = (typeof PLATFORMS)[number];

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const callbackUrl = (url: URL, platform: string) => `${url.origin}/oauth/callback/${platform}`;
type PendingAccount = { id: string; name: string; picture: string | null; token_enc: string };

export async function channelsApi(request: Request, env: Env, url: URL, user: string): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, "");

  if (path === "/api/channels" && request.method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT id, platform, account_id, name, picture, status, error, connected_by, created_at, updated_at FROM channels ORDER BY platform, name",
    ).all();
    return json({ data: results, platforms: PLATFORMS });
  }

  const connect = path.match(/^\/api\/channels\/([a-z]+)\/connect$/);
  if (connect && request.method === "GET") {
    const platform = connect[1] as Platform;
    if (!PLATFORMS.includes(platform)) return json({ message: "Unknown platform." }, 404);
    const state = randomToken();
    await env.DB.prepare("DELETE FROM oauth_pending WHERE created_at < datetime('now', '-1 hour')").run();
    await env.DB.prepare("INSERT INTO oauth_pending (state, platform, created_by) VALUES (?, ?, ?)").bind(state, platform, user).run();
    try {
      return Response.redirect(facebookAuthUrl(env, callbackUrl(url, platform), state), 302);
    } catch (e) {
      return json({ message: (e as Error).message }, 500);
    }
  }

  const pending = path.match(/^\/api\/channels\/pending\/([A-Za-z0-9_-]+)$/);
  if (pending) {
    const row = await env.DB.prepare("SELECT * FROM oauth_pending WHERE state = ? AND created_at >= datetime('now', '-1 hour')")
      .bind(pending[1])
      .first<{ state: string; platform: string; data: string | null }>();
    if (!row?.data) return json({ message: "এই connect-এর মেয়াদ শেষ — আবার Connect করুন।" }, 404);
    const accounts = JSON.parse(row.data) as PendingAccount[];

    if (request.method === "GET") {
      const { results } = await env.DB.prepare("SELECT account_id FROM channels WHERE platform = ?").bind(row.platform).all<{ account_id: string }>();
      const have = new Set(results.map((r) => r.account_id));
      return json({ platform: row.platform, data: accounts.map((a) => ({ id: a.id, name: a.name, picture: a.picture, connected: have.has(a.id) })) });
    }

    if (request.method === "POST") {
      const body = (await request.json().catch(() => null)) as { account_ids?: unknown } | null;
      const ids = new Set(Array.isArray(body?.account_ids) ? body.account_ids.map(String) : []);
      const chosen = accounts.filter((a) => ids.has(a.id));
      for (const a of chosen) {
        await env.DB.prepare(
          `INSERT INTO channels (platform, account_id, name, picture, token_enc, connected_by) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (platform, account_id) DO UPDATE SET name = excluded.name, picture = excluded.picture, token_enc = excluded.token_enc,
             status = 'active', error = NULL, connected_by = excluded.connected_by, updated_at = datetime('now')`,
        )
          .bind(row.platform, a.id, a.name, a.picture, a.token_enc, user)
          .run();
      }
      await env.DB.prepare("DELETE FROM oauth_pending WHERE state = ?").bind(row.state).run();
      return json({ added: chosen.length });
    }
  }

  const one = path.match(/^\/api\/channels\/(\d+)$/);
  if (one && request.method === "DELETE") {
    await env.DB.prepare("UPDATE publishes SET status = 'canceled', updated_at = datetime('now') WHERE channel_id = ? AND status = 'scheduled'").bind(Number(one[1])).run();
    await env.DB.prepare("DELETE FROM channels WHERE id = ?").bind(Number(one[1])).run();
    return json({ ok: true });
  }

  return json({ message: "Not found." }, 404);
}

/** The platform sends the browser back here after login. */
export async function oauthCallback(request: Request, env: Env, url: URL): Promise<Response> {
  const m = url.pathname.match(/^\/oauth\/callback\/([a-z]+)\/?$/);
  const platform = m?.[1] as Platform | undefined;
  const back = (q: string) => Response.redirect(`${url.origin}/channels?${q}`, 302);
  if (!platform || !PLATFORMS.includes(platform)) return back("error=unknown-platform");
  const state = url.searchParams.get("state") ?? "";
  const row = await env.DB.prepare("SELECT state FROM oauth_pending WHERE state = ? AND platform = ? AND created_at >= datetime('now', '-1 hour')")
    .bind(state, platform)
    .first();
  if (!row) return back("error=expired");
  const code = url.searchParams.get("code");
  if (!code) return back(`error=${encodeURIComponent(url.searchParams.get("error_description") ?? url.searchParams.get("error") ?? "denied")}`);

  try {
    const pages = await facebookPages(env, code, callbackUrl(url, platform));
    const accounts: PendingAccount[] = [];
    for (const p of pages) accounts.push({ id: p.id, name: p.name, picture: p.picture, token_enc: await encrypt(env.TOKEN_KEY, p.token) });
    await env.DB.prepare("UPDATE oauth_pending SET data = ? WHERE state = ?").bind(JSON.stringify(accounts), state).run();
    return back(`pick=${encodeURIComponent(state)}`);
  } catch (e) {
    return back(`error=${encodeURIComponent((e as Error).message)}`);
  }
}

export async function channelToken(env: Env, channelId: number) {
  const ch = await env.DB.prepare("SELECT * FROM channels WHERE id = ?")
    .bind(channelId)
    .first<{ id: number; platform: string; account_id: string; token_enc: string; status: string }>();
  if (!ch) throw new Error("Channel was removed.");
  return { ...ch, token: await decrypt(env.TOKEN_KEY, ch.token_enc) };
}
