// server.js ─ Node.js runtime (Serverless Function)
const jsonServer = require('json-server');
const { kv }     = require('@vercel/kv');      // npm i @vercel/kv
const fs         = require('fs');
const path       = require('path');

const DB_KEY   = 'mock:db';                    // chave Redis onde ficará o JSON
const SEED_SRC = path.join(process.cwd(), 'db.json');

// ---------------------- bootstrap ----------------------
/**
 * Carrega o JSON:
 *  • 1ª execução (cold‑start)      → kv.get()  ➜ se nada, lê SEED_SRC
 *  • execuções seguintes (quente) → objeto já mantido em memória
 */
let cache;                                    // fica em RAM enquanto a instância estiver viva
async function getState() {
  if (cache) return cache;                    // hit em memória

  cache = await kv.get(DB_KEY);              // tenta KV
  if (!cache) {
    cache = JSON.parse(fs.readFileSync(SEED_SRC, 'utf-8')); // fallback
    await kv.set(DB_KEY, cache);             // grava seed na KV
  }
  return cache;
}
// -------------------------------------------------------

async function buildServer() {
  const server     = jsonServer.create();
  const middlewares = jsonServer.defaults();

  // ← 1. obtém o estado atual da KV
  const router = jsonServer.router(await getState());

  // ← 2. antes de cada resposta, se houver escrita, persiste na KV
  server.use(async (req, res, next) => {
    res.on('finish', async () => {
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        await kv.set(DB_KEY, router.db.getState());
      }
    });
    next();
  });

  // (opcional) reescritas de rota
  server.use(jsonServer.rewriter({ '/api/*': '/$1' }));
  server.use(middlewares);
  server.use(router);

  return server;
}

// ---------------------- Vercel export ------------------
let handler;                                  // cache o objeto entre execuções

module.exports = async (req, res) => {
  if (!handler) {
    const app = await buildServer();
    handler   = app;                          // memoriza
  }
  return handler(req, res);                   // delega
};

// Next.js 15/App Router precisa informar runtime “nodejs”
module.exports.config = { runtime: 'nodejs' };
