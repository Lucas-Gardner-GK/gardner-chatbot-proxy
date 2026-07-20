const http = require('http');
const https = require('https');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const PORT = process.env.PORT || 3000;

// --- Konfig ---
const ALLOWED_ORIGINS = [
  'https://gardnersolutions.no',
  'https://www.gardnersolutions.no',
  'https://lucas-gardner-gk.github.io'
];
const RATE_MAX = 10;                 // maks meldinger
const RATE_WINDOW_MS = 60 * 1000;    // per 60 sek per IP
const MAX_MESSAGE_LEN = 1500;
const MAX_HISTORY = 10;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 time

const SYSTEM_PROMPT = 'Du er en vennlig og profesjonell AI-assistent for Gardner Solutions — et norsk AI-automatiseringsfirma i Stavanger. Svar alltid på norsk. Svar kort og konkret, maks 3 setninger. Om Gardner Solutions: Lager skreddersydde AI-løsninger for norske SMB-er. Tjenester: AI-chatboter for nettsider, faktura- og automatiseringsapper, dataflyt mellom systemer. Grunnlagt juni 2026 av Lucas Longum-Gardner, Stavanger. Org.nr: 937 948 883. Priser: Enkle løsninger 7 000–15 000 kr engangssum. Komplekse automatiseringer fra flere titalls tusen. Alle løsninger inkluderer fast månedlig vedlikehold og support. Gratis uforpliktende første samtale. Referanse: Faktura-app for Steven M Jones Snekkerservice, Stavanger juni 2026. Kontakt: gardner.ai.automation@gmail.com. Hvis noen vil ha tilbud eller møte: be dem ta kontakt på gardner.ai.automation@gmail.com.';

// --- State (in-memory) ---
const hits = new Map();   // ip -> [timestamps]
const cache = new Map();  // normalisert melding -> { ts, body }

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) { for (const [k, v] of hits) { if (!v.length || now - v[v.length - 1] > RATE_WINDOW_MS) hits.delete(k); } }
  return arr.length > RATE_MAX;
}

function textReply(text) {
  return JSON.stringify({ content: [{ type: 'text', text }] });
}

function corsOrigin(req) {
  const o = req.headers.origin;
  return (o && ALLOWED_ORIGINS.includes(o)) ? o : ALLOWED_ORIGINS[0];
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', corsOrigin(req));
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'POST' && req.url === '/chat') {
    const ip = clientIp(req);
    if (rateLimited(ip)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(textReply('Du sender litt for mange meldinger på kort tid. Vent et lite øyeblikk og prøv igjen.'));
      return;
    }

    let body = '';
    let tooBig = false;
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 20000) { tooBig = true; req.destroy(); }
    });
    req.on('end', () => {
      if (tooBig) return;
      try {
        let { message, history } = JSON.parse(body);
        if (typeof message !== 'string' || !message.trim()) {
          res.writeHead(400); res.end(JSON.stringify({ error: 'Bad request' })); return;
        }
        message = message.trim();
        if (message.length > MAX_MESSAGE_LEN) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(textReply('Meldingen er litt for lang — kan du korte den ned? Eller ta kontakt på gardner.ai.automation@gmail.com.'));
          return;
        }
        history = Array.isArray(history) ? history.slice(-MAX_HISTORY) : [];

        // Cache kun for enkle spørsmål uten historikk
        const cacheKey = history.length === 0 ? message.toLowerCase() : null;
        if (cacheKey && cache.has(cacheKey)) {
          const entry = cache.get(cacheKey);
          if (Date.now() - entry.ts < CACHE_TTL_MS) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(entry.body);
            return;
          }
          cache.delete(cacheKey);
        }

        const messages = history.concat([{ role: 'user', content: message }]);
        const payload = JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1000,
          system: SYSTEM_PROMPT,
          messages
        });

        const options = {
          hostname: 'api.anthropic.com',
          path: '/v1/messages',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'Content-Length': Buffer.byteLength(payload)
          }
        };

        const apiReq = https.request(options, apiRes => {
          let data = '';
          apiRes.on('data', chunk => data += chunk);
          apiRes.on('end', () => {
            // Cache kun vellykkede svar med innhold
            try {
              const parsed = JSON.parse(data);
              if (cacheKey && parsed && Array.isArray(parsed.content) && parsed.content.length) {
                cache.set(cacheKey, { ts: Date.now(), body: data });
                if (cache.size > 500) { for (const [k, v] of cache) { if (Date.now() - v.ts > CACHE_TTL_MS) cache.delete(k); } }
              }
            } catch (e) {}
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(data);
          });
        });

        apiReq.on('error', err => {
          res.writeHead(500);
          res.end(JSON.stringify({ error: err.message }));
        });

        apiReq.write(payload);
        apiReq.end();

      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Bad request' }));
      }
    });
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'Gardner Solutions Chatbot Proxy OK' }));
  }
});

server.listen(PORT, () => {
  console.log(`Proxy running on port ${PORT}`);
});
