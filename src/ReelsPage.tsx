import { useEffect, useMemo, useState } from "react";
import { type ApiQuestion, type RandomFilters, fetchQuestion, fetchRandom, narrationScripts, toReelProps } from "./api";
import {
  type ReelRow,
  type ReelStatus,
  STATUS_LABEL,
  createReel,
  deleteReel,
  duplicateReel,
  fromData,
  getReel,
  listReels,
  loadPrefs,
  mediaUrl,
  toData,
  updateReel,
} from "./reels";
import { PLATFORMS, PLATFORM_INFO, type Platform, captionsFor } from "./captions";
import { navigate } from "./router";
import { syncBuiltinVoices } from "./voices";
import { type Publish, PUBLISH_LABEL, listPublishes } from "./channels";
import { PublishDialog } from "./PublishDialog";
import type { ReelData } from "./reels";

type Status = { kind: "idle" | "busy" | "error" | "ok"; text: string };
const FILTERS: (ReelStatus | "all")[] = ["all", "draft", "rendered", "published"];

/** Reels list: every draft / render / published reel, with "new reel" and the YouTube manual-upload helpers. */
export function ReelsPage() {
  const [rows, setRows] = useState<ReelRow[] | null>(null);
  const [filter, setFilter] = useState<ReelStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle", text: "" });
  const [creating, setCreating] = useState(false);
  const [idInput, setIdInput] = useState("");
  const [filters, setFilters] = useState<RandomFilters>({ exam_name: "bar_council", year: "", topic_id: "", skip_used: true });
  /** A question that already has reels: ask whether to open one of them or start a new one. */
  const [publishes, setPublishes] = useState<Publish[]>([]);
  const [publishFor, setPublishFor] = useState<{ id: number; data: ReelData } | null>(null);
  const [conflict, setConflict] = useState<{ q: ApiQuestion; reels: ReelRow[] } | null>(null);

  const refresh = () => {
    listPublishes()
      .then(setPublishes)
      .catch(() => undefined);
    return listReels()
      .then(setRows)
      .catch((e) => setStatus({ kind: "error", text: (e as Error).message }));
  };

  const openPublish = async (r: ReelRow) => {
    try {
      const full = await getReel(r.id);
      if (!full.data) throw new Error("এই reel-এ লেখা জমা নেই — একবার খুলে নিন।");
      setPublishFor({ id: r.id, data: full.data });
    } catch (e) {
      setStatus({ kind: "error", text: (e as Error).message });
    }
  };
  useEffect(() => {
    void refresh();
  }, []);

  const shown = useMemo(
    () => (rows ?? []).filter((r) => (filter === "all" || r.status === filter) && (!search || String(r.question_id).includes(search) || (r.title ?? "").includes(search))),
    [rows, filter, search],
  );
  const busy = status.kind === "busy";

  const pick = async (fn: () => Promise<ApiQuestion>) => {
    setStatus({ kind: "busy", text: "প্রশ্ন আনছি…" });
    try {
      const q = await fn();
      const existing = await listReels({ question_id: q.id });
      if (existing.length) {
        setConflict({ q, reels: existing });
        setStatus({ kind: "idle", text: "" });
      } else {
        await startNew(q);
      }
    } catch (e) {
      setStatus({ kind: "error", text: (e as Error).message });
    }
  };

  const startNew = async (q: ApiQuestion) => {
    setStatus({ kind: "busy", text: "নতুন খসড়া বানাচ্ছি…" });
    const base = { ...toReelProps(q), ...loadPrefs() };
    const scripts = narrationScripts(base);
    const props = syncBuiltinVoices(base, scripts);
    const row = await createReel(q.id, toData(props, scripts));
    navigate(`/reels/${row.id}`);
  };

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setStatus({ kind: "busy", text: `${label}…` });
    try {
      await fn();
      setStatus({ kind: "ok", text: `${label} হয়েছে।` });
      await refresh();
    } catch (e) {
      setStatus({ kind: "error", text: (e as Error).message });
    }
  };

  const copyCaption = async (r: ReelRow, platform: Platform) => {
    try {
      const full = await getReel(r.id);
      if (!full.data) throw new Error("এই reel-এ লেখা জমা নেই — একবার খুলে নিন।");
      await navigator.clipboard.writeText(captionsFor(full.data.props, full.data.captions)[platform]);
      setStatus({ kind: "ok", text: `Reel #${r.id}: ${PLATFORM_INFO[platform].label} caption কপি হয়েছে।` });
    } catch (e) {
      setStatus({ kind: "error", text: (e as Error).message });
    }
  };

  const markPublished = (r: ReelRow) => {
    const link = window.prompt("YouTube link (না থাকলে খালি রাখুন):", r.youtube_url ?? "");
    if (link === null) return;
    void act("প্রকাশিত হিসেবে চিহ্নিত", () => updateReel(r.id, { status: "published", youtube_url: link.trim() || null }));
  };

  return (
    <div className="list-page">
      <header className="list-head">
        <h1>
          নির্ণয় <span>Reel Studio</span>
        </h1>
        <div className="row">
          <button className="secondary" onClick={() => navigate("/channels")}>
            Channels
          </button>
          <button onClick={() => setCreating((c) => !c)}>{creating ? "বন্ধ করুন" : "+ নতুন reel"}</button>
        </div>
      </header>

      {creating ? (
        <section className="new-reel">
          <div className="row">
            <input inputMode="numeric" placeholder="Question ID" value={idInput} onChange={(e) => setIdInput(e.target.value.replace(/\D/g, ""))} />
            <button disabled={busy || !idInput} onClick={() => pick(() => fetchQuestion(Number(idInput)))}>
              আনুন
            </button>
          </div>
          <div className="grid">
            <label>
              পরীক্ষা (exam_name)
              <input value={filters.exam_name} onChange={(e) => setFilters({ ...filters, exam_name: e.target.value.trim() })} />
            </label>
            <label>
              সাল (year)
              <input value={filters.year} placeholder="যেমন 2023" onChange={(e) => setFilters({ ...filters, year: e.target.value.trim() })} />
            </label>
            <label>
              Topic ID
              <input value={filters.topic_id} onChange={(e) => setFilters({ ...filters, topic_id: e.target.value.replace(/\D/g, "") })} />
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={filters.skip_used} onChange={(e) => setFilters({ ...filters, skip_used: e.target.checked })} />
            আগে বানানো প্রশ্ন বাদ দিন
          </label>
          <button className="secondary" disabled={busy} onClick={() => pick(() => fetchRandom(filters))}>
            Random প্রশ্ন
          </button>
        </section>
      ) : null}

      {publishFor ? (
        <PublishDialog
          reelId={publishFor.id}
          props={fromData(publishFor.id, publishFor.data)}
          captions={publishFor.data.captions}
          onClose={() => {
            setPublishFor(null);
            void refresh();
          }}
        />
      ) : null}

      {conflict ? (
        <div className="dialog-backdrop" onClick={() => setConflict(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>প্রশ্ন #{conflict.q.id}-এ আগে reel আছে</h2>
            <p className="muted">আগেরটায় edit করবেন, নাকি নতুন একটা বানাবেন?</p>
            <ul className="dialog-list">
              {conflict.reels.map((r) => (
                <li key={r.id}>
                  <span>
                    Reel #{r.id} · <span className={`chip ${r.status}`}>{STATUS_LABEL[r.status]}</span> · {r.updated_at ?? r.created_at}
                  </span>
                  <button className="secondary" onClick={() => navigate(`/reels/${r.id}`)}>
                    এটায় edit
                  </button>
                </li>
              ))}
            </ul>
            <div className="row">
              <button onClick={() => startNew(conflict.q).catch((e) => setStatus({ kind: "error", text: (e as Error).message }))}>নতুন reel বানান</button>
              <button className="link" onClick={() => setConflict(null)}>
                বাতিল
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {status.text ? <p className={`status ${status.kind}`}>{status.text}</p> : null}

      <div className="list-tools">
        <div className="tabs">
          {FILTERS.map((f) => (
            <button key={f} className={filter === f ? "" : "secondary"} onClick={() => setFilter(f)}>
              {f === "all" ? "সব" : STATUS_LABEL[f]}
              {rows ? ` (${f === "all" ? rows.length : rows.filter((r) => r.status === f).length})` : ""}
            </button>
          ))}
        </div>
        <input className="search" placeholder="প্রশ্ন ID বা লেখা খুঁজুন" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {rows === null ? <p className="muted">লোড হচ্ছে…</p> : shown.length === 0 ? <p className="muted">কোনো reel নেই। "+ নতুন reel" দিয়ে শুরু করুন।</p> : null}

      <ul className="reel-list">
        {shown.map((r) => (
          <li key={r.id} className="reel-card">
            <button className="thumb" onClick={() => navigate(`/reels/${r.id}`)} title="খুলুন">
              {r.rendered_at ? (
                <img src={mediaUrl(r.id, "thumb.jpg", r.updated_at ?? r.rendered_at)} alt="" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
              ) : null}
            </button>
            <div className="reel-info">
              <div className="reel-title">
                <span className={`chip ${r.status}`}>{STATUS_LABEL[r.status]}</span> #{r.question_id} · {r.title ?? <em className="muted">পুরনো log (খুললে নতুন করে সাজানো হবে)</em>}
              </div>
              <div className="muted">
                Reel #{r.id} · {r.updated_by ?? r.created_by ?? "—"} · {r.updated_at ?? r.created_at} UTC
                {publishes
                  .filter((p) => p.reel_id === r.id && p.status !== "canceled")
                  .slice(0, 6)
                  .map((p) =>
                    p.url ? (
                      <a key={p.id} className={`chip pub-${p.status}`} href={p.url} target="_blank" rel="noreferrer" title={p.channel_name ?? ""}>
                        {p.channel_name ?? p.platform}: {PUBLISH_LABEL[p.status]}
                      </a>
                    ) : (
                      <span key={p.id} className={`chip pub-${p.status}`} title={p.error ?? ""}>
                        {p.channel_name ?? p.platform}: {PUBLISH_LABEL[p.status]}
                      </span>
                    ),
                  )}
                {r.youtube_url ? (
                  <>
                    {" · "}
                    <a href={r.youtube_url} target="_blank" rel="noreferrer">
                      YouTube
                    </a>
                  </>
                ) : null}
              </div>
              <div className="row small reel-actions">
                <button onClick={() => navigate(`/reels/${r.id}`)}>খুলুন</button>
                <button className="secondary" onClick={() => act("কপি", () => duplicateReel(r.id))}>
                  কপি
                </button>
                {r.rendered_at ? (
                  <>
                    <a className="btn secondary" href={`${mediaUrl(r.id, "video.mp4")}?download=1`}>
                      MP4
                    </a>
                    <a className="btn secondary" href={`${mediaUrl(r.id, "thumb.jpg")}?download=1`}>
                      Thumbnail
                    </a>
                    <button className="secondary" onClick={() => openPublish(r)}>
                      Publish / Schedule
                    </button>
                    <button className="secondary" onClick={() => markPublished(r)}>
                      {r.status === "published" ? "YouTube link বদলান" : "YouTube-এ দিয়েছি"}
                    </button>
                  </>
                ) : null}
                {r.title ? (
                  <details className="caption-menu">
                    <summary className="btn secondary">ক্যাপশন কপি ▾</summary>
                    <div className="caption-menu-list">
                      {PLATFORMS.map((k) => (
                        <button
                          key={k}
                          className="secondary"
                          onClick={(e) => {
                            void copyCaption(r, k);
                            (e.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open");
                          }}
                        >
                          {PLATFORM_INFO[k].label}
                        </button>
                      ))}
                    </div>
                  </details>
                ) : null}
                <button
                  className="link danger"
                  onClick={() => window.confirm(`Reel #${r.id} মুছবেন? এর voice, video, thumbnail সব মুছে যাবে।`) && act("মুছে ফেলা", () => deleteReel(r.id))}
                >
                  মুছুন
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
