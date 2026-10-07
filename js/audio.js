// Sons 3D spatialisés, générés par code (aucun fichier audio externe)
import * as THREE from 'three';

function creerBuffer(ctx, duree, fn) {
  const sr = ctx.sampleRate;
  const n = Math.floor(duree * sr);
  const buf = ctx.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  let max = 0;
  for (let i = 0; i < n; i++) { d[i] = fn(i / sr, i); max = Math.max(max, Math.abs(d[i])); }
  if (max > 0) for (let i = 0; i < n; i++) d[i] *= 0.9 / max;
  return buf;
}

const bruit = () => Math.random() * 2 - 1;
const sin = (f, t) => Math.sin(2 * Math.PI * f * t);

function synthLancer(ctx) { // souffle du lancer
  let y = 0;
  return creerBuffer(ctx, 0.45, (t) => {
    const a = 0.02 + 0.15 * Math.sin(Math.PI * t / 0.45);
    y += a * (bruit() - y);
    return y * Math.sin(Math.PI * t / 0.45) ** 2;
  });
}

function synthImpact(ctx) { // bois lourd contre sol/quille
  return creerBuffer(ctx, 0.3, (t) =>
    sin(170, t) * Math.exp(-t / 0.06) + 0.6 * sin(420, t) * Math.exp(-t / 0.035) +
    0.3 * sin(950, t) * Math.exp(-t / 0.015) + (t < 0.006 ? bruit() * 0.8 : 0));
}

function synthQuille(ctx) { // claquement de quille qui tombe
  const coup = (t) => t < 0 ? 0 : sin(560, t) * Math.exp(-t / 0.03) + 0.7 * sin(1300, t) * Math.exp(-t / 0.018) +
    0.4 * sin(2150, t) * Math.exp(-t / 0.01) + (t < 0.004 ? bruit() : 0);
  return creerBuffer(ctx, 0.35, (t) => coup(t) + 0.5 * coup(t - 0.07) + 0.25 * coup(t - 0.13));
}

function synthNotes(ctx, notes, ecart, duree, tau) {
  return creerBuffer(ctx, duree, (t) => {
    let s = 0;
    notes.forEach((f, i) => {
      const dt = t - i * ecart;
      if (dt >= 0) s += (sin(f, dt) + 0.3 * sin(2 * f, dt)) * Math.exp(-dt / tau) * Math.min(1, dt * 200);
    });
    return s;
  });
}

export class Sons {
  constructor(camera) {
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);
    const ctx = this.listener.context;
    this.buffers = {
      lancer: synthLancer(ctx),
      impact: synthImpact(ctx),
      quille: synthQuille(ctx),
      victoire: synthNotes(ctx, [523.25, 659.25, 783.99, 1046.5, 1318.5], 0.13, 1.6, 0.45),
      defaite: synthNotes(ctx, [392, 349.2, 311.1, 233.1], 0.32, 2.2, 0.5),
    };
  }

  // Crée une source spatialisée attachée à un objet 3D
  creer(nom, parent, distanceRef = 1.5) {
    const s = new THREE.PositionalAudio(this.listener);
    s.setBuffer(this.buffers[nom]);
    s.setRefDistance(distanceRef);
    s.setRolloffFactor(1.2);
    parent.add(s);
    return s;
  }

  jouer(source, volume = 1) {
    const ctx = this.listener.context;
    if (ctx.state !== 'running') ctx.resume();
    if (source.isPlaying) source.stop();
    source.setVolume(volume);
    source.play();
  }

  debloquer() {
    const ctx = this.listener.context;
    if (ctx.state !== 'running') ctx.resume();
  }
}
