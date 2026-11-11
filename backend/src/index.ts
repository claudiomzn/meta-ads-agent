import prisma from './lib/prisma.js';
import dotenv from 'dotenv';
dotenv.config({ override: true });
import 'express-async-errors'; // captura erros async em Express 4 automaticamente
import { instalarAxiosSemToken } from './lib/axiosSemToken.js';
// Antes de qualquer chamada: erro do axios sai sem o access_token do cliente
// (o log do Render já foi caminho de vazamento — ver lib/axiosSemToken.ts).
instalarAxiosSemToken();
import express from 'express';
import cors from 'cors';
import cliqueRoutes from './routes/clique.routes.js';
import cron from 'node-cron';

// ─── Log de ambiente para diagnóstico ────────────────────────────────────────
console.log('[STARTUP] NODE_ENV:', process.env.NODE_ENV);
console.log('[STARTUP] PORT:', process.env.PORT);
console.log('[STARTUP] DATABASE_URL set:', !!process.env.DATABASE_URL, '| length:', process.env.DATABASE_URL?.length ?? 0);
console.log('[STARTUP] JWT_SECRET set:', !!process.env.JWT_SECRET);
console.log('[STARTUP] ENCRYPTION_KEY set:', !!process.env.ENCRYPTION_KEY);

const REQUIRED_ENV = ['JWT_SECRET', 'ENCRYPTION_KEY', 'DATABASE_URL'] as const;

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.warn(`[WARN] Variável de ambiente ausente: ${key}`);
  }
}

// Em produção, JWT_SECRET vazio/ausente não pode passar batido: além de
// autenticação (não coberta aqui), evolution.manager.ts deriva dele o
// segredo do webhook do WhatsApp (webhookSecret) — com JWT_SECRET vazio esse
// segredo vira previsível/igual pra qualquer instalação, permitindo forjar
// mensagens de webhook. Falha cedo no startup em vez de deixar rodar
// silenciosamente inseguro.
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('[STARTUP] JWT_SECRET ausente em produção — abortando inicialização.');
}

import authRoutes from './routes/auth.routes.js';
import campaignRoutes from './routes/campaigns.routes.js';
import copiesRoutes from './routes/copies.routes.js';
import audiencesRoutes from './routes/audiences.routes.js';
import abTestsRoutes from './routes/abtests.routes.js';
import automationsRoutes from './routes/automations.routes.js';
import mcpRoutes from './routes/mcp.routes.js';
import analysisRoutes from './routes/analysis.routes.js';
import instagramRoutes from './routes/instagram.routes.js';
import mediaRoutes from './routes/media.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import { SyncService } from './services/sync.service.js';
import creativeAnalysisRoutes from './routes/creative-analysis.routes.js';
import agentRoutes from './routes/agent.routes.js';
import creativeStudioRoutes from './routes/creative-studio.routes.js';
import pixelRoutes from './routes/pixel.routes.js';
import capiRoutes from './routes/capi.routes.js';
import whatsappRoutes from './routes/whatsapp.routes.js';
import metaConnectionRoutes from './routes/meta-connection.routes.js';
import { verifyPendingMetaConnectionRequests } from './services/metaPartnerVerification.service.js';

const app = express();
const PORT = process.env.PORT ?? 3001;

const allowedOrigins = [
  'http://localhost:5173',
  'https://app.adsgenius.net',
  'https://adsgenius.net',
  process.env.FRONTEND_URL,
].filter(Boolean) as string[];

// Rota pública do site (registro do clique do anúncio) ANTES do CORS global:
// o CORS daqui recusa qualquer origem fora do app, e os sites dos clientes são
// outros domínios. A rota tem a sua própria lista (ver clique.routes.ts).
app.use('/api/clique', cliqueRoutes);

app.use(cors({
  origin: (origin, callback) => {
    // Permite requests sem origin (ex: mobile, Postman, curl)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} não permitida`));
  },
  credentials: true,
}));
// Guarda o corpo bruto da requisição (buf) em req.rawBody — necessário pro
// webhook do Meta (mcp.routes.ts) validar o HMAC de x-hub-signature-256
// sobre os bytes EXATOS recebidos. Re-serializar req.body com JSON.stringify
// depois do parse pode divergir do payload original (ordem de chaves,
// espaçamento) e derrubar a validação de assinaturas legítimas.
app.use(express.json({
  verify: (req, _res, buf) => {
    (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
  },
}));

// ─── Rotas ────────────────────────────────────────────────────────────────────

app.use('/api/auth', authRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/copies', copiesRoutes);
app.use('/api/audiences', audiencesRoutes);
app.use('/api/ab-tests', abTestsRoutes);
app.use('/api/automations', automationsRoutes);
app.use('/api/mcp', mcpRoutes);
app.use('/api/analysis', analysisRoutes);
app.use('/api/instagram', instagramRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/creative-analysis', creativeAnalysisRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/creative-studio', creativeStudioRoutes);
app.use('/api/pixel', pixelRoutes);
app.use('/api/capi', capiRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/meta-connection', metaConnectionRoutes);

app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date() }));

// ─── Middleware global de erros ────────────────────────────────────────────────
// Captura qualquer erro não tratado em rotas async e retorna JSON limpo
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Error]', err.message ?? err);
  const status = (err as { status?: number }).status ?? 500;
  res.status(status).json({
    error: status >= 500 ? 'Erro interno. Tente novamente.' : (err.message || 'Requisição inválida.'),
  });
});

// ─── Cron Jobs ────────────────────────────────────────────────────────────────

async function runSyncForAllConnectedUsers(
  task: (svc: SyncService) => Promise<void>,
): Promise<void> {
  const connections = await prisma.mCPConnection.findMany({
    where: { connected: true },
  });

  await Promise.allSettled(
    connections.map(async (conn) => {
      const svc = new SyncService(conn.userId);
      await task(svc);
    }),
  );
}

// A cada hora — sincroniza métricas
cron.schedule('0 * * * *', () => {
  console.log('[Cron] Sincronizando métricas...');
  runSyncForAllConnectedUsers((svc) => svc.syncPerformanceMetrics()).catch(console.error);
});

// Enquanto o OAuth aguarda App Review, confirma automaticamente quando a
// conta pedida aparece entre os ativos compartilhados com o AdsGenius.
cron.schedule('*/2 * * * *', () => {
  verifyPendingMetaConnectionRequests().catch((error) =>
    console.error('[Cron] Falha ao verificar parcerias Meta:', error),
  );
});

// A cada 15 minutos — sincroniza status + executa automações
cron.schedule('*/15 * * * *', async () => {
  console.log('[Cron] Sincronizando status...');
  await runSyncForAllConnectedUsers((svc) => svc.syncCampaignStatuses()).catch(console.error);

  // Executa regras de automação ativas — cada usuário isolado (ver automacoes.cron.ts).
  const { executarAutomacoesDeTodos } = await import('./services/automacoes.cron.js');
  await executarAutomacoesDeTodos();
});

// Agente de otimização: analisa as campanhas de cada usuário conectado e cria
// propostas (pausar campanha no prejuízo, pausar conjunto saturado). Usa só
// dados já sincronizados — sem custo extra de chamadas ao Meta.
// No Render Free o serviço dorme e às 5h quase nunca está acordado, então o
// agente também roda no boot e no cron de hora em hora; a trava de ~20h
// (agenteScan.cron.ts) impede varrer mais de uma vez por dia. O de 5h fica:
// se estiver acordado, roda.
cron.schedule('0 5 * * *', async () => {
  const { rodarAgenteSeForHora } = await import('./services/agenteScan.cron.js');
  await rodarAgenteSeForHora('cron 5h');
});

cron.schedule('5 * * * *', async () => {
  const { rodarAgenteSeForHora } = await import('./services/agenteScan.cron.js');
  await rodarAgenteSeForHora('cron horário');
});

// De hora em hora (minuto 40, fora do minuto cheio dos outros crons): cobra do
// vendedor o desfecho dos leads QUENTES que seguem em aberto — dias 2, 5 e 10
// do handoff, e só dentro do horário de atendimento da config (ver
// resultado.ts). Nunca toca em conversa de ensaio e nunca fala com o lead.
// Pula se a Evolution não está configurada (EVOLUTION_URL ausente): é o único
// transporte que envia de verdade; sem ela o cron só reclamaria lembretes que
// não têm como sair.
cron.schedule('40 * * * *', async () => {
  if (!process.env.EVOLUTION_URL) return;
  try {
    const { enviarLembretesPendentes } = await import('./services/whatsapp/resultado.service.js');
    const enviados = await enviarLembretesPendentes();
    if (enviados > 0) console.log(`[Cron] ${enviados} lembrete(s) de retorno enviados aos vendedores`);
  } catch (err) {
    console.error('[Cron] Falha ao enviar lembretes de retorno:', err instanceof Error ? err.message : 'erro desconhecido');
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`✅ Backend rodando em http://0.0.0.0:${PORT}`);
  console.log(`   NODE_ENV: ${process.env.NODE_ENV}`);
  console.log(`   Crons: métricas (1h) | status + automações (15min) | lembrete ao vendedor (1h) | agente de otimização (boot + 1h, no máx. 1x/20h; 5h)`);

  // Agente: ~60s depois de acordar (não compete com o boot), sem bloquear.
  // A trava de 20h evita repetir se o serviço acordar várias vezes no dia.
  setTimeout(() => {
    import('./services/agenteScan.cron.js')
      .then((m) => m.rodarAgenteSeForHora('boot'))
      .catch((err) => console.warn('[startup] agente falhou:', err instanceof Error ? err.message : 'erro desconhecido'));
  }, 60_000).unref();

  // Self-heal: garante que os webhooks das instâncias gerenciadas usam a URL
  // atual (com segredo). Não-bloqueante — falha aqui não impede o servidor.
  import('./services/whatsapp/evolution.manager.js')
    .then((m) => m.ensureManagedWebhooks())
    .catch((err) => console.warn('[startup] ensureManagedWebhooks falhou:', err instanceof Error ? err.message : 'erro desconhecido'));
});
