# Mölkky VR (ST2AWD – WebXR)

Expérience WebVR solo du Mölkky : Three.js (rendu + WebXR) et cannon-es (physique). Aucune dépendance à installer, aucune ressource externe (textures et sons générés par code).

## Lancer

```bash
node server.js 8080
```

- PC : http://localhost:8080 (mode test souris, sans casque).
- Casque (Quest) : WebXR exige HTTPS. Deux options :
  - `adb reverse tcp:8080 tcp:8080` puis ouvrir http://localhost:8080 dans le navigateur du casque ;
  - ou exposer le port en HTTPS (Cloudflare Tunnel, etc.).
- Cliquer sur **ENTER VR**.

## Commandes

| VR | Action |
|---|---|
| Rayon + gâchette | Boutons des menus |
| Gâchette ou grip près du Mölkky (support à droite) | Saisir |
| Mouvement de lancer + relâcher | Lancer (direction, vitesse et rotation du geste) |

Hors VR : clic sur les boutons, puis cliquer-glisser vers le bas et relâcher pour lancer (le glissé latéral oriente).

## Règles implémentées

- 12 quilles en configuration officielle, zone de lancer à 2,5 / 3,5 / 4,5 m (Facile / Normal / Difficile).
- Facile : trajectoire prévue affichée pendant la visée. Difficile : aucune assistance.
- Quille tombée = inclinée de plus de ~41°. Détection automatique quand tout est immobile.
- 1 quille : sa valeur ; plusieurs : leur nombre ; aucune : 0.
- Plus de 50 : retour à 25. Exactement 50 : victoire. 3 lancers consécutifs sans point : défaite.
- Les quilles tombées sont relevées là où elles sont tombées (décalées si elles en chevauchent une autre).

## Interface et données

- Panneau de jeu : score, n° du lancer, points du dernier lancer, échecs consécutifs, temps, feedbacks (sans point, dépassement, victoire, défaite).
- Chaque lancer est enregistré : `{ lancer, quilles, points, scoreTotal }` (`Partie.lancers`).
- Écran de fin : résultat, score final, nombre de lancers, temps total, historique.
- Meilleur résultat sauvegardé dans `localStorage` par difficulté (victoire > défaite, puis moins de lancers, puis moins de temps). La dernière partie complète est aussi conservée (`molkky-vr-derniere-partie`).
- Sons 3D spatialisés (PositionalAudio) : lancer, impact du Mölkky, chute de chaque quille, victoire, défaite.

## Structure

```
index.html        page + import map
server.js         serveur statique sans dépendance
js/main.js        scène, physique, contrôleurs VR, déroulement d'une partie
js/game.js        règles, calcul du score, données, sauvegarde du record
js/ui.js          panneaux 3D (canvas) cliquables au rayon
js/audio.js       synthèse des sons et sources spatialisées
lib/              three.js r186, VRButton, cannon-es 0.20
test/regles.test.mjs   tests des règles : node test/regles.test.mjs
```

## Notes physique

- Pas fixe de 1/360 s pour des contacts Mölkky/sol réalistes (glisse, roule, se plante).
- cannon-es borne l'impulsion de frottement par pas et non par seconde : `world.frictionGravity` est ramené à l'échelle du pas, sinon les quilles restent « collées » au sol et absorbent l'élan du Mölkky.
- Les quilles ne s'endorment jamais (un corps endormi se comporte comme un mur au premier contact).
