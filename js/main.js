import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import {
  DIFFICULTES, Partie, ECHECS_MAX, SCORE_CIBLE, SCORE_RETOUR,
  chargerRecord, sauvegarderFinPartie, formaterTemps,
} from './game.js';
import { Sons } from './audio.js';
import { Panneau, COULEURS, texte } from './ui.js';

// ------------------------------------------------------------------
// Dimensions réelles approximatives (mètres / kg)
// ------------------------------------------------------------------
const Q_R = 0.029, Q_H = 0.15, Q_MASSE = 0.2;   // quille
const M_R = 0.029, M_L = 0.225, M_MASSE = 0.4;  // Mölkky (bâton de lancer)
const ESPACEMENT = 2 * Q_R + 0.004;
const LIGNE_Z = -0.3;                            // ligne de lancer (avant de la zone)
const SUPPORT = new THREE.Vector3(0.32, 0.95, -0.15); // où le Mölkky attend d'être saisi
const DISTANCE_SAISIE = 0.3;
const SEUIL_TOMBEE = 0.75;                       // cos de l'inclinaison max d'une quille debout (~41°)
// Configuration initiale officielle (rangée la plus proche du joueur en premier)
const DISPOSITION = [[1, 2], [3, 10, 4], [5, 11, 12, 6], [7, 9, 8]];

// ------------------------------------------------------------------
// Rendu
// ------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fd3f0);
scene.fog = new THREE.Fog(0x9fd3f0, 18, 45);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 100);
const sons = new Sons(camera);

scene.add(new THREE.HemisphereLight(0xdff2ff, 0x4a6b35, 1.4));
const soleil = new THREE.DirectionalLight(0xfff2dd, 2.2);
soleil.position.set(3, 8, 2);
soleil.castShadow = true;
soleil.shadow.mapSize.set(2048, 2048);
Object.assign(soleil.shadow.camera, { left: -3, right: 3, top: 2, bottom: -8, near: 1, far: 20 });
soleil.shadow.bias = -0.0005;
scene.add(soleil);

// Sol en herbe (texture procédurale)
function textureHerbe() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#4c8a38'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 6000; i++) {
    const v = 110 + Math.random() * 70;
    g.fillStyle = `rgb(${v * 0.45},${v},${v * 0.3})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(40, 40);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const sol = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ map: textureHerbe(), roughness: 1 }));
sol.rotation.x = -Math.PI / 2;
sol.receiveShadow = true;
scene.add(sol);

// Zone de lancer : rectangle + ligne de lancer
const matLigne = new THREE.MeshBasicMaterial({ color: 0xffffff });
function bande(w, d, x, z) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), matLigne);
  m.rotation.x = -Math.PI / 2; m.position.set(x, 0.002, z); scene.add(m);
}
bande(1.0, 0.04, 0, LIGNE_Z);   // ligne de lancer
bande(1.0, 0.02, 0, 0.4);
bande(0.02, 0.7, -0.5, 0.05);
bande(0.02, 0.7, 0.5, 0.05);

// Petit support où repose le Mölkky
const support = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.3), new THREE.MeshStandardMaterial({ color: 0x6b4a2b }));
support.position.set(SUPPORT.x, SUPPORT.y - M_R - 0.02, SUPPORT.z);
const pied = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, support.position.y, 10), support.material);
pied.position.set(SUPPORT.x, support.position.y / 2, SUPPORT.z);
support.castShadow = pied.castShadow = true;
scene.add(support, pied);

// ------------------------------------------------------------------
// Physique (cannon-es)
// ------------------------------------------------------------------
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.solver.iterations = 20;
const PAS_PHYSIQUE = 1 / 360;
// cannon-es borne l'impulsion de frottement par pas (et non par seconde) : on la ramène à l'échelle du pas,
// sinon les quilles sont « collées » au sol et absorbent l'élan du Mölkky.
world.frictionGravity = new CANNON.Vec3(0, (9.82 * 3) * PAS_PHYSIQUE, 0);

const matSol = new CANNON.Material('sol');
const matBois = new CANNON.Material('bois');
world.addContactMaterial(new CANNON.ContactMaterial(matBois, matBois, { friction: 0.35, restitution: 0.25 }));
world.addContactMaterial(new CANNON.ContactMaterial(matBois, matSol, { friction: 1.0, restitution: 0.12 }));

const corpsSol = new CANNON.Body({ mass: 0, material: matSol, shape: new CANNON.Plane() });
corpsSol.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(corpsSol);

// ------------------------------------------------------------------
// Quilles numérotées
// ------------------------------------------------------------------
const couleurBois = '#dcb784';
function textureCote(n) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = couleurBois; g.fillRect(0, 0, 256, 128);
  g.fillStyle = 'rgba(120,80,40,0.15)';
  for (let y = 0; y < 128; y += 6) g.fillRect(0, y + Math.random() * 3, 256, 1);
  g.font = 'bold 64px Arial'; g.fillStyle = '#2b1d10'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const x of [0, 128, 256]) g.fillText(String(n), x, 40); // u=0 et u=0.5 : face avant et arrière
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function textureDessus(n) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = couleurBois; g.fillRect(0, 0, 128, 128);
  g.font = 'bold 72px Arial'; g.fillStyle = '#2b1d10'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(n), 64, 68);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const geoQuille = new THREE.CylinderGeometry(Q_R, Q_R, Q_H, 20);
const matDessous = new THREE.MeshStandardMaterial({ color: couleurBois, roughness: 0.8 });
const quilles = [];
for (let n = 1; n <= 12; n++) {
  const mesh = new THREE.Mesh(geoQuille, [
    new THREE.MeshStandardMaterial({ map: textureCote(n), roughness: 0.8 }),
    new THREE.MeshStandardMaterial({ map: textureDessus(n), roughness: 0.8 }),
    matDessous,
  ]);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  const body = new CANNON.Body({
    mass: Q_MASSE, material: matBois, shape: new CANNON.Cylinder(Q_R, Q_R, Q_H, 12),
    linearDamping: 0.05, angularDamping: 0.25, allowSleep: false, // jamais endormies : sinon elles agissent comme un mur au premier contact
  });
  world.addBody(body);
  quilles.push({ n, mesh, body, tombee: false, son: sons.creer('quille', mesh) });
}

function poserDebout(q, x, z) {
  q.body.position.set(x, Q_H / 2 + 0.001, z);
  q.body.quaternion.set(0, 0, 0, 1);
  q.body.velocity.setZero();
  q.body.angularVelocity.setZero();
  q.tombee = false;
}

function placerQuillesDepart(distance) {
  const pas = ESPACEMENT * 0.866;
  DISPOSITION.forEach((rangee, r) => {
    rangee.forEach((n, i) => {
      const x = (i - (rangee.length - 1) / 2) * ESPACEMENT;
      poserDebout(quilles[n - 1], x, LIGNE_Z - distance - r * pas);
    });
  });
}

function estTombee(q) {
  const haut = q.body.quaternion.vmult(new CANNON.Vec3(0, 1, 0));
  return haut.y < SEUIL_TOMBEE;
}

// Relève chaque quille tombée là où elle se trouve (décalée si elle chevauche une autre)
function releverQuilles(tombees) {
  for (const q of tombees) {
    let x = q.body.position.x, z = q.body.position.z;
    for (let essai = 0; essai < 8; essai++) {
      let bouge = false;
      for (const o of quilles) {
        if (o === q) continue;
        const dx = x - o.body.position.x, dz = z - o.body.position.z;
        const d = Math.hypot(dx, dz);
        if (d < ESPACEMENT) {
          const a = d > 1e-4 ? Math.atan2(dz, dx) : Math.random() * Math.PI * 2;
          x = o.body.position.x + Math.cos(a) * ESPACEMENT;
          z = o.body.position.z + Math.sin(a) * ESPACEMENT;
          bouge = true;
        }
      }
      if (!bouge) break;
    }
    poserDebout(q, x, z);
  }
}

// ------------------------------------------------------------------
// Mölkky (bâton de lancer)
// ------------------------------------------------------------------
const molkky = new THREE.Mesh(
  new THREE.CylinderGeometry(M_R, M_R, M_L, 20),
  new THREE.MeshStandardMaterial({ color: 0xb07a42, roughness: 0.7 }),
);
molkky.castShadow = true;
scene.add(molkky);
const corpsMolkky = new CANNON.Body({
  mass: M_MASSE, material: matBois, shape: new CANNON.Cylinder(M_R, M_R, M_L, 12),
  linearDamping: 0.1, angularDamping: 0.85, allowSleep: false, // amortissement = résistance de l'herbe
});
world.addBody(corpsMolkky);
const sonLancer = sons.creer('lancer', molkky);
const sonImpact = sons.creer('impact', molkky);
let dernierImpact = 0;
corpsMolkky.addEventListener('collide', (e) => {
  if (etat !== 'vol') return;
  const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
  const t = performance.now();
  if (v > 0.6 && t - dernierImpact > 90) {
    dernierImpact = t;
    sons.jouer(sonImpact, Math.min(1, v / 5));
  }
});

function rendreCinematique() {
  corpsMolkky.type = CANNON.Body.KINEMATIC;
  corpsMolkky.velocity.setZero();
  corpsMolkky.angularVelocity.setZero();
  corpsMolkky.updateMassProperties();
}

function retourSupport() {
  rendreCinematique();
  corpsMolkky.position.set(SUPPORT.x, SUPPORT.y, SUPPORT.z);
  corpsMolkky.quaternion.setFromEuler(0, 0, Math.PI / 2); // couché sur le support
  molkky.position.copy(corpsMolkky.position);
  molkky.quaternion.copy(corpsMolkky.quaternion);
}

// ------------------------------------------------------------------
// État du jeu
// ------------------------------------------------------------------
let etat = 'menu';           // 'menu' | 'vise' | 'vol' | 'resultat' | 'fin'
let difficulte = 'normal';
let partie = null;
let tenue = null;            // { type:'xr', grip, offset, bouton } ou { type:'souris', x0, y0 }
let tVol = 0, tCalme = 0, tResultat = 0;
let tombeesDernierLancer = [];
let message = { texte: '', couleur: COULEURS.texte };
let nouveauRecord = false;

const sonVictoire = new THREE.Object3D();
const sonDefaite = new THREE.Object3D();
scene.add(sonVictoire, sonDefaite);
const audioVictoire = sons.creer('victoire', sonVictoire, 4);
const audioDefaite = sons.creer('defaite', sonDefaite, 4);

// ------------------------------------------------------------------
// Interface
// ------------------------------------------------------------------
const hud = new Panneau(1024, 560, 2.0, (p, c) => {
  p.fond();
  if (!partie) return;
  const d = DIFFICULTES[partie.difficulte].label;
  texte(c, `MÖLKKY VR  ·  ${d}`, 512, 52, 40, COULEURS.accent, 'center', true);
  texte(c, 'Score', 70, 130, 34, COULEURS.doux);
  texte(c, `${partie.score} / ${SCORE_CIBLE}`, 70, 200, 92, COULEURS.texte, 'left', true);
  const numero = partie.numeroLancer + (etat === 'vise' || etat === 'vol' ? 1 : 0);
  const lignes = [
    ['Lancer n°', String(numero)],
    ['Dernier lancer', partie.dernierPoints === null ? '-' : `+${partie.dernierPoints} pt${partie.dernierPoints > 1 ? 's' : ''}`],
    ['Échecs consécutifs', `${partie.echecs} / ${ECHECS_MAX}`],
    ['Temps', formaterTemps(partie.tempsEcoule())],
  ];
  lignes.forEach(([k, v], i) => {
    texte(c, k, 520, 120 + i * 62, 34, COULEURS.doux);
    texte(c, v, 960, 120 + i * 62, 40, partie.echecs >= 2 && i === 2 ? COULEURS.rouge : COULEURS.texte, 'right', true);
  });
  if (message.texte) texte(c, message.texte, 512, 440, 46, message.couleur, 'center', true);
  if (etat === 'vise') texte(c, 'Saisissez le Mölkky sur le support et lancez-le', 512, 510, 28, COULEURS.doux, 'center');
});

const panneauJeu = new Panneau(512, 200, 0.42, (p) => {
  p.fond();
  p.bouton('recommencer', 'Recommencer', 24, 30, 464, 64);
  p.bouton('menu', 'Menu principal', 24, 110, 464, 64);
});

const panneauMenu = new Panneau(1024, 780, 1.1, (p, c) => {
  p.fond();
  texte(c, 'MÖLKKY VR', 512, 80, 80, COULEURS.accent, 'center', true);
  texte(c, `Faites tomber les quilles pour atteindre exactement ${SCORE_CIBLE} points`, 512, 150, 32, COULEURS.doux, 'center');
  texte(c, 'Niveau de difficulté', 512, 230, 38, COULEURS.texte, 'center', true);
  Object.entries(DIFFICULTES).forEach(([id, d], i) => {
    p.bouton(`diff:${id}`, d.label, 72 + i * 300, 270, 280, 90, id === difficulte);
  });
  const desc = {
    facile: `Distance ${DIFFICULTES.facile.distance} m  ·  trajectoire affichée`,
    normal: `Distance ${DIFFICULTES.normal.distance} m  ·  paramètres standards`,
    difficile: `Distance ${DIFFICULTES.difficile.distance} m  ·  aucune assistance`,
  }[difficulte];
  texte(c, desc, 512, 395, 30, COULEURS.doux, 'center');
  p.bouton('jouer', 'Nouvelle partie', 262, 450, 500, 100);
  const r = chargerRecord(difficulte);
  texte(c, 'Meilleur résultat', 512, 610, 32, COULEURS.texte, 'center', true);
  texte(c, r ? (r.victoire
    ? `Victoire en ${r.lancers} lancers · ${formaterTemps(r.temps)}`
    : `Défaite · ${r.score} pts en ${r.lancers} lancers · ${formaterTemps(r.temps)}`) : 'Aucune partie enregistrée',
  512, 660, 32, r?.victoire ? COULEURS.vert : COULEURS.doux, 'center');
  texte(c, renderer.xr.isPresenting ? 'Visez un bouton et appuyez sur la gâchette' : 'Hors VR : cliquez sur les boutons', 512, 730, 24, COULEURS.doux, 'center');
});

const panneauFin = new Panneau(1024, 900, 1.1, (p, c) => {
  p.fond();
  if (!partie) return;
  const v = partie.etat === 'victoire';
  texte(c, v ? 'VICTOIRE !' : 'DÉFAITE', 512, 80, 86, v ? COULEURS.vert : COULEURS.rouge, 'center', true);
  texte(c, v ? `Exactement ${SCORE_CIBLE} points !` : `${ECHECS_MAX} lancers consécutifs sans point`, 512, 150, 32, COULEURS.doux, 'center');
  [['Score final', `${partie.score}`], ['Nombre total de lancers', `${partie.numeroLancer}`],
    ['Temps total', formaterTemps(partie.tempsEcoule())]].forEach(([k, val], i) => {
    texte(c, k, 140, 225 + i * 55, 36, COULEURS.doux);
    texte(c, val, 884, 225 + i * 55, 40, COULEURS.texte, 'right', true);
  });
  texte(c, nouveauRecord ? 'Nouveau meilleur résultat !' : '', 512, 395, 36, COULEURS.accent, 'center', true);
  // Historique des derniers lancers
  texte(c, 'Lancer   Quilles tombées            Points   Total', 140, 450, 26, COULEURS.doux);
  partie.lancers.slice(-6).forEach((l, i) => {
    const y = 490 + i * 38;
    texte(c, `#${l.lancer}`, 140, y, 26);
    texte(c, l.quilles.length ? l.quilles.join(', ') : '-', 250, y, 26);
    texte(c, `+${l.points}`, 690, y, 26, COULEURS.texte, 'right');
    texte(c, `${l.scoreTotal}`, 884, y, 26, COULEURS.texte, 'right');
  });
  p.bouton('recommencer', 'Recommencer', 90, 760, 400, 90);
  p.bouton('menu', 'Menu principal', 534, 760, 400, 90);
});

panneauMenu.mesh.position.set(0, 1.3, -1.3);
panneauFin.mesh.position.set(0, 1.3, -1.3);
panneauMenu.mesh.lookAt(0, 1.6, 0);
panneauFin.mesh.lookAt(0, 1.6, 0);
panneauJeu.mesh.position.set(-0.6, 1.1, -0.45);
panneauJeu.mesh.lookAt(0, 1.4, 0.3);
scene.add(hud.mesh, panneauJeu.mesh, panneauMenu.mesh, panneauFin.mesh);
const panneaux = [hud, panneauJeu, panneauMenu, panneauFin];

function afficherPanneaux() {
  panneauMenu.mesh.visible = etat === 'menu';
  panneauFin.mesh.visible = etat === 'fin';
  hud.mesh.visible = etat !== 'menu' && etat !== 'fin';
  panneauJeu.mesh.visible = etat === 'vise' || etat === 'vol' || etat === 'resultat';
  panneaux.forEach((p) => p.rafraichir());
}

function setMessage(t, couleur = COULEURS.texte) { message = { texte: t, couleur }; }

// ------------------------------------------------------------------
// Gestion d'une partie
// ------------------------------------------------------------------
function placerVue(distance) {
  hud.mesh.position.set(0, 1.45, LIGNE_Z - distance - 1.1);
  sonVictoire.position.copy(hud.mesh.position);
  sonDefaite.position.copy(hud.mesh.position);
  if (!renderer.xr.isPresenting) {
    camera.position.set(0, 1.5, 0.3);
    camera.lookAt(0, 0.35, LIGNE_Z - distance);
  }
}

function nouvellePartie() {
  sons.debloquer();
  tenue = null;
  partie = new Partie(difficulte);
  nouveauRecord = false;
  placerQuillesDepart(DIFFICULTES[difficulte].distance);
  placerVue(DIFFICULTES[difficulte].distance);
  retourSupport();
  setMessage('');
  etat = 'vise';
  afficherPanneaux();
}

function allerMenu() {
  tenue = null;
  etat = 'menu';
  retourSupport();
  placerQuillesDepart(DIFFICULTES[difficulte].distance);
  placerVue(DIFFICULTES[difficulte].distance);
  afficherPanneaux();
}

function action(id) {
  sons.debloquer();
  if (id.startsWith('diff:')) {
    difficulte = id.slice(5);
    placerQuillesDepart(DIFFICULTES[difficulte].distance);
    placerVue(DIFFICULTES[difficulte].distance);
    panneauMenu.rafraichir();
  } else if (id === 'jouer' || id === 'recommencer') nouvellePartie();
  else if (id === 'menu') allerMenu();
}

// Lâcher du Mölkky avec la vitesse/rotation du mouvement
function lancer(vitesse, vitesseAngulaire) {
  tenue = null;
  if (etat !== 'vise') return;
  if (vitesse.length() < 1.0) { retourSupport(); return; } // simple lâcher : retour au support
  corpsMolkky.type = CANNON.Body.DYNAMIC;
  corpsMolkky.updateMassProperties();
  corpsMolkky.velocity.set(vitesse.x, vitesse.y, vitesse.z);
  corpsMolkky.angularVelocity.set(vitesseAngulaire.x, vitesseAngulaire.y, vitesseAngulaire.z);
  corpsMolkky.wakeUp();
  quilles.forEach((q) => { q.tombee = false; q.body.wakeUp(); });
  sons.jouer(sonLancer, Math.min(1, vitesse.length() / 6));
  etat = 'vol';
  tVol = 0; tCalme = 0;
  setMessage('');
  hud.rafraichir();
}

function finLancer() {
  const tombees = quilles.filter(estTombee);
  tombeesDernierLancer = tombees;
  const ev = partie.enregistrerLancer(tombees.map((q) => q.n));
  const p = partie.dernierPoints;
  if (ev === 'victoire') { setMessage(`+${p} · VICTOIRE ! ${SCORE_CIBLE} points`, COULEURS.vert); sons.jouer(audioVictoire); }
  else if (ev === 'defaite') { setMessage(`Lancer sans point · DÉFAITE`, COULEURS.rouge); sons.jouer(audioDefaite); }
  else if (ev === 'depassement') setMessage(`+${p} · Plus de ${SCORE_CIBLE} ! Retour à ${SCORE_RETOUR} points`, COULEURS.accent);
  else if (ev === 'sans_point') setMessage(`Lancer sans point (${partie.echecs}/${ECHECS_MAX})`, COULEURS.rouge);
  else setMessage(`+${p} point${p > 1 ? 's' : ''}` + (tombees.length > 1 ? ` (${tombees.length} quilles)` : ` (quille ${tombees[0].n})`), COULEURS.vert);
  if (partie.etat !== 'en_cours') nouveauRecord = sauvegarderFinPartie(partie);
  etat = 'resultat';
  tResultat = 0;
  hud.rafraichir();
}

function apresResultat() {
  releverQuilles(tombeesDernierLancer);
  retourSupport();
  etat = partie.etat === 'en_cours' ? 'vise' : 'fin';
  afficherPanneaux();
}

// ------------------------------------------------------------------
// Assistance visuelle (Facile) : trajectoire prévue
// ------------------------------------------------------------------
const NB_POINTS = 60;
const trajectoire = new THREE.Line(
  new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(NB_POINTS * 3), 3)),
  new THREE.LineBasicMaterial({ color: 0xffe14d }),
);
const cible = new THREE.Mesh(new THREE.RingGeometry(0.07, 0.1, 24), new THREE.MeshBasicMaterial({ color: 0xffe14d, side: THREE.DoubleSide }));
cible.rotation.x = -Math.PI / 2;
trajectoire.frustumCulled = false;
scene.add(trajectoire, cible);

function majTrajectoire(p0, v) {
  const pos = trajectoire.geometry.attributes.position;
  let x = p0.x, y = p0.y, z = p0.z;
  const dt = 0.025;
  for (let i = 0; i < NB_POINTS; i++) {
    const t = i * dt;
    const yi = p0.y + v.y * t - 4.91 * t * t;
    if (yi >= 0) { x = p0.x + v.x * t; y = yi; z = p0.z + v.z * t; }
    pos.setXYZ(i, x, Math.max(0.005, y), z);
  }
  pos.needsUpdate = true;
  cible.position.set(x, 0.006, z);
}

// ------------------------------------------------------------------
// Contrôleurs VR
// ------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const tmpMat = new THREE.Matrix4();
const controleurs = [];

for (let i = 0; i < 2; i++) {
  const ray = renderer.xr.getController(i);
  const grip = renderer.xr.getControllerGrip(i);
  const ligne = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
    new THREE.LineBasicMaterial({ color: 0xffffff }),
  );
  ligne.scale.z = 2;
  ray.add(ligne);
  const main = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.1), new THREE.MeshStandardMaterial({ color: 0x333333 }));
  grip.add(main);
  scene.add(ray, grip);
  const c = { ray, grip, ligne, survol: null, echantillons: [] };
  controleurs.push(c);

  const presser = (bouton) => {
    if (bouton === 'select' && c.survol) { action(c.survol); return; }
    if (etat !== 'vise' || tenue) return;
    const pg = new THREE.Vector3().setFromMatrixPosition(grip.matrixWorld);
    if (pg.distanceTo(molkky.position) > DISTANCE_SAISIE) return;
    // On conserve la position relative du Mölkky dans la main au moment de la saisie
    const offset = new THREE.Matrix4().copy(grip.matrixWorld).invert().multiply(molkky.matrixWorld);
    tenue = { type: 'xr', c, offset, bouton };
    rendreCinematique();
    c.echantillons.length = 0;
  };
  const relacher = (bouton) => {
    if (!tenue || tenue.type !== 'xr' || tenue.c !== c || tenue.bouton !== bouton) return;
    const { v, w } = vitesseMain(c);
    lancer(v, w);
  };
  ray.addEventListener('selectstart', () => presser('select'));
  ray.addEventListener('selectend', () => relacher('select'));
  ray.addEventListener('squeezestart', () => presser('squeeze'));
  ray.addEventListener('squeezeend', () => relacher('squeeze'));
}

// Vitesse linéaire et angulaire du Mölkky tenu, calculées sur les ~80 dernières ms
const _q = new THREE.Quaternion();
function vitesseMain(c) {
  const e = c.echantillons;
  const v = new THREE.Vector3(), w = new THREE.Vector3();
  if (e.length < 2) return { v, w };
  const fin = e[e.length - 1];
  let debut = e[0];
  for (let i = e.length - 2; i >= 0; i--) { debut = e[i]; if (fin.t - e[i].t >= 0.08) break; }
  const dt = fin.t - debut.t;
  if (dt <= 0) return { v, w };
  v.subVectors(fin.p, debut.p).divideScalar(dt);
  _q.copy(debut.q).invert().premultiply(fin.q); // rotation de debut à fin (repère monde)
  if (_q.w < 0) { _q.x *= -1; _q.y *= -1; _q.z *= -1; _q.w *= -1; }
  const angle = 2 * Math.acos(Math.min(1, _q.w));
  const s = Math.sqrt(1 - _q.w * _q.w);
  if (s > 1e-4) w.set(_q.x / s, _q.y / s, _q.z / s).multiplyScalar(Math.min(angle / dt, 30));
  return { v, w };
}

const _m = new THREE.Matrix4(), _s = new THREE.Vector3();
function majTenueXR(temps) {
  const { c, offset } = tenue;
  _m.multiplyMatrices(c.grip.matrixWorld, offset);
  _m.decompose(molkky.position, molkky.quaternion, _s);
  corpsMolkky.position.copy(molkky.position);
  corpsMolkky.quaternion.copy(molkky.quaternion);
  c.echantillons.push({ t: temps, p: molkky.position.clone(), q: molkky.quaternion.clone() });
  if (c.echantillons.length > 30) c.echantillons.shift();
}

function majRayons() {
  for (const c of controleurs) {
    c.survol = null;
    const visibles = panneaux.filter((p) => p.mesh.visible).map((p) => p.mesh);
    tmpMat.identity().extractRotation(c.ray.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(c.ray.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tmpMat);
    const hit = raycaster.intersectObjects(visibles, false)[0];
    if (hit) {
      c.survol = hit.object.userData.panneau.boutonA(hit.uv);
      c.ligne.scale.z = hit.distance;
    } else c.ligne.scale.z = 2;
    c.ligne.visible = !!c.survol || etat === 'menu' || etat === 'fin';
  }
  for (const p of panneaux) {
    const c = controleurs.find((c) => c.survol && p.boutons.some((b) => b.id === c.survol));
    p.setSurvol(c ? c.survol : null);
  }
}

// ------------------------------------------------------------------
// Mode test hors VR (souris) : clic sur les boutons, glisser vers le bas puis relâcher pour lancer
// ------------------------------------------------------------------
const souris = new THREE.Vector2();
const POS_SOURIS = new THREE.Vector3(0.12, 1.05, -0.45);
let survolSouris = null;

function boutonSousSouris(ev) {
  souris.set((ev.clientX / window.innerWidth) * 2 - 1, -(ev.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(souris, camera);
  const hit = raycaster.intersectObjects(panneaux.filter((p) => p.mesh.visible).map((p) => p.mesh), false)[0];
  return hit ? { p: hit.object.userData.panneau, id: hit.object.userData.panneau.boutonA(hit.uv) } : null;
}

function vitesseSouris(ev) {
  const dx = ev.clientX - tenue.x0, dy = ev.clientY - tenue.y0;
  const L = Math.hypot(dx, dy);
  const v = new THREE.Vector3();
  if (L < 5 || dy <= 0) return v;
  const puissance = Math.min(L * 0.022, 10);
  const dir = new THREE.Vector3(-dx, 0, -dy).normalize();
  const a = THREE.MathUtils.degToRad(15);
  return v.copy(dir).multiplyScalar(Math.cos(a) * puissance).setY(Math.sin(a) * puissance);
}

renderer.domElement.addEventListener('pointerdown', (ev) => {
  if (renderer.xr.isPresenting) return;
  sons.debloquer();
  const b = boutonSousSouris(ev);
  if (b && b.id) { action(b.id); return; }
  if (etat === 'vise' && !tenue) {
    tenue = { type: 'souris', x0: ev.clientX, y0: ev.clientY, v: new THREE.Vector3() };
    rendreCinematique();
    corpsMolkky.position.set(POS_SOURIS.x, POS_SOURIS.y, POS_SOURIS.z);
    corpsMolkky.quaternion.setFromEuler(-0.4, 0, 0);
    molkky.position.copy(POS_SOURIS);
    molkky.quaternion.copy(corpsMolkky.quaternion);
  }
});
renderer.domElement.addEventListener('pointermove', (ev) => {
  if (renderer.xr.isPresenting) return;
  if (tenue && tenue.type === 'souris') { tenue.v = vitesseSouris(ev); return; }
  const b = boutonSousSouris(ev);
  const id = b ? b.id : null;
  if (id !== survolSouris) {
    survolSouris = id;
    panneaux.forEach((p) => p.setSurvol(b && b.p === p ? id : null));
  }
});
renderer.domElement.addEventListener('pointerup', (ev) => {
  if (!tenue || tenue.type !== 'souris') return;
  lancer(vitesseSouris(ev), new THREE.Vector3(-8, 0, 0));
});

renderer.xr.addEventListener('sessionstart', () => { sons.debloquer(); panneauMenu.rafraichir(); });
renderer.xr.addEventListener('sessionend', () => {
  tenue = null;
  placerVue(DIFFICULTES[difficulte].distance);
  if (etat === 'vise') retourSupport();
  panneauMenu.rafraichir();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ------------------------------------------------------------------
// Boucle principale
// ------------------------------------------------------------------
const horloge = new THREE.Clock();
let tHud = 0;

function calme() {
  if (corpsMolkky.velocity.length() > 0.08 || corpsMolkky.angularVelocity.length() > 0.5) return false;
  return quilles.every((q) => q.body.velocity.length() < 0.05 && q.body.angularVelocity.length() < 0.3);
}

function boucle() {
  const dt = Math.min(horloge.getDelta(), 0.05);
  const temps = horloge.elapsedTime;

  if (renderer.xr.isPresenting) majRayons();
  if (tenue?.type === 'xr') majTenueXR(temps);

  world.step(PAS_PHYSIQUE, dt, 20); // pas fin : contacts bâton/sol réalistes (roule, glisse)

  for (const q of quilles) { q.mesh.position.copy(q.body.position); q.mesh.quaternion.copy(q.body.quaternion); }
  if (!tenue || tenue.type === 'souris') { molkky.position.copy(corpsMolkky.position); molkky.quaternion.copy(corpsMolkky.quaternion); }

  if (etat === 'vol') {
    tVol += dt;
    for (const q of quilles) {
      if (!q.tombee && estTombee(q)) { q.tombee = true; sons.jouer(q.son, 0.9); }
    }
    tCalme = tVol > 1.2 && calme() ? tCalme + dt : 0;
    if (tCalme > 0.5 || tVol > 10) finLancer();
  } else if (etat === 'resultat') {
    tResultat += dt;
    if (tResultat > 2) apresResultat();
  }

  // Assistance visuelle (Facile uniquement)
  const assist = !!tenue && etat === 'vise' && DIFFICULTES[difficulte].assistance;
  trajectoire.visible = cible.visible = assist;
  if (assist) majTrajectoire(molkky.position, tenue.type === 'xr' ? vitesseMain(tenue.c).v : tenue.v);

  tHud += dt;
  if (tHud > 0.25 && partie && (etat === 'vise' || etat === 'vol' || etat === 'resultat')) { tHud = 0; hud.rafraichir(); }

  renderer.render(scene, camera);
}

// Démarrage
placerQuillesDepart(DIFFICULTES[difficulte].distance);
placerVue(DIFFICULTES[difficulte].distance);
retourSupport();
afficherPanneaux();
renderer.setAnimationLoop(boucle);

// Accès console pour la démonstration / le débogage
window.molkky = { get etat() { return etat; }, get partie() { return partie; }, quilles, action, lancer, corpsMolkky };
