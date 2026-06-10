const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const QWEN_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const API_KEY = process.env.QWEN_API_KEY;

// ─── Chat / Text ────────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, model = 'qwen-max' } = req.body;
    const r = await fetch(`${QWEN_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`
      },
      body: JSON.stringify({ model, messages, stream: false, max_tokens: 2000 })
    });
    if (!r.ok) {
      const err = await r.text();
      console.error('[Chat] API error:', err);
      return res.status(r.status).json({ error: err });
    }
    res.json(await r.json());
  } catch (e) {
    console.error('[Chat]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Vision ─────────────────────────────────────────────────────────────────
app.post('/api/vision', async (req, res) => {
  const reqId = Math.random().toString(36).slice(2, 8);
  const t0 = Date.now();
  try {
    const { imageBase64, prompt } = req.body;
    const sizeKB = Math.round((imageBase64?.length || 0) * 0.75 / 1024);
    console.log(`[Vision ${reqId}] → upload size: ${sizeKB} KB, prompt: ${prompt?.length || 0} chars`);

    // Abort handling — if the *client* really disconnects mid-flight, abort
    // the Qwen call. IMPORTANT: use `res.on('close')`, NOT `req.on('close')`.
    // In Node, `req` emits 'close' as soon as `express.json()` finishes reading
    // the body (the readable stream is consumed), which is NOT a real client
    // disconnect — it fires for every successful POST. Using it here caused us
    // to abort Qwen the instant body parsing finished and return HTTP 499.
    // `res.on('close')` fires only when the underlying connection is torn down
    // before we got a chance to send the full response, which is what we want.
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) {
        console.log(`[Vision ${reqId}] ⛔ client disconnected after ${Date.now() - t0}ms, aborting Qwen call`);
        controller.abort();
      }
    });

    // Manual timeout: 50s for the Qwen call itself
    const timeoutId = setTimeout(() => {
      console.log(`[Vision ${reqId}] ⏱ 50s timeout hit, aborting`);
      controller.abort();
    }, 50_000);

    let r;
    try {
      r = await fetch(`${QWEN_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${API_KEY}`
        },
        body: JSON.stringify({
          model: 'qwen-vl-max',
          messages: [{
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
              { type: 'text', text: prompt }
            ]
          }],
          max_tokens: 2000
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!r.ok) {
      const err = await r.text();
      console.error(`[Vision ${reqId}] API error (${r.status}) after ${Date.now() - t0}ms:`, err.slice(0, 300));
      return res.status(r.status).json({ error: err });
    }
    const data = await r.json();
    const tookMs = Date.now() - t0;
    const outLen = data.choices?.[0]?.message?.content?.length || 0;
    console.log(`[Vision ${reqId}] ✓ done in ${tookMs}ms, output ${outLen} chars`);
    res.json(data);
  } catch (e) {
    const tookMs = Date.now() - t0;
    if (e.name === 'AbortError') {
      console.log(`[Vision ${reqId}] aborted after ${tookMs}ms`);
      if (!res.writableEnded) res.status(499).json({ error: 'aborted' });
      return;
    }
    console.error(`[Vision ${reqId}] error after ${tookMs}ms:`, e.message);
    if (!res.writableEnded) res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🌏  WorldQuest  →  http://localhost:${PORT}\n`);
});
