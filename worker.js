/* ============================================================================
   Inno Talk #4 — Worker de regroupement (Sondage 2)
   Déployez ce code sur un Cloudflare Worker. Il appelle l'API Anthropic avec
   votre clé (stockée comme secret côté serveur, jamais exposée au navigateur)
   et renvoie les réponses ouvertes regroupées en thèmes.

   Déploiement (résumé) :
     1. dash.cloudflare.com → Workers & Pages → Create Worker → nom "innotalk4".
     2. Collez ce fichier (Edit code) → Deploy.
     3. Settings → Variables → Add secret :  ANTHROPIC_API_KEY = votre clé.
     4. Copiez l'URL du Worker (https://innotalk4.<sous-domaine>.workers.dev)
        dans store.js → CONFIG.clusterEndpoint.
   ============================================================================ */

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST") return new Response("POST only", { status: 405, headers: cors });

    try {
      const { question, answers } = await request.json();
      if (!answers || !answers.length)
        return json({ clusters: [] }, cors);

      const list = answers.map((a, i) => `${i + 1}. ${a}`).join("\n");
      const prompt =
`You are clustering live audience answers from a Vallourec innovation webinar.

Question asked: "${question}"

Answers (one per line):
${list}

Group these answers into 4 to 8 clear, business-meaningful themes (e.g. by opportunity type, market, product family, or partnership). Each theme gets a short label (max 5 words), a count of how many answers fall in it, and up to 2 short representative examples (verbatim or lightly trimmed).

Return ONLY valid JSON, no prose, no markdown fences:
{"clusters":[{"label":"...","count":0,"examples":["...","..."]}]}`;

      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1024,
          messages: [{ role: "user", content: prompt }]
        })
      });
      const data = await r.json();
      let text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
      text = text.replace(/```json/g, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(text);
      return json(parsed, cors);
    } catch (e) {
      return json({ error: String(e), clusters: [] }, cors, 500);
    }
  }
};

function json(obj, cors, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: Object.assign({ "Content-Type": "application/json" }, cors)
  });
}
