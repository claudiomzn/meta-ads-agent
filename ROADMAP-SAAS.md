# Roadmap SaaS — Meta Ads Agent

Melhorias necessárias para transformar o app em um produto SaaS comercial.
Ordenadas por prioridade de implementação.

---

## 🏗️ Fase 1 — Infraestrutura Base

### Banco de dados
- [ ] Migrar de **SQLite → PostgreSQL** (Supabase, Neon ou Railway)
- [ ] Configurar connection pooling (PgBouncer ou Prisma Accelerate)
- [ ] Backups automáticos diários

### Deploy
- [ ] **Backend**: Railway, Render ou Fly.io com deploy automático via GitHub
- [ ] **Frontend**: Vercel ou Netlify com preview por branch
- [ ] **Variáveis de ambiente** separadas por ambiente (dev / staging / prod)
- [ ] Domínio próprio com HTTPS (SSL automático)

### CDN e Storage
- [ ] Substituir `backend/uploads/` por **AWS S3 ou Cloudflare R2** para mídias
- [ ] CDN para servir imagens/vídeos dos usuários (CloudFront ou Cloudflare)

---

## 📧 Fase 2 — E-mail Transacional

- [ ] Integrar **Resend, SendGrid ou Nodemailer** com SMTP
- [ ] E-mails obrigatórios:
  - Boas-vindas ao criar conta
  - Confirmação de e-mail (verificação)
  - Redefinição de senha (hoje retorna o link na API)
  - Alerta de sessão expirando
  - Resumo semanal de performance das campanhas
  - Notificação de automação disparada
  - Fatura / recibo de pagamento
- [ ] Templates HTML responsivos com logo e identidade visual

---

## 💳 Fase 3 — Planos e Cobrança

### Stripe
- [ ] Integrar **Stripe** (subscriptions + webhooks)
- [ ] Tabela `subscriptions` no banco com: plano, status, trial, datas, stripe_customer_id
- [ ] Webhook handler: `customer.subscription.updated`, `invoice.paid`, `invoice.payment_failed`

### Planos sugeridos
| Plano | Preço | Limites |
|---|---|---|
| **Free Trial** | 7 dias grátis | 1 conta Meta, 5 campanhas |
| **Pro** | R$ 97/mês | 3 contas Meta, campanhas ilimitadas, IA ilimitada |
| **Business** | R$ 297/mês | 10 contas Meta, múltiplos usuários, white-label |

### Controle de acesso
- [ ] `SubscriptionGuard` que bloqueia rotas se trial expirado ou plano inativo
- [ ] Paywall com CTA para upgrade
- [ ] Limites por plano: número de campanhas, contas Meta, chamadas de IA/mês
- [ ] Contador de uso visível no painel

---

## 👥 Fase 4 — Multi-usuário e Organizações

- [ ] Modelo `Organization` com múltiplos `users` (owner + members)
- [ ] **Convite por e-mail** para adicionar membros à organização
- [ ] Roles: `owner`, `admin`, `viewer`
- [ ] Cada organização tem sua própria conexão Meta e campanhas isoladas
- [ ] Trocar de organização sem sair da conta

---

## 🔐 Fase 5 — Segurança Reforçada

- [ ] **Verificação de e-mail** obrigatória no cadastro
- [ ] **OAuth** — Login com Google (NextAuth ou Passport.js)
- [ ] **Refresh token rotation** com família (invalidar toda a família em caso de roubo)
- [ ] Invalidar todas as sessões ao trocar senha
- [ ] **Helmet.js** — headers de segurança HTTP (CSP, HSTS, etc.)
- [ ] **CORS** restrito ao domínio de produção
- [ ] Log de acesso por IP no `AuditLog`
- [ ] Bloqueio automático após N tentativas de login falhas
- [ ] 2FA opcional (TOTP com Google Authenticator)

---

## 📱 Fase 6 — Mobile e Responsividade

- [ ] **Sidebar colapsável** em telas < 768px (drawer/hamburger menu)
- [ ] Layout responsivo em todas as páginas (campanhas, dashboard, configurações)
- [ ] **PWA** instalável no celular (manifest + service worker)
- [ ] Touch-friendly: botões maiores, swipe para deletar

---

## ⚡ Fase 7 — Performance e Escalabilidade

- [ ] **Redis** para:
  - Cache de métricas do Meta (evitar chamadas repetidas à API)
  - Lock distribuído nos crons (evitar execução duplicada com múltiplos servidores)
  - Rate limiting distribuído
- [ ] **BullMQ** para filas de tarefas pesadas:
  - Publicação de campanha (hoje é síncrono)
  - Geração de análise IA
  - Sync de métricas em background
- [ ] Paginação real no backend (cursor-based) para listas grandes
- [ ] `staleTime` e `cacheTime` otimizados por rota no React Query

---

## 📊 Fase 8 — Monitoramento e Observabilidade

- [ ] **Sentry** para tracking de erros (frontend + backend)
- [ ] **Uptime monitoring**: BetterUptime, UptimeRobot ou Checkly
- [ ] **Logs estruturados** com Pino ou Winston (substituir console.log)
- [ ] Dashboard de métricas de uso: usuários ativos, campanhas publicadas, chamadas de IA
- [ ] Alertas automáticos por e-mail se taxa de erro > X%

---

## 🧩 Fase 9 — Features de Produto

### A/B Tests
- [ ] Botão "Encerrar teste e declarar vencedor"
- [ ] Cálculo automático de significância estatística
- [ ] Histórico de testes anteriores com resultado

### Campanhas
- [ ] Agendamento de campanha (publicar em data/hora futura)
- [ ] Histórico de versões (antes/depois de edições)
- [ ] Templates de campanha salvos para reutilizar

### Relatórios
- [ ] **Exportar PDF** com relatório de performance das campanhas
- [ ] **Exportar CSV** das métricas para análise externa
- [ ] Relatório comparativo de períodos (ex: esta semana vs semana passada)
- [ ] Compartilhar dashboard com cliente (link público, somente leitura)

### Notificações
- [ ] **Notificações in-app** (sino com badge de não lidas)
- [ ] **Push notifications** no celular (via PWA)
- [ ] Configurar quais alertas receber por e-mail

---

## 🎨 Fase 10 — White-label (plano Business)

- [ ] Logo e nome do produto personalizáveis por organização
- [ ] Domínio personalizado (`ads.agenciadocliente.com.br`)
- [ ] Paleta de cores customizável
- [ ] E-mails enviados com remetente da agência

---

## 📋 Compliance e Legal

- [ ] **Política de Privacidade** (LGPD)
- [ ] **Termos de Uso**
- [ ] Banner de cookies
- [ ] Endpoint de exclusão de conta e dados (`DELETE /auth/account`)
- [ ] Exportação dos dados do usuário (LGPD Art. 18)

---

## 🚀 Checklist mínimo para lançar

Antes de cobrar o primeiro cliente, os itens abaixo são obrigatórios:

- [ ] PostgreSQL em produção (não SQLite)
- [ ] Deploy estável com HTTPS
- [ ] E-mail de reset de senha funcionando
- [ ] Stripe integrado com plano mensal
- [ ] Verificação de e-mail no cadastro
- [ ] Política de privacidade publicada
- [ ] Backup automático do banco
- [ ] Sentry ativo para capturar erros

---

*Documento criado em: 2026-05-08*
*Versão atual do app: 1.0.0 (nota 8.5/10)*
