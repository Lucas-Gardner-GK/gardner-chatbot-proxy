const http = require('http');
const https = require('https');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/chat') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { message, history } = JSON.parse(body);

        const messages = (history || []).concat([{ role: 'user', content: message }]);

        const payload = JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1000,
          system: 'Du er en vennlig og profesjonell AI-assistent for Gardner Solutions — et norsk AI-automatiseringsfirma i Stavanger. Svar alltid på norsk. Svar kort og konkret, maks 3 setninger. Om Gardner Solutions: Lager skreddersydde AI-løsninger for norske SMB-er. Tjenester: AI-chatboter for nettsider, faktura- og automatiseringsapper, dataflyt mellom systemer. Grunnlagt juni 2026 av Lucas Longum-Gardner, Stavanger. Org.nr: 937 948 883. Priser: Enkle løsninger 7 000–15 000 kr engangssum. Komplekse automatiseringer fra flere titalls tusen. Alle løsninger inkluderer fast månedlig vedlikehold og support. Gratis uforpliktende første samtale. Referanse: Faktura-app for Steven M Jones Snekkerservice, Stavanger juni 2026. Kontakt: gardner.ai.automation@gmail.com. Hvis noen vil ha tilbud eller møte: be dem ta kontakt på gardner.ai.automation@gmail.com.',
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
