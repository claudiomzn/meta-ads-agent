import prisma from '../lib/prisma.js';
import { Router, Response } from 'express';

import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { createMetaMCPService } from '../services/meta.mcp.service.js';
import { auditLog } from '../services/audit.service.js';
import { targetBelongsToUser } from '../lib/ownership.js';
import { mensagemDaRecusaMeta, motivoParaLog } from '../lib/metaRecusa.js';

const router = Router();

router.use(authMiddleware);

const RuleSchema = z.object({
  name: z.string().min(1),
  campaignId: z.string().optional(),
  targetId: z.string().min(1),
  targetType: z.enum(['campaign', 'adset', 'ad']),
  trigger: z.enum(['roas', 'cpc', 'cpl', 'ctr', 'frequency', 'spend']),
  condition: z.enum(['gt', 'lt', 'gte', 'lte']),
  value: z.number(),
  window: z.number().int().min(1).max(90),
  action: z.enum(['PAUSE', 'ACTIVATE', 'SCALE_UP', 'SCALE_DOWN', 'ALERT']),
  alertEmail: z.string().email().optional(),
});

router.get('/', async (req: AuthRequest, res: Response) => {
  const rules = await prisma.automationRule.findMany({
    where: { userId: req.userId! },
    include: {
      logs: { orderBy: { executedAt: 'desc' }, take: 5 },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(rules);
});

router.post('/', async (req: AuthRequest, res: Response) => {
  const parsed = RuleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  // Modelo pipeboard/zapier: token de servidor compartilhado entre todos os
  // clientes — sem essa checagem, qualquer usuário poderia criar uma regra
  // apontando pro targetId (ID do Meta) de campanha/adset/ad de OUTRO cliente.
  const owns = await targetBelongsToUser(
    parsed.data.targetType,
    parsed.data.targetId,
    req.userId!,
  );
  if (!owns) {
    res.status(403).json({ error: 'Você não tem acesso a esse item.' });
    return;
  }

  const rule = await prisma.automationRule.create({
    data: { ...parsed.data, userId: req.userId!, active: true },
  });

  res.status(201).json(rule);
});

router.patch('/:id/toggle', async (req: AuthRequest, res: Response) => {
  const rule = await prisma.automationRule.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!rule) {
    res.status(404).json({ error: 'Regra não encontrada' });
    return;
  }

  const updated = await prisma.automationRule.update({
    where: { id: req.params.id },
    data: { active: !rule.active },
  });

  res.json(updated);
});

// Executa uma regra manualmente (test run)
router.post('/:id/run', async (req: AuthRequest, res: Response) => {
  const rule = await prisma.automationRule.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!rule) {
    res.status(404).json({ error: 'Regra não encontrada' });
    return;
  }

  const conn = await prisma.mCPConnection.findUnique({ where: { userId: req.userId! } });
  if (!conn?.connected) {
    res.status(400).json({ error: 'Meta Ads não conectado' });
    return;
  }

  // Fora do try para o catch conseguir desconectar: a recusa da Meta agora
  // lança no meio, e a conexão MCP ficava aberta.
  let svc: Awaited<ReturnType<typeof createMetaMCPService>> | undefined;
  try {
    svc = await createMetaMCPService(req.userId!);

    const today = new Date().toISOString().split('T')[0];
    const since = new Date(Date.now() - rule.window * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const dateRange = { since, until: today };

    let metricValue = 0;
    let insights;

    if (rule.targetType === 'campaign') {
      insights = await svc.getCampaignInsights(rule.targetId, dateRange);
    } else if (rule.targetType === 'adset') {
      insights = await svc.getAdSetInsights(rule.targetId, dateRange);
    } else {
      insights = await svc.getAdInsights(rule.targetId, dateRange);
    }

    metricValue = (insights as unknown as Record<string, number>)[rule.trigger] ?? 0;

    const conditionMet =
      (rule.condition === 'gt' && metricValue > rule.value) ||
      (rule.condition === 'lt' && metricValue < rule.value) ||
      (rule.condition === 'gte' && metricValue >= rule.value) ||
      (rule.condition === 'lte' && metricValue <= rule.value);

    let executed = false;
    let scaleError: string | undefined;
    if (conditionMet) {
      // scaleCampaignBudget espera um metaCampaignId — se a regra aponta pra
      // um adset/ad, rule.targetId é o ID errado de entidade pra essa chamada.
      // Escala de orçamento só é suportada para targetType === 'campaign'.
      const isUnsupportedScale =
        (rule.action === 'SCALE_UP' || rule.action === 'SCALE_DOWN') && rule.targetType !== 'campaign';

      if (isUnsupportedScale) {
        scaleError = 'Escala de orçamento só é suportada em campanhas.';
      } else {
        // Toda ação abaixo LANÇA se a Meta recusar (requireOk) — e o throw cai
        // no catch lá embaixo ANTES do RuleLog e do cooldown. Antes, a recusa
        // voltava como sucesso e a regra registrava uma ação que não houve.
        switch (rule.action) {
          case 'PAUSE':
            if (rule.targetType === 'adset') await svc.updateAdSetStatus(rule.targetId, 'PAUSED');
            else if (rule.targetType === 'ad') await svc.updateAdStatus(rule.targetId, 'PAUSED');
            else await svc.updateCampaignStatus(rule.targetId, 'PAUSED');
            break;
          case 'ACTIVATE':
            if (rule.targetType === 'adset') await svc.updateAdSetStatus(rule.targetId, 'ACTIVE');
            else if (rule.targetType === 'ad') await svc.updateAdStatus(rule.targetId, 'ACTIVE');
            else await svc.updateCampaignStatus(rule.targetId, 'ACTIVE');
            break;
          // Escala a partir do orçamento ATUAL (fator 1.2/0.8) — nunca do valor
          // da métrica/gasto, que não tem relação com orçamento diário.
          // `scaleCampaignBudget` pode decidir NÃO escalar (campanha sem
          // conjunto com orçamento conhecido) — aí não houve ação: nada de
          // RuleLog nem cooldown, e o cliente lê o motivo.
          case 'SCALE_UP':
          case 'SCALE_DOWN': {
            const escala = await svc.scaleCampaignBudget(rule.targetId, rule.action === 'SCALE_UP' ? 1.2 : 0.8);
            if (!escala.escalado) scaleError = escala.motivo;
            break;
          }
        }
        executed = !scaleError;
      }

      if (executed) {
        await prisma.ruleLog.create({
          data: {
            ruleId: rule.id,
            action: rule.action,
            metrics: JSON.stringify({ ...insights, conditionValue: rule.value, actualValue: metricValue }),
          },
        });

        // Execução manual NÃO é bloqueada pelo cooldown (é uma ação deliberada
        // do usuário), mas ABRE o cooldown: sem isso o cron de 15 min voltaria
        // a aplicar a mesma ação logo depois, compondo o efeito no orçamento.
        await prisma.automationRule.update({
          where: { id: rule.id },
          data: { lastTriggeredAt: new Date(), triggerCount: { increment: 1 } },
        });

        await auditLog({
          userId: req.userId!,
          action: 'AUTOMATION_EXECUTED',
          resource: 'automation_rule',
          resourceId: rule.id,
          details: { action: rule.action, metricValue, threshold: rule.value },
        });
      }
    }

    await svc.disconnect();
    svc = undefined;

    await prisma.automationRule.update({
      where: { id: rule.id },
      data: { lastChecked: new Date() },
    });

    res.json({
      conditionMet,
      executed,
      metricValue,
      threshold: rule.value,
      condition: rule.condition,
      ...(scaleError && { error: scaleError }),
    });
  } catch (err) {
    await svc?.disconnect().catch(() => undefined);
    const recusa = mensagemDaRecusaMeta(err);
    console.error('[Automação] Execução manual falhou:', rule.id, motivoParaLog(err));
    res.status(recusa ? 502 : 500).json({ error: recusa ?? 'Não foi possível executar a automação.' });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  const rule = await prisma.automationRule.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!rule) {
    res.status(404).json({ error: 'Regra não encontrada' });
    return;
  }

  await prisma.automationRule.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

router.get('/:id/logs', async (req: AuthRequest, res: Response) => {
  const rule = await prisma.automationRule.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!rule) {
    res.status(404).json({ error: 'Regra não encontrada' });
    return;
  }

  const logs = await prisma.ruleLog.findMany({
    where: { ruleId: rule.id },
    orderBy: { executedAt: 'desc' },
    take: 50,
  });

  res.json(logs);
});

export default router;
