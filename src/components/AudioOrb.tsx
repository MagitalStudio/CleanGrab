// SPDX-License-Identifier: GPL-3.0-only
import { useEffect, useRef } from "react";

interface AudioOrbProps {
  /** Where the sound is read from. `null` when it cannot be: the ring then stays still. */
  analyser: AnalyserNode | null;
  /** Whether the sound is playing right now. */
  playing: boolean;
}

/** Lines around the ring. */
const POINTS = 120;
/** How many of the analyser's frequency bins are used (up to about 8 kHz). */
const USABLE_BINS = 190;

/** The accent colour, as [r, g, b], from the palette in force. */
function readAccent(): [number, number, number] {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--accent-fill").trim().split(/\s+/).map(Number);
  return raw.length === 3 && raw.every(Number.isFinite) ? [raw[0], raw[1], raw[2]] : [0, 113, 227];
}

/**
 * A circular spectrum made of lines: a ring of short lines that, as the music plays, grow outwards.
 * With no sound it is a perfect, motionless ring; the louder the sound, the longer the lines
 * and the harder the ring pulses. Low notes act at the bottom, high notes at the top,
 * mirrored left and right. Flat colour, no glow.
 */
export default function AudioOrb({ analyser, playing }: AudioOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Read by the drawing loop each frame, so the loop never has to restart.
  const live = useRef({ analyser, playing });
  live.current = { analyser, playing };

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const targets = new Float32Array(POINTS);
    const spread = new Float32Array(POINTS); // how long each line is, 0 to 1, eased
    let bins: Uint8Array<ArrayBuffer> | null = null;
    let binsOf: AnalyserNode | null = null;
    let level = 0;
    let bass = 0;
    let last = performance.now();
    let frameCount = 0;
    let accent = readAccent();
    let drawnStill = false;

    const resize = () => {
      const size = Math.max(1, Math.round(canvas.getBoundingClientRect().width * (window.devicePixelRatio || 1)));
      canvas.width = size;
      canvas.height = size;
      drawnStill = false;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    let frame = 0;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (frameCount++ % 30 === 0) accent = readAccent();
      // A small spectrum (in the little player) has fewer, so that its lines do not run together.
      const count = canvas.width < 160 ? 32 : POINTS;

      // 1. What the sound asks for.
      const { analyser: node, playing: on } = live.current;
      let heard = 0;
      let heardBass = 0;
      targets.fill(0);
      if (node && on) {
        if (binsOf !== node) {
          bins = new Uint8Array(node.frequencyBinCount);
          binsOf = node;
        }
        const data = bins as Uint8Array<ArrayBuffer>;
        node.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < 120; i++) sum += data[i];
        heard = Math.min(1, (sum / 120 / 255) * 2.2);
        let low = 0;
        for (let i = 1; i < 7; i++) low += data[i];
        heardBass = Math.min(1, (low / 6 / 255) * 1.4);

        for (let i = 0; i < count; i++) {
          const t = i / count;
          const fromBottom = t < 0.5 ? t * 2 : (1 - t) * 2; // 0 at the bottom, 1 at the top: mirrored
          const bin = 1 + Math.floor(Math.pow(fromBottom, 1.7) * (USABLE_BINS - 2));
          const value = (data[bin - 1] + data[bin] * 2 + data[bin + 1]) / 4 / 255;
          targets[i] = Math.pow(value, 1.5);
        }
      }

      // 2. Ease towards it: quick to rise, slower to fall, so it moves like something alive.
      level += (heard - level) * (1 - Math.exp(-dt * (heard > level ? 18 : 6)));
      bass += (heardBass - bass) * (1 - Math.exp(-dt * (heardBass > bass ? 22 : 7)));
      let peak = 0;
      for (let i = 0; i < count; i++) {
        spread[i] += (targets[i] - spread[i]) * (1 - Math.exp(-dt * (targets[i] > spread[i] ? 30 : 8)));
        peak = Math.max(peak, spread[i]);
      }

      // Nothing is moving and it has been drawn: leave the picture as it is.
      if (level < 0.002 && bass < 0.002 && peak < 0.002) {
        if (drawnStill) return;
        level = bass = 0;
        spread.fill(0);
        drawnStill = true;
      } else {
        drawnStill = false;
      }

      // 3. The lines: one at each place on the ring, pointing outwards, longer with the sound.
      const size = canvas.width;
      const centre = size / 2;
      const motion = reducedMotion ? 0 : 1;
      const radius = size * 0.24 * (1 + bass * 0.06 * motion);
      const width = Math.max(1.6, size * 0.0072);
      const resting = size * 0.012; // a short tick when there is no sound, so the ring is already a ring of lines
      const longest = size * 0.2;

      const [r, g, b] = accent;
      context.clearRect(0, 0, size, size);
      context.strokeStyle = `rgb(${r}, ${g}, ${b})`;
      context.lineWidth = width;
      context.lineCap = "round";
      context.beginPath();
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + Math.PI / 2; // line 0 is at the bottom
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const inner = radius;
        const outer = radius + resting + spread[i] * longest * motion;
        context.moveTo(centre + cos * inner, centre + sin * inner);
        context.lineTo(centre + cos * outer, centre + sin * outer);
      }
      context.stroke();
    };
    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  // As big as its container allows (a size container), up to a limit, and always square.
  const side = "min(100cqw, 100cqh, 720px)";
  return <canvas ref={canvasRef} aria-hidden="true" className="shrink-0" style={{ width: side, height: side }} />;
}
