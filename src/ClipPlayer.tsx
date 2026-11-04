import { useEffect, useRef, useState } from "react";

/** Big, obvious play/stop button with a progress bar for one voice clip (the native <audio> bar was too cramped to notice). */
export function ClipPlayer({ url, sec }: { url: string; sec: number }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);

  useEffect(() => {
    const el = new Audio(url);
    ref.current = el;
    el.ontimeupdate = () => setAt(el.currentTime);
    el.onended = () => {
      setPlaying(false);
      setAt(0);
    };
    return () => {
      el.pause();
      ref.current = null;
    };
  }, [url]);

  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (playing) {
      el.pause();
      el.currentTime = 0;
      setAt(0);
      setPlaying(false);
    } else {
      void el.play();
      setPlaying(true);
    }
  };

  return (
    <div className="clip-player">
      <button type="button" className={playing ? "play on" : "play"} onClick={toggle}>
        {playing ? "■ থামান" : "▶ শুনুন"}
      </button>
      <div className="clip-bar">
        <div style={{ width: `${Math.min(100, (at / Math.max(sec, 0.01)) * 100)}%` }} />
      </div>
      <span className="clip-time">
        {at.toFixed(1)} / {sec.toFixed(1)}s
      </span>
    </div>
  );
}
