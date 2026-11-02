import { Player } from "@remotion/player";
import { renderMediaOnWeb } from "@remotion/web-renderer";
import { useEffect, useMemo, useRef, useState } from "react";
import { type RandomFilters, type ReelLog, fetchQuestion, fetchRandom, fetchReels, logReel, toReelProps } from "./api";
import { MCQReel } from "./remotion/MCQReel";
import { FPS, HEIGHT, type ReelProps, WIDTH, durationInFrames } from "./remotion/types";

type Status = { kind: "idle" | "busy" | "error" | "ok"; text: string };

export function App() {
  const [idInput, setIdInput] = useState("");
  const [filters, setFilters] = useState<RandomFilters>({ exam_name: "bar_council", year: "", topic_id: "", skip_used: true });
  const [props, setProps] = useState<ReelProps | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle", text: "" });
  const [progress, setProgress] = useState<number | null>(null);
  const [reels, setReels] = useState<ReelLog[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const refreshReels = () => fetchReels().then(setReels).catch(() => undefined);
  useEffect(() => {
    refreshReels();
  }, []);

  const load = async (fn: () => Promise<Parameters<typeof toReelProps>[0]>) => {
    setStatus({ kind: "busy", text: "প্রশ্ন আনছি…" });
    try {
      const q = await fn();
      setProps(toReelProps(q));
      setIdInput(String(q.id));
      setStatus({ kind: "ok", text: `প্রশ্ন #${q.id} লোড হয়েছে। লেখা দেখে নিন, দরকার হলে ঠিক করুন।` });
    } catch (e) {
      setStatus({ kind: "error", text: (e as Error).message });
    }
  };

  const duration = useMemo(() => (props ? durationInFrames(props) : 1), [props]);

  const render = async () => {
    if (!props) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setProgress(0);
    setStatus({ kind: "busy", text: "Video বানাচ্ছি… এই tab খোলা রাখুন।" });
    try {
      const { getBlob } = await renderMediaOnWeb({
        composition: { id: "MCQReel", component: MCQReel, durationInFrames: duration, fps: FPS, width: WIDTH, height: HEIGHT, defaultProps: props },
        inputProps: props,
        container: "mp4",
        videoBitrate: "high",
        signal: controller.signal,
        onProgress: (p) => setProgress(p.progress),
      });
      const blob = await getBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nirnoy-reel-q${props.questionId}.mp4`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      await logReel(props.questionId).catch(() => undefined);
      refreshReels();
      setStatus({ kind: "ok", text: `Download হয়েছে: nirnoy-reel-q${props.questionId}.mp4` });
    } catch (e) {
      setStatus({ kind: "error", text: controller.signal.aborted ? "বাতিল করা হয়েছে।" : `Render ব্যর্থ: ${(e as Error).message}` });
    } finally {
      setProgress(null);
      abortRef.current = null;
    }
  };

  const set = <K extends keyof ReelProps>(key: K, value: ReelProps[K]) => setProps((p) => (p ? { ...p, [key]: value } : p));
  const busy = status.kind === "busy";

  return (
    <div className="layout">
      <aside className="panel">
        <h1>
          নির্ণয় <span>Reel Studio</span>
        </h1>

        <section>
          <h2>প্রশ্ন বাছাই</h2>
          <div className="row">
            <input inputMode="numeric" placeholder="Question ID" value={idInput} onChange={(e) => setIdInput(e.target.value.replace(/\D/g, ""))} />
            <button disabled={busy || !idInput} onClick={() => load(() => fetchQuestion(Number(idInput)))}>
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
          <button className="secondary" disabled={busy} onClick={() => load(() => fetchRandom(filters))}>
            Random প্রশ্ন
          </button>
        </section>

        {props ? (
          <section>
            <h2>লেখা (#{props.questionId})</h2>
            <label>
              Act / Topic
              <input value={props.act} onChange={(e) => set("act", e.target.value)} />
            </label>
            <label>
              উৎস (পরীক্ষা, সাল)
              <input value={props.source} onChange={(e) => set("source", e.target.value)} />
            </label>
            <label>
              প্রশ্ন <small>{props.body.length} অক্ষর</small>
              <textarea rows={4} value={props.body} onChange={(e) => set("body", e.target.value)} />
            </label>
            {props.options.map((o, i) => (
              <label key={i} className="option">
                <span>
                  <input type="radio" name="correct" checked={props.correctIndex === i} onChange={() => set("correctIndex", i)} title="সঠিক উত্তর" />
                  {o.label}
                </span>
                <input
                  value={o.text}
                  onChange={(e) => set("options", props.options.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                />
              </label>
            ))}
            <label>
              ব্যাখ্যা <small>{props.explanation.length} অক্ষর{props.explanation.length > 450 ? " · লম্বা, ছোট করলে ভালো" : ""}</small>
              <textarea rows={6} value={props.explanation} onChange={(e) => set("explanation", e.target.value)} />
            </label>
            <label>
              শেষ পর্দার লাইন
              <input value={props.ctaLine} onChange={(e) => set("ctaLine", e.target.value)} />
            </label>
            <label>
              বোতামের লেখা
              <input value={props.ctaUrl} onChange={(e) => set("ctaUrl", e.target.value)} />
            </label>
          </section>
        ) : null}

        {status.text ? <p className={`status ${status.kind}`}>{status.text}</p> : null}

        <section>
          <h2>সাম্প্রতিক reel</h2>
          {reels.length === 0 ? <p className="muted">এখনো কোনো reel নেই।</p> : null}
          <ul className="reels">
            {reels.map((r) => (
              <li key={r.id}>
                <button className="link" onClick={() => load(() => fetchQuestion(r.question_id))}>
                  #{r.question_id}
                </button>
                <span>{r.created_at} UTC</span>
              </li>
            ))}
          </ul>
        </section>
      </aside>

      <main className="stage">
        {props ? (
          <>
            <div className="player">
              <Player
                component={MCQReel}
                inputProps={props}
                durationInFrames={duration}
                fps={FPS}
                compositionWidth={WIDTH}
                compositionHeight={HEIGHT}
                style={{ width: "100%", height: "100%" }}
                initialFrame={75}
                controls
                loop
              />
            </div>
            <div className="actions">
              <span className="muted">{(duration / FPS).toFixed(1)} সেকেন্ড · 1080×1920</span>
              {progress === null ? (
                <button disabled={busy} onClick={render}>
                  MP4 Download
                </button>
              ) : (
                <>
                  <progress value={progress} max={1} />
                  <span>{Math.round(progress * 100)}%</span>
                  <button className="secondary" onClick={() => abortRef.current?.abort()}>
                    বাতিল
                  </button>
                </>
              )}
            </div>
          </>
        ) : (
          <div className="empty">বাঁ দিক থেকে একটি প্রশ্ন আনুন।</div>
        )}
      </main>
    </div>
  );
}
