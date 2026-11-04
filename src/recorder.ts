/**
 * Microphone recording for the voice-over segments.
 *
 * The mic is captured as raw PCM through Web Audio and written straight to a 16-bit mono WAV —
 * no MediaRecorder, so no webm/mp4 codec that some browsers then refuse to decode
 * ("Unable to decode audio data"). Silence before and after the speech is trimmed off
 * (people click "record", breathe, then talk).
 */

export async function startMic(): Promise<{ stop: () => Promise<Blob>; cancel: () => void }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const ctx = new AudioContext();
  await ctx.resume();
  const source = ctx.createMediaStreamSource(stream);
  // ScriptProcessor is deprecated but works everywhere without a separate worklet file; output stays silent.
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  proc.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  source.connect(proc);
  proc.connect(ctx.destination);

  const release = () => {
    proc.onaudioprocess = null;
    source.disconnect();
    proc.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
  };

  return {
    stop: async () => {
      const rate = ctx.sampleRate;
      release();
      const samples = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
      let o = 0;
      for (const c of chunks) {
        samples.set(c, o);
        o += c.length;
      }
      return fromSamples(samples, rate);
    },
    cancel: release,
  };
}

const fromSamples = (samples: Float32Array, rate: number) => {
  const trimmed = trimSilence(samples, rate);
  if (trimmed.length < rate * 0.2) throw new Error("কোনো কথা শোনা যায়নি — মাইক চালু আছে কিনা দেখুন।");
  return encodeWav(trimmed, rate);
};

/** Cuts leading/trailing audio quieter than ~-46 dBFS, keeping 120 ms of breathing room. */
function trimSilence(samples: Float32Array, rate: number): Float32Array {
  const win = Math.round(rate * 0.02);
  const loud = (i: number) => {
    let peak = 0;
    for (let j = i; j < Math.min(samples.length, i + win); j++) peak = Math.max(peak, Math.abs(samples[j]));
    return peak > 0.005;
  };
  let start = 0;
  while (start < samples.length && !loud(start)) start += win;
  let end = samples.length;
  while (end > start && !loud(Math.max(start, end - win))) end -= win;
  const pad = Math.round(rate * 0.12);
  return samples.slice(Math.max(0, start - pad), Math.min(samples.length, end + pad));
}

function encodeWav(samples: Float32Array, rate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true));
  return new Blob([buf], { type: "audio/wav" });
}
