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
for (const [name, fn] of Object.entries({ tick, chime, whoosh, music })) {
  writeFileSync(join(OUT, `${name}.wav`), wav(fn()));
  console.log(`wrote sfx/${name}.wav`);
}
