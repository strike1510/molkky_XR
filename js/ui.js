// Panneaux d'interface 3D dessinés sur canvas (utilisables en VR au rayon du contrôleur)
import * as THREE from 'three';

export const COULEURS = {
  fond: 'rgba(18, 28, 38, 0.88)',
  texte: '#f2efe6',
  doux: '#a9b4bf',
  accent: '#f2b84b',
  vert: '#6fd37a',
  rouge: '#ff6b6b',
  bouton: '#2e4457',
  boutonSurvol: '#3f6382',
  boutonActif: '#c98b2a',
};

export function rectArrondi(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function texte(ctx, t, x, y, taille, couleur = COULEURS.texte, align = 'left', gras = false) {
  ctx.font = `${gras ? 'bold ' : ''}${taille}px "Segoe UI", Arial, sans-serif`;
  ctx.fillStyle = couleur;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(t, x, y);
}

export class Panneau {
  constructor(largeurPx, hauteurPx, largeurM, dessin) {
    this.w = largeurPx;
    this.h = hauteurPx;
    this.canvas = document.createElement('canvas');
    this.canvas.width = largeurPx;
    this.canvas.height = hauteurPx;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(largeurM, (largeurM * hauteurPx) / largeurPx),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, toneMapped: false }),
    );
    this.mesh.userData.panneau = this;
    this.boutons = [];
    this.survol = null;
    this.dessin = dessin;
  }

  fond() {
    const c = this.ctx;
    rectArrondi(c, 4, 4, this.w - 8, this.h - 8, 28);
    c.fillStyle = COULEURS.fond;
    c.fill();
  }

  bouton(id, label, x, y, w, h, actif = false) {
    const c = this.ctx;
    this.boutons.push({ id, x, y, w, h });
    rectArrondi(c, x, y, w, h, 16);
    c.fillStyle = actif ? COULEURS.boutonActif : this.survol === id ? COULEURS.boutonSurvol : COULEURS.bouton;
    c.fill();
    if (this.survol === id) { c.lineWidth = 4; c.strokeStyle = COULEURS.accent; c.stroke(); }
    texte(c, label, x + w / 2, y + h / 2 + 2, Math.min(44, h * 0.45), COULEURS.texte, 'center', true);
  }

  rafraichir() {
    this.ctx.clearRect(0, 0, this.w, this.h);
    this.boutons = [];
    this.dessin(this, this.ctx);
    this.texture.needsUpdate = true;
  }

  boutonA(uv) {
    const x = uv.x * this.w, y = (1 - uv.y) * this.h;
    const b = this.boutons.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    return b ? b.id : null;
  }

  setSurvol(id) {
    if (id !== this.survol) { this.survol = id; this.rafraichir(); }
  }
}
