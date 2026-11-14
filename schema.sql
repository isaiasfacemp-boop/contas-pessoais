-- Banco D1: contas_pessoais
-- Execute no painel Cloudflare > D1 > seu banco > Console

-- Usuários
CREATE TABLE IF NOT EXISTS usuarios (
  id         TEXT PRIMARY KEY,           -- uid gerado no servidor
  nome       TEXT NOT NULL,
  senha_hash TEXT NOT NULL,              -- SHA-256(salt + senha)
  salt       TEXT NOT NULL,              -- hex aleatório
  criado_em  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Sessões (tokens de acesso)
CREATE TABLE IF NOT EXISTS sessoes (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  criado_em  TEXT NOT NULL DEFAULT (datetime('now')),
  expira_em  TEXT NOT NULL               -- datetime string
);

-- Lançamentos (cada um pertence a um usuário)
CREATE TABLE IF NOT EXISTS lancamentos (
  id          TEXT NOT NULL,
  user_id     TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo        TEXT NOT NULL CHECK(tipo IN ('saida','entrada')),
  desc        TEXT NOT NULL,
  obs         TEXT NOT NULL DEFAULT '',
  criado      TEXT NOT NULL,
  tot         INTEGER,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id, user_id)
);

-- Parcelas
CREATE TABLE IF NOT EXISTS parcelas (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  lancamento_id TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  idx           INTEGER NOT NULL,         -- posição (0-based)
  v             INTEGER NOT NULL,         -- centavos
  d             TEXT NOT NULL,            -- YYYY-MM-DD
  pago          INTEGER NOT NULL DEFAULT 0,
  pago_em       TEXT,
  pg            INTEGER,                  -- valor parcial pago
  n             INTEGER,                  -- número customizado
  abat          TEXT,                     -- JSON [{v,d},...]
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (lancamento_id, user_id) REFERENCES lancamentos(id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lanc_user   ON lancamentos(user_id);
CREATE INDEX IF NOT EXISTS idx_parc_lanc   ON parcelas(lancamento_id, user_id);
CREATE INDEX IF NOT EXISTS idx_sessao_user ON sessoes(user_id);
