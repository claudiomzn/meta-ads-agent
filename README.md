# Meta Ads Agent

Agente de IA para gestão completa de campanhas Meta Ads (Facebook e Instagram). Gera planos de campanha com Claude, valida e publica diretamente no Meta via protocolo MCP.

## O que faz

- **Cria campanhas com IA** — descreva o produto e objetivo, o Claude gera adsets e anúncios completos
- **Publica no Meta em tempo real** — progresso via SSE, sempre cria como PAUSED para revisão
- **Gera copies automaticamente** — frameworks AIDA, PAS e BAB com tom de voz configurável
- **Monitora métricas reais** — gasto, ROAS, CPC, CPL sincronizados do Meta
- **Executa automações** — regras para pausar, ativar ou escalar campanhas automaticamente
- **Testes A/B** — criação + calculadora de significância estatística (teste Z bilateral)

---

## Pré-requisitos

- Node.js 18+
- Conta no [Pipeboard](https://pipeboard.co) (para MCP) — plano gratuito disponível
- Chave da [API Anthropic](https://console.anthropic.com/settings/keys) (para funções de IA)
- Token Meta Ads com permissões `ads_management`, `ads_read`, `business_management`
  - Gere em: https://developers.facebook.com/tools/explorer/

---

## Instalação

### 1. Clone o repositório

```bash
git clone https://github.com/seu-usuario/meta-ads-agent.git
cd meta-ads-agent
```

### 2. Configure o backend

```bash
cd backend

# Copie e edite o arquivo de variáveis de ambiente
cp .env.example .env
# Abra .env e preencha pelo menos:
#   JWT_SECRET        → string aleatória com 32+ caracteres
#   ENCRYPTION_KEY    → string aleatória com exatamente 32 caracteres
#   ANTHROPIC_API_KEY → chave da API Anthropic (opcional para testar)
#   PIPEBOARD_API_KEY → chave do Pipeboard (necessária para publicar no Meta)

# Instale as dependências
npm install

# Crie o banco de dados
npm run db:push

# (Opcional) Crie usuário de demonstração: demo@metaads.com / demo1234
npm run db:seed

# Inicie em modo desenvolvimento
npm run dev
```

Backend disponível em: **http://localhost:3001**

### 3. Configure o frontend

```bash
# Em outro terminal, a partir da raiz do projeto
cd frontend
npm install
npm run dev
```

Frontend disponível em: **http://localhost:5173**

---

## Primeiro acesso

1. Acesse **http://localhost:5173**
2. Crie uma conta ou use `demo@metaads.com` / `demo1234`
3. Preencha o perfil no onboarding
4. Vá em **Configurações** e conecte o MCP com seu token Meta e chave Pipeboard

---

## Configuração do MCP (conexão com o Meta)

O sistema suporta três provedores MCP. Configure o escolhido no `.env`:

| Provedor | Dificuldade | Custo | `META_MCP_URL` |
|----------|-------------|-------|----------------|
| **Pipeboard** | ⭐ Fácil | Plano gratuito | `https://meta-ads.mcp.pipeboard.co/` |
| **Zapier MCP** | ⭐⭐ Médio | Plano Zapier | `https://mcp.zapier.com/api/mcp/s/SEU_ID/mcp` |
| **Meta Oficial** | ⭐⭐⭐ Difícil | Grátis | Requer app aprovado no Meta Business |

**Recomendação:** comece com Pipeboard. É o mais simples e tem plano gratuito.

---

## Scripts disponíveis

### Backend

| Comando | Descrição |
|---------|-----------|
| `npm run dev` | Inicia com hot-reload (desenvolvimento) |
| `npm run build` | Compila TypeScript para `dist/` |
| `npm start` | Inicia a versão compilada (produção) |
| `npm test` | Executa todos os testes |
| `npm run test:watch` | Testes em modo watch |
| `npm run db:push` | Sincroniza schema com o banco |
| `npm run db:migrate` | Cria migration (produção) |
| `npm run db:studio` | Abre Prisma Studio (interface visual do banco) |
| `npm run db:seed` | Cria usuário demo |

### Frontend

| Comando | Descrição |
|---------|-----------|
| `npm run dev` | Inicia com hot-reload |
| `npm run build` | Gera bundle de produção em `dist/` |
| `npm test` | Executa todos os testes |
| `npm run test:watch` | Testes em modo watch |

---

## Cobertura de testes

```
Backend  — 62 testes  (crypto, validação MCP, auth, campaigns, automations, mcp routes)
Frontend — 15 testes  (api client, LoginPage, MCPStatusBadge)
Total    — 77 testes, CI via GitHub Actions
```

Execute:
```bash
cd backend && npm test
cd frontend && npm test
```

---

## Segurança

- **Tokens Meta** criptografados com AES-256 antes de salvar no banco
- **JWT** com expiração de 7 dias
- **Rate limiting**: 10 publicações/hora, 10 logins/15min por IP
- **Campanhas sempre criadas como PAUSED** — nunca ativam sem revisão humana
- **Webhook** validado com HMAC-SHA256 (chave `META_APP_SECRET`)
- **Auditoria** completa de toda ação de escrita no Meta

---

## Arquitetura

```
meta-ads-agent/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma         Modelos: User, Campaign, AdSet, Ad,
│   │   │                         MCPConnection, ABTest, AutomationRule...
│   │   └── seed.ts               Usuário de demonstração
│   └── src/
│       ├── middleware/
│       │   ├── auth.ts           Validação JWT
│       │   └── rateLimiter.ts    Rate limiting por rota
│       ├── routes/
│       │   ├── auth.routes.ts    POST /register /login  GET /me
│       │   ├── campaigns.routes.ts  CRUD + adsets aninhados
│       │   ├── copies.routes.ts  Geração de copy com IA
│       │   ├── audiences.routes.ts  Biblioteca de públicos
│       │   ├── abtests.routes.ts  Testes A/B + calculadora
│       │   ├── automations.routes.ts  Regras + execução
│       │   └── mcp.routes.ts     Conexão, publicação SSE, webhook
│       ├── services/
│       │   ├── ai.service.ts     Claude com prompt caching
│       │   ├── meta.mcp.service.ts  MCP com retry exponencial
│       │   ├── sync.service.ts   Sincronização de métricas (cron)
│       │   ├── crypto.service.ts  AES-256 para tokens
│       │   └── audit.service.ts  Log de auditoria
│       └── index.ts              Express + cron jobs (1h métricas, 15min status)
│
└── frontend/
    └── src/
        ├── components/
        │   ├── Layout.tsx          Menu lateral + navegação
        │   ├── MCPStatusBadge.tsx  Status da conexão MCP
        │   ├── PublishButton.tsx   Publicação com progresso SSE
        │   ├── ErrorBoundary.tsx   Captura de erros React
        │   └── ui/                 Componentes shadcn/ui
        ├── hooks/
        │   ├── useAuth.ts          Login, logout, register
        │   ├── useMCP.ts           Status MCP, sincronização
        │   └── useCampaigns.ts     CRUD de campanhas
        ├── pages/
        │   ├── LoginPage.tsx       Login + cadastro
        │   ├── OnboardingPage.tsx  Primeiro acesso
        │   ├── DashboardPage.tsx   Visão geral com métricas
        │   ├── CampaignsPage.tsx   Lista de campanhas
        │   ├── CampaignDetailPage.tsx  Detalhes + performance
        │   ├── CampaignWizardPage.tsx  Criar campanha com IA
        │   ├── CopiesPage.tsx      Gerador de copy
        │   ├── AudiencesPage.tsx   Biblioteca de públicos
        │   ├── ABTestsPage.tsx     Testes A/B
        │   ├── AutomationsPage.tsx  Regras de automação
        │   └── SettingsPage.tsx    Configuração MCP + token
        └── services/
            └── api.ts              Cliente HTTP com retry e handler 401
```

---

## Deploy em produção

### Backend (Railway / Render / Fly.io)

1. Configure as variáveis de ambiente no painel da plataforma
2. Troque `DATABASE_URL` para PostgreSQL
3. Execute `npm run db:migrate` no deploy
4. Não esqueça de configurar `FRONTEND_URL` com o domínio real

### Frontend (Vercel / Netlify)

1. Aponte para a pasta `frontend/`
2. Comando de build: `npm run build`
3. Diretório de saída: `dist/`

---

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Frontend | React 18 + TypeScript + Vite + Tailwind + shadcn/ui |
| Estado assíncrono | TanStack Query (React Query) |
| Backend | Node.js + Express + TypeScript |
| Banco de dados | SQLite (dev) / PostgreSQL (prod) via Prisma ORM |
| IA | Claude Sonnet 4.6 com prompt caching |
| Meta Ads | MCP via Pipeboard / Zapier / Meta Oficial |
| Autenticação | JWT + bcrypt |
| Criptografia | AES-256 (crypto-js) |
| Testes | Vitest + Supertest + React Testing Library |
| CI | GitHub Actions |
