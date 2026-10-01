// Appel minimal à l'API Claude, facultatif : sans ANTHROPIC_API_KEY, tout fonctionne quand
// même (le récap n'a simplement pas de paragraphe d'analyse, l'ajout de véhicule garde des
// scores neutres).

export async function askClaude(prompt, { model, maxTokens = 1200, system, fetchImpl = fetch } = {}) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-5-5',
        max_tokens: maxTokens,
        ...(system ? { system } : {}),
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) {
      console.warn(`Claude a répondu ${res.status} : ${(await res.text()).slice(0, 300)}`);
      return null;
    }
    const json = await res.json();
    return json.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  } catch (err) {
    console.warn(`Claude indisponible : ${err.message}`);
    return null;
  }
}

// Extrait le premier objet JSON d'une réponse texte (Claude l'entoure parfois de ```json).
export function extractJson(text) {
  if (!text) return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}
