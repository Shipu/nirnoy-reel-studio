import { useEffect, useMemo, useState } from "react";
import { type Channel, type PostStats, PLATFORM_LABEL, listStats, refreshStats, showDhaka } from "./channels";
import { navigate } from "./router";

/**
 * Every published post's numbers in one place: totals per platform, then a table by post or by reel.
 * Numbers come from D1 (fetched by a cron a few times a day, or "এখনই আপডেট").
 */

type Metric = "views" | "reach" | "likes" | "comments" | "shares" | "saves";
const METRICS: { key: Metric; label: string }[] = [
  { key: "views", label: "Views" },
  { key: "reach", label: "Reach" },
  { key: "likes", label: "Likes" },
  { key: "comments", label: "Comments" },
  { key: "shares", label: "Shares" },
  { key: "saves", label: "Saves" },
];
const PLATFORMS: Channel["platform"][] = ["facebook", "instagram", "youtube"];

const fmt = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("bn-BD"));
const watch = (ms: number | null) => (ms == null ? "—" : `${(ms / 1000).toLocaleString("bn-BD", { maximumFractionDigits: 1 })} সে.`);
/** Sum that stays null when no post reports the metric (so "—" means "not reported", not 0). */
const sum = (rows: PostStats[], k: Metric) => rows.reduce<number | null>((a, r) => (r[k] == null ? a : (a ?? 0) + (r[k] as number)), null);

type ReelRow = { reel_id: number; title: string; platforms: Channel["platform"][] } & Record<Metric, number | null>;

export function AnalyticsPage() {
  const [rows, setRows] = useState<PostStats[] | null>(null);
  const [platform, setPlatform] = useState<Channel["platform"] | "all">("all");
  const [by, setBy] = useState<"post" | "reel">("post");
  const [sortKey, setSortKey] = useState<Metric | "published_at">("views");
  const [msg, setMsg] = useState<{ kind: "ok" | "error" | "busy"; text: string } | null>(null);

  const load = () =>
    listStats()
      .then(setRows)
      .catch((e) => setMsg({ kind: "error", text: (e as Error).message }));
  useEffect(() => {
    void load();
  }, []);

  /** Fetch from the platforms; a run handles part of the posts, so keep going while some are waiting. */
  const refresh = async () => {
    setMsg({ kind: "busy", text: "Platform থেকে সংখ্যা আনছি…" });
    try {
      let updated = 0;
      let failed = 0;
      for (let i = 0; i < 6; i++) {
        const r = await refreshStats();
        updated += r.updated;
        failed += r.failed;
        if (r.remaining === 0 || r.updated + r.failed === 0) break;
      }
      await load();
      setMsg({ kind: failed ? "error" : "ok", text: `${updated}টি post আপডেট হয়েছে${failed ? `, ${failed}টিতে সমস্যা (নিচে লাল লেখা দেখুন)` : ""}।` });
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    }
  };

  const shown = useMemo(() => (rows ?? []).filter((r) => platform === "all" || r.platform === platform), [rows, platform]);
  const lastFetch = useMemo(() => (rows ?? []).reduce<string | null>((a, r) => (r.stats_at && (!a || r.stats_at > a) ? r.stats_at : a), null), [rows]);

  const posts = useMemo(() => {
    const k = sortKey;
    return [...shown].sort((a, b) => (k === "published_at" ? b.published_at.localeCompare(a.published_at) : (b[k] ?? -1) - (a[k] ?? -1)));
  }, [shown, sortKey]);

  const reels = useMemo(() => {
    const m = new Map<number, PostStats[]>();
    for (const r of shown) m.set(r.reel_id, [...(m.get(r.reel_id) ?? []), r]);
    const out: (ReelRow & { published_at: string })[] = [...m.entries()].map(([reel_id, list]) => ({
      reel_id,
      title: list[0].reel_title ?? `Reel #${reel_id}`,
      platforms: [...new Set(list.map((r) => r.platform))],
      published_at: list.map((r) => r.published_at).sort()[0],
      ...(Object.fromEntries(METRICS.map(({ key }) => [key, sum(list, key)])) as Record<Metric, number | null>),
    }));
    const k = sortKey;
    return out.sort((a, b) => (k === "published_at" ? b.published_at.localeCompare(a.published_at) : (b[k] ?? -1) - (a[k] ?? -1)));
  }, [shown, sortKey]);

  const head = (label: string, key: Metric | "published_at") => (
    <th key={key}>
      <button className={`link sort ${sortKey === key ? "on" : ""}`} onClick={() => setSortKey(key)} title="এই কলাম অনুযায়ী সাজান">
        {label}
        {sortKey === key ? " ↓" : ""}
      </button>
    </th>
  );

  return (
    <div className="list-page analytics">
      <header className="list-head">
        <h1>
          নির্ণয় <span>Analytics</span>
        </h1>
        <button className="link" onClick={() => navigate("/")}>
          ← সব reel
        </button>
      </header>

      <div className="row filters">
        <div className="seg" role="group" aria-label="Platform">
          {(["all", ...PLATFORMS] as const).map((p) => (
            <button key={p} className={platform === p ? "on" : ""} onClick={() => setPlatform(p)}>
              {p === "all" ? "সব" : PLATFORM_LABEL[p]}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Group">
          <button className={by === "post" ? "on" : ""} onClick={() => setBy("post")}>
            Post অনুযায়ী
          </button>
          <button className={by === "reel" ? "on" : ""} onClick={() => setBy("reel")}>
            Reel অনুযায়ী
          </button>
        </div>
        <span className="spacer" />
        <span className="muted">{lastFetch ? `শেষ আপডেট: ${showDhaka(lastFetch)}` : "এখনো আনা হয়নি"}</span>
        <button disabled={msg?.kind === "busy"} onClick={refresh}>
          এখনই আপডেট
        </button>
      </div>
      {msg ? <p className={`status ${msg.kind}`}>{msg.text}</p> : null}

      {rows === null ? (
        <p className="muted">লোড হচ্ছে…</p>
      ) : rows.length === 0 ? (
        <p className="muted">এখনো কোনো প্রকাশিত post নেই।</p>
      ) : (
        <>
          <div className="kpis">
            {METRICS.map(({ key, label }) => (
              <div key={key} className="kpi">
                <div className="kpi-label">{label}</div>
                <div className="kpi-value">{fmt(sum(shown, key))}</div>
              </div>
            ))}
          </div>

          {platform === "all" ? (
            <table className="stats">
              <thead>
                <tr>
                  <th>Platform</th>
                  <th className="num">Post</th>
                  {METRICS.map((m) => (
                    <th key={m.key} className="num">
                      {m.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PLATFORMS.map((p) => {
                  const list = shown.filter((r) => r.platform === p);
                  return list.length ? (
                    <tr key={p}>
                      <td>{PLATFORM_LABEL[p]}</td>
                      <td className="num">{fmt(list.length)}</td>
                      {METRICS.map((m) => (
                        <td key={m.key} className="num">
                          {fmt(sum(list, m.key))}
                        </td>
                      ))}
                    </tr>
                  ) : null;
                })}
              </tbody>
            </table>
          ) : null}

          <div className="table-wrap">
            {by === "post" ? (
              <table className="stats">
                <thead>
                  <tr>
                    <th>Reel</th>
                    <th>Platform</th>
                    {head("প্রকাশ", "published_at")}
                    {METRICS.map((m) => head(m.label, m.key))}
                    <th className="num">গড় দেখা</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {posts.map((r) => (
                    <tr key={r.id}>
                      <td className="reel-cell">
                        <button className="link" onClick={() => navigate(`/reels/${r.reel_id}`)} title={r.reel_title ?? ""}>
                          #{r.reel_id} {r.reel_title ?? ""}
                        </button>
                        {r.stats_error ? <small className="over">{r.stats_error}</small> : null}
                      </td>
                      <td>
                        {PLATFORM_LABEL[r.platform] ?? r.platform}
                        <small className="muted"> {r.channel_name ?? ""}</small>
                      </td>
                      <td className="muted date">{showDhaka(r.published_at)}</td>
                      {METRICS.map((m) => (
                        <td key={m.key} className="num">
                          {fmt(r[m.key])}
                        </td>
                      ))}
                      <td className="num">{watch(r.avg_watch_ms)}</td>
                      <td>
                        {r.url ? (
                          <a href={r.url} target="_blank" rel="noreferrer">
                            দেখুন
                          </a>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="stats">
                <thead>
                  <tr>
                    <th>Reel</th>
                    <th>Platform</th>
                    {head("প্রথম প্রকাশ", "published_at")}
                    {METRICS.map((m) => head(m.label, m.key))}
                  </tr>
                </thead>
                <tbody>
                  {reels.map((r) => (
                    <tr key={r.reel_id}>
                      <td className="reel-cell">
                        <button className="link" onClick={() => navigate(`/reels/${r.reel_id}`)} title={r.title}>
                          #{r.reel_id} {r.title}
                        </button>
                      </td>
                      <td>{r.platforms.map((p) => PLATFORM_LABEL[p] ?? p).join(", ")}</td>
                      <td className="muted date">{showDhaka(r.published_at)}</td>
                      {METRICS.map((m) => (
                        <td key={m.key} className="num">
                          {fmt(r[m.key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <p className="muted">
            "—" মানে platform এই সংখ্যা দেয় না বা এখনো আনা হয়নি। Facebook-এর reach/plays আর Instagram-এর views/saves পেতে Channels পাতায় দুটো channel "আবার connect" করতে হবে।
            সংখ্যা প্রতি ২ ঘণ্টায় নিজে থেকে আপডেট হয়।
          </p>
        </>
      )}
    </div>
  );
}
