// Vercel serverless function. Multi-provider so you are not locked to one free tier.
// CommonJS on purpose: `export default` only works if the project is an ES module, and
// getting that wrong is what makes Vercel serve an HTML page instead of running this file.
//
// Set ONE of these in Vercel, Settings, Environment Variables:
//   GROQ_API_KEY        recommended, free, ~30 requests/min and ~1000/day, no card
//   GEMINI_API_KEY      free, but Flash models are only ~20 requests/DAY. Use a Flash-Lite model.
//   OPENAI_API_KEY      any OpenAI-compatible endpoint, paired with OPENAI_BASE_URL
//   OPENAI_BASE_URL     e.g. https://api.cerebras.ai/v1 or https://openrouter.ai/api/v1
//
// If more than one is set, the request picks whichever the page asked for.

const GROQ_BASE = 'https://api.groq.com/openai/v1';

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const keys = {
    groq: Boolean(process.env.GROQ_API_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY)
  };

  // Free health check. Never calls a model, so it costs nothing.
  if (req.method === 'GET') {
    const any = keys.groq || keys.gemini || keys.openai;
    return res.status(200).json({
      ok: true,
      keys: keys,
      hasKey: any,
      baseUrl: process.env.OPENAI_BASE_URL || null,
      message: any
        ? 'Serverless function is running. Keys found: ' +
          Object.keys(keys).filter(function (k) { return keys[k]; }).join(', ')
        : 'Serverless function is running, but no API key is set. Add GROQ_API_KEY or GEMINI_API_KEY in Vercel, Settings, Environment Variables, then redeploy.'
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use GET to check status or POST to generate.' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  if (!body || typeof body !== 'object') body = {};

  const prompt = body.prompt;
  const maxTokens = body.maxTokens || 16000;
  const temperature = typeof body.temperature === 'number' ? body.temperature : 0.4;
  if (!prompt) return res.status(400).json({ error: 'No prompt supplied.' });

  // Decide which provider to use: what the page asked for, else whatever key exists.
  let provider = body.provider;
  if (!provider || !keys[provider]) {
    provider = keys.groq ? 'groq' : (keys.gemini ? 'gemini' : (keys.openai ? 'openai' : null));
  }
  if (!provider) {
    return res.status(500).json({
      error: 'No API key is set on the server. Add GROQ_API_KEY or GEMINI_API_KEY in Vercel, then redeploy.'
    });
  }

  try {
    if (provider === 'gemini') {
      const model = body.model || 'gemini-3.5-flash-lite';
      const url = 'https://generativelanguage.googleapis.com/v1beta/models/'
        + encodeURIComponent(model) + ':generateContent?key='
        + encodeURIComponent(process.env.GEMINI_API_KEY);

      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: temperature,
            maxOutputTokens: maxTokens,
            responseMimeType: 'application/json'
          }
        })
      });

      const raw = await r.text();
      let data;
      try { data = JSON.parse(raw); }
      catch (e) { return res.status(502).json({ error: 'Gemini returned a non-JSON response.', sample: raw.slice(0, 300) }); }

      if (!r.ok) {
        return res.status(r.status).json({
          error: (data && data.error && data.error.message) || ('Gemini returned ' + r.status),
          status: r.status, provider: 'gemini'
        });
      }
      const cand = data && data.candidates && data.candidates[0];
      const parts = (cand && cand.content && cand.content.parts) || [];
      return res.status(200).json({
        text: parts.map(function (p) { return p.text || ''; }).join(''),
        finishReason: (cand && cand.finishReason) || null,
        provider: 'gemini'
      });
    }

    // Everything else speaks the OpenAI chat-completions shape.
    const isGroq = provider === 'groq';
    const base = isGroq ? GROQ_BASE : (process.env.OPENAI_BASE_URL || '').replace(/\/+$/, '');
    const key = isGroq ? process.env.GROQ_API_KEY : process.env.OPENAI_API_KEY;
    const model = body.model || (isGroq ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini');

    if (!base) {
      return res.status(500).json({ error: 'OPENAI_BASE_URL is not set, so the OpenAI-compatible provider cannot be used.' });
    }

    const r = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({
        model: model,
        temperature: temperature,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const raw = await r.text();
    let data;
    try { data = JSON.parse(raw); }
    catch (e) { return res.status(502).json({ error: 'Provider returned a non-JSON response.', sample: raw.slice(0, 300) }); }

    if (!r.ok) {
      return res.status(r.status).json({
        error: (data && data.error && (data.error.message || data.error)) || ('Provider returned ' + r.status),
        status: r.status, provider: provider
      });
    }

    const choice = data && data.choices && data.choices[0];
    return res.status(200).json({
      text: (choice && choice.message && choice.message.content) || '',
      finishReason: (choice && choice.finish_reason) === 'length' ? 'MAX_TOKENS' : 'STOP',
      provider: provider
    });

  } catch (err) {
    return res.status(500).json({ error: String(err && err.message ? err.message : err), provider: provider });
  }
};
