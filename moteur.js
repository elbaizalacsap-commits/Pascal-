/* ============================================================
   MOTEUR D'ÉCHECS MAISON
   Aucune dépendance externe : fonctionne 100% hors ligne.
   Utilisé pour : les coups de l'ordinateur, les indices,
   la barre d'évaluation et l'analyse de fin de partie.
   ============================================================ */

const VALEURS_PIECES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// Tables de position (bonus/malus selon la case occupée), du point de vue des blancs
const TABLE_PION = [
  0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10,
  5,5,10,25,25,10,5,5, 0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5,
  5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0,
];
const TABLE_CAVALIER = [
  -50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40,
  -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30,
  -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30,
  -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50,
];
const TABLE_FOU = [
  -20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10,
  -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10,
  -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10,
  -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20,
];
const TABLE_TOUR = [
  0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5,
  -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5,
  -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0,
];
const TABLE_DAME = [
  -20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10,
  -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5,
  0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10,
  -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20,
];
const TABLE_ROI = [
  -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30,
  -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10,
  20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20,
];
const TABLES = { p: TABLE_PION, n: TABLE_CAVALIER, b: TABLE_FOU, r: TABLE_TOUR, q: TABLE_DAME, k: TABLE_ROI };

function indexCase(fichier, rang) {
  // fichier 0-7 (a-h), rang 0-7 (rang 1 en bas) -> index dans une table écrite rang 8 en premier
  return (7 - rang) * 8 + fichier;
}

function evaluerPosition(partie) {
  if (partie.in_checkmate()) return partie.turn() === "w" ? -99999 : 99999;
  if (partie.in_draw() || partie.in_stalemate() || partie.in_threefold_repetition()) return 0;

  const plateau = partie.board();
  let total = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const carre = plateau[r][c];
      if (!carre) continue;
      const rangEchecs = 7 - r; // 0 = rang1
      const idx = carre.color === "w" ? indexCase(c, rangEchecs) : indexCase(c, 7 - rangEchecs);
      const valeur = VALEURS_PIECES[carre.type] + TABLES[carre.type][idx];
      total += carre.color === "w" ? valeur : -valeur;
    }
  }
  return total; // positif = avantage blancs, en centipions
}

function trierCoups(partie, coups) {
  // Priorise les captures et les promotions pour un élagage alpha-bêta plus efficace
  return coups.sort((a, b) => {
    const scoreA = (a.captured ? 10 : 0) + (a.flags.includes("p") ? 5 : 0);
    const scoreB = (b.captured ? 10 : 0) + (b.flags.includes("p") ? 5 : 0);
    return scoreB - scoreA;
  });
}

function negamax(partie, profondeur, alpha, beta, couleur) {
  if (profondeur === 0 || partie.game_over()) {
    return couleur * evaluerPosition(partie);
  }
  const coups = trierCoups(partie, partie.moves({ verbose: true }));
  let meilleur = -Infinity;
  for (const coup of coups) {
    partie.move({ from: coup.from, to: coup.to, promotion: coup.promotion || "q" });
    const score = -negamax(partie, profondeur - 1, -beta, -alpha, -couleur);
    partie.undo();
    if (score > meilleur) meilleur = score;
    if (meilleur > alpha) alpha = meilleur;
    if (alpha >= beta) break;
  }
  return meilleur;
}

/**
 * Cherche le meilleur coup pour la position actuelle.
 * Retourne { from, to, promotion, evaluation } — evaluation en centipions,
 * toujours du point de vue des blancs (positif = mieux pour les blancs).
 */
function chercherMeilleurCoup(partie, profondeur) {
  const couleur = partie.turn() === "w" ? 1 : -1;
  const coups = trierCoups(partie, partie.moves({ verbose: true }));
  if (!coups.length) return null;

  let meilleurCoup = coups[0];
  let meilleurScore = -Infinity;
  let alpha = -Infinity, beta = Infinity;

  for (const coup of coups) {
    partie.move({ from: coup.from, to: coup.to, promotion: coup.promotion || "q" });
    const score = -negamax(partie, profondeur - 1, -beta, -alpha, -couleur);
    partie.undo();
    if (score > meilleurScore) {
      meilleurScore = score;
      meilleurCoup = coup;
    }
    if (meilleurScore > alpha) alpha = meilleurScore;
  }

  return {
    from: meilleurCoup.from,
    to: meilleurCoup.to,
    promotion: meilleurCoup.promotion,
    evaluation: couleur * meilleurScore,
  };
}

/** Évalue simplement la position actuelle, sans chercher de coup (pour la barre d'évaluation). */
function evaluerPositionActuelle(partie) {
  return evaluerPosition(partie);
}
