import { useEffect, useRef } from 'react';

/*
 * Electric plasma orb: lightning filaments crawling over a rotating 3D
 * sphere, drawn on a canvas with additive blending. Filaments are born,
 * glow and fade continuously; mic / voice levels make them crackle.
 */

// [bottom-left colour, top-right colour] per state
const PALETTES = {
  idle: [[236, 79, 216], [109, 93, 252]],
  listening: [[255, 92, 196], [178, 92, 255]],
  thinking: [[150, 100, 255], [64, 140, 255]],
  speaking: [[226, 84, 240], [110, 120, 255]],
};
const VEINS = 34;

const STATE_MOTION = {
  // rotation (rad/s), filament churn rate, base jitter
  idle: [0.16, 1, 0.012],
  listening: [0.3, 1.6, 0.02],
  thinking: [0.95, 2.6, 0.016],
  speaking: [0.24, 1.4, 0.014],
};

const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function randomUnit() {
  const u = Math.random() * 2 - 1;
  const t = Math.random() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return [s * Math.cos(t), s * Math.sin(t), u];
}

/** A jagged random walk along the sphere surface. */
function makeVein(initialAge) {
  let p = randomUnit();
  let d = norm(cross(p, randomUnit()));
  const steps = 22 + Math.floor(Math.random() * 30);
  const pts = [];
  for (let i = 0; i < steps; i++) {
    pts.push({ p, j: [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5] });
    const turn = (Math.random() - 0.5) * 1.5;
    const b = cross(p, d);
    d = norm([
      d[0] * Math.cos(turn) + b[0] * Math.sin(turn),
      d[1] * Math.cos(turn) + b[1] * Math.sin(turn),
      d[2] * Math.cos(turn) + b[2] * Math.sin(turn),
    ]);
    const step = 0.055 + Math.random() * 0.055;
    p = norm([p[0] + d[0] * step, p[1] + d[1] * step, p[2] + d[2] * step]);
    const k = dot(d, p);
    d = norm([d[0] - p[0] * k, d[1] - p[1] * k, d[2] - p[2] * k]);
  }
  const life = 1.6 + Math.random() * 3.4;
  return { pts, life, age: initialAge ? Math.random() * life : 0, seed: Math.random() * 1000 };
}

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

export default function Orb({ state, engine, size, onActivate, label }) {
  const canvasRef = useRef(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const veins = Array.from({ length: VEINS }, () => makeVein(true));
    const bins = new Uint8Array(256);
    const colA = [...PALETTES.idle[0]];
    const colB = [...PALETTES.idle[1]];
    const motion = [...STATE_MOTION.idle];
    let angle = 0;
    let energy = 0;
    let last = performance.now();
    let raf;

    const frame = (now) => {
      const dt = Math.max(0, Math.min((now - last) / 1000, 0.05));
      last = now;
      const st = stateRef.current;
      const k = Math.min(1, dt * 3);
      const [pa, pb] = PALETTES[st] || PALETTES.idle;
      const tm = STATE_MOTION[st] || STATE_MOTION.idle;
      for (let i = 0; i < 3; i++) {
        colA[i] += (pa[i] - colA[i]) * k;
        colB[i] += (pb[i] - colB[i]) * k;
        motion[i] += (tm[i] - motion[i]) * k;
      }

      // Audio energy (0..1)
      let level = 0;
      if (engine.getFrequencies(bins)) {
        let sum = 0;
        for (let i = 2; i < 96; i++) sum += bins[i];
        level = Math.min(1, Math.pow(sum / (94 * 255), 0.8) * 1.6);
      } else if (st === 'thinking') {
        level = 0.18 + 0.12 * Math.sin(now / 160);
      }
      energy += (level - energy) * Math.min(1, dt * 10);
      energy = Math.max(0, Math.min(1, energy));

      const slow = reduceMotion ? 0.15 : 1;
      angle += dt * (motion[0] + energy * 0.6) * slow;
      const churn = (motion[1] + energy * 2.5) * slow;
      const jitter = motion[2] + energy * 0.055;

      const c = size / 2;
      const R = size * 0.34 * (1 + energy * 0.06);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      ctx.globalCompositeOperation = 'source-over';

      // Outer halo
      const halo = ctx.createRadialGradient(c, c, R * 0.7, c, c, R * 1.55);
      halo.addColorStop(0, rgba(colB, 0.32 + energy * 0.3));
      halo.addColorStop(0.45, rgba(mix(colB, colA, 0.4), 0.12 + energy * 0.12));
      halo.addColorStop(1, rgba(colB, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, size, size);

      // Sphere body: dark core, glowing rim
      const body = ctx.createRadialGradient(c - R * 0.15, c - R * 0.2, R * 0.1, c, c, R * 1.02);
      body.addColorStop(0, 'rgba(18, 10, 52, 0.55)');
      body.addColorStop(0.7, rgba(mix(colB, [20, 12, 60], 0.6), 0.45));
      body.addColorStop(0.93, rgba(mix(colA, colB, 0.5), 0.35 + energy * 0.25));
      body.addColorStop(1, rgba(colB, 0));
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(c, c, R * 1.02, 0, Math.PI * 2);
      ctx.fill();

      // Filaments
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const tilt = 0.35;
      const cosT = Math.cos(tilt);
      const sinT = Math.sin(tilt);
      const tSec = now / 1000;

      for (let v = 0; v < veins.length; v++) {
        let vein = veins[v];
        vein.age += dt * churn;
        if (vein.age >= vein.life) {
          vein = veins[v] = makeVein(false);
        }
        const lifeAlpha = Math.pow(Math.sin((Math.PI * vein.age) / vein.life), 0.6);
        if (lifeAlpha <= 0.01) continue;

        // Project points
        const proj = vein.pts.map(({ p, j }, i) => {
          const wob = Math.sin(tSec * 9 + vein.seed + i * 1.7) * jitter * 2;
          const x0 = p[0] + j[0] * wob;
          const y0 = p[1] + j[1] * wob;
          const z0 = p[2] + j[2] * wob;
          const x1 = x0 * cosA + z0 * sinA;
          const z1 = -x0 * sinA + z0 * cosA;
          const y2 = y0 * cosT - z1 * sinT;
          const z2 = y0 * sinT + z1 * cosT;
          return [c + x1 * R, c + y2 * R, z2];
        });

        // Draw in short chunks so colour/depth vary along the filament
        for (let s = 0; s < proj.length - 1; s += 4) {
          const end = Math.min(proj.length - 1, s + 5);
          const mid = proj[(s + end) >> 1];
          const depth = 0.18 + 0.82 * ((mid[2] + 1) / 2); // back = dim
          const t = Math.max(0, Math.min(1, 0.5 + ((mid[1] - c) - (mid[0] - c)) / (2.4 * R)));
          const col = mix(colB, colA, t);
          const a = lifeAlpha * depth;

          ctx.beginPath();
          ctx.moveTo(proj[s][0], proj[s][1]);
          for (let i = s + 1; i <= end; i++) ctx.lineTo(proj[i][0], proj[i][1]);

          ctx.strokeStyle = rgba(col, 0.09 * a);
          ctx.lineWidth = 7;
          ctx.stroke();
          ctx.strokeStyle = rgba(col, 0.38 * a);
          ctx.lineWidth = 2.4;
          ctx.stroke();
          ctx.strokeStyle = rgba(mix(col, [255, 255, 255], 0.55), 0.85 * a);
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      // Rim light
      ctx.strokeStyle = rgba(mix(colA, colB, 0.5), 0.22 + energy * 0.3);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(c, c, R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [engine, size]);

  return (
    <button
      type="button"
      className={`orb orb--${state}`}
      style={{ width: size, height: size }}
      onClick={onActivate}
      aria-label={label}
      title={label}
    >
      <canvas ref={canvasRef} style={{ width: size, height: size }} />
    </button>
  );
}
