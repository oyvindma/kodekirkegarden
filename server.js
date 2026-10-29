// Backend for Kodekirkegården: server frontend, og streamer agentens arbeid som Server-Sent Events.
//   npm run web          → http://127.0.0.1:3000
//   GET /api/status      → om API-nøkkel finnes
//   GET /api/repo        → filene i hjemsokt-repo (frontend tegner dem som gravsteiner)
//   GET /api/run?modus=live|demo&oppgave=…  → SSE med hendelser fra agenten
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { kjørAgent, anthropicModell, modellnavn, MAX_ITERASJONER } from './src/agent.js';
import { demoModell } from './src/demo.js';
import { system, eksempelOppgave, verktøy, repoFiler } from './src/verktoy.js';

try {
  process.loadEnvFile();
} catch {
  // Ingen .env — da må ANTHROPIC_API_KEY være satt i miljøet.
}

const PORT = Number(process.env.PORT ?? 3000);
const HOST = '127.0.0.1'; // bare lokalt: serveren bruker din API-nøkkel
const PUBLIC = path.resolve(import.meta.dirname, 'public');
const harNokkel = () => Boolean(process.env.ANTHROPIC_API_KEY);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg' };

let kjører = false; // én kjøring om gangen, så ingen starter ti agenter ved et uhell

const json = (res, kode, data) => {
  res.writeHead(kode, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
};

function statisk(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const full = path.resolve(PUBLIC, rel);
  if (path.relative(PUBLIC, full).startsWith('..') || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
    res.writeHead(404); return res.end('Ikke funnet');
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(full)] ?? 'application/octet-stream' });
  fs.createReadStream(full).pipe(res);
}

async function kjør(req, res, params) {
  const modus = params.get('modus') === 'live' ? 'live' : 'demo';
  if (modus === 'live' && !harNokkel()) return json(res, 400, { feil: 'Mangler ANTHROPIC_API_KEY. Lag en .env-fil (se .env.example) og start serveren på nytt.' });
  if (kjører) return json(res, 429, { feil: 'En agent kjører allerede.' });
  const oppgave = (params.get('oppgave') || eksempelOppgave).slice(0, 1000);

  kjører = true;
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const ac = new AbortController();
  res.on('close', () => ac.abort()); // lukker nettleseren, stopper vi agenten (og kostnaden)
  const emit = (h) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(h)}\n\n`); };

  emit({ type: 'start', modus, modell: modus === 'live' ? modellnavn : 'manus', oppgave, maks: MAX_ITERASJONER });
  try {
    await kjørAgent({ system, oppgave, verktøy, emit, signal: ac.signal, modell: modus === 'live' ? await anthropicModell() : demoModell() });
  } catch (e) {
    if (!ac.signal.aborted) emit({ type: 'feil', melding: e?.message ?? String(e) });
  } finally {
    kjører = false;
    res.end();
  }
}

http.createServer((req, res) => {
  const u = new URL(req.url, `http://${HOST}:${PORT}`);
  if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
  if (u.pathname === '/api/status') return json(res, 200, { harNokkel: harNokkel(), modell: modellnavn, maksIterasjoner: MAX_ITERASJONER, oppgave: eksempelOppgave });
  if (u.pathname === '/api/repo') return json(res, 200, { navn: 'hjemsokt-repo', filer: repoFiler() });
  if (u.pathname === '/api/run') return kjør(req, res, u.searchParams);
  statisk(req, res, u.pathname);
}).listen(PORT, HOST, () => {
  console.log(`🪦 Kodekirkegården på http://${HOST}:${PORT}  (${harNokkel() ? `live-modus: ${modellnavn}` : 'ingen API-nøkkel: bare demo-modus'})`);
});
