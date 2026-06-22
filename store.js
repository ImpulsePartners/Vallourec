/* ============================================================================
   INNO TALK #4 — Live Polls · store.js
   Configuration partagée + couche de données temps réel.
   Utilisé par index.html (participants), display.html (écran), admin.html (régie).
   ⚙️  Un seul endroit à éditer : l'objet CONFIG ci-dessous.
   ============================================================================ */

const CONFIG = {

  // 1) URL publique de la page PARTICIPANT (sans paramètre). Alimente les QR codes.
  //    ⚠️ Remplacez IMPULSE-ORG par le slug réel de l'organisation GitHub d'Impulse.
  joinUrl: "https://impulsepartners.github.io/Vallourec/",

  // 2) Mot de passe — demandé à l'ouverture d'admin.html ET avant la réinitialisation.
  adminPassword: "vallourec4",

  // 3) Endpoint du Cloudflare Worker qui regroupe les réponses du Sondage 2 (voir worker.js).
  //    Laissez vide ("") pour un regroupement local par mots-clés (sans IA, pour tester).
  clusterEndpoint: "https://vallourec.jeetoki.workers.dev/",   // Cloudflare Worker (regroupement S2)

  // 4) Espace de noms.
  session: "innotalk4",

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
   Les 4 sondages — TEXTE AFFICHÉ (anglais, public mondial).
   Types : wordcloud · open (réponse détaillée, regroupée) · multi (choix multiples + autre)
   ---------------------------------------------------------------------------- */
const POLLS = {
  s1: {
    n: 1, type: "wordcloud",
    question: "In one word: what is the biggest innovation challenge your clients are talking about right now?",
    sub: "Type 1 to 3 words — you can add several.",
    placeholder: "e.g. cost, integrity, CO₂…"
  },
  s2: {
    n: 2, type: "open",
    question: "How could Vallourec connect to technologies / business opportunities in Oil & Gas and conventional businesses?",
    sub: "Existing products, on-going projects, expertise to value, new products / solutions to develop, partnerships to explore… Answer in detail — name the player, the product.",
    placeholder: "Be specific: client / project, product or solution, what to do…"
  },
  s3: {
    n: 3, type: "multi", allowOther: true,
    question: "Which of these are real barriers for Vallourec to win in CCUS, hydrogen & geothermal?",
    sub: "Select all that apply — add your own with “Other”.",
    reveal: { id: "qual", note: "The real barrier: qualification & standards — not invention." },
    options: [
      { id: "tech", label: "New technology",            full: "Inventing new technology" },
      { id: "qual", label: "Qualification & standards", full: "Qualification & standards" },
      { id: "cost", label: "Cost",                       full: "Cost" },
      { id: "rel",  label: "Client relationships",       full: "Client relationships" },
      { id: "cap",  label: "Capacity",                   full: "Manufacturing capacity" }
    ]
  },
  s4: {
    n: 4, type: "wordcloud",
    question: "In one word: what will you do differently after today?",
    sub: "Type 1 to 3 words — you can add several.",
    placeholder: "e.g. call a client, submit a pain point…"
  }
};
const POLL_ORDER = ["s1", "s2", "s3", "s4"];

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
  const fb = CONFIG.firebase, ROOT = CONFIG.session || "innotalk4";
  const ready = typeof firebase !== "undefined" && fb && fb.apiKey && fb.apiKey !== "PASTE_HERE" &&
                fb.databaseURL && fb.databaseURL !== "PASTE_HERE";
  const DEFAULT_CTRL = { display: "none", status: {}, reveal: false };
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
