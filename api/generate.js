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

// Groq retires models often. llama-3.3-70b-versatile was deprecated on 17 June 2026 and the
// announced replacement is openai/gpt-oss-120b. Rather than trust any single name forever, the
// function falls back to asking the provider what it actually serves.
const PREFERRED = [
  'openai/gpt-oss-120b',
  'qwen/qwen3.8-27b',
  'openai/gpt-oss-20b',
  'moonshotai/kimi-k2-instruct'
];
const NOT_CHAT = /whisper|tts|guard|embed|vision-only|distil/i;

async function discoverModel(base, key) {
  try {
    const r = await fetch(base + '/models', { headers: { 'Authorization': 'Bearer ' + key } });
    if (!r.ok) return null;
    const d = await r.json();
    const ids = ((d && d.data) || []).map(function (m) { return m.id; }).filter(Boolean);
    for (var i = 0; i < PREFERRED.length; i++) {
      if (ids.indexOf(PREFERRED[i]) !== -1) return PREFERRED[i];
    }
    const usable = ids.filter(function (id) { return !NOT_CHAT.test(id); });
    return usable[0] || null;
  } catch (e) { return null; }
}

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
      model: process.env.GROQ_MODEL || process.env.OPENAI_MODEL || PREFERRED[0],
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
    let model = body.model || process.env.GROQ_MODEL || process.env.OPENAI_MODEL
      || (isGroq ? PREFERRED[0] : 'gpt-4o-mini');

    if (!base) {
      return res.status(500).json({ error: 'OPENAI_BASE_URL is not set, so the OpenAI-compatible provider cannot be used.' });
    }

    // Providers count prompt + max_tokens against the tokens-per-minute budget, so asking for a
    // huge completion burns the budget even when the reply is short. But reasoning models spend
    // tokens thinking before they emit anything, so the cap cannot be too tight either or the JSON
    // never arrives and the reply comes back empty. The page sends a per-task figure.
    const cap = Math.min(maxTokens, 3000);

    // gpt-oss and qwen think before answering. Turn that down: this is structured extraction, not
    // a reasoning problem, and every thinking token is a token that cannot hold the answer.
    const isReasoner = /gpt-oss|qwen|deepseek|thinking/i.test(model);

    async function ask(useJsonMode) {
      const payload = {
        model: model,
        temperature: temperature,
        max_tokens: cap,
        messages: [{ role: 'user', content: prompt }]
      };
      if (useJsonMode) payload.response_format = { type: 'json_object' };
      if (isReasoner) payload.reasoning_effort = 'low';
      const rr = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify(payload)
      });
      const txt = await rr.text();
      let js = null;
      try { js = JSON.parse(txt); } catch (e) {}
      return { rr: rr, js: js, txt: txt };
    }

    let out = await ask(true);

    // Some models reject JSON mode outright. Try again without it before giving up.
    if (!out.rr.ok && out.rr.status === 400) out = await ask(false);

    // Model retired or not on this account: ask the provider what it serves and retry once.
    let discovered = null;
    if (!out.rr.ok && (out.rr.status === 404 || out.rr.status === 400)) {
      const msg = String((out.js && out.js.error && (out.js.error.message || out.js.error.code)) || '');
      if (/decommission|does not exist|not found|no access|deprecat/i.test(msg) || out.rr.status === 404) {
        discovered = await discoverModel(base, key);
        if (discovered && discovered !== model) {
          model = discovered;
          out = await ask(true);
          if (!out.rr.ok && out.rr.status === 400) out = await ask(false);
        }
      }
    }

    const r = out.rr;
    const data = out.js;

    if (!data) {
      return res.status(502).json({
        error: 'Provider returned a non-JSON response.',
        sample: out.txt.slice(0, 300), provider: provider, model: model
      });
    }

    if (!r.ok) {
      const msg = (data && data.error && (data.error.message || data.error.code || data.error)) || ('Provider returned ' + r.status);
      const retryHeader = r.headers.get('retry-after');
      const fromMsg = /try again in ([\d.]+)\s*s/i.exec(String(msg));
      return res.status(r.status).json({
        retryAfter: retryHeader ? Number(retryHeader) : (fromMsg ? Number(fromMsg[1]) : null),
        error: typeof msg === 'string' ? msg : JSON.stringify(msg),
        status: r.status, provider: provider, model: model,
        hint: r.status === 404 || /decommission|not found|does not exist/i.test(String(msg))
          ? 'That model is gone and automatic discovery could not find a replacement. Open console.groq.com/docs/models, pick a current chat model, and set GROQ_MODEL in Vercel.'
          : (r.status === 401 ? 'The key was rejected. Check GROQ_API_KEY in Vercel and redeploy.'
          : (r.status === 429 ? 'Rate limited. Wait a minute and run again.' : undefined))
      });
    }

    const choice = data && data.choices && data.choices[0];
    const content = (choice && choice.message && choice.message.content) || '';
    if (!content && choice && choice.finish_reason === 'length') {
      return res.status(502).json({
        error: 'The model used its whole token budget thinking and produced no answer. Raise max tokens or use a non-reasoning model.',
        provider: provider, model: model, usage: data.usage || null
      });
    }
    return res.status(200).json({
      text: content,
      finishReason: (choice && choice.finish_reason) === 'length' ? 'MAX_TOKENS' : 'STOP',
      provider: provider,
      model: model,
      autoSelected: Boolean(discovered),
      usage: data.usage || null
    });

  } catch (err) {
    return res.status(500).json({ error: String(err && err.message ? err.message : err), provider: provider });
  }
};
