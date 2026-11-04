// Generates the reel's sound files from plain math (no samples, no licences):
//   node scripts/make-sfx.mjs
// Writes 44.1 kHz mono 16-bit WAVs into src/remotion/sfx/.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RATE = 44100;
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "remotion", "sfx");

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const gain = peak > 0.98 ? 0.98 / peak : 1;
  samples.forEach((s, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s * gain)) * 32767), i * 2));
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const buffer = (seconds) => new Float64Array(Math.round(seconds * RATE));
const midi = (n) => 440 * 2 ** ((n - 69) / 12);

// Deterministic noise so every build produces identical files.
let seed = 7;
const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x3fffffff) - 1;

/** Soft woodblock-style tick for each countdown second. */
function tick() {
  const out = buffer(0.12);
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    const env = Math.exp(-t * 60);
    out[i] = 0.6 * env * Math.sin(2 * Math.PI * 1250 * t) + 0.25 * env * Math.sin(2 * Math.PI * 2500 * t);
  }
  return out;
}

/** Bright two-note chime (E6 then B6) for the answer reveal. */
function chime() {
  const out = buffer(1.6);
  const notes = [
    [midi(88), 0],
    [midi(95), 0.11],
  ];
  for (const [f, start] of notes) {
    for (let i = Math.round(start * RATE); i < out.length; i++) {
      const t = i / RATE - start;
      const env = Math.min(1, t * 400) * Math.exp(-t * 3.2);
      out[i] += 0.45 * env * (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * f * 2.76 * t) * Math.exp(-t * 8));
    }
  }
  return out;
}

/** Filtered-noise swoosh for scene changes. */
function whoosh() {
  const out = buffer(0.7);
  let lp = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    const p = t / 0.7;
    const env = Math.sin(Math.PI * Math.min(1, p)) ** 2;
    const cutoff = 0.02 + 0.25 * Math.sin(Math.PI * p);
    lp += cutoff * (noise() - lp);
    out[i] = 0.9 * env * lp;
  }
  return out;
}

/** Six ticks one second apart (last two louder) as a single track, so the player never drops one. */
function countdown() {
  const one = tick();
  const out = buffer(6 + one.length / RATE);
  for (let k = 0; k < 6; k++) {
    const g = k >= 4 ? 0.9 : 0.6;
    one.forEach((v, i) => (out[k * RATE + i] += g * v));
  }
  return out;
}

// ---- Background music beds. All 32 s, mixed quiet, faded at the edges. ----

const MUSIC_SECONDS = 32;
const TAU = 2 * Math.PI;
const fadeEdges = (out, seconds = 1.5) => {
  const fade = RATE * seconds;
  for (let i = 0; i < fade; i++) {
    out[i] *= i / fade;
    out[out.length - 1 - i] *= i / fade;
  }
  return out;
};
/** Adds `fn(t)` into `out` for `len` seconds starting at `start`. */
const add = (out, start, len, fn) => {
  const a = Math.round(start * RATE);
  const b = Math.min(out.length, a + Math.round(len * RATE));
  for (let i = Math.max(0, a); i < b; i++) out[i] += fn(i / RATE - start);
};
const kick = (out, at, gain) =>
  add(out, at, 0.35, (t) => gain * Math.exp(-t * 14) * Math.sin(TAU * (50 * t + (70 / 18) * (1 - Math.exp(-t * 18)))));
const hat = (out, at, gain, decay = 70) => add(out, at, 0.08, (t) => gain * Math.exp(-t * decay) * noise());
const snare = (out, at, gain) => {
  let lp = 0;
  add(out, at, 0.2, (t) => {
    const n = noise();
    lp += 0.35 * (n - lp);
    return gain * Math.exp(-t * 22) * (n - lp) + gain * 0.4 * Math.exp(-t * 30) * Math.sin(TAU * 190 * t);
  });
};
/** Scales a bed to the same loudness (RMS) as the original calm track, so switching tracks doesn't jump in volume. */
const level = (out, target = 0.169) => {
  let sum = 0;
  for (const v of out) sum += v * v;
  const g = target / Math.sqrt(sum / out.length);
  for (let i = 0; i < out.length; i++) out[i] *= g;
  return out;
};
/** One-pole low-pass over the whole bed to take the edge off. */
const soften = (out, k) => {
  let lp = 0;
  for (let i = 0; i < out.length; i++) out[i] = lp += k * (out[i] - lp);
  return out;
};

/** Lo-fi: swung 80 bpm beat, jazzy 7th chords on a wobbly electric piano, a bit of vinyl crackle. */
function lofi() {
  const out = buffer(MUSIC_SECONDS);
  const beat = 60 / 80;
  const chords = [
    [50, 53, 57, 60], // Dm7
    [55, 59, 62, 65], // G7
    [48, 52, 55, 59], // Cmaj7
    [57, 60, 64, 67], // Am7
  ];
  const bars = Math.ceil(MUSIC_SECONDS / (beat * 4));
  for (let b = 0; b < bars; b++) {
    const t0 = b * beat * 4;
    const chord = chords[b % chords.length];
    for (const [at, len] of [[0, 1.6], [1.6, 2.4]]) {
      for (const n of chord) {
        const f = midi(n) * (1 + 0.002 * noise());
        add(out, t0 + at * beat, len * beat, (t) => {
          const env = Math.min(1, t * 40) * Math.exp(-t * 1.6);
          return 0.07 * env * (Math.sin(TAU * f * t) + 0.35 * Math.sin(TAU * 2 * f * t)) * (1 + 0.15 * Math.sin(TAU * 4.5 * t));
        });
      }
    }
    add(out, t0, beat * 4, (t) => 0.13 * Math.min(1, t * 20) * Math.exp(-t * 0.6) * Math.sin(TAU * midi(chord[0] - 12) * t));
    for (let k = 0; k < 4; k++) {
      const at = t0 + k * beat;
      if (k === 0 || k === 2) kick(out, at, 0.5);
      if (k === 2) kick(out, at + beat * 0.66, 0.3);
      if (k === 1 || k === 3) snare(out, at, 0.18);
      hat(out, at, 0.05);
      hat(out, at + beat * 0.66, 0.035); // swung off-beat
    }
  }
  for (let i = 0; i < out.length; i += 1) if (noise() > 0.9993) add(out, i / RATE, 0.004, () => 0.05 * noise());
  return level(fadeEdges(soften(out, 0.35)));
}

/** Upbeat: 112 bpm pop groove, C–G–Am–F, sixteenth-note pluck arpeggio, four-on-the-floor kick and claps. */
function upbeat() {
  const out = buffer(MUSIC_SECONDS);
  const beat = 60 / 112;
  const chords = [
    [60, 64, 67], // C
    [55, 59, 62], // G
    [57, 60, 64], // Am
    [53, 57, 60], // F
  ];
  const bars = Math.ceil(MUSIC_SECONDS / (beat * 4));
  for (let b = 0; b < bars; b++) {
    const t0 = b * beat * 4;
    const chord = chords[b % chords.length];
    for (const n of chord) {
      const f = midi(n);
      add(out, t0, beat * 4, (t) => {
        const env = Math.min(1, t * 6) * (1 - Math.max(0, t - beat * 3.7) / (beat * 0.3));
        let s = 0;
        for (let h = 1; h <= 5; h++) s += Math.sin(TAU * f * h * t) / h;
        return 0.035 * env * s;
      });
    }
    for (let k = 0; k < 16; k++) {
      const f = midi(chord[k % 3] + 12 + (k % 8 >= 6 ? 12 : 0));
      add(out, t0 + (k * beat) / 4, beat / 2, (t) => 0.09 * Math.exp(-t * 18) * (Math.sin(TAU * f * t) + 0.3 * Math.sin(TAU * 3 * f * t)));
    }
    for (let k = 0; k < 8; k++) {
      const f = midi(chord[0] - 24);
      add(out, t0 + (k * beat) / 2, beat / 2, (t) => 0.16 * Math.exp(-t * 6) * Math.sin(TAU * f * t));
    }
    for (let k = 0; k < 4; k++) {
      const at = t0 + k * beat;
      kick(out, at, 0.55);
      if (k % 2 === 1) snare(out, at, 0.22);
      hat(out, at + beat / 2, 0.06, 90);
    }
  }
  return level(fadeEdges(soften(out, 0.5)));
}

/** Suspense: A-minor drone with a pulsing low note and sparse bells — for the "think" mood. */
function suspense() {
  const out = buffer(MUSIC_SECONDS);
  const beat = 60 / 90;
  const roots = [45, 41, 38, 40]; // A, F, D, E
  const bars = Math.ceil(MUSIC_SECONDS / (beat * 4));
  for (let b = 0; b < bars; b++) {
    const t0 = b * beat * 4;
    const r = roots[b % roots.length];
    const third = r === 40 ? 4 : 3; // E major for the pull back to A minor
    for (const n of [r, r + 7, r + 12 + third]) {
      const f = midi(n);
      add(out, t0, beat * 4, (t) => {
        const env = Math.min(1, t * 1.5) * (1 - Math.max(0, t - beat * 3.4) / (beat * 0.6));
        return 0.06 * env * (Math.sin(TAU * f * t) + 0.2 * Math.sin(TAU * 2.01 * f * t)) * (0.8 + 0.2 * Math.sin(TAU * 0.25 * t));
      });
    }
    for (let k = 0; k < 8; k++) {
      const f = midi(r - 12);
      add(out, t0 + (k * beat) / 2, beat / 2, (t) => 0.14 * Math.exp(-t * 9) * Math.sin(TAU * f * t));
      hat(out, t0 + (k * beat) / 2 + beat / 4, 0.025, 120);
    }
    if (b % 2 === 1) {
      const f = midi(r + 31);
      add(out, t0 + beat * 2, 2.5, (t) => 0.07 * Math.exp(-t * 2) * (Math.sin(TAU * f * t) + 0.4 * Math.sin(TAU * f * 2.76 * t) * Math.exp(-t * 6)));
    }
  }
  return level(fadeEdges(soften(out, 0.3)));
}

/** Music box: gentle pentatonic bell melody over a soft pad, 70 bpm. */
function musicbox() {
  const out = buffer(MUSIC_SECONDS);
  const beat = 60 / 70;
  const pad = [
    [48, 55, 64],
    [45, 52, 60],
    [41, 48, 57],
    [43, 50, 59],
  ];
  const melody = [76, 79, 81, 79, 76, 74, 72, 74, 76, 74, 72, 69, 72, 74, 76, 79];
  const bars = Math.ceil(MUSIC_SECONDS / (beat * 4));
  for (let b = 0; b < bars; b++) {
    const t0 = b * beat * 4;
    for (const n of pad[b % pad.length]) {
      const f = midi(n);
      add(out, t0, beat * 4, (t) => 0.045 * Math.min(1, t * 2) * (1 - Math.max(0, t - beat * 3.5) / (beat * 0.5)) * Math.sin(TAU * f * t));
    }
    for (let k = 0; k < 4; k++) {
      const n = melody[(b * 4 + k) % melody.length];
      const f = midi(n);
      add(out, t0 + k * beat, beat * 2, (t) => {
        const env = Math.min(1, t * 300) * Math.exp(-t * 2.4);
        return 0.12 * env * (Math.sin(TAU * f * t) + 0.35 * Math.sin(TAU * 3 * f * t) * Math.exp(-t * 5) + 0.15 * Math.sin(TAU * 4.2 * f * t) * Math.exp(-t * 9));
      });
    }
  }
  return level(fadeEdges(out));
}

/** Calm study bed: I–vi–IV–V pad with a soft pluck, 32 s so any reel length fits. */
function music() {
  const seconds = 32;
  const out = buffer(seconds);
  const bar = 2; // seconds per chord
  const chords = [
    [57, 60, 64, 69], // A minor-ish colour over C major progression, kept mellow
    [53, 57, 60, 65],
    [55, 59, 62, 67],
    [52, 55, 60, 64],
  ];
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    const chord = chords[Math.floor(t / bar) % chords.length];
    const tc = t % bar;
    const swell = Math.min(1, tc * 3) * (1 - Math.max(0, tc - (bar - 0.25)) / 0.25);
    let s = 0;
    for (const n of chord) {
      const f = midi(n);
      s += 0.11 * swell * (Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(2 * Math.PI * f * 2 * t + 0.4));
    }
    // Pluck on every half bar, notes from the chord.
    const step = Math.floor(t / (bar / 4));
    const tp = t % (bar / 4);
    const pf = midi(chord[step % chord.length] + 12);
    s += 0.16 * Math.exp(-tp * 9) * Math.sin(2 * Math.PI * pf * tp);
    // Bass.
    s += 0.12 * Math.sin(2 * Math.PI * midi(chord[0] - 12) * t) * swell;
    out[i] = s;
  }
  // Fade the file edges.
  const fade = RATE * 1.5;
  for (let i = 0; i < fade; i++) {
    out[i] *= i / fade;
    out[out.length - 1 - i] *= i / fade;
  }
  return out;
}

mkdirSync(OUT, { recursive: true });
const FILES = { tick, chime, whoosh, countdown, music, lofi, upbeat, suspense, musicbox };
for (const [name, fn] of Object.entries(FILES)) {
  writeFileSync(join(OUT, `${name}.wav`), wav(fn()));
  console.log(`wrote sfx/${name}.wav`);
}
