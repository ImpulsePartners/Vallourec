/* ============================================================================
   INNO TALK #4 — Live Polls
   store.js — Configuration partagée + couche de données temps réel
   ----------------------------------------------------------------------------
   Ce fichier est utilisé par index.html (participants) ET presenter.html.
   ⚙️  Vous n'avez qu'UN SEUL endroit à modifier : l'objet CONFIG ci-dessous.

   • Tant que la config Firebase n'est pas renseignée, le site fonctionne en
     MODE DÉMO LOCAL : ouvrez index.html et presenter.html dans deux onglets
     du MÊME ordinateur pour tester tout le déroulé (pas de multi-appareils).
   • Une fois Firebase renseigné, le site passe automatiquement en temps réel
     multi-appareils (chaque téléphone du public se synchronise).
   ============================================================================ */

const CONFIG = {

  // 1) URL publique de la page PARTICIPANT (index.html) sur GitHub Pages.
  //    Sert à générer le QR code affiché sur l'écran présentateur.
  joinUrl: "https://jeetoki.github.io/vallourec/",

  // 2) Mot de passe demandé avant de réinitialiser les données.
  adminPassword: "vallourec4",

  // 3) Espace de noms (permet de réutiliser le même projet Firebase plus tard).
  session: "innotalk4",

  // 4) Configuration Firebase Realtime Database.
  //    Console Firebase → ⚙ Paramètres du projet → Vos applications (Web) → SDK.
  //    Laissez "PASTE_HERE" pour rester en mode démo local.
  firebase: {
    apiKey:      "PASTE_HERE",
    authDomain:  "PASTE_HERE",
    databaseURL: "PASTE_HERE",   // ex. https://innotalk4-default-rtdb.europe-west1.firebasedatabase.app
    projectId:   "PASTE_HERE",
    appId:       "PASTE_HERE"
  }
};

/* ----------------------------------------------------------------------------
   Définition des 4 sondages — TEXTE AFFICHÉ À L'ÉCRAN (en anglais, public mondial)
   Ne pas traduire : ce texte est vu par les participants et sur l'écran.
   ---------------------------------------------------------------------------- */
const POLLS = {
  s1: {
    n: 1,
    type: "wordcloud",
    question: "In one word: what is the biggest innovation challenge your clients are talking about right now?",
    sub: "Type 1 to 3 words — you can add several.",
    hint: "Type 1 to 3 words — you can add several.",
    placeholder: "e.g. cost, integrity, CO₂…"
  },
  s2: {
    n: 2,
    type: "choice",
    ordinal: true,                                  // garde l'ordre 1 → All 4
    question: "Pick ONE client you touch. In how many of these four tube markets are they already active?",
    sub: "O&G · CCUS · Hydrogen · Geothermal",
    chips: ["O&G", "CCUS", "Hydrogen", "Geothermal"],
    metric: { type: "twoPlus", ids: ["2", "3", "all4"], label: "of clients active in 2+ markets" },
    options: [
      { id: "1",       label: "1 market" },
      { id: "2",       label: "2 markets" },
      { id: "3",       label: "3 markets" },
      { id: "all4",    label: "All 4 markets" },
      { id: "notsure", label: "Not sure" }
    ]
  },
  s3: {
    n: 3,
    type: "choice",
    question: "What's the #1 barrier for Vallourec to win in CCUS, hydrogen & geothermal?",
    sub: "Pick the single biggest one.",
    reveal: { id: "qual", note: "The real barrier: qualification & standards — not invention." },
    options: [
      // label = court (écran) ; full = complet (bouton participant)
      { id: "tech", label: "New technology",            full: "Inventing new technology" },
      { id: "qual", label: "Qualification & standards", full: "Qualification & standards" },
      { id: "cost", label: "Cost",                       full: "Cost" },
      { id: "rel",  label: "Client relationships",       full: "Client relationships" },
      { id: "cap",  label: "Capacity",                   full: "Manufacturing capacity" }
    ]
  },
  s4: {
    n: 4,
    type: "wordcloud",
    question: "In one word: what will you do differently after today?",
    sub: "Type 1 to 3 words — you can add several.",
    hint: "Type 1 to 3 words — you can add several.",
    placeholder: "e.g. call a client, submit a pain point…"
  }
};
const POLL_ORDER = ["s1", "s2", "s3", "s4"];

/* ----------------------------------------------------------------------------
   Couche de données : Firebase si configuré, sinon démo locale (même appareil).
   Interface commune utilisée par les deux pages :
     Store.mode
     Store.onControl(cb)            -> cb({activePoll, status:{s1:'open'|'closed',...}})
     Store.setControl(partialObj)
     Store.onResponses(pollId, cb)  -> cb([{...}, ...])
     Store.addResponse(pollId, data)
     Store.registerParticipant(pid)
     Store.onParticipantCount(cb)   -> cb(number)
     Store.reset()
   ---------------------------------------------------------------------------- */
const Store = (function () {
  const fb = CONFIG.firebase;
  const ROOT = CONFIG.session || "innotalk4";
  const firebaseReady =
    typeof firebase !== "undefined" &&
    fb && fb.apiKey && fb.apiKey !== "PASTE_HERE" &&
    fb.databaseURL && fb.databaseURL !== "PASTE_HERE";

  /* ---------------------- Backend Firebase (multi-appareils) --------------- */
  if (firebaseReady) {
    try {
      firebase.initializeApp(fb);
      const base = firebase.database().ref(ROOT);
      return {
        mode: "firebase",
        onControl(cb) {
          base.child("control").on("value", s => cb(s.val() || { activePoll: "none", status: {} }));
        },
        setControl(obj) { base.child("control").update(obj); },
        onResponses(pollId, cb) {
          base.child("responses/" + pollId).on("value", s => cb(Object.values(s.val() || {})));
        },
        addResponse(pollId, data) {
          base.child("responses/" + pollId).push(Object.assign({ ts: Date.now() }, data));
        },
        registerParticipant(pid) { base.child("participants/" + pid).set(Date.now()); },
        onParticipantCount(cb) {
          base.child("participants").on("value", s => cb(s.numChildren()));
        },
        reset() { return base.remove(); }
      };
    } catch (e) {
      console.error("Firebase init failed, falling back to local demo:", e);
    }
  }

  /* ---------------------- Backend local (démo, même appareil) -------------- */
  const KEY = ROOT + "-demo";
  const chan = ("BroadcastChannel" in window) ? new BroadcastChannel(ROOT) : null;
  let mem = { control: { activePoll: "none", status: {} }, responses: {}, participants: {} };

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { mem = JSON.parse(raw); }
    } catch (e) { /* localStorage indisponible -> mémoire seule */ }
    mem.control = mem.control || { activePoll: "none", status: {} };
    mem.responses = mem.responses || {};
    mem.participants = mem.participants || {};
    return mem;
  }
  function write(state) {
    mem = state;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
    if (chan) chan.postMessage(Date.now());
  }

  const controlSubs = [];
  const respSubs = {};   // pollId -> [cb]
  const countSubs = [];

  function notify() {
    const s = read();
    controlSubs.forEach(cb => cb(s.control));
    Object.keys(respSubs).forEach(p =>
      respSubs[p].forEach(cb => cb((s.responses[p]) || [])));
    const n = Object.keys(s.participants).length;
    countSubs.forEach(cb => cb(n));
  }
  if (chan) chan.onmessage = notify;
  window.addEventListener("storage", e => { if (e.key === KEY) notify(); });

  return {
    mode: "local",
    onControl(cb) { controlSubs.push(cb); cb(read().control); },
    setControl(obj) {
      const s = read();
      s.control = Object.assign(s.control, obj);
      if (obj.status) s.control.status = Object.assign(s.control.status || {}, obj.status);
      write(s); notify();
    },
    onResponses(pollId, cb) {
      (respSubs[pollId] = respSubs[pollId] || []).push(cb);
      cb((read().responses[pollId]) || []);
    },
    addResponse(pollId, data) {
      const s = read();
      (s.responses[pollId] = s.responses[pollId] || []).push(Object.assign({ ts: Date.now() }, data));
      write(s); notify();
    },
    registerParticipant(pid) {
      const s = read();
      s.participants[pid] = Date.now();
      write(s); notify();
    },
    onParticipantCount(cb) { countSubs.push(cb); cb(Object.keys(read().participants).length); },
    reset() {
      write({ control: { activePoll: "none", status: {} }, responses: {}, participants: {} });
      notify();
    }
  };
})();
