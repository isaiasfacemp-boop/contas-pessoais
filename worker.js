// Worker Cloudflare — Contas Pessoais API (multi-usuário)
// Bindings necessários:
//   DB    → D1 database "contas_pessoais"
//   ASSETS → Static Assets (para servir o index.html)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

/* ---- helpers ---- */
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
function err(msg, status = 400) { return json({ error: msg }, status); }

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

/* ---- hash seguro com SubtleCrypto (disponível nos Workers) ---- */
async function hashSenha(salt, senha) {
  const enc = new TextEncoder();
  const data = enc.encode(salt + senha);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ---- autenticação por token (header Authorization: Bearer <token>) ---- */
async function getUser(request, DB) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return null;
  const row = await DB.prepare(
    `SELECT s.user_id, u.nome FROM sessoes s
     JOIN usuarios u ON u.id = s.user_id
     WHERE s.token = ? AND s.expira_em > datetime('now')`
  ).bind(token).first();
  return row || null;
}

/* ---- montar objeto "g" (formato do frontend) ---- */
function rowsToG(lancRows, parcRows) {
  const g = {};
  for (const l of lancRows) {
    g[l.id] = {
      tipo: l.tipo,
      desc: l.desc,
      obs: l.obs || '',
      criado: l.criado,
      ...(l.tot ? { tot: l.tot } : {}),
      parcelas: [],
    };
  }
  for (const p of parcRows) {
    const lanc = g[p.lancamento_id];
    if (!lanc) continue;
    lanc.parcelas[p.idx] = {
      v: p.v,
      d: p.d,
      pago: p.pago === 1,
      pagoEm: p.pago_em || null,
      ...(p.pg ? { pg: p.pg } : {}),
      ...(p.n  ? { n: p.n }  : {}),
      ...(p.abat ? { abat: JSON.parse(p.abat) } : {}),
    };
  }
  return g;
}

/* ---- upsert de um lançamento completo ---- */
async function upsertLancamento(DB, userId, id, data) {
  if (!id || !data || !data.tipo || !data.desc || !Array.isArray(data.parcelas))
    throw new Error('Dados inválidos');

  await DB.prepare(
    `INSERT INTO lancamentos (id, user_id, tipo, desc, obs, criado, tot, updated_at)
     VALUES (?,?,?,?,?,?,?,datetime('now'))
     ON CONFLICT(id, user_id) DO UPDATE SET
       tipo=excluded.tipo, desc=excluded.desc, obs=excluded.obs,
       criado=excluded.criado, tot=excluded.tot, updated_at=datetime('now')`
  ).bind(id, userId, data.tipo, data.desc, data.obs||'',
         data.criado||new Date().toISOString(), data.tot||null).run();

  await DB.prepare(
    'DELETE FROM parcelas WHERE lancamento_id=? AND user_id=?'
  ).bind(id, userId).run();

  for (let idx = 0; idx < data.parcelas.length; idx++) {
    const p = data.parcelas[idx];
    if (!p) continue;
    await DB.prepare(
      `INSERT INTO parcelas
         (lancamento_id, user_id, idx, v, d, pago, pago_em, pg, n, abat, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))`
    ).bind(
      id, userId, idx, p.v, p.d, p.pago ? 1 : 0, p.pagoEm||null,
      p.pg||null, p.n||null,
      p.abat && p.abat.length ? JSON.stringify(p.abat) : null
    ).run();
  }
}

/* ---- roteador principal ---- */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();
    const DB = env.DB;

    if (method === 'OPTIONS') return new Response(null, { headers: CORS });

    // Servir o frontend
    if (!pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    /* ==================== AUTH ==================== */

    // POST /api/auth/registro
    if (pathname === '/api/auth/registro' && method === 'POST') {
      let body; try { body = await request.json(); } catch { return err('JSON inválido'); }
      const nome = (body.nome||'').trim();
      const senha = (body.senha||'').trim();
      if (!nome || nome.length < 2) return err('Nome deve ter ao menos 2 caracteres.');
      if (!senha || senha.length < 4) return err('Senha deve ter ao menos 4 caracteres.');

      const exist = await DB.prepare(
        "SELECT id FROM usuarios WHERE lower(nome)=lower(?)"
      ).bind(nome).first();
      if (exist) return err('Este nome de usuário já está em uso.');

      const salt = uid() + uid();
      const hash = await hashSenha(salt, senha);
      const userId = uid();
      await DB.prepare(
        'INSERT INTO usuarios (id, nome, senha_hash, salt) VALUES (?,?,?,?)'
      ).bind(userId, nome, hash, salt).run();

      const token = uid() + uid() + uid();
      const expira = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
        .toISOString().replace('T', ' ').slice(0, 19);
      await DB.prepare(
        'INSERT INTO sessoes (token, user_id, expira_em) VALUES (?,?,?)'
      ).bind(token, userId, expira).run();

      return json({ ok: true, token, nome });
    }

    // POST /api/auth/login
    if (pathname === '/api/auth/login' && method === 'POST') {
      let body; try { body = await request.json(); } catch { return err('JSON inválido'); }
      const nome = (body.nome||'').trim();
      const senha = (body.senha||'').trim();
      if (!nome || !senha) return err('Informe nome e senha.');

      const user = await DB.prepare(
        "SELECT * FROM usuarios WHERE lower(nome)=lower(?)"
      ).bind(nome).first();
      if (!user) return err('Usuário não encontrado.', 401);

      const hash = await hashSenha(user.salt, senha);
      if (hash !== user.senha_hash) return err('Senha incorreta.', 401);

      const token = uid() + uid() + uid();
      const expira = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
        .toISOString().replace('T', ' ').slice(0, 19);
      await DB.prepare(
        'INSERT INTO sessoes (token, user_id, expira_em) VALUES (?,?,?)'
      ).bind(token, user.id, expira).run();

      return json({ ok: true, token, nome: user.nome });
    }

    // POST /api/auth/logout
    if (pathname === '/api/auth/logout' && method === 'POST') {
      const auth = request.headers.get('Authorization') || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      if (token) await DB.prepare('DELETE FROM sessoes WHERE token=?').bind(token).run();
      return json({ ok: true });
    }

    /* ==================== LANÇAMENTOS (requer login) ==================== */

    const user = await getUser(request, DB);
    if (!user) return err('Não autenticado. Faça login.', 401);

    // GET /api/lancamentos
    if (pathname === '/api/lancamentos' && method === 'GET') {
      const lancRows = (await DB.prepare(
        'SELECT * FROM lancamentos WHERE user_id=? ORDER BY criado'
      ).bind(user.user_id).all()).results || [];

      const ids = lancRows.map(l => l.id);
      let parcRows = [];
      if (ids.length) {
        const ph = ids.map(() => '?').join(',');
        parcRows = (await DB.prepare(
          `SELECT * FROM parcelas WHERE user_id=? AND lancamento_id IN (${ph}) ORDER BY lancamento_id, idx`
        ).bind(user.user_id, ...ids).all()).results || [];
      }
      return json(rowsToG(lancRows, parcRows));
    }

    // POST /api/lancamentos  — salvar ou excluir
    if (pathname === '/api/lancamentos' && method === 'POST') {
      let body; try { body = await request.json(); } catch { return err('JSON inválido'); }
      const { id, data } = body;
      if (!id) return err('id obrigatório');

      if (data === null || data === undefined) {
        await DB.prepare(
          'DELETE FROM lancamentos WHERE id=? AND user_id=?'
        ).bind(id, user.user_id).run();
        return json({ ok: true, deleted: id });
      }

      try { await upsertLancamento(DB, user.user_id, id, data); }
      catch (e) { return err(e.message); }
      return json({ ok: true, id });
    }

    return err('Rota não encontrada', 404);
  }
};
