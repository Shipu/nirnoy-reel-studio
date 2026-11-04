import React from "react";
import { Img, spring } from "remotion";

/*
 * Niru, rigged. Every mascot from nirnoy.pen is exported as full-frame transparent layers
 * (src/remotion/assets/rig/<mascot>-<part>.png), so layers stack pixel-perfectly and each part
 * can move on its own. Pivot points are in the pen frame's own coordinates (420 or 735 px).
 *
 * All motion is a pure function of `t` (seconds since the mascot appeared), so the video renders
 * deterministically frame by frame.
 */

const RIG = import.meta.glob("./assets/rig/*.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const rig = (name: string) => RIG[`./assets/rig/${name}.png`];

type Pt = [number, number];

const Layer: React.FC<{ name: string; opacity?: number }> = ({ name, opacity = 1 }) => (
  <Img src={rig(name)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity }} />
);

/** A transform group with its pivot given in pen-frame pixels. */
const G: React.FC<React.PropsWithChildren<{ W: number; o: Pt; transform?: string; opacity?: number; filter?: string }>> = ({
  W, o, transform, opacity, filter, children,
}) => (
  <div
    style={{
      position: "absolute", inset: 0, transformOrigin: `${(o[0] / W) * 100}% ${(o[1] / W) * 100}%`, transform, opacity, filter,
    }}
  >
    {children}
  </div>
);

const TAU = Math.PI * 2;
const wave = (t: number, period: number, phase = 0) => Math.sin((t / period) * TAU + phase);
/** 0→1 with a little overshoot, starting at `start` seconds. */
const pop = (t: number, fps: number, start: number, damping = 11) =>
  spring({ frame: Math.max(0, (t - start) * fps), fps, config: { damping, stiffness: 160, mass: 0.6 } });
/** A short pulse (0→1→0) of `len` seconds, repeating every `every` seconds from `offset`. */
const pulse = (t: number, every: number, len: number, offset = 0) => {
  const ph = (((t - offset) % every) + every) % every;
  return ph < len ? Math.sin((ph / len) * Math.PI) : 0;
};
/** Eyes shut for ~0.13s every 2.8s, with a double blink every third time. */
const blinking = (t: number) => {
  const period = 2.8;
  const ph = ((t % period) + period) % period;
  const cycle = Math.floor(t / period);
  return ph < 0.13 || (cycle % 3 === 1 && ph > 0.26 && ph < 0.39);
};

const Eyes: React.FC<{ prefix: string; t: number }> = ({ prefix, t }) => {
  const shut = blinking(t);
  return (
    <>
      <Layer name={`${prefix}-eyes`} opacity={shut ? 0 : 1} />
      <Layer name={`${prefix}-lids`} opacity={shut ? 1 : 0} />
    </>
  );
};

type MascotProps = { t: number; fps: number };

/** Thinking: breathes, cap wobbles, brows lift, thought bubbles pop in one by one, then the idea bulb lights up and glows. */
export const NiruThinking: React.FC<MascotProps> = ({ t, fps }) => {
  const W = 420;
  const enter = pop(t, fps, 0, 13);
  const bob = (wave(t, 2.9) + 1) / 2; // 0..1
  const y = -bob * 10;
  const breathe = 1 + 0.018 * wave(t, 1.45);
  const brow = -5 * pulse(t, 3.7, 0.55, 1.2);
  const glow = 6 + 6 * ((wave(t, 1.1) + 1) / 2);
  const bulbIn = pop(t, fps, 1.05, 9);
  const raysIn = pop(t, fps, 1.3, 10);
  const float = (k: number) => `translateY(${wave(t, 2.4, k) * 4}px)`;

  return (
    <G W={W} o={[210, 380]} transform={`scale(${0.75 + 0.25 * enter})`} opacity={Math.min(1, enter * 1.5)}>
      <G W={W} o={[202, 380]} transform={`scaleX(${1 - bob * 0.1})`}>
        <Layer name="think-shadow" />
      </G>

      <G W={W} o={[230, 362]} transform={`translateY(${y}px) scaleY(${breathe})`}>
        <Layer name="think-body" />
        <Eyes prefix="think" t={t} />
        <G W={W} o={[180, 200]} transform={`translateY(${brow}px)`}>
          <Layer name="think-brows" />
        </G>
        <G W={W} o={[135, 222]} transform={`rotate(${wave(t, 2.9, -0.9) * 5}deg)`}>
          <Layer name="think-cap" />
        </G>
      </G>

      <G W={W} o={[218, 152]} transform={`${float(0)} scale(${pop(t, fps, 0.35)})`}>
        <Layer name="think-dotsSmall" />
      </G>
      <G W={W} o={[236, 134]} transform={`${float(0.8)} scale(${pop(t, fps, 0.55)})`}>
        <Layer name="think-dotsMid" />
      </G>
      <G W={W} o={[282, 75]} transform={`${float(1.6)} scale(${pop(t, fps, 0.75, 10)})`}>
        <Layer name="think-cloud" />
        <G W={W} o={[280, 80]} transform={`scale(${bulbIn * (1 + 0.05 * wave(t, 1.1))})`} filter={`drop-shadow(0 0 ${glow * bulbIn}px #FCB51B)`}>
          <Layer name="think-bulb" />
        </G>
        <G W={W} o={[280, 78]} transform={`scale(${raysIn * (0.9 + 0.14 * ((wave(t, 0.55) + 1) / 2))})`} opacity={raysIn * (0.65 + 0.35 * ((wave(t, 0.55) + 1) / 2))}>
          <Layer name="think-rays" />
        </G>
        <G W={W} o={[247, 92]} transform={`scale(${raysIn * (0.6 + 0.5 * ((wave(t, 0.9) + 1) / 2))}) rotate(${wave(t, 1.8) * 20}deg)`}>
          <Layer name="think-sparkL" />
        </G>
        <G W={W} o={[316, 96]} transform={`scale(${raysIn * (0.6 + 0.5 * ((wave(t, 0.9, Math.PI) + 1) / 2))}) rotate(${wave(t, 1.8, 1) * -20}deg)`}>
          <Layer name="think-sparkR" />
        </G>
      </G>
    </G>
  );
};

/** Pieces of confetti in the success frame: [pivot, fall distance, spin direction, delay]. */
const CONFETTI: [Pt, number, number, number][] = [
  [[50, 200], 46, 1, 0],
  [[82, 276], 40, -1, 0.5],
  [[96, 331], 34, 1, 1.1],
  [[314, 343], 36, -1, 0.3],
  [[323, 296], 42, 1, 0.9],
  [[365, 245], 44, -1, 0.15],
  [[272, 68], 50, 1, 0.7],
];

/** Correct answer: jumps in, keeps hopping, waves the trophy (which glints), cap bounces, confetti drifts and spins. */
export const NiruSuccess: React.FC<MascotProps> = ({ t, fps }) => {
  const W = 420;
  const enter = pop(t, fps, 0, 9);
  const hop = Math.abs(wave(t, 1.3)); // 0..1, |sin| gives a bouncy hop
  const y = (1 - enter) * 90 - hop * 16;
  const squash = 1 - 0.04 * (1 - hop) * enter;
  const trophyIn = pop(t, fps, 0.25, 8);

  return (
    <G W={W} o={[210, 384]} opacity={Math.min(1, enter * 1.6)}>
      <G W={W} o={[209, 384]} transform={`scaleX(${1 - hop * 0.18})`} opacity={1 - hop * 0.3}>
        <Layer name="success-shadow" />
      </G>

      <G W={W} o={[220, 340]} transform={`translateY(${y}px) scale(${2 - squash}, ${squash})`}>
        <Layer name="success-body" />
        <Eyes prefix="success" t={t} />
        <G W={W} o={[180, 168]} transform={`translateY(${-4 * hop}px)`}>
          <Layer name="success-brows" />
        </G>
        <G W={W} o={[183, 148]} transform={`translateY(${-6 * hop}px) rotate(${wave(t, 1.3, 0.6) * 6}deg)`}>
          <Layer name="success-cap" />
        </G>
        <G W={W} o={[84, 140]} transform={`rotate(${wave(t, 0.65) * 7}deg) scale(${0.6 + 0.4 * trophyIn})`}>
          <Layer name="success-trophy" />
          <G
            W={W}
            o={[60, 72]}
            transform={`scale(${0.8 + 0.35 * ((wave(t, 0.45) + 1) / 2)})`}
            opacity={trophyIn * (0.5 + 0.5 * ((wave(t, 0.45) + 1) / 2))}
          >
            <Layer name="success-trophyRays" />
          </G>
        </G>
      </G>

      {CONFETTI.map(([o, fall, dir, delay], i) => {
        const period = 2.2;
        const p = (((t - delay) % period) + period) % period / period; // 0..1 loop
        const shown = t > delay ? Math.sin(p * Math.PI) : 0;
        return (
          <G key={i} W={W} o={o} transform={`translateY(${-fall / 2 + fall * p}px) rotate(${dir * 220 * p}deg)`} opacity={shown}>
            <Layer name={`success-c${i}`} />
          </G>
        );
      })}
    </G>
  );
};

/** End screen: bobs and breathes, pumps the thumbs-up, waves the other hand, cap tilts. */
export const NiruWave: React.FC<MascotProps> = ({ t, fps }) => {
  const W = 735;
  const enter = pop(t, fps, 0, 12);
  const bob = (wave(t, 2.4) + 1) / 2;
  const y = (1 - enter) * 120 - bob * 14;
  const breathe = 1 + 0.015 * wave(t, 1.2);
  const thumb = -14 * pulse(t, 1.6, 0.6, 0.4); // a quick "yes!" pump

  return (
    <G W={W} o={[326, 660]} opacity={Math.min(1, enter * 1.6)}>
      <G W={W} o={[326, 657]} transform={`scaleX(${1 - bob * 0.08})`}>
        <Layer name="wave-shadow" />
      </G>
      <G W={W} o={[330, 640]} transform={`translateY(${y}px) scaleY(${breathe})`}>
        <G W={W} o={[150, 470]} transform={`rotate(${wave(t, 1.9) * 7}deg)`}>
          <Layer name="wave-armL" />
        </G>
        <Layer name="wave-body" />
        <G W={W} o={[500, 420]} transform={`rotate(${thumb}deg)`}>
          <Layer name="wave-armR" />
        </G>
        <Eyes prefix="wave" t={t} />
        <G W={W} o={[290, 250]} transform={`translateY(${-6 * pulse(t, 3.2, 0.5, 1)}px)`}>
          <Layer name="wave-brows" />
        </G>
        <G W={W} o={[200, 190]} transform={`rotate(${wave(t, 2.4, -0.8) * 4}deg)`}>
          <Layer name="wave-cap" />
        </G>
      </G>
    </G>
  );
};
