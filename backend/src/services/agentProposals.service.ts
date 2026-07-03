// O agente que trabalha de madrugada: analisa as campanhas de todos os
// usuários conectados usando os dados já sincronizados (sem custo extra de
// chamadas ao Meta) e cria propostas de otimização. O usuário aprova ou
// rejeita com 1 clique; aprovar executa a ação de verdade no Meta.
//
// Espelha o "agent-proposals" do lado Google Ads (edge function em
// supabase/functions/agent-proposals) — mesmo conceito, adaptado à stack
// deste backend (Express + Prisma, sem Supabase).

import prisma from '../lib/prisma.js';
import { createMetaMCPService } from './meta.mcp.service.js';

const RECENT_WINDOW_DAYS = 14;
const brl = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface ProposalInput {
  userId: string;
  type: string;
  title: string;
  description: string;
  payload: Record<string, unknown>;
  estimatedSavings?: number;
}

async function createProposal(recentKeys: Set<string>, input: ProposalInput): Promise<boolean> {
  const dedupKey = `${input.type}:${(input.payload as { campaignId?: string; adSetId?: string }).campaignId ?? (input.payload as { adSetId?: string }).adSetId ?? ''}`;
  if (recentKeys.has(dedupKey)) return false;

  await prisma.agentProposal.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      description: input.description,
      payload: JSON.stringify(input.payload),
      estimatedSavings: input.estimatedSavings ?? 0,
    },
  });
  return true;
}

// Analisa as campanhas de um usuário e cria propostas novas. Retorna quantas
// foram criadas (0 é normal — nem toda madrugada tem algo a propor).
export async function scanUser(userId: string): Promise<number> {
  const recentSince = new Date(Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const recent = await prisma.agentProposal.findMany({
    where: { userId, createdAt: { gte: recentSince } },
    select: { type: true, payload: true },
  });
  const recentKeys = new Set(
    recent.map((p) => {
      const payload = JSON.parse(p.payload) as { campaignId?: string; adSetId?: string };
      return `${p.type}:${payload.campaignId ?? payload.adSetId ?? ''}`;
    }),
  );

  const campaigns = await prisma.campaign.findMany({
    where: { userId, metaCampaignId: { not: null }, metaStatus: 'ACTIVE' },
    include: { adSets: true },
  });

  let created = 0;

  // ── 1. Campanha no prejuízo (ROAS baixo com gasto relevante) ────────────────
  for (const c of campaigns) {
    if ((c.metaSpend ?? 0) < 150) continue;
    const roas = c.metaRoas ?? 0;
    if (roas >= 0.5) continue;

    const ok = await createProposal(recentKeys, {
      userId,
      type: 'pause_low_roas',
      title: `Pausar "${c.name}" — gastou ${brl(c.metaSpend!)} com retorno de só ${brl(roas * c.metaSpend!)}`,
      description: `ROAS de ${roas.toFixed(2)}x nos últimos 30 dias (cada R$1 investido voltou R$${roas.toFixed(2)}). Pausar evita repetir esse gasto enquanto você revisa a campanha.`,
      payload: { campaignId: c.id, metaCampaignId: c.metaCampaignId, campaignName: c.name, spend30d: c.metaSpend },
      estimatedSavings: c.metaSpend!,
    });
    if (ok) created++;
  }

  // ── 2. Público saturado (frequência alta) num conjunto de anúncios ─────────
  for (const c of campaigns) {
    for (const adSet of c.adSets) {
      if (!adSet.metaAdSetId || adSet.metaStatus !== 'ACTIVE') continue;
      const freq = adSet.metaFrequency ?? 0;
      if (freq < 4) continue;

      const ok = await createProposal(recentKeys, {
        userId,
        type: 'pause_high_frequency',
        title: `Pausar conjunto saturado em "${c.name}" (frequência ${freq.toFixed(1)}x)`,
        description: `O conjunto "${adSet.name}" está mostrando o mesmo anúncio ${freq.toFixed(1)}x, em média, para a mesma pessoa — acima do limite saudável (3x). Isso costuma cansar o público e encarecer o resultado. Pausar dá tempo de trocar o criativo.`,
        payload: { campaignId: c.id, adSetId: adSet.id, metaAdSetId: adSet.metaAdSetId, campaignName: c.name, adSetName: adSet.name, frequency: freq },
        estimatedSavings: 0,
      });
      if (ok) created++;
    }
  }

  return created;
}

// Executa a ação da proposta aprovada no Meta de verdade.
export async function executeProposal(proposal: { id: string; userId: string; type: string; payload: string }): Promise<string> {
  const payload = JSON.parse(proposal.payload) as Record<string, string | number>;
  const svc = await createMetaMCPService(proposal.userId);

  try {
    if (proposal.type === 'pause_low_roas') {
      await svc.updateCampaignStatus(String(payload.metaCampaignId), 'PAUSED');
      await prisma.campaign.update({ where: { id: String(payload.campaignId) }, data: { metaStatus: 'PAUSED' } });
      return `Campanha "${payload.campaignName}" pausada no Meta Ads`;
    }

    if (proposal.type === 'pause_high_frequency') {
      await svc.updateAdSetStatus(String(payload.metaAdSetId), 'PAUSED');
      await prisma.adSet.update({ where: { id: String(payload.adSetId) }, data: { metaStatus: 'PAUSED' } });
      return `Conjunto "${payload.adSetName}" pausado na campanha "${payload.campaignName}"`;
    }

    throw new Error(`Tipo de proposta desconhecido: ${proposal.type}`);
  } finally {
    await svc.disconnect();
  }
}
