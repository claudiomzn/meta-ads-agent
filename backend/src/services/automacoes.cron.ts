// Execução das regras de automação do Meta, extraída do cron de 15 min (index.ts)
// para poder ser testada. O defeito que isto corrige: o try/catch ficava só por
// regra — `findMany`, `createMetaMCPService` (token inválido, por ex.) e
// `disconnect` ficavam FORA. Um usuário com falha abortava o loop inteiro e os
// usuários seguintes não rodavam nunca; e o `disconnect` não rodava em erro.

import prisma from '../lib/prisma.js';
import { targetBelongsToUser } from '../lib/ownership.js';

const msgDoErro = (err: unknown) => (err instanceof Error ? err.message : 'erro desconhecido');

// Roda as regras ativas de UM usuário. Lança se o serviço Meta não abrir; o
// chamador isola isso por usuário.
export async function executarAutomacoesDoUsuario(userId: string): Promise<void> {
  const rules = await prisma.automationRule.findMany({
    where: { userId, active: true },
  });
  if (!rules.length) return;

  const { createMetaMCPService } = await import('./meta.mcp.service.js');
  const svc = await createMetaMCPService(userId);
  try {
    const today = new Date().toISOString().split('T')[0];

    for (const rule of rules) {
      try {
        // Cooldown de 24h — MESMA regra do Google (google-ads-agent,
        // check-automation-rules). Este cron roda a cada 15 min, mas a janela
        // de métricas da regra é de dias: a condição continua verdadeira muito
        // depois da ação. Sem cooldown, SCALE_UP/SCALE_DOWN RECOMPÕEM a cada
        // execução (1.2^96 num único dia) — o orçamento do cliente explode ou
        // vai a zero sozinho. Vale para toda ação, pra manter o comportamento
        // igual ao do Google.
        if (
          rule.lastTriggeredAt &&
          Date.now() - rule.lastTriggeredAt.getTime() < 24 * 60 * 60 * 1000
        ) {
          continue;
        }

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
          // Toda ação abaixo LANÇA se a Meta recusar (requireOk): o throw cai no
          // catch da regra, ANTES do RuleLog e do cooldown. Antes a recusa
          // voltava como sucesso e a regra dormia 24h sem ter feito nada.
          let executou = true;
          if (rule.action === 'PAUSE') {
            if (rule.targetType === 'adset') await svc.updateAdSetStatus(rule.targetId, 'PAUSED');
            else if (rule.targetType === 'ad') await svc.updateAdStatus(rule.targetId, 'PAUSED');
            else await svc.updateCampaignStatus(rule.targetId, 'PAUSED');
          } else if (rule.action === 'ACTIVATE') {
            if (rule.targetType === 'adset') await svc.updateAdSetStatus(rule.targetId, 'ACTIVE');
            else if (rule.targetType === 'ad') await svc.updateAdStatus(rule.targetId, 'ACTIVE');
            else await svc.updateCampaignStatus(rule.targetId, 'ACTIVE');
          } else if (rule.action === 'SCALE_UP' || rule.action === 'SCALE_DOWN') {
            // scaleCampaignBudget espera um metaCampaignId — se a regra aponta
            // pra um adset/ad, rule.targetId é o ID errado de entidade e a
            // chamada acabaria escalando (ou falhando silenciosamente contra)
            // algo que não é a campanha pretendida. Escala de orçamento só é
            // suportada para targetType === 'campaign'.
            if (rule.targetType !== 'campaign') {
              console.warn(
                `[Automação] Regra "${rule.name}" (${rule.id}): escala de orçamento só é suportada em campanhas (targetType=${rule.targetType}) — pulando`,
              );
              executou = false;
            } else {
              const escala = await svc.scaleCampaignBudget(rule.targetId, rule.action === 'SCALE_UP' ? 1.2 : 0.8);
              if (!escala.escalado) {
                console.warn(`[Automação] Regra "${rule.name}" (${rule.id}) não escalou: ${escala.motivo}`);
                executou = false;
              }
            }
          }

          // Ação que não aconteceu não vira RuleLog nem abre cooldown.
          if (!executou) {
            await prisma.automationRule.update({ where: { id: rule.id }, data: { lastChecked: new Date() } });
            continue;
          }

          await prisma.ruleLog.create({
            data: { ruleId: rule.id, action: rule.action, metrics: JSON.stringify(insights) },
          });
          // Abre o cooldown de 24h — só quando a ação DE FATO executou.
          await prisma.automationRule.update({
            where: { id: rule.id },
            data: { lastTriggeredAt: new Date(), triggerCount: { increment: 1 } },
          });
          console.log(`[Automação] Regra "${rule.name}" executada — ${rule.action} (${rule.trigger}=${val})`);
        }

        await prisma.automationRule.update({ where: { id: rule.id }, data: { lastChecked: new Date() } });
      } catch (err) {
        // Só a mensagem: o objeto de erro cru já levou token de cliente ao log.
        console.error(`[Automação] Erro na regra "${rule.name}":`, err instanceof Error ? err.message : 'erro desconhecido');
      }
    }
  } finally {
    // Em finally: antes, um erro no meio deixava a conexão aberta.
    await svc.disconnect();
  }
}

// Roda as automações de todos os usuários conectados. Falha de um usuário
// (token inválido etc.) é registrada — só a mensagem, nunca o erro cru, que já
// levou token de cliente ao log — e NÃO impede os seguintes.
export async function executarAutomacoesDeTodos(): Promise<void> {
  const connections = await prisma.mCPConnection.findMany({ where: { connected: true } });
  for (const conn of connections) {
    try {
      await executarAutomacoesDoUsuario(conn.userId);
    } catch (err) {
      console.error(`[Automação] Falha ao processar o usuário ${conn.userId}:`, msgDoErro(err));
    }
  }
}
