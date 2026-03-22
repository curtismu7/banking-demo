// banking_api_server/services/geminiNlIntent.js
/**
 * Optional Gemini (Google AI) intent parsing — free tier friendly when GEMINI_API_KEY is set.
 * Falls back to caller if unset or on error.
 */
'use strict';

const { parseHeuristic, EDU } = require('./nlIntentParser');

const MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

const SYSTEM = `You are a strict JSON router for a banking demo SPA.
Return ONLY a JSON object (no markdown) with one of:
{"kind":"education","education":{"panel":"login-flow|token-exchange|may-act|mcp-protocol|introspection|agent-gateway|rfc-index|step-up|pingone-authorize","tab":"optional tab id"}}
{"kind":"education","ciba":true,"tab":"what"}
{"kind":"banking","banking":{"action":"accounts|transactions|balance|deposit|withdraw|transfer","params":{"accountId":"optional","fromId":"","toId":"","amount":0,"note":""}}}
{"kind":"none","message":"short hint"}

User wants banking operations OR to open help topics (OAuth, MCP, CIBA, token exchange, etc.).
Prefer banking when the user asks to move money or list data; prefer education when they ask how something works.`;

/**
 * @returns {Promise<object|null>} parsed result object or null to use heuristic
 */
async function parseWithGemini(userMessage) {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  if (!key) return null;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    systemInstruction: { parts: [{ text: SYSTEM }] },
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 512,
      responseMimeType: 'application/json',
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.warn('[geminiNlIntent] Gemini HTTP', res.status, errText.slice(0, 200));
    return null;
  }

  const data = await res.json();
  let text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return null;
  text = text.replace(/^```json\s*/i, '').replace(/```\s*$/m, '').trim();

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && parsed.kind) return parsed;
  } catch (e) {
    console.warn('[geminiNlIntent] JSON parse failed', e.message);
  }
  return null;
}

/**
 * @param {string} message
 * @returns {Promise<{ source: 'gemini'|'heuristic', result: object }>}
 */
async function parseNaturalLanguage(message) {
  const gemini = await parseWithGemini(message).catch((e) => {
    console.warn('[geminiNlIntent]', e.message);
    return null;
  });
  if (gemini) {
    return { source: 'gemini', result: gemini };
  }
  return { source: 'heuristic', result: parseHeuristic(message) };
}

module.exports = {
  parseNaturalLanguage,
  EDU,
};
