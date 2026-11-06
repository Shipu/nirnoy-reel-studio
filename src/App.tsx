import { Player, Thumbnail } from "@remotion/player";
import { renderMediaOnWeb, renderStillOnWeb } from "@remotion/web-renderer";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  SEGMENT_LABELS,
  type TtsVoice,
  audioDuration,
  type ApiQuestion,
  diffQuestion,
  fetchQuestion,
  fetchVoices,
  saveQuestion,
  synthesize,
  narrationScripts,
  toReelProps,
} from "./api";
import { MCQReel } from "./remotion/MCQReel";
import { MCQThumbnail } from "./remotion/MCQThumbnail";
import { MUSIC, type MusicKey } from "./remotion/music";
import { ClipPlayer } from "./ClipPlayer";
import { startMic } from "./recorder";
import { type ReelRow, STATUS_LABEL, fromData, getReel, loadPrefs, mediaUrl, savePrefs, toData, updateReel, uploadMedia } from "./reels";
import { navigate } from "./router";
import { FPS, HEIGHT, type ReelProps, SEGMENTS, type SegmentKey, THEMES, type ThemeKey, type VoiceClip, WIDTH, themeOf, durationInFrames, hasExplanation } from "./remotion/types";

type ClipSource = NonNullable<VoiceClip["source"]>;

const downloadBlob = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

const thumbnailBlob = async (props: ReelProps) => {
  const { blob } = await renderStillOnWeb({
    composition: { id: "MCQThumbnail", component: MCQThumbnail, durationInFrames: 1, fps: FPS, width: WIDTH, height: HEIGHT, defaultProps: props },
    inputProps: props,
    frame: 0,
  });
  return blob({ format: "jpeg", quality: 0.92 });
};
type Status = { kind: "idle" | "busy" | "error" | "ok"; text: string };

/** One reel draft: loads it, autosaves every change, keeps voice clips and the render in R2. */
export function Editor({ reelId }: { reelId: number }) {
  const [reel, setReel] = useState<ReelRow | null>(null);
  const [props, setProps] = useState<ReelProps | null>(null);
  const [original, setOriginal] = useState<ApiQuestion | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle", text: "" });
  const [view, setView] = useState<"video" | "thumbnail">("video");
  const [progress, setProgress] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [scripts, setScripts] = useState<Record<SegmentKey, string> | null>(null);
  const [voices, setVoices] = useState<TtsVoice[]>([]);
  const [voice, setVoice] = useState<string>("");
  const [rate, setRate] = useState(-5);
  const [voiceBusy, setVoiceBusy] = useState(false);

  useEffect(() => {
    fetchVoices()
      .then((r) => {
        setVoices(r.voices);
        setVoice((v) => v || r.voices[0]?.id || "");
      })
      .catch(() => undefined);
  }, []);

  // Open the draft. Rows from before drafts existed (only a question id) are rebuilt from the question.
  const [ready, setReady] = useState(false);
  const hadData = useRef(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus({ kind: "busy", text: "Reel খুলছি…" });
      try {
        const row = await getReel(reelId);
        const q = await fetchQuestion(row.question_id).catch(() => null);
        if (cancelled) return;
        setReel(row);
        setOriginal(q);
        hadData.current = row.data !== null;
        if (row.data) {
          const p = fromData(reelId, row.data);
          setProps(p);
          setScripts(row.data.scripts ?? narrationScripts(p));
        } else if (q) {
          const p = { ...toReelProps(q), ...loadPrefs() };
          setProps(p);
          setScripts(narrationScripts(p));
        } else {
          throw new Error(`প্রশ্ন #${row.question_id} আনা গেল না।`);
        }
        setReady(true);
        setStatus({ kind: "ok", text: `Reel #${reelId} (প্রশ্ন #${row.question_id}) খোলা হয়েছে। যা বদলাবেন নিজে থেকে সেভ হবে।` });
      } catch (e) {
        if (!cancelled) setStatus({ kind: "error", text: (e as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reelId]);

  // Autosave: every change is written to the draft shortly after you stop typing.
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const firstSave = useRef(true);
  useEffect(() => {
    if (!ready || !props) return;
    if (firstSave.current) {
      firstSave.current = false;
      if (hadData.current) return; // just loaded, nothing new to write
    }
    setSaveState("saving");
    const id = setTimeout(() => {
      updateReel(reelId, { data: toData(props, scripts) })
        .then((row) => {
          setReel((r) => (r ? { ...r, ...row } : r));
          setSaveState("saved");
        })
        .catch(() => setSaveState("error"));
    }, 800);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props, scripts, ready]);

  useEffect(() => {
    if (props) savePrefs(props);
  }, [props?.theme, props?.music, props?.sfx]); // eslint-disable-line react-hooks/exhaustive-deps

  const edit = useMemo(() => (props && original && props.questionId === original.id ? diffQuestion(original, props) : null), [props, original]);

  const saveEdits = async () => {
    if (!props || !edit) return;
    setStatus({ kind: "busy", text: "ডাটাবেসে সেভ করছি…" });
    try {
      const saved = await saveQuestion(props.questionId, edit);
      setOriginal(saved);
      setStatus({ kind: "ok", text: `প্রশ্ন #${saved.id} ডাটাবেসে সেভ হয়েছে।` });
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
        audioBitrate: "high",
        signal: controller.signal,
        onProgress: (p) => setProgress(p.progress),
      });
      const blob = await getBlob();
      downloadBlob(blob, `nirnoy-reel-${reelId}-q${props.questionId}.mp4`);
      // Keep the render with the reel so it can be downloaded or posted later without rendering again.
      setStatus({ kind: "busy", text: "Video আর thumbnail reel-এ জমা রাখছি…" });
      await uploadMedia(reelId, blob, { file: "video.mp4" });
      await uploadMedia(reelId, await thumbnailBlob(props), { file: "thumb.jpg" });
      const row = await updateReel(reelId, reel?.status === "published" ? {} : { status: "rendered" });
      setReel((r) => (r ? { ...r, ...row } : r));
      setStatus({ kind: "ok", text: `Download হয়েছে, আর reel-এ জমা আছে (তালিকা থেকে আবার নামানো যাবে)।` });
    } catch (e) {
      setStatus({ kind: "error", text: controller.signal.aborted ? "বাতিল করা হয়েছে।" : `Render ব্যর্থ: ${(e as Error).message}` });
    } finally {
      setProgress(null);
      abortRef.current = null;
    }
  };

  const downloadThumbnail = async () => {
    if (!props) return;
    setStatus({ kind: "busy", text: "Thumbnail বানাচ্ছি…" });
    try {
      const blob = await thumbnailBlob(props);
      downloadBlob(blob, `nirnoy-thumbnail-${reelId}-q${props.questionId}.jpg`);
      await uploadMedia(reelId, blob, { file: "thumb.jpg" }).catch(() => undefined);
      setStatus({ kind: "ok", text: `Download হয়েছে: nirnoy-thumbnail-${reelId}-q${props.questionId}.jpg` });
    } catch (e) {
      setStatus({ kind: "error", text: `Thumbnail ব্যর্থ: ${(e as Error).message}` });
    }
  };

  const activeSegments = (p: ReelProps) => SEGMENTS.filter((k) => k !== "explanation" || hasExplanation(p));

  /** Uploads a clip to the reel's folder in R2 and puts it on the segment (autosave records it). */
  const attachClip = async (key: SegmentKey, blob: Blob, source: ClipSource) => {
    const local = URL.createObjectURL(blob);
    const sec = await audioDuration(local).finally(() => URL.revokeObjectURL(local));
    const file = await uploadMedia(reelId, blob, { segment: key });
    setProps((p) => (p ? { ...p, voice: { ...p.voice, [key]: { url: mediaUrl(reelId, file), sec, source, file } } } : p));
    return sec;
  };

  const makeVoice = async (only?: SegmentKey) => {
    if (!props || !scripts) return;
    const keys = only ? [only] : activeSegments(props);
    setVoiceBusy(true);
    try {
      let total = 0;
      for (const [i, key] of keys.entries()) {
        const text = scripts[key].trim();
        if (!text) continue;
        // "সব voice বানান" never replaces your own recording or uploaded file; the per-segment button still can.
        const existing = props.voice[key];
        if (!only && existing && existing.source !== "tts") continue;
        setStatus({ kind: "busy", text: `Voice বানাচ্ছি (${i + 1}/${keys.length}): ${SEGMENT_LABELS[key]}` });
        total += await attachClip(key, await synthesize(text, voice, rate), "tts");
      }
      setStatus({ kind: "ok", text: `Voice তৈরি (${total.toFixed(1)} সেকেন্ড কথা)। Preview চালিয়ে শুনে নিন।` });
    } catch (e) {
      setStatus({ kind: "error", text: (e as Error).message });
    } finally {
      setVoiceBusy(false);
    }
  };

  const [recording, setRecording] = useState<{ key: SegmentKey; started: number; mic: Awaited<ReturnType<typeof startMic>> } | null>(null);
  const [recSeconds, setRecSeconds] = useState(0);
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setRecSeconds((Date.now() - recording.started) / 1000), 100);
    return () => clearInterval(id);
  }, [recording]);
  // Release the microphone if the studio unmounts mid-take.
  const micRef = useRef<Awaited<ReturnType<typeof startMic>> | null>(null);
  useEffect(() => () => micRef.current?.cancel(), []);

  const startRecording = async (key: SegmentKey) => {
    try {
      const mic = await startMic();
      micRef.current = mic;
      setRecSeconds(0);
      setRecording({ key, started: Date.now(), mic });
      setStatus({ kind: "busy", text: `রেকর্ড হচ্ছে: ${SEGMENT_LABELS[key]} — উপরের লেখাটা পড়ুন, শেষ হলে "থামান" চাপুন।` });
    } catch (e) {
      setStatus({ kind: "error", text: `মাইক চালু হয়নি: ${(e as Error).message}` });
    }
  };

  const stopRecording = async () => {
    if (!recording) return;
    const { key, mic } = recording;
    micRef.current = null;
    setRecording(null);
    try {
      const sec = await attachClip(key, await mic.stop(), "rec");
      setStatus({ kind: "ok", text: `${SEGMENT_LABELS[key]} রেকর্ড হয়েছে (${sec.toFixed(1)} সেকেন্ড)। শুনে দেখুন, পছন্দ না হলে আবার রেকর্ড করুন।` });
    } catch (e) {
      setStatus({ kind: "error", text: (e as Error).message });
    }
  };

  /** Takes a clip off (or all clips); the next autosave deletes the files from R2. */
  const removeClip = (key?: SegmentKey) => setProps((p) => (p ? { ...p, voice: key ? { ...p.voice, [key]: null } : {} } : p));

  const set = <K extends keyof ReelProps>(key: K, value: ReelProps[K]) => setProps((p) => (p ? { ...p, [key]: value } : p));
  const busy = status.kind === "busy";

  return (
    <div className="layout">
      <aside className="panel">
        <h1>
          নির্ণয় <span>Reel Studio</span>
        </h1>

        <div className="editor-head">
          <button className="link" onClick={() => navigate("/")}>
            ← সব reel
          </button>
          <span className={`save-state ${saveState}`}>
            {saveState === "saving" ? "সেভ হচ্ছে…" : saveState === "error" ? "সেভ হয়নি — আবার চেষ্টা করবে" : "সেভ হয়েছে ✓"}
          </span>
        </div>
        {reel ? (
          <p className="muted reel-meta">
            Reel #{reel.id} · প্রশ্ন #{reel.question_id} · <span className={`chip ${reel.status}`}>{STATUS_LABEL[reel.status]}</span>
          </p>
        ) : null}

        {props ? (
          <section className="groups">
            <details className="group" open>
              <summary>
                প্রশ্ন ও উত্তর <small>#{props.questionId}</small>
                {edit ? <span className="dot" title="ডাটাবেসে সেভ হয়নি" /> : null}
              </summary>
              <div className="group-body">
                <>
                  <label>
                    Act / Topic
                    <input value={props.act} onChange={(e) => set("act", e.target.value)} />
                  </label>
                  <label>
                    উৎস (পরীক্ষা, সাল)
                    <input value={props.source} onChange={(e) => set("source", e.target.value)} />
                  </label>
                </>
                <label>
                  প্রশ্ন <small>{props.body.length} অক্ষর</small>
                  <textarea rows={4} value={props.body} onChange={(e) => set("body", e.target.value)} />
                </label>
                <div className="options">
                  <div className="field-title">
                    অপশন <small>গোল বোতামে ঠিক উত্তর বাছুন</small>
                  </div>
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
                </div>
                <label>
                  ব্যাখ্যা <small>{props.explanation.length} অক্ষর{props.explanation.length > 450 ? " · লম্বা, ছোট করলে ভালো" : ""}</small>
                  <textarea rows={6} value={props.explanation} onChange={(e) => set("explanation", e.target.value)} />
                </label>
                <div className="row save-row">
                  <button className="secondary" disabled={busy || !edit} onClick={saveEdits}>
                    ডাটাবেসে সেভ করুন
                  </button>
                  <small>{edit ? "বদলেছে, সেভ হয়নি (টপিক নয়)" : "ডাটাবেসের সাথে মিলে আছে"}</small>
                </div>
              </div>
            </details>

            <details className="group" open>
              <summary>ডিজাইন ও শেষ পর্দা</summary>
              <div className="group-body">
                <label>
                  থিম
                  <select value={props.theme} onChange={(e) => set("theme", e.target.value as ThemeKey)}>
                    {(Object.keys(THEMES) as ThemeKey[]).map((k) => (
                      <option key={k} value={k}>
                        {THEMES[k].label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  ট্যাগলাইন
                  <input value={props.tagline} onChange={(e) => set("tagline", e.target.value)} />
                </label>
                {themeOf(props.theme).studio ? (
                  <>
                    <label>
                      স্লোগান <small>লোগোর পাশে</small>
                      <input value={props.slogan} onChange={(e) => set("slogan", e.target.value)} />
                    </label>
                    <label>
                      ছোট লাইন <small>কমা পর্যন্ত ম্লান, বাকিটা হাইলাইট</small>
                      <input value={props.subline} onChange={(e) => set("subline", e.target.value)} />
                    </label>
                  </>
                ) : null}
                <label>
                  কল-টু-অ্যাকশন লাইন
                  <input value={props.ctaLine} onChange={(e) => set("ctaLine", e.target.value)} />
                </label>
                <label>
                  বোতামের লেখা
                  <input value={props.ctaUrl} onChange={(e) => set("ctaUrl", e.target.value)} />
                </label>
              </div>
            </details>

            <details className="group">
              <summary>অডিও</summary>
              <div className="group-body">
                <label>
                  Background music
                  <select value={props.music} onChange={(e) => set("music", e.target.value as ReelProps["music"])}>
                    <option value="none">বন্ধ</option>
                    {(Object.keys(MUSIC) as MusicKey[]).map((k) => (
                      <option key={k} value={k}>
                        {MUSIC[k].label}
                      </option>
                    ))}
                  </select>
                </label>
                {props.music !== "none" ? <audio className="music-preview" controls src={MUSIC[props.music].url} /> : null}
                <div className="row toggles">
                  <label className="check">
                    <input type="checkbox" checked={props.sfx} onChange={(e) => set("sfx", e.target.checked)} />
                    Sound effect
                  </label>
                </div>
                <div className="voice">
                  <div className="field-title">Voice-over</div>
              <div className="row">
                <select value={voice} onChange={(e) => setVoice(e.target.value)}>
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
                <select value={rate} onChange={(e) => setRate(Number(e.target.value))} title="গতি">
                  <option value={-15}>ধীর</option>
                  <option value={-5}>স্বাভাবিক</option>
                  <option value={5}>একটু দ্রুত</option>
                </select>
              </div>
              {scripts
                ? activeSegments(props).map((key) => {
                    const clip = props.voice[key];
                    return (
                      <div key={key} className="segment">
                        <label>
                          {SEGMENT_LABELS[key]} {clip ? <small>{clip.sec.toFixed(1)} সে.{clip.source === "rec" ? " · নিজের গলা" : clip.source === "file" ? " · ফাইল" : ""}</small> : null}
                          <textarea
                            rows={key === "explanation" ? 4 : 2}
                            value={scripts[key]}
                            onChange={(e) => setScripts({ ...scripts, [key]: e.target.value })}
                          />
                        </label>
                        <div className="row small">
                          <button className="secondary" disabled={voiceBusy || !scripts[key].trim()} onClick={() => makeVoice(key)}>
                            {clip ? "আবার" : "বানান"}
                          </button>
                          {recording?.key === key ? (
                            <button className="rec on" onClick={stopRecording}>
                              ■ থামান {recSeconds.toFixed(1)}s
                            </button>
                          ) : (
                            <button className="rec" disabled={voiceBusy || recording !== null} onClick={() => startRecording(key)} title="নিজের গলায় রেকর্ড করুন">
                              🎙 রেকর্ড
                            </button>
                          )}
                          <label className="upload secondary" title="অডিও ফাইল দিন">
                            ফাইল
                            <input
                              type="file"
                              accept="audio/*"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) attachClip(key, f, "file").catch((err) => setStatus({ kind: "error", text: err.message }));
                                e.target.value = "";
                              }}
                            />
                          </label>
                          {clip ? (
                            <button className="link" onClick={() => removeClip(key)}>
                              বাদ
                            </button>
                          ) : null}
                        </div>
                        {clip ? <ClipPlayer url={clip.url} sec={clip.sec} /> : null}
                      </div>
                    );
                  })
                : null}
              <div className="row">
                <button disabled={voiceBusy} onClick={() => makeVoice()}>
                  {voiceBusy ? "বানাচ্ছি…" : "সব voice বানান"}
                </button>
                <button className="secondary" disabled={voiceBusy} onClick={() => setScripts(narrationScripts(props))} title="উপরের লেখা বদলালে narration আবার বানাতে">
                  লেখা আবার সাজান
                </button>
              </div>
              {Object.values(props.voice).some(Boolean) ? (
                <button className="link" onClick={() => removeClip()}>
                  সব voice বাদ দিন
                </button>
              ) : null}
                </div>
              </div>
            </details>
          </section>
        ) : null}

        {status.text ? <p className={`status ${status.kind}`}>{status.text}</p> : null}

      </aside>

      <main className="stage">
        {props ? (
          <>
            <div className="tabs">
              <button className={view === "video" ? "" : "secondary"} onClick={() => setView("video")}>
                Video
              </button>
              <button className={view === "thumbnail" ? "" : "secondary"} onClick={() => setView("thumbnail")}>
                Thumbnail
              </button>
            </div>
            <div className="player">
              {view === "thumbnail" ? (
                <Thumbnail
                  component={MCQThumbnail}
                  inputProps={props}
                  frameToDisplay={0}
                  durationInFrames={1}
                  fps={FPS}
                  compositionWidth={WIDTH}
                  compositionHeight={HEIGHT}
                  style={{ width: "100%", height: "100%" }}
                />
              ) : (
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
              )}
            </div>
            <div className="actions">
              <span className="muted">{(duration / FPS).toFixed(1)} সেকেন্ড · 1080×1920</span>
              {progress === null ? (
                <>
                  <button disabled={busy} onClick={render}>
                    MP4 Download
                  </button>
                  <button className="secondary" disabled={busy} onClick={downloadThumbnail}>
                    Thumbnail Download (JPG)
                  </button>
                </>
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
          <div className="empty">{status.kind === "error" ? status.text : "Reel খুলছি…"}</div>
        )}
      </main>
    </div>
  );
}
