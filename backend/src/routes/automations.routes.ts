import prisma from '../lib/prisma.js';
import { Router, Response } from 'express';

import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { createMetaMCPService } from '../services/meta.mcp.service.js';
import { auditLog } from '../services/audit.service.js';

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

  try {
    const svc = await createMetaMCPService(req.userId!);

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
    if (conditionMet) {
      switch (rule.action) {
        case 'PAUSE':
          if (rule.targetType === 'adset') await svc.updateAdSetStatus(rule.targetId, 'PAUSED');
          else if (rule.targetType === 'ad') await svc.updateAdStatus(rule.targetId, 'PAUSED');
          break;
        case 'ACTIVATE':
          if (rule.targetType === 'adset') await svc.updateAdSetStatus(rule.targetId, 'ACTIVE');
          else if (rule.targetType === 'ad') await svc.updateAdStatus(rule.targetId, 'ACTIVE');
          break;
        case 'SCALE_UP':
          await svc.updateCampaignBudget(rule.targetId, (insights.spend ?? 0) * 1.2);
          break;
        case 'SCALE_DOWN':
          await svc.updateCampaignBudget(rule.targetId, (insights.spend ?? 0) * 0.8);
          break;
      }
      executed = true;

      await prisma.ruleLog.create({
        data: {
          ruleId: rule.id,
          action: rule.action,
          metrics: JSON.stringify({ ...insights, conditionValue: rule.value, actualValue: metricValue }),
        },
      });

      await auditLog({
        userId: req.userId!,
        action: 'AUTOMATION_EXECUTED',
        resource: 'automation_rule',
        resourceId: rule.id,
        details: { action: rule.action, metricValue, threshold: rule.value },
      });
    }

    await svc.disconnect();

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
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
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
