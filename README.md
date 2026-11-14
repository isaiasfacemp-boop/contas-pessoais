# Contas Pessoais — Multi-usuário

App de controle financeiro pessoal com múltiplos usuários isolados.  
Cada pessoa se cadastra com nome + senha e só enxerga seus próprios dados.

## Arquivos

| Arquivo | O que é |
|---|---|
| `index.html` | Frontend completo do app |
| `worker.js` | API Cloudflare Worker (rotas REST + autenticação) |
| `schema.sql` | Estrutura do banco D1 |
| `wrangler.toml` | Configuração do Worker |

---

## Deploy passo a passo

### 1. Criar o banco D1

No painel Cloudflare → **D1** → **Create database**:
- Nome: `contas_pessoais`
- Clique em **Create**
- Copie o **Database ID** (vai para o wrangler.toml)

Depois vá em **Console** e cole todo o conteúdo de `schema.sql` e clique **Execute**.

### 2. Configurar o wrangler.toml

Abra `wrangler.toml` e substitua:
```
database_id = "COLE_AQUI_O_DATABASE_ID"
```
pelo ID que você copiou no passo anterior.

### 3. Criar o Worker no painel Cloudflare

- Cloudflare → **Workers & Pages** → **Create** → **Worker**
- Nome: `contas-pessoais`
- Clique em **Deploy** (pode deixar o código padrão por enquanto)

### 4. Conectar o banco D1 ao Worker

- Entre no Worker criado → aba **Settings** → **Bindings**
- Clique **Add** → **D1 Database**
- Variable name: `DB`
- D1 database: selecione `contas_pessoais`
- Clique **Save**

### 5. Subir o código pelo GitHub (recomendado)

```bash
# Primeira vez
git init
git add .
git commit -m "Contas Pessoais — deploy inicial"
git remote add origin https://github.com/SEU_USER/contas-pessoais.git
git push -u origin main
```

Depois conecte o repositório ao Worker:
- Worker → **Settings** → **Build** → conectar com GitHub

Ou publique direto pelo editor do painel:
- Cole o conteúdo de `worker.js` no editor do Worker e clique **Deploy**
- O `index.html` será servido automaticamente pelo binding `assets`

### 6. Acessar o app

A URL será:  
`https://contas-pessoais.SEU_USUARIO.workers.dev`

---

## Como funciona o multi-usuário

- Cada pessoa cria sua conta com **nome + senha**
- A senha é armazenada como hash seguro (SHA-256 + salt) — nunca em texto puro
- Após o login, um **token de sessão** (válido por 90 dias) é salvo no navegador
- Todos os lançamentos ficam vinculados ao usuário — a API filtra automaticamente
- Não existe "admin" — cada um só vê seus próprios dados

## Rotas da API

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/auth/registro` | Criar conta `{nome, senha}` |
| POST | `/api/auth/login` | Login `{nome, senha}` → `{token, nome}` |
| POST | `/api/auth/logout` | Invalidar token |
| GET | `/api/lancamentos` | Buscar todos os lançamentos do usuário logado |
| POST | `/api/lancamentos` | Salvar ou excluir um lançamento `{id, data}` |
