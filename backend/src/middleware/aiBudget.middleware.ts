import crypto from 'node:crypto';
import type { NextFunction, Response } from 'express';
import prisma from '../lib/prisma.js';
import type { AuthRequest } from './auth.middleware.js';
import { sendMail } from '../services/email.service.js';

export type AiBudgetFeature =
  | 'agent_chat'
  | 'agent_quick'
  | 'campaign_create'
  | 'ad_improve'
  | 'creative_generate'
  | 'connection_help'
  | 'website_analyze';

const budgets: Record<AiBudgetFeature, {
  credits: number;
  estimatedCostBrlCents: number;
  model: 'claude-sonnet-4-6' | 'claude-haiku-4-5';
}> = {
  agent_chat: { credits: 6, estimatedCostBrlCents: 100, model: 'claude-sonnet-4-6' },
  agent_quick: { credits: 1, estimatedCostBrlCents: 10, model: 'claude-haiku-4-5' },
  campaign_create: { credits: 3, estimatedCostBrlCents: 60, model: 'claude-sonnet-4-6' },
  ad_improve: { credits: 3, estimatedCostBrlCents: 50, model: 'claude-sonnet-4-6' },
  creative_generate: { credits: 3, estimatedCostBrlCents: 50, model: 'claude-sonnet-4-6' },
  // Onboarding não reduz os créditos de campanha do cliente. O custo continua
  // no ledger e no teto financeiro global de 7% do MRR.
  connection_help: { credits: 0, estimatedCostBrlCents: 2, model: 'claude-haiku-4-5' },
  website_analyze: { credits: 1, estimatedCostBrlCents: 10, model: 'claude-haiku-4-5' },
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const base = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !serviceKey) throw new Error('AI_BUDGET_UNAVAILABLE');
  const response = await fetch(`${base}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error('AI_BUDGET_UNAVAILABLE');
  return await response.json() as T;
}

function limitMessage(reason: string): string {
  if (reason === 'daily_credits') return 'Você atingiu o limite diário de IA.';
  if (reason === 'daily_feature') return 'Você atingiu o limite diário desta operação.';
  if (reason === 'global_cost' || reason === 'global_soft_limit') {
    return 'As análises avançadas estão temporariamente indisponíveis.';
  }
  if (reason === 'request_in_progress' || reason === 'request_completed') {
    return 'Esta solicitação já foi processada ou está em andamento.';
  }
  return 'Você utilizou os créditos de IA disponíveis neste ciclo.';
}

async function notifyBudgetThreshold(): Promise<void> {
  const alert = await rpc<Record<string, unknown>>('claim_ai_budget_alert', {});
  if (alert.send !== true) return;
  const threshold = Number(alert.threshold_percent ?? 0);
  const cost = Number(alert.cost_brl_cents ?? 0) / 100;
  const mrr = Number(alert.mrr_brl_cents ?? 0) / 100;
  const percentage = Number(alert.percentage ?? 0).toFixed(2);
  // Sem destinatário configurado o alerta não tem para onde ir. Antes havia um
  // e-mail fixo no código como último recurso; um endereço pessoal embutido no
  // fonte vaza em qualquer fork/print do repo e passa a ser difícil de mudar.
  const to = process.env.AI_BUDGET_ALERT_EMAIL ?? process.env.ADMIN_ALERT_EMAIL;
  if (!to) {
    console.warn(
      '[ai-budget:meta] limite de %s%% do MRR atingido, mas nenhum destinatário está configurado ' +
        '(defina AI_BUDGET_ALERT_EMAIL ou ADMIN_ALERT_EMAIL).',
      threshold,
    );
    return;
  }
  const text = `AdsGenius IA atingiu ${threshold}% do MRR.\nCusto: R$ ${cost.toFixed(2)}\nMRR: R$ ${mrr.toFixed(2)}\nUso: ${percentage}%`;
  await sendMail({
    to,
    subject: `⚠️ IA atingiu ${threshold}% do MRR`,
    text,
    html: `<pre style="font-family:Arial,sans-serif;white-space:pre-wrap">${text}</pre>`,
  });
}

async function reserveForBackendUser(userId: string, feature: AiBudgetFeature) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { supabaseUserId: true },
  });
  if (!user?.supabaseUserId) throw new Error('SSO_REQUIRED');
  const budget = budgets[feature];
  const result = await rpc<Record<string, unknown>>('reserve_ai_usage', {
    p_request_id: crypto.randomUUID(),
    p_user_id: user.supabaseUserId,
    p_feature: feature,
    p_model: budget.model,
    p_credits: budget.credits,
    p_estimated_cost_brl_cents: budget.estimatedCostBrlCents,
    p_metadata: { source: 'meta_ads_backend' },
  });
  if (result.allowed !== true || !result.reservation_id) {
    throw new Error(`AI_LIMIT:${String(result.reason ?? 'monthly_credits')}`);
  }
  return { id: String(result.reservation_id), budget };
}

export async function runWithAiBudget<T>(
  userId: string,
  feature: AiBudgetFeature,
  action: () => Promise<T>,
): Promise<T> {
  if (process.env.NODE_ENV === 'test') return action();
  const reservation = await reserveForBackendUser(userId, feature);

  let value: T;
  try {
    value = await action();
  } catch (error) {
    // Só libera a reserva quando a operação de IA realmente falhou. Falhas
    // posteriores de contabilização não podem apagar um consumo já realizado.
    await rpc('release_ai_usage', {
      p_reservation_id: reservation.id,
      p_reason: error instanceof Error ? error.message.slice(0, 200) : 'AI call failed',
    }).catch(() => undefined);
    throw error;
  }

  try {
    await rpc('settle_ai_usage', {
      p_reservation_id: reservation.id,
      p_actual_cost_brl_cents: reservation.budget.estimatedCostBrlCents,
      p_actual_cost_usd_micros: 0,
      p_input_tokens: 0,
      p_output_tokens: 0,
      p_cache_creation_input_tokens: 0,
      p_cache_read_input_tokens: 0,
      p_rounds: 1,
      p_metadata: { source: 'meta_ads_backend', estimated: true },
    });
    await notifyBudgetThreshold().catch((error) =>
      console.error('[ai-budget:meta] alerta falhou:', error));
  } catch (error) {
    // A IA já respondeu: devolver erro agora induziria retry e custo duplicado.
    // A reserva permanece em `reserved` (e continua contando nos limites) para
    // reconciliação; nunca é liberada como se a chamada não tivesse ocorrido.
    console.error(
      '[ai-budget:meta] liquidação pendente após IA concluída:',
      reservation.id,
      error instanceof Error ? error.message : 'erro',
    );
  }

  return value;
}

export function aiBudget(feature: AiBudgetFeature) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    if (process.env.NODE_ENV === 'test') {
      next();
      return;
    }
    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: { supabaseUserId: true },
    });
    if (!user?.supabaseUserId) {
      res.status(403).json({ error: 'Conta AdsGenius não vinculada.', code: 'SSO_REQUIRED' });
      return;
    }

    const budget = budgets[feature];
    const headerKey = String(req.headers['x-idempotency-key'] ?? '').trim();
    const requestId = UUID_PATTERN.test(headerKey) ? headerKey : crypto.randomUUID();
    let result: Record<string, unknown>;
    try {
      result = await rpc<Record<string, unknown>>('reserve_ai_usage', {
        p_request_id: requestId,
        p_user_id: user.supabaseUserId,
        p_feature: feature,
        p_model: budget.model,
        p_credits: budget.credits,
        p_estimated_cost_brl_cents: budget.estimatedCostBrlCents,
        p_metadata: { source: 'meta_ads', path: req.originalUrl },
      });
    } catch {
      res.status(503).json({
        error: 'Não foi possível confirmar seus créditos de IA. Tente novamente.',
        code: 'AI_BUDGET_UNAVAILABLE',
      });
      return;
    }

    if (result.allowed !== true || !result.reservation_id) {
      const reason = String(result.reason ?? 'monthly_credits');
      res.status(429).json({ error: limitMessage(reason), ai_limit_reached: true, reason });
      return;
    }

    const reservationId = String(result.reservation_id);
    let finalized = false;
    res.once('finish', () => {
      if (finalized) return;
      finalized = true;
      const success = res.statusCode >= 200 && res.statusCode < 400;
      const task = success
        ? rpc('settle_ai_usage', {
            p_reservation_id: reservationId,
            // Conservador: o backend Meta ainda não agrega usage de todas as
            // chamadas; liquida pelo custo máximo reservado.
            p_actual_cost_brl_cents: budget.estimatedCostBrlCents,
            p_actual_cost_usd_micros: 0,
            p_input_tokens: 0,
            p_output_tokens: 0,
            p_cache_creation_input_tokens: 0,
            p_cache_read_input_tokens: 0,
            p_rounds: 1,
            p_metadata: { source: 'meta_ads', estimated: true },
          })
        : rpc('release_ai_usage', {
            p_reservation_id: reservationId,
            p_reason: `HTTP ${res.statusCode}`,
          });
      task
        .then(() => success ? notifyBudgetThreshold() : undefined)
        .catch((error) => console.error('[ai-budget:meta] finalização falhou:', error));
    });
    next();
  };
}
