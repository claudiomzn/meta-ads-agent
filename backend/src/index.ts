import prisma from './lib/prisma.js';
import dotenv from 'dotenv';
dotenv.config({ override: true });
import 'express-async-errors'; // captura erros async em Express 4 automaticamente
import express from 'express';
import cors from 'cors';
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
import { targetBelongsToUser } from './lib/ownership.js';

const app = express();
const PORT = process.env.PORT ?? 3001;

const allowedOrigins = [
  'http://localhost:5173',
  'https://app.adsgenius.net',
  'https://adsgenius.net',
  process.env.FRONTEND_URL,
].filter(Boolean) as string[];

app.use(cors({
  origin: (origin, callback) => {
    // Permite requests sem origin (ex: mobile, Postman, curl)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} não permitida`));
  },
  credentials: true,
}));
app.use(express.json());

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

app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date() }));

// ─── Middleware global de erros ────────────────────────────────────────────────
// Captura qualquer erro não tratado em rotas async e retorna JSON limpo
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Error]', err.message ?? err);
  const status = (err as { status?: number }).status ?? 500;
  res.status(status).json({ error: err.message ?? 'Internal Server Error' });
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

// A cada 15 minutos — sincroniza status + executa automações
cron.schedule('*/15 * * * *', async () => {
  console.log('[Cron] Sincronizando status...');
  await runSyncForAllConnectedUsers((svc) => svc.syncCampaignStatuses()).catch(console.error);

  // Executa regras de automação ativas para todos os usuários conectados
  const connections = await prisma.mCPConnection.findMany({ where: { connected: true } });
  for (const conn of connections) {
    const rules = await prisma.automationRule.findMany({
      where: { userId: conn.userId, active: true },
    });
    if (!rules.length) continue;

    const { createMetaMCPService } = await import('./services/meta.mcp.service.js');
    const svc = await createMetaMCPService(conn.userId);
    const today = new Date().toISOString().split('T')[0];

    for (const rule of rules) {
      try {
        // Defesa em profundidade: revalida ownership do targetId mesmo pra
        // regras já criadas (ex.: item pode ter mudado de dono desde então).
        // Token de servidor compartilhado (pipeboard/zapier) — sem isso o
        // cron executaria ação numa campanha/adset/ad de outro cliente.
        const owns = await targetBelongsToUser(
          rule.targetType as 'campaign' | 'adset' | 'ad',
          rule.targetId,
          rule.userId,
        );
        if (!owns) {
          console.warn(
            `[Automação] Regra "${rule.name}" (${rule.id}) pulada — targetId ${rule.targetId} não pertence ao usuário ${rule.userId}`,
          );
          continue;
        }

        const since = new Date(Date.now() - rule.window * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const range = { since, until: today };

        let insights;
        if (rule.targetType === 'campaign') insights = await svc.getCampaignInsights(rule.targetId, range);
        else if (rule.targetType === 'adset') insights = await svc.getAdSetInsights(rule.targetId, range);
        else insights = await svc.getAdInsights(rule.targetId, range);

        const val = (insights as unknown as Record<string, number>)[rule.trigger] ?? 0;
        const triggered =
          (rule.condition === 'gt' && val > rule.value) ||
          (rule.condition === 'lt' && val < rule.value) ||
          (rule.condition === 'gte' && val >= rule.value) ||
          (rule.condition === 'lte' && val <= rule.value);

        if (triggered) {
          if (rule.action === 'PAUSE') {
            if (rule.targetType === 'adset') await svc.updateAdSetStatus(rule.targetId, 'PAUSED');
            else if (rule.targetType === 'ad') await svc.updateAdStatus(rule.targetId, 'PAUSED');
            else await svc.updateCampaignStatus(rule.targetId, 'PAUSED');
          } else if (rule.action === 'ACTIVATE') {
            if (rule.targetType === 'adset') await svc.updateAdSetStatus(rule.targetId, 'ACTIVE');
            else if (rule.targetType === 'ad') await svc.updateAdStatus(rule.targetId, 'ACTIVE');
            else await svc.updateCampaignStatus(rule.targetId, 'ACTIVE');
          } else if (rule.action === 'SCALE_UP') {
            // Escala a partir do orçamento ATUAL — nunca do valor da métrica
            await svc.scaleCampaignBudget(rule.targetId, 1.2);
          } else if (rule.action === 'SCALE_DOWN') {
            await svc.scaleCampaignBudget(rule.targetId, 0.8);
          }

          await prisma.ruleLog.create({
            data: { ruleId: rule.id, action: rule.action, metrics: JSON.stringify(insights) },
          });
          console.log(`[Automação] Regra "${rule.name}" executada — ${rule.action} (${rule.trigger}=${val})`);
        }

        await prisma.automationRule.update({ where: { id: rule.id }, data: { lastChecked: new Date() } });
      } catch (err) {
        console.error(`[Automação] Erro na regra "${rule.name}":`, err);
      }
    }
    await svc.disconnect();
  }
});

// Todo dia às 5h — o agente analisa as campanhas de cada usuário conectado e
// cria propostas de otimização (pausar campanha no prejuízo, pausar conjunto
// saturado). Usa só dados já sincronizados pelos crons acima — sem custo
// extra de chamadas ao Meta na hora do scan.
cron.schedule('0 5 * * *', async () => {
  console.log('[Cron] Agente noturno: analisando campanhas...');
  const connections = await prisma.mCPConnection.findMany({ where: { connected: true } });
  const { scanUser } = await import('./services/agentProposals.service.js');

  for (const conn of connections) {
    try {
      const created = await scanUser(conn.userId);
      if (created > 0) console.log(`[Agente] ${created} proposta(s) criada(s) para ${conn.userId}`);
    } catch (err) {
      console.error(`[Agente] Falha ao analisar ${conn.userId}:`, err);
    }
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`✅ Backend rodando em http://0.0.0.0:${PORT}`);
  console.log(`   NODE_ENV: ${process.env.NODE_ENV}`);
  console.log(`   Crons: métricas (1h) | status + automações (15min) | agente noturno (5h)`);

  // Self-heal: garante que os webhooks das instâncias gerenciadas usam a URL
  // atual (com segredo). Não-bloqueante — falha aqui não impede o servidor.
  import('./services/whatsapp/evolution.manager.js')
    .then((m) => m.ensureManagedWebhooks())
    .catch((err) => console.warn('[startup] ensureManagedWebhooks falhou:', err));
});
