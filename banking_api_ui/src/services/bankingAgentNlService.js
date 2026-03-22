// banking_api_ui/src/services/bankingAgentNlService.js
/**
 * Natural language routing for the Banking Agent (BFF: heuristic + optional Gemini).
 */

export async function fetchNlStatus() {
  const res = await fetch('/api/banking-agent/nl/status', { credentials: 'include' });
  if (!res.ok) return { geminiConfigured: false, heuristicAlwaysAvailable: true };
  return res.json();
}

/**
 * @param {string} message
 * @returns {Promise<{ source: string, result: object }>}
 */
export async function parseNaturalLanguage(message) {
  const res = await fetch('/api/banking-agent/nl', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ message }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || data.error || `NL request failed (${res.status})`);
  }
  return data;
}
