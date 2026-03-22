// banking_api_server/routes/bankingAgentNl.js
/**
 * POST /api/banking-agent/nl — natural language → education or banking intent.
 * Session required. Uses Gemini when GEMINI_API_KEY is set; otherwise heuristic parser (free).
 */
'use strict';

const express = require('express');
const { parseNaturalLanguage } = require('../services/geminiNlIntent');

const router = express.Router();

router.post('/nl', async (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ error: 'authentication_required', message: 'Sign in to use the agent.' });
  }
  const message = typeof req.body?.message === 'string' ? req.body.message : '';
  if (!message.trim()) {
    return res.status(400).json({ error: 'invalid_body', message: 'message is required' });
  }

  try {
    const { source, result } = await parseNaturalLanguage(message.trim());
    return res.json({ source, result });
  } catch (e) {
    console.error('[bankingAgentNl]', e);
    return res.status(500).json({ error: 'nl_parse_failed', message: e.message || 'Failed to parse message' });
  }
});

/** GET /api/banking-agent/nl/status — whether Gemini is configured (no secrets returned). */
router.get('/nl/status', (req, res) => {
  const gemini = !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY);
  return res.json({
    geminiConfigured: gemini,
    model: gemini ? (process.env.GEMINI_MODEL || 'gemini-1.5-flash') : null,
    heuristicAlwaysAvailable: true,
  });
});

module.exports = router;
