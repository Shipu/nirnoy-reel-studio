import { useEffect, useState } from "react";
import { type Channel, type PendingAccount, PLATFORM_LABEL, addAccounts, connectUrl, listChannels, pendingAccounts, removeChannel } from "./channels";
import { navigate } from "./router";

type Status = { kind: "idle" | "busy" | "error" | "ok"; text: string };

/** Connected social channels: connect a platform, tick which Pages/accounts to keep, remove them. */
export function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [platforms, setPlatforms] = useState<Channel["platform"][]>([]);
  const [status, setStatus] = useState<Status>({ kind: "idle", text: "" });
  /** After a platform login: the accounts it returned, to choose from. */
  const [pick, setPick] = useState<{ state: string; platform: string; accounts: PendingAccount[]; chosen: Set<string> } | null>(null);

  const refresh = () =>
    listChannels()
      .then((r) => {
        setChannels(r.data);
        setPlatforms(r.platforms);
      })
      .catch((e) => setStatus({ kind: "error", text: (e as Error).message }));

  useEffect(() => {
    void refresh();
    const q = new URLSearchParams(window.location.search);
    const error = q.get("error");
    const state = q.get("pick");
    if (error) setStatus({ kind: "error", text: error === "expired" ? "Connect-এর মেয়াদ শেষ — আবার চেষ্টা করুন।" : `Connect হয়নি: ${error}` });
    if (state) {
      pendingAccounts(state)
        .then((r) => setPick({ state, platform: r.platform, accounts: r.data, chosen: new Set(r.data.filter((a) => !a.connected).map((a) => a.id)) }))
        .catch((e) => setStatus({ kind: "error", text: (e as Error).message }));
    }
    if (error || state) window.history.replaceState(null, "", "/channels");
  }, []);

  const savePick = async () => {
    if (!pick) return;
    setStatus({ kind: "busy", text: "যোগ করছি…" });
    try {
      const r = await addAccounts(pick.state, [...pick.chosen]);
      setPick(null);
      setStatus({ kind: "ok", text: `${r.added}টি channel যোগ হয়েছে।` });
      await refresh();
    } catch (e) {
      setStatus({ kind: "error", text: (e as Error).message });
    }
  };

  const remove = async (c: Channel) => {
    if (!window.confirm(`"${c.name}" সরাবেন? এই channel-এ নির্ধারিত post বাতিল হবে। আগে প্রকাশিত post থেকে যাবে।`)) return;
    try {
      await removeChannel(c.id);
      setStatus({ kind: "ok", text: `"${c.name}" সরানো হয়েছে।` });
      await refresh();
    } catch (e) {
      setStatus({ kind: "error", text: (e as Error).message });
    }
  };

  return (
    <div className="list-page">
      <header className="list-head">
        <h1>
          নির্ণয় <span>Channels</span>
        </h1>
        <button className="link" onClick={() => navigate("/")}>
          ← সব reel
        </button>
      </header>

      <section className="new-reel">
        <div className="field-title">নতুন channel connect করুন</div>
        <div className="row">
          {platforms.map((p) => (
            <a key={p} className="btn connect" href={connectUrl(p)}>
              + {PLATFORM_LABEL[p]}
            </a>
          ))}
        </div>
        <p className="muted">Login শেষে আপনার সব Page (বা Page-এর সাথে যুক্ত Instagram professional account) দেখাবে — কোনগুলো রাখবেন টিক দিয়ে বাছবেন। LinkedIn, TikTok, X পরে আসছে।</p>
      </section>

      {status.text ? <p className={`status ${status.kind}`}>{status.text}</p> : null}

      {channels === null ? (
        <p className="muted">লোড হচ্ছে…</p>
      ) : channels.length === 0 ? (
        <p className="muted">এখনো কোনো channel নেই।</p>
      ) : (
        <ul className="channel-list">
          {channels.map((c) => (
            <li key={c.id} className="channel-card">
              {c.picture ? <img src={c.picture} alt="" /> : <span className="avatar" />}
              <div className="reel-info">
                <div className="reel-title">{c.name}</div>
                <div className="muted">
                  {PLATFORM_LABEL[c.platform]} · {c.status === "active" ? "চালু" : `সমস্যা: ${c.error ?? c.status}`} · {c.connected_by ?? "—"}
                </div>
              </div>
              <a className="btn secondary" href={connectUrl(c.platform)} title="Token নবায়ন / আবার connect">
                আবার connect
              </a>
              <button className="link danger" onClick={() => remove(c)}>
                সরান (Remove)
              </button>
            </li>
          ))}
        </ul>
      )}

      {pick ? (
        <div className="dialog-backdrop" onClick={() => setPick(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>{pick.platform === "instagram" ? "কোন Instagram account রাখবেন?" : "কোন Page গুলো রাখবেন?"}</h2>
            {pick.accounts.length === 0 ? (
              <p className="muted">
                {pick.platform === "instagram"
                  ? "কোনো Instagram account পাওয়া যায়নি। Instagram account-টি professional (Business/Creator) হতে হবে এবং একটি Facebook Page-এর সাথে যুক্ত থাকতে হবে; login-এর সময় সেই Page ও account বাছতে হবে।"
                  : "এই account-এ কোনো Page পাওয়া যায়নি (বা অনুমতি দেওয়া হয়নি)।"}
              </p>
            ) : null}
            <ul className="dialog-list">
              {pick.accounts.map((a) => (
                <li key={a.id}>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={pick.chosen.has(a.id)}
                      onChange={(e) => {
                        const chosen = new Set(pick.chosen);
                        if (e.target.checked) chosen.add(a.id);
                        else chosen.delete(a.id);
                        setPick({ ...pick, chosen });
                      }}
                    />
                    {a.picture ? <img className="mini-avatar" src={a.picture} alt="" /> : null}
                    {a.name} {a.connected ? <small className="muted">(আগে থেকে আছে — token নবায়ন হবে)</small> : null}
                  </label>
                </li>
              ))}
            </ul>
            <div className="row">
              <button disabled={pick.chosen.size === 0 || status.kind === "busy"} onClick={savePick}>
                {pick.chosen.size}টি যোগ করুন
              </button>
              <button className="link" onClick={() => setPick(null)}>
                বাতিল
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
