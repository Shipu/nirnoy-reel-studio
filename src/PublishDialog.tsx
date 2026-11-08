import { useEffect, useMemo, useState } from "react";
import { type Captions, captionsFor } from "./captions";
import {
  type Channel,
  type Publish,
  PLATFORM_LABEL,
  PUBLISH_LABEL,
  cancelPublish,
  dhakaToIso,
  listChannels,
  listPublishes,
  publishReel,
  retryPublish,
  showDhaka,
} from "./channels";
import type { ReelProps } from "./remotion/types";
import { navigate } from "./router";

type Source = Omit<ReelProps, "voice">;

/** Pick channels, check each caption, post now or at a Bangladesh time; shows this reel's posts. */
export function PublishDialog({ reelId, props, captions, onClose }: { reelId: number; props: Source; captions?: Partial<Captions>; onClose: () => void }) {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [rows, setRows] = useState<Publish[]>([]);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [text, setText] = useState<Record<number, string>>({});
  const [when, setWhen] = useState<"now" | "at">("now");
  const [at, setAt] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "error" | "busy"; text: string } | null>(null);
  const ready = useMemo(() => captionsFor(props, captions), [props, captions]);

  const refreshRows = () => listPublishes(reelId).then(setRows).catch(() => undefined);
  useEffect(() => {
    listChannels()
      .then((r) => setChannels(r.data))
      .catch((e) => setMsg({ kind: "error", text: (e as Error).message }));
    void refreshRows();
    const id = setInterval(refreshRows, 10_000);
    return () => clearInterval(id);
  }, [reelId]); // eslint-disable-line react-hooks/exhaustive-deps

  const captionFor = (c: Channel) => text[c.id] ?? ready[c.platform];

  const submit = async () => {
    if (!channels) return;
    if (when === "at" && !at) return setMsg({ kind: "error", text: "সময় দিন।" });
    setMsg({ kind: "busy", text: "পাঠাচ্ছি…" });
    try {
      const targets = channels.filter((c) => chosen.has(c.id)).map((c) => ({ channel_id: c.id, caption: captionFor(c) }));
      const r = await publishReel(reelId, targets, when === "at" ? dhakaToIso(at) : null);
      setMsg({ kind: "ok", text: when === "at" ? `${r.created.length}টি post নির্ধারিত হয়েছে (${at.replace("T", " ")})।` : `${r.created.length}টি post যাচ্ছে — কয়েক মিনিটে প্রকাশ হবে।` });
      setChosen(new Set());
      await refreshRows();
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    }
  };

  const act = (fn: () => Promise<unknown>) =>
    fn()
      .then(refreshRows)
      .catch((e) => setMsg({ kind: "error", text: (e as Error).message }));

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog wide" onClick={(e) => e.stopPropagation()}>
        <h2>Publish / Schedule — Reel #{reelId}</h2>

        {channels === null ? (
          <p className="muted">লোড হচ্ছে…</p>
        ) : channels.length === 0 ? (
          <p className="muted">
            কোনো channel connect করা নেই।{" "}
            <button className="link" onClick={() => navigate("/channels")}>
              Channels পাতায় যান →
            </button>
          </p>
        ) : (
          <div className="publish-targets">
            {channels.map((c) => (
              <div key={c.id} className={`publish-target ${chosen.has(c.id) ? "on" : ""}`}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={chosen.has(c.id)}
                    onChange={(e) => {
                      const next = new Set(chosen);
                      if (e.target.checked) next.add(c.id);
                      else next.delete(c.id);
                      setChosen(next);
                    }}
                  />
                  {c.picture ? <img className="mini-avatar" src={c.picture} alt="" /> : null}
                  <strong>{c.name}</strong> <small className="muted">{PLATFORM_LABEL[c.platform]}</small>
                </label>
                {chosen.has(c.id) ? <textarea rows={6} value={captionFor(c)} onChange={(e) => setText({ ...text, [c.id]: e.target.value })} /> : null}
              </div>
            ))}
          </div>
        )}

        <div className="row when">
          <label className="check">
            <input type="radio" checked={when === "now"} onChange={() => setWhen("now")} /> এখনই
          </label>
          <label className="check">
            <input type="radio" checked={when === "at"} onChange={() => setWhen("at")} /> নির্দিষ্ট সময় (বাংলাদেশ সময়)
          </label>
          {when === "at" ? <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /> : null}
        </div>

        {msg ? <p className={`status ${msg.kind}`}>{msg.text}</p> : null}

        <div className="row">
          <button disabled={chosen.size === 0 || msg?.kind === "busy"} onClick={submit}>
            {when === "now" ? `${chosen.size}টি channel-এ পাঠান` : `${chosen.size}টি channel-এ schedule করুন`}
          </button>
          <button className="link" onClick={onClose}>
            বন্ধ
          </button>
        </div>

        {rows.length ? (
          <>
            <div className="field-title">এই reel-এর post</div>
            <ul className="dialog-list publish-rows">
              {rows.map((r) => (
                <li key={r.id}>
                  <span>
                    <span className={`chip pub-${r.status}`}>{PUBLISH_LABEL[r.status]}</span> {r.channel_name ?? "(সরানো channel)"}
                    {r.scheduled_at && r.status === "scheduled" ? <small className="muted"> · {showDhaka(r.scheduled_at)}</small> : null}
                    {r.error ? <small className="over"> · {r.error}</small> : null}
                  </span>
                  <span className="row small">
                    {r.url ? (
                      <a className="btn secondary" href={r.url} target="_blank" rel="noreferrer">
                        দেখুন
                      </a>
                    ) : null}
                    {r.status === "failed" ? (
                      <button className="secondary" onClick={() => act(() => retryPublish(r.id))}>
                        আবার চেষ্টা
                      </button>
                    ) : null}
                    {r.status === "scheduled" ? (
                      <button className="link danger" onClick={() => act(() => cancelPublish(r.id))}>
                        বাতিল
                      </button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </div>
  );
}
