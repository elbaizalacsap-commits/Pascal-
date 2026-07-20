/* ============================================================
   ÉCHECS — P.SCALIUM GGG — logique de l'application
   ============================================================ */

const SYMBOLES = {
  p: "♟", r: "♜", n: "♞", b: "♝", q: "♛", k: "♚",
  P: "♙", R: "♖", N: "♘", B: "♗", Q: "♕", K: "♔",
};
const NOMS_PIECES = { q: "Dame", r: "Tour", b: "Fou", n: "Cavalier" };

let partie = new Chess();
let modeActuel = "ordinateur";
let couleurJoueur = "w";
let caseSelectionnee = null;
let coupsPossibles = [];
let difficulteChoisie = 1;
let themeActuel = "historique";
let derniereCase = { from: null, to: null };
let cadenceChoisie = 0; // secondes, 0 = illimité
let horloges = { w: 0, b: 0 };
let intervalleHorloge = null;
let promotionEnAttente = null;
let sonActif = true;
let audioCtx = null;

const PROFONDEUR_DIFFICULTE = { 1: 1, 2: 2, 3: 3, 4: 4 };
const PROFONDEUR_INDICE = 2;
const PROFONDEUR_ANALYSE = 1; // évaluation statique = profondeur 0 en pratique (rapide)

// --- Multijoueur en ligne ---
let codePartieEnLigne = null;
let abonnementRealtime = null;

/* ============================================================
   NAVIGATION ENTRE ÉCRANS
   ============================================================ */
function afficherEcran(id) {
  document.querySelectorAll(".ecran").forEach(e => e.classList.remove("actif"));
  document.getElementById(id).classList.add("actif");
}
document.querySelectorAll("[data-retour]").forEach(btn => {
  btn.addEventListener("click", () => {
    arreterHorloge();
    if (abonnementRealtime) { abonnementRealtime.unsubscribe(); abonnementRealtime = null; }
    document.getElementById("superpositionFin").style.display = "none";
    document.getElementById("superpositionAnalyse").style.display = "none";
    afficherEcran(btn.dataset.retour);
  });
});
document.querySelectorAll(".carte-mode").forEach(carte => {
  carte.addEventListener("click", () => {
    const mode = carte.dataset.mode;
    if (mode === "ordinateur") afficherEcran("ecranReglagesOrdi");
    else if (mode === "local") afficherEcran("ecranReglagesLocal");
    else if (mode === "enligne") afficherEcran("ecranEnLigne");
    else if (mode === "actus") { afficherEcran("ecranActus"); chargerPosts(); }
  });
});

/* ============================================================
   ACTUS (publications gérées via /admin/, lues depuis content/posts.json)
   ============================================================ */
function afficherPosts(posts) {
  const zone = document.getElementById("postsListe");
  if (!posts || !posts.length) {
    zone.innerHTML = `<p class="texte-discret">Aucune publication pour l'instant.</p>`;
    return;
  }
  const tries = posts.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  zone.innerHTML = tries.map(p => `
    <div class="carte-post">
      <div class="post-titre">${p.titre}</div>
      <div class="post-date">${new Date(p.date).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}</div>
      <div class="post-corps">${p.corps}</div>
    </div>
  `).join("");
}
function chargerPosts() {
  document.getElementById("postsListe").innerHTML = `<p class="texte-discret">Chargement…</p>`;
  fetch("/content/posts.json")
    .then(r => { if (!r.ok) throw new Error("introuvable"); return r.json(); })
    .then(donnees => afficherPosts(donnees.posts || []))
    .catch(() => afficherPosts([]));
}

/* ============================================================
   FOND ANIMÉ DU MENU
   ============================================================ */
function construireFondAnime() {
  const fond = document.getElementById("fondAnime");
  fond.innerHTML = "";
  for (let i = 0; i < 64; i++) fond.appendChild(Object.assign(document.createElement("div"), { className: "case" }));
  const cases = fond.children;
  const parcours = genererParcoursCavalier();
  let i = 0;
  setInterval(() => {
    Array.from(cases).forEach(c => c.classList.remove("allumee"));
    cases[parcours[i % parcours.length]].classList.add("allumee");
    cases[parcours[(i + 3) % parcours.length]].classList.add("allumee");
    i++;
  }, 550);
}
function genererParcoursCavalier() {
  const suite = []; let x = 0, y = 0;
  const mouvements = [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]];
  const vus = new Set();
  for (let n = 0; n < 40; n++) {
    suite.push(y * 8 + x); vus.add(`${x},${y}`);
    let deplace = false;
    for (const [dx, dy] of mouvements.sort(() => Math.random() - 0.5)) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < 8 && ny >= 0 && ny < 8 && !vus.has(`${nx},${ny}`)) { x = nx; y = ny; deplace = true; break; }
    }
    if (!deplace) { x = Math.floor(Math.random()*8); y = Math.floor(Math.random()*8); }
  }
  return suite;
}
construireFondAnime();

/* ============================================================
   SON (Web Audio API — aucun fichier externe requis)
   ============================================================ */
try { sonActif = localStorage.getItem("echecs_son") !== "off"; } catch (e) {}
majIconeSon();
document.getElementById("btnSon").addEventListener("click", () => {
  sonActif = !sonActif;
  try { localStorage.setItem("echecs_son", sonActif ? "on" : "off"); } catch (e) {}
  majIconeSon();
});
function majIconeSon() { document.getElementById("btnSon").textContent = sonActif ? "🔊" : "🔇"; }

function jouerSon(type) {
  if (!sonActif) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const reglages = {
      coup: [[420, 0.06]],
      capture: [[260, 0.09]],
      echec: [[700, 0.07], [520, 0.09]],
      fin: [[500, 0.1], [380, 0.1], [280, 0.16]],
    }[type] || [[400, 0.06]];
    let t = audioCtx.currentTime;
    reglages.forEach(([freq, duree]) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = freq;
      osc.type = "triangle";
      gain.gain.setValueAtTime(0.16, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + duree);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t); osc.stop(t + duree);
      t += duree * 0.7;
    });
  } catch (e) {}
}

/* ============================================================
   RÉGLAGES — segmented controls génériques
   ============================================================ */
function brancherSegmented(id, callback) {
  document.getElementById(id).addEventListener("click", e => {
    const btn = e.target.closest(".seg-btn");
    if (!btn) return;
    btn.parentElement.querySelectorAll(".seg-btn").forEach(b => b.classList.remove("actif"));
    btn.classList.add("actif");
    callback(btn);
  });
}
brancherSegmented("choixDifficulte", btn => difficulteChoisie = parseInt(btn.dataset.niveau, 10));
brancherSegmented("choixCouleur", btn => couleurJoueur = btn.dataset.couleur === "blanc" ? "w" : "b");
brancherSegmented("choixCadenceOrdi", btn => cadenceChoisie = parseInt(btn.dataset.cadence, 10));
brancherSegmented("choixCadenceLocal", btn => cadenceChoisie = parseInt(btn.dataset.cadence, 10));

document.getElementById("btnLancerOrdi").addEventListener("click", () => demarrerPartie("ordinateur"));
document.getElementById("btnLancerLocal").addEventListener("click", () => demarrerPartie("local"));

/* ============================================================
   DÉMARRER UNE PARTIE
   ============================================================ */
function demarrerPartie(mode) {
  modeActuel = mode;
  partie = new Chess();
  caseSelectionnee = null;
  coupsPossibles = [];
  derniereCase = { from: null, to: null };
  document.getElementById("historiqueCoups").innerHTML = "";
  document.getElementById("capturesHaut").textContent = "";
  document.getElementById("capturesBas").textContent = "";
  afficherEcran("ecranJeu");
  appliquerTheme(themeActuel);
  dessinerPlateau();
  majStatutPartie();
  majEvaluation();
  configurerHorloge();
  configurerBoutonsAction();

  if (mode === "ordinateur") {
    document.getElementById("nomJoueurHaut").textContent = "Ordinateur";
    document.getElementById("nomJoueurBas").textContent = "Toi";
    document.getElementById("barreEvalConteneur").style.display = "flex";
    if (couleurJoueur === "b") setTimeout(jouerCoupOrdinateur, 400);
  } else if (mode === "local") {
    document.getElementById("nomJoueurHaut").textContent = "Joueur 2 (noirs)";
    document.getElementById("nomJoueurBas").textContent = "Joueur 1 (blancs)";
    document.getElementById("barreEvalConteneur").style.display = "flex";
  } else if (mode === "enligne") {
    document.getElementById("nomJoueurHaut").textContent = "Adversaire";
    document.getElementById("nomJoueurBas").textContent = "Toi";
    document.getElementById("barreEvalConteneur").style.display = "none";
  }
}

function configurerBoutonsAction() {
  const enLigne = modeActuel === "enligne";
  document.getElementById("btnIndice").classList.toggle("cache", enLigne);
  document.getElementById("btnAnnuler").classList.toggle("cache", enLigne);
  document.getElementById("btnAnnuler").disabled = true;
}

/* ============================================================
   HORLOGE
   ============================================================ */
function configurerHorloge() {
  arreterHorloge();
  const actif = cadenceChoisie > 0 && modeActuel !== "enligne";
  document.getElementById("horlogeHaut").style.display = actif ? "inline-block" : "none";
  document.getElementById("horlogeBas").style.display = actif ? "inline-block" : "none";
  if (!actif) return;
  horloges = { w: cadenceChoisie, b: cadenceChoisie };
  majAffichageHorloges();
  intervalleHorloge = setInterval(() => {
    if (partie.game_over()) return arreterHorloge();
    const trait = partie.turn();
    horloges[trait] -= 1;
    if (horloges[trait] <= 0) {
      horloges[trait] = 0;
      majAffichageHorloges();
      arreterHorloge();
      const gagnant = trait === "w" ? "Les noirs" : "Les blancs";
      afficherFin("Temps écoulé", `${gagnant} remportent la partie au temps.`, "⏱️");
      return;
    }
    majAffichageHorloges();
  }, 1000);
}
function arreterHorloge() { if (intervalleHorloge) { clearInterval(intervalleHorloge); intervalleHorloge = null; } }
function majAffichageHorloges() {
  if (cadenceChoisie <= 0) return;
  const bas = (modeActuel === "ordinateur") ? couleurJoueur : "w";
  const haut = bas === "w" ? "b" : "w";
  document.getElementById("horlogeBas").textContent = formaterTemps(horloges[bas]);
  document.getElementById("horlogeHaut").textContent = formaterTemps(horloges[haut]);
  document.getElementById("horlogeBas").classList.toggle("urgent", horloges[bas] <= 20);
  document.getElementById("horlogeHaut").classList.toggle("urgent", horloges[haut] <= 20);
}
function formaterTemps(s) {
  const m = Math.floor(s / 60), sec = s % 60;
  return `${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
}

/* ============================================================
   DESSIN DU PLATEAU
   ============================================================ */
function dessinerPlateau() {
  const plateau = document.getElementById("plateau");
  plateau.innerHTML = "";
  const position = partie.board();
  const inverser = (modeActuel === "ordinateur" || modeActuel === "enligne") && couleurJoueur === "b";

  for (let rangee = 0; rangee < 8; rangee++) {
    for (let col = 0; col < 8; col++) {
      const r = inverser ? 7 - rangee : rangee;
      const c = inverser ? 7 - col : col;
      const carre = position[r][c];
      const nomCase = `${"abcdefgh"[c]}${8 - r}`;

      const div = document.createElement("div");
      div.className = "case-plateau " + ((r + c) % 2 === 0 ? "claire" : "sombre");
      div.dataset.case = nomCase;

      if (carre) {
        const symbole = carre.color === "w" ? carre.type.toUpperCase() : carre.type;
        const classeCouleur = carre.color === "w" ? "piece-blanche" : "piece-noire";
        div.innerHTML = `<span class="case-piece ${classeCouleur}">${SYMBOLES[symbole]}</span>`;
      }
      if (nomCase === caseSelectionnee) div.classList.add("selectionnee");
      if (coupsPossibles.includes(nomCase)) div.classList.add("coup-possible");
      if (nomCase === derniereCase.from || nomCase === derniereCase.to) div.classList.add("dernier-coup");

      div.addEventListener("click", () => gererClicCase(nomCase));
      plateau.appendChild(div);
    }
  }
}

/* ============================================================
   ANIMATION DE DÉPLACEMENT (glissement d'une pièce)
   ============================================================ */
function animerDeplacement(from, to) {
  const plateauEl = document.getElementById("plateau");
  const caseFrom = plateauEl.querySelector(`[data-case="${from}"]`);
  const caseTo = plateauEl.querySelector(`[data-case="${to}"]`);
  if (!caseFrom || !caseTo || !caseFrom.textContent) return;
  const rectFrom = caseFrom.getBoundingClientRect();
  const rectTo = caseTo.getBoundingClientRect();
  const clone = document.createElement("div");
  clone.textContent = caseFrom.textContent;
  Object.assign(clone.style, {
    position: "fixed", left: rectFrom.left + "px", top: rectFrom.top + "px",
    width: rectFrom.width + "px", height: rectFrom.height + "px",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: getComputedStyle(caseFrom).fontSize, zIndex: 999,
    transition: "transform 0.2s ease", pointerEvents: "none",
  });
  document.body.appendChild(clone);
  requestAnimationFrame(() => {
    clone.style.transform = `translate(${rectTo.left - rectFrom.left}px, ${rectTo.top - rectFrom.top}px)`;
  });
  setTimeout(() => clone.remove(), 240);
}

/* ============================================================
   INTERACTION : SÉLECTION, PROMOTION, DÉPLACEMENT
   ============================================================ */
function gererClicCase(nomCase) {
  if (partieVerrouillee()) return;

  if (caseSelectionnee) {
    if (coupsPossibles.includes(nomCase)) {
      const from = caseSelectionnee;
      const correspondants = partie.moves({ square: from, verbose: true }).filter(m => m.to === nomCase);
      caseSelectionnee = null; coupsPossibles = [];
      if (correspondants.length > 1) {
        demanderPromotion(from, nomCase);
      } else {
        jouerCoup(from, nomCase, correspondants[0] ? correspondants[0].promotion : undefined);
      }
      dessinerPlateau();
      return;
    }
    caseSelectionnee = null; coupsPossibles = [];
  }

  const piece = partie.get(nomCase);
  if (piece && piece.color === partie.turn() && couleurAutoriseeAJouer()) {
    caseSelectionnee = nomCase;
    coupsPossibles = partie.moves({ square: nomCase, verbose: true }).map(m => m.to);
  }
  dessinerPlateau();
}
function couleurAutoriseeAJouer() {
  if (modeActuel === "local") return true;
  return partie.turn() === couleurJoueur;
}
function partieVerrouillee() {
  return partie.game_over() || document.getElementById("superpositionFin").style.display !== "none";
}

function demanderPromotion(from, to) {
  promotionEnAttente = { from, to };
  const couleur = partie.turn();
  const grille = document.getElementById("grillePromotion");
  grille.innerHTML = "";
  ["q", "r", "b", "n"].forEach(type => {
    const symbole = couleur === "w" ? type.toUpperCase() : type;
    const btn = document.createElement("button");
    btn.className = "piece-promotion";
    btn.textContent = SYMBOLES[symbole];
    btn.title = NOMS_PIECES[type];
    btn.addEventListener("click", () => {
      document.getElementById("superpositionPromotion").style.display = "none";
      jouerCoup(promotionEnAttente.from, promotionEnAttente.to, type);
      promotionEnAttente = null;
    });
    grille.appendChild(btn);
  });
  document.getElementById("superpositionPromotion").style.display = "flex";
}

function jouerCoup(from, to, promotion) {
  const coupsLegaux = partie.moves({ square: from, verbose: true });
  const infosCoup = coupsLegaux.find(m => m.to === to && (m.promotion || undefined) === (promotion || m.promotion || undefined));
  animerDeplacement(from, to);

  const resultat = partie.move({ from, to, promotion: promotion || (infosCoup && infosCoup.promotion) });
  if (!resultat) return;

  derniereCase = { from, to };
  majCapturesEtHistorique(resultat);
  majStatutPartie();
  majEvaluation();
  document.getElementById("btnAnnuler").disabled = !partie.history().length || modeActuel === "enligne";
  setTimeout(dessinerPlateau, 30);

  if (resultat.captured) jouerSon("capture"); else jouerSon("coup");
  if (partie.in_check() && !partie.game_over()) setTimeout(() => jouerSon("echec"), 120);

  verifierFinDePartie();

  if (modeActuel === "ordinateur" && !partie.game_over() && partie.turn() !== couleurJoueur) {
    setTimeout(jouerCoupOrdinateur, 400);
  }
  if (modeActuel === "enligne") envoyerCoupEnLigne();
}

function majCapturesEtHistorique(resultat) {
  if (resultat.captured) {
    const zone = resultat.color === "w" ? "capturesHaut" : "capturesBas";
    const symbole = resultat.color === "w" ? resultat.captured : resultat.captured.toUpperCase();
    document.getElementById(zone).textContent += SYMBOLES[symbole] + " ";
  }
  const historique = document.getElementById("historiqueCoups");
  const li = document.createElement("li");
  li.textContent = resultat.san;
  historique.appendChild(li);
  historique.scrollTop = historique.scrollHeight;
}

function reconstruireCapturesEtHistorique() {
  document.getElementById("capturesHaut").textContent = "";
  document.getElementById("capturesBas").textContent = "";
  document.getElementById("historiqueCoups").innerHTML = "";
  const hist = partie.history({ verbose: true });
  hist.forEach(majCapturesEtHistorique);
  derniereCase = hist.length ? { from: hist[hist.length-1].from, to: hist[hist.length-1].to } : { from: null, to: null };
}

/* ============================================================
   ANNULER LE DERNIER COUP
   ============================================================ */
document.getElementById("btnAnnuler").addEventListener("click", () => {
  if (modeActuel === "enligne" || !partie.history().length) return;
  partie.undo();
  if (modeActuel === "ordinateur" && partie.history().length && partie.turn() !== couleurJoueur) {
    partie.undo();
  }
  caseSelectionnee = null; coupsPossibles = [];
  reconstruireCapturesEtHistorique();
  document.getElementById("superpositionFin").style.display = "none";
  document.getElementById("btnAnnuler").disabled = !partie.history().length;
  dessinerPlateau();
  majStatutPartie();
  majEvaluation();
});

/* ============================================================
   INDICE
   ============================================================ */
document.getElementById("btnIndice").addEventListener("click", () => {
  if (modeActuel === "enligne" || partieVerrouillee()) return;
  const copie = new Chess(partie.fen());
  const suggestion = chercherMeilleurCoup(copie, PROFONDEUR_INDICE);
  if (!suggestion) return;
  document.querySelectorAll(".case-plateau").forEach(c => c.classList.remove("suggestion"));
  const elFrom = document.querySelector(`[data-case="${suggestion.from}"]`);
  const elTo = document.querySelector(`[data-case="${suggestion.to}"]`);
  if (elFrom) elFrom.classList.add("suggestion");
  if (elTo) elTo.classList.add("suggestion");
  setTimeout(() => { if (elFrom) elFrom.classList.remove("suggestion"); if (elTo) elTo.classList.remove("suggestion"); }, 1800);
});

/* ============================================================
   ABANDON
   ============================================================ */
document.getElementById("btnAbandonner").addEventListener("click", () => {
  if (partieVerrouillee()) return;
  if (!confirm("Confirmer l'abandon de la partie ?")) return;
  let gagnant = "L'adversaire";
  if (modeActuel === "local") gagnant = partie.turn() === "w" ? "Les noirs" : "Les blancs";
  else if (modeActuel === "ordinateur") gagnant = "L'ordinateur";
  afficherFin("Abandon", `${gagnant} remporte la partie.`, "🏳️");
});

/* ============================================================
   EXPORT PGN
   ============================================================ */
document.getElementById("btnExporterPgn").addEventListener("click", () => {
  const nomBlanc = modeActuel === "ordinateur" ? (couleurJoueur === "w" ? "Toi" : "Ordinateur") : (modeActuel === "local" ? "Joueur 1" : "Toi");
  const nomNoir = modeActuel === "ordinateur" ? (couleurJoueur === "b" ? "Toi" : "Ordinateur") : (modeActuel === "local" ? "Joueur 2" : "Adversaire");
  try {
    partie.header("Event", "Partie — Échecs P.Scalium ggg", "Date", new Date().toISOString().slice(0,10).replace(/-/g,"."), "White", nomBlanc, "Black", nomNoir);
  } catch (e) {}
  const pgn = partie.pgn();
  const blob = new Blob([pgn || "* Aucun coup joué *"], { type: "application/x-chess-pgn" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "partie-echecs-pscalium-ggg.pgn";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
});

/* ============================================================
   STATUT / FIN DE PARTIE
   ============================================================ */
function majStatutPartie() {
  const statut = document.getElementById("statutPartie");
  if (partie.in_checkmate()) { statut.textContent = "Échec et mat"; return; }
  if (partie.in_draw() || partie.in_stalemate()) { statut.textContent = "Partie nulle"; return; }
  const trait = partie.turn() === "w" ? "Trait aux blancs" : "Trait aux noirs";
  statut.textContent = partie.in_check() ? trait + " — échec !" : trait;
}

function afficherFin(titre, detail, icone) {
  arreterHorloge();
  document.getElementById("finTitre").textContent = titre;
  document.getElementById("finDetail").textContent = detail;
  document.getElementById("finIcone").textContent = icone || "♚";
  document.getElementById("superpositionFin").style.display = "flex";
  jouerSon("fin");
}

function verifierFinDePartie() {
  if (!partie.game_over()) return;
  let titre = "Partie terminée", detail = "";
  if (partie.in_checkmate()) {
    const gagnant = partie.turn() === "w" ? "Les noirs" : "Les blancs";
    titre = "Échec et mat"; detail = `${gagnant} remportent la partie.`;
  } else if (partie.in_stalemate()) {
    titre = "Pat"; detail = "Aucun coup légal possible — partie nulle.";
  } else if (partie.insufficient_material && partie.insufficient_material()) {
    titre = "Partie nulle"; detail = "Matériel insuffisant pour mater.";
  } else if (partie.in_draw()) {
    titre = "Partie nulle"; detail = "Répétition ou règle des 50 coups.";
  }
  afficherFin(titre, detail);
}
document.getElementById("btnRejouer").addEventListener("click", () => {
  document.getElementById("superpositionFin").style.display = "none";
  demarrerPartie(modeActuel);
});

/* ============================================================
   BARRE D'ÉVALUATION
   ============================================================ */
function majEvaluation() {
  if (modeActuel === "enligne") return;
  const evalCp = evaluerPositionActuelle(partie);
  const borne = Math.max(-1000, Math.min(1000, evalCp));
  const pourcentageBlanc = 50 + (borne / 1000) * 50;
  document.getElementById("barreEvalRemplissage").style.height = pourcentageBlanc + "%";
  let texte;
  if (Math.abs(evalCp) > 9000) texte = evalCp > 0 ? "Mat" : "Mat";
  else texte = (evalCp / 100 >= 0 ? "+" : "") + (evalCp / 100).toFixed(1);
  document.getElementById("barreEvalChiffre").textContent = texte;
}

/* ============================================================
   IA (moteur maison, voir moteur.js)
   ============================================================ */
function jouerCoupOrdinateur() {
  if (partie.game_over()) return;
  document.getElementById("statutPartie").textContent = "L'ordinateur réfléchit…";
  setTimeout(() => {
    const profondeur = PROFONDEUR_DIFFICULTE[difficulteChoisie] || 2;
    const coup = chercherMeilleurCoup(partie, profondeur);
    if (coup) jouerCoup(coup.from, coup.to, coup.promotion);
  }, 60);
}

/* ============================================================
   THÈMES DE PLATEAU
   ============================================================ */
document.getElementById("btnThemePlateau").addEventListener("click", () => {
  document.getElementById("superpositionTheme").style.display = "flex";
});
document.getElementById("btnFermerTheme").addEventListener("click", () => {
  document.getElementById("superpositionTheme").style.display = "none";
});
document.querySelectorAll(".vignette-theme").forEach(btn => {
  btn.addEventListener("click", () => {
    appliquerTheme(btn.dataset.theme);
    document.getElementById("superpositionTheme").style.display = "none";
  });
});
function appliquerTheme(theme) {
  themeActuel = theme;
  document.getElementById("plateau").className = "plateau theme-" + theme;
  document.querySelectorAll(".vignette-theme").forEach(v => v.classList.toggle("actif", v.dataset.theme === theme));
  try { localStorage.setItem("echecs_theme", theme); } catch (e) {}
}
try { const t = localStorage.getItem("echecs_theme"); if (t) themeActuel = t; } catch (e) {}

/* ============================================================
   ANALYSE DE PARTIE (post-mortem)
   ============================================================ */
document.getElementById("btnVoirAnalyse").addEventListener("click", () => {
  document.getElementById("superpositionFin").style.display = "none";
  document.getElementById("superpositionAnalyse").style.display = "flex";
  document.getElementById("analyseResume").textContent = "Calcul en cours…";
  document.getElementById("listeAnalyse").innerHTML = "";
  setTimeout(lancerAnalyse, 30);
});
document.getElementById("btnFermerAnalyse").addEventListener("click", () => {
  document.getElementById("superpositionAnalyse").style.display = "none";
});

function classifierCoup(delta) {
  if (delta >= -10) return { texte: "Excellent", classe: "etiquette-excellent" };
  if (delta >= -50) return { texte: "Bon", classe: "etiquette-bon" };
  if (delta >= -150) return { texte: "Imprécision", classe: "etiquette-imprecision" };
  if (delta >= -300) return { texte: "Erreur", classe: "etiquette-erreur" };
  return { texte: "Gaffe", classe: "etiquette-gaffe" };
}

function lancerAnalyse() {
  const coupsJoues = partie.history({ verbose: true });
  const rejoueur = new Chess();
  const resultats = [];
  let evalAvant = evaluerPositionActuelle(rejoueur);
  let gaffesBlancs = 0, gaffesNoirs = 0;

  coupsJoues.forEach((coup, i) => {
    rejoueur.move({ from: coup.from, to: coup.to, promotion: coup.promotion });
    const evalApres = evaluerPositionActuelle(rejoueur);
    const delta = coup.color === "w" ? (evalApres - evalAvant) : (evalAvant - evalApres);
    const etiquette = classifierCoup(delta);
    if (etiquette.classe === "etiquette-gaffe") { if (coup.color === "w") gaffesBlancs++; else gaffesNoirs++; }
    resultats.push({ numero: Math.floor(i / 2) + 1, couleur: coup.color, san: coup.san, etiquette });
    evalAvant = evalApres;
  });

  const liste = document.getElementById("listeAnalyse");
  liste.innerHTML = "";
  resultats.forEach(r => {
    const li = document.createElement("li");
    li.className = "ligne-analyse";
    const numero = r.couleur === "w" ? `${r.numero}.` : `${r.numero}…`;
    li.innerHTML = `<span>${numero} ${r.san}</span><span class="etiquette-analyse ${r.etiquette.classe}">${r.etiquette.texte}</span>`;
    liste.appendChild(li);
  });
  document.getElementById("analyseResume").textContent = resultats.length
    ? `Blancs : ${gaffesBlancs} gaffe(s) — Noirs : ${gaffesNoirs} gaffe(s).`
    : "Pas assez de coups joués pour une analyse.";
}

/* ============================================================
   MULTIJOUEUR EN LIGNE (Supabase)
   ============================================================ */
document.getElementById("etatConnexion").textContent = supabaseClient
  ? "" : "Le mode en ligne nécessite d'avoir configuré Supabase (voir SUPABASE-SETUP.md).";

document.getElementById("btnCreerPartie").addEventListener("click", async () => {
  if (!supabaseClient) return afficherMessageEnLigne("Configuration Supabase manquante.");
  const code = genererCodePartie();
  const nouvellePartie = new Chess();
  const { error } = await supabaseClient.from("games").insert({
    code, fen: nouvellePartie.fen(), turn: "w", white_joined: true, black_joined: false, last_move: null,
  });
  if (error) return afficherMessageEnLigne("Impossible de créer la partie.");
  codePartieEnLigne = code;
  couleurJoueur = "w";
  document.getElementById("codePartieAffiche").textContent = code;
  document.getElementById("codePartieZone").style.display = "block";
  attendreAdversaire(code);
});

document.getElementById("btnRejoindrePartie").addEventListener("click", async () => {
  if (!supabaseClient) return afficherMessageEnLigne("Configuration Supabase manquante.");
  const code = document.getElementById("champCodeRejoindre").value.trim().toUpperCase();
  if (code.length !== 4) return afficherMessageEnLigne("Le code doit faire 4 caractères.");
  const { data, error } = await supabaseClient.from("games").select("*").eq("code", code).single();
  if (error || !data) return afficherMessageEnLigne("Partie introuvable.");
  await supabaseClient.from("games").update({ black_joined: true }).eq("code", code);
  codePartieEnLigne = code;
  couleurJoueur = "b";
  partie = new Chess(data.fen);
  demarrerPartie("enligne");
  ecouterPartieEnLigne(code);
});

function afficherMessageEnLigne(texte) { document.getElementById("messageEnLigne").textContent = texte; }
function genererCodePartie() {
  const car = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = ""; for (let i = 0; i < 4; i++) code += car[Math.floor(Math.random() * car.length)];
  return code;
}
function attendreAdversaire(code) {
  abonnementRealtime = supabaseClient.channel(`partie-${code}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "games", filter: `code=eq.${code}` }, payload => {
      if (payload.new.black_joined && document.getElementById("ecranEnLigne").classList.contains("actif")) {
        demarrerPartie("enligne");
        ecouterPartieEnLigne(code);
      }
    }).subscribe();
}
function ecouterPartieEnLigne(code) {
  if (abonnementRealtime) abonnementRealtime.unsubscribe();
  abonnementRealtime = supabaseClient.channel(`coups-${code}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "games", filter: `code=eq.${code}` }, payload => {
      const nouvelleFen = payload.new.fen;
      if (nouvelleFen && nouvelleFen !== partie.fen()) {
        partie.load(nouvelleFen);
        derniereCase = payload.new.last_move ? JSON.parse(payload.new.last_move) : derniereCase;
        dessinerPlateau();
        majStatutPartie();
        verifierFinDePartie();
      }
    }).subscribe();
}
async function envoyerCoupEnLigne() {
  if (!supabaseClient || !codePartieEnLigne) return;
  await supabaseClient.from("games").update({
    fen: partie.fen(), turn: partie.turn(), last_move: JSON.stringify(derniereCase),
  }).eq("code", codePartieEnLigne);
}
