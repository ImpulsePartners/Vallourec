/* ============================================================================
   INNO TALK #6 — Live Polls · store.js
   Steel & Heavy Manufacturing — Innovation Benchmark (September 2026)

   Configuration partagée + couche de données temps réel.
   Utilisé par index.html (participants), display.html (écran), admin.html (régie).
   Un seul endroit à éditer : l'objet CONFIG ci-dessous.
   ============================================================================ */

const CONFIG = {

  // 1) URL publique de la page PARTICIPANT (sans paramètre). Alimente les QR codes.
  //    Si le déck IT#6 est publié dans un nouveau repo, changer cette ligne.
  joinUrl: "https://impulsepartners.github.io/Vallourec/",

  // 2) Mot de passe — demandé à l'ouverture d'admin.html ET avant la réinitialisation.
  adminPassword: "vallourec6",

  // 3) Endpoint du Cloudflare Worker qui regroupe les réponses ouvertes (voir worker.js).
  //    Laisser vide ("") pour un regroupement local par mots-clés (sans IA, pour tester).
  clusterEndpoint: "https://vallourec.jeetoki.workers.dev/",

  // 4) Espace de noms. innotalk6 ≠ innotalk4 : les données d'IT#4 restent intactes.
  session: "innotalk6",

  // 5) Config Firebase Realtime Database (laisser "PASTE_HERE" pour le mode démo local).
  firebase: {
    apiKey:      "AIzaSyAnmf9XM2R0-Vc9M4-61VEUeAA7WRsffdo",
    authDomain:  "innotalk4.firebaseapp.com",
    databaseURL: "https://innotalk4-default-rtdb.europe-west1.firebasedatabase.app",
    projectId:   "innotalk4",
    appId:       "1:683039855535:web:2c4fe1f922543984c3955a"
  }
};

/* ----------------------------------------------------------------------------
   Les 5 sondages — TEXTE AFFICHÉ (anglais, public international).

   Types :
     wordcloud · nuage de mots, réponses multiples autorisées
     single    · choix unique (une seule réponse par participant)
     multi     · choix multiples + champ "autre"
     open      · réponse détaillée, regroupée par thèmes (Worker IA)

   reveal : { id, note } — bouton régie qui met en avant la réponse "evidence"
            du déck et estompe les autres. Utilisé sur S2 (slide 16) et S4 (slide 36).
            Pour changer la bonne réponse, modifier le champ id ci-dessous.
   ---------------------------------------------------------------------------- */
const POLLS = {

  // Slide 6 — Live quiz 1 of 5 · 60 à 90 s · nuage repris entre chaque tendance
  s1: {
    n: 1, type: "wordcloud",
    question: "What is the strongest force pushing your part of Vallourec to innovate right now?",
    sub: "One word or a short phrase. You can send several.",
    placeholder: "e.g. client demand, CBAM, cost pressure, overcapacity…"
  },

  // Slide 16 — Live quiz 2 of 5 · 30 s · choix unique · reveal en fin de session
  s2: {
    n: 2, type: "single",
    question: "Which trend do you expect to pay back fastest for a tube maker?",
    sub: "Pick one. We will compare the room's instinct with the evidence later.",
    options: [
      { id: "bm",   label: "New business models", full: "New business models — service around the pipe" },
      { id: "digi", label: "Digitalisation",      full: "Digitalisation & Industry 4.0" },
      { id: "deca", label: "Decarbonation",       full: "Decarbonation & green steel" },
      { id: "circ", label: "Circular economy",    full: "Circular economy — certified scrap" }
    ],
    reveal: {
      id: "digi",
      note: "The evidence: digital pays back first. Yield, energy and running time land straight on margin — $11M at Hickman, 25% less running time, 60+ countries on Dopeless."
    }
  },

  // Slide 25 — Live quiz 3 of 5 · 60 s · nuage de mots
  s3: {
    n: 3, type: "wordcloud",
    question: "In one word: what matters most to our customers in 2026?",
    sub: "Hold your answer against the four trends we just saw.",
    placeholder: "e.g. uptime, traceability, carbon, lead time…"
  },

  // Slide 36 — Live quiz 4 of 5 · 30 s · choix unique · reveal avec la matrice
  s4: {
    n: 4, type: "single",
    question: "Which lever would move the needle fastest for a tier-1 tube maker?",
    sub: "Pick one, then argue for it. The matrix takes a position too.",
    options: [
      { id: "ma",   label: "Acquisitions",       full: "A · Acquisitions — buy the capability" },
      { id: "rnd",  label: "Internal R&D",       full: "B · Internal R&D — own the roadmap" },
      { id: "cvc",  label: "Corporate venture",  full: "C · Corporate venture — options on the future" },
      { id: "cons", label: "Consortiums & universities", full: "D · Consortiums & universities — share the risk" }
    ],
    reveal: {
      id: "rnd",
      note: "The matrix says internal R&D. Standing programmes still carry most of the load: Tenaris 263 staff / $64M, voestalpine €218.9M. Everything else buys options on top of that base."
    }
  },

  // Live quiz 5 of 5 — à insérer après la slide 37 (What to remember)
  s5: {
    n: 5, type: "open",
    question: "Which of the four means would you push first in your perimeter, and on what?",
    sub: "Name the lever (acquisition, R&D, venture, consortium) and the subject. Be specific: the technology, the partner, the plant.",
    placeholder: "e.g. Joint programme with a university on scrap sorting AI, venture ticket on a pipe-tracking startup, consortium on hydrogen-ready grades…"
  }
};
const POLL_ORDER = ["s1", "s2", "s3", "s4", "s5"];

/* ----------------------------------------------------------------------------
   Couche de données. Interface commune :
     Store.mode
     Store.onControl(cb)              -> {display:'none'|sN, status:{sN:'open'|'closed'}, reveal:bool}
     Store.setControl(partial)
     Store.onResponses(pollId, cb)    -> [ {...}, ... ]
     Store.addResponse(pollId, data)
     Store.onAnalysis(pollId, cb)     -> {clusters:[...], ts} | null
     Store.setAnalysis(pollId, data)
     Store.registerParticipant(pid)
     Store.onParticipantCount(cb)     -> number
     Store.reset()
   ---------------------------------------------------------------------------- */
const Store = (function () {
  const fb = CONFIG.firebase, ROOT = CONFIG.session || "innotalk6";
  const ready = typeof firebase !== "undefined" && fb && fb.apiKey && fb.apiKey !== "PASTE_HERE" &&
                fb.databaseURL && fb.databaseURL !== "PASTE_HERE";
  const dctrl = () => ({ display: "none", status: {}, reveal: false });

  if (ready) {
    try {
      firebase.initializeApp(fb);
      const base = firebase.database().ref(ROOT);
      return {
        mode: "firebase",
        onControl(cb){ base.child("control").on("value", s => cb(Object.assign(dctrl(), s.val()||{}))); },
        setControl(o){ const upd={};
          if("display" in o) upd["display"]=o.display;
          if("reveal" in o) upd["reveal"]=o.reveal;
          if(o.status) Object.keys(o.status).forEach(k=>{ upd["status/"+k]=o.status[k]; });
          base.child("control").update(upd); },
        onResponses(id, cb){ base.child("responses/"+id).on("value", s => cb(Object.values(s.val()||{}))); },
        addResponse(id, d){ base.child("responses/"+id).push(Object.assign({ ts: Date.now() }, d)); },
        onAnalysis(id, cb){ base.child("analysis/"+id).on("value", s => cb(s.val()||null)); },
        setAnalysis(id, d){ base.child("analysis/"+id).set(Object.assign({ ts: Date.now() }, d)); },
        registerParticipant(pid){ base.child("participants/"+pid).set(Date.now()); },
        onParticipantCount(cb){ base.child("participants").on("value", s => cb(s.numChildren())); },
        reset(){ return base.remove(); }
      };
    } catch (e) { console.error("Firebase init failed → local demo:", e); }
  }

  // ---- backend local (démo, même appareil) ----
  const KEY = ROOT + "-demo";
  const chan = ("BroadcastChannel" in window) ? new BroadcastChannel(ROOT) : null;
  let mem = { control: dctrl(), responses: {}, analysis: {}, participants: {} };
  function read(){ try{ const r=localStorage.getItem(KEY); if(r) mem=JSON.parse(r); }catch(e){}
    mem.control=Object.assign(dctrl(), mem.control||{}); mem.control.status=Object.assign({}, mem.control.status||{});
    mem.responses=mem.responses||{}; mem.analysis=mem.analysis||{}; mem.participants=mem.participants||{}; return mem; }
  function write(s){ mem=s; try{ localStorage.setItem(KEY, JSON.stringify(s)); }catch(e){} if(chan) chan.postMessage(Date.now()); }
  const cSubs=[], rSubs={}, aSubs={}, nSubs=[];
  function notify(){ const s=read();
    cSubs.forEach(cb=>cb(s.control));
    Object.keys(rSubs).forEach(p=>rSubs[p].forEach(cb=>cb(s.responses[p]||[])));
    Object.keys(aSubs).forEach(p=>aSubs[p].forEach(cb=>cb(s.analysis[p]||null)));
    const n=Object.keys(s.participants).length; nSubs.forEach(cb=>cb(n)); }
  if(chan) chan.onmessage=notify;
  window.addEventListener("storage", e=>{ if(e.key===KEY) notify(); });

  return {
    mode: "local",
    onControl(cb){ cSubs.push(cb); cb(read().control); },
    setControl(o){ const s=read(); if(o.status) o.status=Object.assign({}, s.control.status||{}, o.status);
      s.control=Object.assign(s.control, o); write(s); notify(); },
    onResponses(id, cb){ (rSubs[id]=rSubs[id]||[]).push(cb); cb(read().responses[id]||[]); },
    addResponse(id, d){ const s=read(); (s.responses[id]=s.responses[id]||[]).push(Object.assign({ts:Date.now()},d)); write(s); notify(); },
    onAnalysis(id, cb){ (aSubs[id]=aSubs[id]||[]).push(cb); cb(read().analysis[id]||null); },
    setAnalysis(id, d){ const s=read(); s.analysis[id]=Object.assign({ts:Date.now()},d); write(s); notify(); },
    registerParticipant(pid){ const s=read(); s.participants[pid]=Date.now(); write(s); notify(); },
    onParticipantCount(cb){ nSubs.push(cb); cb(Object.keys(read().participants).length); },
    reset(){ write({ control: dctrl(), responses:{}, analysis:{}, participants:{} }); notify(); }
  };
})();
