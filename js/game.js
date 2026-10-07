// Règles du Mölkky (mode solo) + données de partie + meilleur résultat

export const SCORE_CIBLE = 50;
export const SCORE_RETOUR = 25;
export const ECHECS_MAX = 3;

export const DIFFICULTES = {
  facile:    { label: 'Facile',    distance: 2.5, assistance: true },
  normal:    { label: 'Normal',    distance: 3.5, assistance: false },
  difficile: { label: 'Difficile', distance: 4.5, assistance: false },
};

// quilles : tableau des numéros des quilles tombées
export function calculerPoints(quilles) {
  if (quilles.length === 0) return 0;
  if (quilles.length === 1) return quilles[0];
  return quilles.length;
}

export class Partie {
  constructor(difficulte) {
    this.difficulte = difficulte;
    this.reinitialiser();
  }

  reinitialiser() {
    this.score = 0;
    this.numeroLancer = 0;
    this.echecs = 0;          // lancers consécutifs sans point
    this.dernierPoints = null;
    this.lancers = [];        // historique de chaque lancer
    this.etat = 'en_cours';   // 'en_cours' | 'victoire' | 'defaite'
    this.debut = performance.now();
    this.fin = null;
  }

  tempsEcoule() {
    return ((this.fin ?? performance.now()) - this.debut) / 1000;
  }

  // Retourne l'événement du lancer : 'points' | 'sans_point' | 'depassement' | 'victoire' | 'defaite'
  enregistrerLancer(quillesTombees) {
    if (this.etat !== 'en_cours') return null;
    const quilles = [...quillesTombees].sort((a, b) => a - b);
    const points = calculerPoints(quilles);
    this.numeroLancer++;
    this.dernierPoints = points;

    let evenement = 'points';
    let total = this.score + points;
    if (total > SCORE_CIBLE) {
      total = SCORE_RETOUR;
      evenement = 'depassement';
    }
    this.score = total;

    if (points === 0) {
      this.echecs++;
      evenement = 'sans_point';
    } else {
      this.echecs = 0;
    }

    this.lancers.push({
      lancer: this.numeroLancer,
      quilles,
      points,
      scoreTotal: this.score,
    });

    if (this.score === SCORE_CIBLE) {
      this.etat = 'victoire';
      evenement = 'victoire';
    } else if (this.echecs >= ECHECS_MAX) {
      this.etat = 'defaite';
      evenement = 'defaite';
    }
    if (this.etat !== 'en_cours') this.fin = performance.now();
    return evenement;
  }

  resultat() {
    return {
      victoire: this.etat === 'victoire',
      score: this.score,
      lancers: this.numeroLancer,
      temps: Math.floor(this.tempsEcoule()),
      date: new Date().toISOString(),
    };
  }
}

// ---- Sauvegarde locale du meilleur résultat (par difficulté) ----
const cle = (d) => `molkky-vr-record-${d}`;

export function chargerRecord(difficulte) {
  try { return JSON.parse(localStorage.getItem(cle(difficulte))); } catch { return null; }
}

// Victoire > défaite ; entre victoires : moins de lancers puis moins de temps ; entre défaites : meilleur score
export function estMeilleur(r, ancien) {
  if (!ancien) return true;
  if (r.victoire !== ancien.victoire) return r.victoire;
  if (r.victoire) return r.lancers < ancien.lancers || (r.lancers === ancien.lancers && r.temps < ancien.temps);
  return r.score > ancien.score;
}

// Enregistre la partie terminée ; retourne true si nouveau record
export function sauvegarderFinPartie(partie) {
  const r = partie.resultat();
  try {
    localStorage.setItem('molkky-vr-derniere-partie', JSON.stringify({ ...r, difficulte: partie.difficulte, historique: partie.lancers }));
    if (estMeilleur(r, chargerRecord(partie.difficulte))) {
      localStorage.setItem(cle(partie.difficulte), JSON.stringify(r));
      return true;
    }
  } catch { /* stockage indisponible */ }
  return false;
}

export function formaterTemps(s) {
  s = Math.floor(s);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
