import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { AIService } from '../services/ai.service.js';
import { executeProposal } from '../services/agentProposals.service.js';
import { auditLog } from '../services/audit.service.js';
import prisma from '../lib/prisma.js';

const router = Router();
const ai = new AIService();

router.use(authMiddleware);

// ─── GET /api/agent/proposals ─────────────────────────────────────────────────
// Propostas do agente noturno (scan automático) — pendentes + decididas recentes
router.get('/proposals', async (req: AuthRequest, res: Response) => {
  const proposals = await prisma.agentProposal.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });
  res.json({ proposals });
});

// ─── POST /api/agent/proposals/:id/decide ────────────────────────────────────
// decision: "approve" (executa no Meta) | "reject" (só descarta)
router.post('/proposals/:id/decide', async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { decision } = req.body as { decision?: string };
  if (!decision || !['approve', 'reject'].includes(decision)) {
    res.status(400).json({ error: 'decision deve ser "approve" ou "reject"' });
    return;
  }

  const proposal = await prisma.agentProposal.findFirst({ where: { id, userId: req.userId! } });
  if (!proposal) {
    res.status(404).json({ error: 'Proposta não encontrada' });
    return;
  }
  if (proposal.status !== 'pending') {
    res.status(409).json({ error: `Proposta já está ${proposal.status}` });
    return;
  }

  if (decision === 'reject') {
    await prisma.agentProposal.update({
      where: { id },
      data: { status: 'rejected', decidedAt: new Date() },
    });
    res.json({ ok: true, status: 'rejected' });
    return;
  }

  await prisma.agentProposal.update({
    where: { id },
    data: { status: 'approved', decidedAt: new Date() },
  });

  try {
    const result = await executeProposal(proposal);
    await prisma.agentProposal.update({
      where: { id },
      data: { status: 'executed', executedAt: new Date(), result },
    });
    await auditLog({
      userId: req.userId!,
      action: 'AGENT_PROPOSAL_EXECUTED',
      resource: 'agent_proposal',
      resourceId: id,
      details: { type: proposal.type, result },
    });
    res.json({ ok: true, status: 'executed', result });
  } catch (err) {
    const reason = String(err);
    await prisma.agentProposal.update({ where: { id }, data: { status: 'failed', result: reason } });
    res.status(500).json({ ok: false, status: 'failed', error: reason });
  }
});

// ─── POST /api/agent/chat ─────────────────────────────────────────────────────
// Conversa com IA usando streaming SSE — contexto real das campanhas do usuário
router.post('/chat', async (req: AuthRequest, res: Response) => {
  const { message, history = [] } = req.body as {
    message: string;
    history: { role: 'user' | 'assistant'; content: string }[];
  };

  if (!message?.trim()) {
    res.status(400).json({ error: 'Mensagem não pode ser vazia' });
    return;
  }

  // ─── Busca contexto real do usuário ───────────────────────────────────────
  const [campaigns, copies, audiences] = await Promise.all([
    prisma.campaign.findMany({
      where: { userId: req.userId! },
      include: { adSets: { include: { ads: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    }),
    prisma.copy.findMany({
      where: { userId: req.userId! },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    prisma.audience.findMany({
      where: { userId: req.userId! },
      take: 10,
    }),
  ]);

  // Monta resumo compacto das campanhas para o contexto
  const campaignsSummary = campaigns.map((c) => {
    const adSetsInfo = c.adSets.map((as) => ({
      nome: as.name,
      orcamento_diario: `R$ ${as.dailyBudget}`,
      roas: as.metaRoas ?? 'sem dados',
      gasto: as.metaSpend ? `R$ ${as.metaSpend.toFixed(2)}` : 'sem dados',
      cpl: as.metaCpl ? `R$ ${as.metaCpl.toFixed(2)}` : 'sem dados',
      frequencia: as.metaFrequency ?? 'sem dados',
      anuncios: as.ads.map((ad) => ({
        headline: ad.headline,
        ctr: ad.metaCtr ?? 'sem dados',
        cpc: ad.metaCpc ? `R$ ${ad.metaCpc.toFixed(2)}` : 'sem dados',
        gasto: ad.metaSpend ? `R$ ${ad.metaSpend.toFixed(2)}` : 'sem dados',
        status_meta: ad.metaStatus ?? 'rascunho',
      })),
    }));
    return {
      id: c.id,
      nome: c.name,
      produto: c.product,
      objetivo: c.objective,
      status: c.metaStatus ?? c.status,
      orcamento: `R$ ${c.budget}`,
      gasto_total: c.metaSpend ? `R$ ${c.metaSpend.toFixed(2)}` : 'sem dados',
      roas: c.metaRoas ?? 'sem dados',
      cpc: c.metaCpc ? `R$ ${c.metaCpc.toFixed(2)}` : 'sem dados',
      cpl: c.metaCpl ? `R$ ${c.metaCpl.toFixed(2)}` : 'sem dados',
      impressoes: c.metaImpressions ?? 0,
      cliques: c.metaClicks ?? 0,
      conjuntos: adSetsInfo,
    };
  });

  const audiencesSummary = audiences.map((a) => ({
    nome: a.name,
    genero: a.gender,
    idade: `${a.ageMin}–${a.ageMax}`,
    localizacao: a.locations,
    interesses: a.interests,
  }));

  const copiesSummary = copies.slice(0, 5).map((c) => ({
    framework: c.framework,
    headline: c.headline,
    score: c.score,
  }));

  const systemPrompt = `Você é o **Agente Meta Ads**, assistente de IA especializado em campanhas de Facebook Ads e Instagram Ads.

Você tem acesso aos dados reais das campanhas do usuário. Responda sempre em português do Brasil, de forma direta e prática.

Use **negrito** para destacar números, métricas e pontos de ação. Use emojis com moderação para organizar seções.

Ao analisar dados:
- Compare ROAS, CTR, CPL e frequência com benchmarks do setor
- ROAS bom: ≥ 3x | CTR bom: ≥ 1,5% para Feed | Frequência alta: > 3,5
- Seja específico: cite nomes de campanhas, conjuntos e anúncios
- Sempre termine com ações concretas numeradas

## Dados das campanhas do usuário (${new Date().toLocaleDateString('pt-BR')}):

\`\`\`json
${JSON.stringify(campaignsSummary, null, 2)}
\`\`\`

## Públicos-alvo salvos:
\`\`\`json
${JSON.stringify(audiencesSummary, null, 2)}
\`\`\`

## Últimas copies geradas:
\`\`\`json
${JSON.stringify(copiesSummary, null, 2)}
\`\`\`

Total: **${campaigns.length} campanha(s)** · **${audiences.length} público(s)** · **${copies.length} copie(s)**`;

  // ─── SSE headers ──────────────────────────────────────────────────────────
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendChunk = (chunk: string) => {
    res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
  };

  const sendDone = () => {
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  };

  const sendError = (msg: string) => {
    res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
    res.end();
  };

  // ─── Streaming via Anthropic SDK ──────────────────────────────────────────
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

    // Monta histórico (máximo últimas 20 mensagens para não estourar contexto)
    const historyMessages = history.slice(-20).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    const stream = await client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: systemPrompt,
      messages: [
        ...historyMessages,
        { role: 'user', content: message.trim() },
      ],
    });

    let fullResponse = '';
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        fullResponse += event.delta.text;
        sendChunk(event.delta.text);
      }
    }

    // Persiste no banco após o stream completo
    await prisma.chatMessage.createMany({
      data: [
        { userId: req.userId!, role: 'user',     content: message.trim() },
        { userId: req.userId!, role: 'assistant', content: fullResponse },
      ],
    });

    sendDone();
  } catch (err) {
    console.error('[Agent] Erro no streaming:', err);
    sendError('Erro ao chamar o modelo de IA. Verifique a chave ANTHROPIC_API_KEY.');
  }
});

// ─── GET /api/agent/health-score ──────────────────────────────────────────────
// Calcula nota de saúde 0-100 das campanhas — puramente algorítmico, sem IA
router.get('/health-score', async (req: AuthRequest, res: Response) => {
  const campaigns = await prisma.campaign.findMany({
    where: { userId: req.userId! },
    include: { adSets: { include: { ads: true } } },
  });

  const published = campaigns.filter((c) => c.metaSpend != null && c.metaSpend > 0);

  if (published.length === 0) {
    res.json({ score: null, status: 'sem_dados', breakdown: [], message: 'Nenhuma campanha com dados ainda.' });
    return;
  }

  const breakdown: { label: string; score: number; max: number; tip: string }[] = [];
  let total = 0;

  // 1. ROAS médio (25pts)
  const avgRoas = published.reduce((s, c) => s + (c.metaRoas ?? 0), 0) / published.length;
  const roasScore = avgRoas >= 3 ? 25 : avgRoas >= 2 ? 15 : avgRoas >= 1 ? 8 : 0;
  total += roasScore;
  breakdown.push({
    label: 'ROAS médio',
    score: roasScore, max: 25,
    tip: avgRoas >= 3 ? 'Excelente! Seu retorno está acima do ideal.' : avgRoas >= 2 ? 'Razoável. Tente chegar a 3x.' : 'Baixo. Revise segmentação e criativos.',
  });

  // 2. CTR médio (20pts)
  const totalImpressions = published.reduce((s, c) => s + (c.metaImpressions ?? 0), 0);
  const totalClicks      = published.reduce((s, c) => s + (c.metaClicks ?? 0), 0);
  const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
  const ctrScore = ctr >= 1.5 ? 20 : ctr >= 0.8 ? 12 : ctr > 0 ? 5 : 0;
  total += ctrScore;
  breakdown.push({
    label: 'CTR (taxa de cliques)',
    score: ctrScore, max: 20,
    tip: ctr >= 1.5 ? 'Ótimo! Seus anúncios estão atraindo cliques.' : ctr >= 0.8 ? 'Ok. Tente melhorar o criativo ou a copy.' : 'Baixo. Seu anúncio não está chamando atenção.',
  });

  // 3. Frequência (20pts) — analisa nos adsets
  const allAdSets = published.flatMap((c) => c.adSets).filter((as) => as.metaFrequency != null);
  const highFreq  = allAdSets.filter((as) => (as.metaFrequency ?? 0) > 3.5).length;
  const freqScore = highFreq === 0 ? 20 : highFreq <= 1 ? 12 : 5;
  total += freqScore;
  breakdown.push({
    label: 'Frequência dos anúncios',
    score: freqScore, max: 20,
    tip: highFreq === 0 ? 'Ótimo! Nenhum público está saturado.' : `${highFreq} conjunto(s) com frequência alta. Troque os criativos.`,
  });

  // 4. Campanhas ativas (15pts)
  const active = campaigns.filter((c) => c.metaStatus === 'ACTIVE').length;
  const activeScore = active >= 2 ? 15 : active === 1 ? 10 : 0;
  total += activeScore;
  breakdown.push({
    label: 'Campanhas ativas',
    score: activeScore, max: 15,
    tip: active >= 1 ? `${active} campanha(s) ativa(s).` : 'Nenhuma campanha ativa no momento.',
  });

  // 5. Diversidade de conjuntos (10pts)
  const adSetsCount = published.flatMap((c) => c.adSets).length;
  const diversityScore = adSetsCount >= 3 ? 10 : adSetsCount >= 2 ? 6 : adSetsCount === 1 ? 3 : 0;
  total += diversityScore;
  breakdown.push({
    label: 'Diversidade de conjuntos',
    score: diversityScore, max: 10,
    tip: adSetsCount >= 3 ? 'Boa diversificação de público.' : 'Teste mais segmentações para reduzir risco.',
  });

  // 6. CPL (10pts)
  const cpls = published.filter((c) => (c.metaCpl ?? 0) > 0).map((c) => c.metaCpl!);
  const avgCpl = cpls.length > 0 ? cpls.reduce((s, v) => s + v, 0) / cpls.length : 0;
  const cplScore = avgCpl === 0 ? 5 : avgCpl <= 20 ? 10 : avgCpl <= 50 ? 6 : 2;
  total += cplScore;
  breakdown.push({
    label: 'Custo por lead (CPL)',
    score: cplScore, max: 10,
    tip: avgCpl === 0 ? 'Sem dados de CPL ainda.' : avgCpl <= 20 ? 'Excelente CPL!' : avgCpl <= 50 ? 'CPL razoável.' : 'CPL alto. Revise o funil.',
  });

  const status = total >= 75 ? 'saudavel' : total >= 50 ? 'atencao' : 'critico';

  res.json({ score: total, status, breakdown });
});

// ─── GET /api/agent/daily-actions ─────────────────────────────────────────────
// Gera 3-5 ações práticas do dia com base nas métricas reais — usa Claude
router.get('/daily-actions', async (req: AuthRequest, res: Response) => {
  const campaigns = await prisma.campaign.findMany({
    where: { userId: req.userId! },
    include: { adSets: { include: { ads: true } } },
    take: 15,
  });

  const published = campaigns.filter((c) => c.metaSpend != null && c.metaSpend > 0);

  if (published.length === 0) {
    res.json({
      actions: [
        { priority: 'info', icon: '🚀', title: 'Crie sua primeira campanha', description: 'Você ainda não tem campanhas publicadas. Use um template de nicho ou crie do zero com ajuda da IA.', link: '/campaigns/new' },
        { priority: 'info', icon: '🎯', title: 'Salve um público-alvo', description: 'Defina o perfil do seu cliente ideal para reutilizar em todas as campanhas.', link: '/audiences' },
        { priority: 'info', icon: '✍️', title: 'Gere copies com IA', description: 'Crie textos persuasivos para seus anúncios em segundos.', link: '/copies' },
      ],
    });
    return;
  }

  // Resumo compacto para o prompt
  const summary = published.map((c) => ({
    nome: c.name,
    status: c.metaStatus,
    roas: c.metaRoas,
    cpl: c.metaCpl,
    cpc: c.metaCpc,
    impressoes: c.metaImpressions,
    cliques: c.metaClicks,
    gasto: c.metaSpend,
    frequencia_max: Math.max(...c.adSets.map((as) => as.metaFrequency ?? 0)),
    ctr: c.metaImpressions ? ((c.metaClicks ?? 0) / c.metaImpressions) * 100 : 0,
  }));

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: `Você é consultor de Meta Ads. Analise estas campanhas e gere EXATAMENTE 4 ações práticas para hoje.

Dados:
${JSON.stringify(summary, null, 2)}

Benchmarks: ROAS bom ≥ 3x | CTR bom ≥ 1.5% | Frequência alta > 3.5 | CPL bom ≤ R$30

Responda APENAS com JSON válido neste formato (sem texto antes ou depois):
{
  "actions": [
    {
      "priority": "urgente|atencao|ok|dica",
      "icon": "emoji único",
      "title": "Título curto (max 50 chars)",
      "description": "Explicação em linguagem simples, sem jargão técnico, dizendo O QUE fazer e POR QUÊ (max 120 chars)",
      "link": "/rota-do-app ou null"
    }
  ]
}

Prioridades: use "urgente" para problemas críticos, "atencao" para melhorias, "ok" para pontos positivos, "dica" para sugestões.
Links válidos: /campaigns, /copies, /audiences, /ab-tests, /automations, /agent, null`,
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON não encontrado');

    const parsed = JSON.parse(jsonMatch[0]);
    res.json(parsed);
  } catch (err) {
    console.error('[DailyActions] Erro:', err);
    // Fallback algorítmico sem IA
    const actions = [];
    for (const c of published.slice(0, 3)) {
      if ((c.metaRoas ?? 0) < 2 && (c.metaSpend ?? 0) > 50) {
        actions.push({ priority: 'urgente', icon: '⚠️', title: `"${c.name}" com ROAS baixo`, description: 'Seu retorno está abaixo do ideal. Pause ou revise o público e criativo.', link: `/campaigns/${c.id}` });
      } else if ((c.metaRoas ?? 0) > 4) {
        actions.push({ priority: 'ok', icon: '🚀', title: `"${c.name}" está indo bem`, description: 'ROAS acima de 4x. Considere aumentar o orçamento para gerar mais resultados.', link: `/campaigns/${c.id}` });
      }
    }
    if (actions.length === 0) actions.push({ priority: 'dica', icon: '💡', title: 'Teste um novo criativo', description: 'Criar variações de anúncio ajuda a descobrir o que mais atrai seu público.', link: '/copies' });
    res.json({ actions });
  }
});

// ─── GET /api/agent/proactive-alerts ─────────────────────────────────────────
// Analisa campanhas com IA e retorna 1-3 alertas com ações executáveis de 1 clique
router.get('/proactive-alerts', async (req: AuthRequest, res: Response) => {
  const campaigns = await prisma.campaign.findMany({
    where: { userId: req.userId! },
    include: { adSets: true },
    take: 20,
  });

  // Alertas determinísticos: anúncios reprovados pelo Meta (independe de gasto/IA)
  const disapprovedAds = await prisma.ad.findMany({
    where: {
      metaStatus: { in: ['DISAPPROVED', 'WITH_ISSUES'] },
      adSet: { campaign: { userId: req.userId! } },
    },
    include: { adSet: { include: { campaign: true } } },
    take: 5,
  });
  const disapprovedAlerts = disapprovedAds.map((ad) => ({
    id: `disapproved-${ad.id}`,
    type: 'critical' as const,
    emoji: '⛔',
    message: `Anúncio reprovado: "${ad.name}"`,
    detail: `Na campanha "${ad.adSet.campaign.name}". ${ad.metaStatus === 'WITH_ISSUES' ? 'Com problemas de política' : 'Reprovado pelo Meta'} — edite o criativo e reenvie para revisão.`,
    campaignId: ad.adSet.campaign.id,
    action: null,
  }));

  const published = campaigns.filter((c) => c.metaSpend != null && c.metaSpend > 0);

  if (published.length === 0) {
    res.json({ alerts: disapprovedAlerts });
    return;
  }

  const summary = published.map((c) => ({
    id: c.id,
    metaCampaignId: c.metaCampaignId,
    nome: c.name,
    status: c.metaStatus,
    roas: c.metaRoas,
    cpl: c.metaCpl,
    cpc: c.metaCpc,
    gasto: c.metaSpend,
    impressoes: c.metaImpressions,
    cliques: c.metaClicks,
    conversoes: c.metaConversions,
    orcamento: c.budget,
    ctr: c.metaImpressions && c.metaClicks
      ? ((c.metaClicks / c.metaImpressions) * 100).toFixed(2)
      : null,
    frequencia_max: c.adSets.length > 0
      ? Math.max(...c.adSets.map((as) => as.metaFrequency ?? 0))
      : null,
  }));

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `Você é um consultor de Meta Ads proativo. Analise estas campanhas e gere ATÉ 3 alertas urgentes/oportunidades.

Dados das campanhas:
${JSON.stringify(summary, null, 2)}

Benchmarks: ROAS bom ≥ 3x | CTR bom ≥ 1.5% | Frequência saturada > 3.5 | CPL bom ≤ R$30

Regras:
- Só inclua alertas realmente importantes (não invente problemas)
- Use linguagem simples, sem jargão técnico
- Se uma campanha gastou muito com ROAS < 1, é crítico
- Se ROAS > 5x, é oportunidade de escalar
- Se frequência > 3.5, o público está saturado
- Sempre que possível, inclua uma action executável

Responda APENAS com JSON válido (sem markdown):
{
  "alerts": [
    {
      "id": "string única",
      "type": "critical|warning|opportunity|info",
      "emoji": "emoji único",
      "message": "mensagem curta em linguagem humana (max 80 chars)",
      "detail": "explicação do impacto e o que acontece se não agir (max 150 chars)",
      "campaignId": "id interno da campanha ou null",
      "action": {
        "label": "texto do botão (max 25 chars)",
        "method": "POST|PATCH",
        "path": "/mcp/campaigns/META_CAMPAIGN_ID/status ou null",
        "body": {}
      } | null
    }
  ]
}

Para a action.path, use o metaCampaignId da campanha, não o id interno (campo "id").
Exemplos de path: "/mcp/campaigns/META_CAMPAIGN_ID/status" (method "PATCH")
Exemplos de body para pausar: {"status":"PAUSED"} | para ativar: {"status":"ACTIVE"}
Se não houver action possível, use null.`,
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON não encontrado');

    const parsed = JSON.parse(jsonMatch[0]);
    res.json({ ...parsed, alerts: [...disapprovedAlerts, ...(parsed.alerts ?? [])] });
  } catch (err) {
    console.error('[ProactiveAlerts] Erro:', err);
    // Fallback algorítmico
    const alerts: object[] = [...disapprovedAlerts];
    for (const c of published.slice(0, 3)) {
      if ((c.metaRoas ?? 0) < 1 && (c.metaSpend ?? 0) > 100) {
        alerts.push({
          id: `low-roas-${c.id}`,
          type: 'critical',
          emoji: '🚨',
          message: `"${c.name}" está gastando sem retorno`,
          detail: `ROAS de ${c.metaRoas?.toFixed(1) ?? 0}x. Cada R$1 investido está retornando menos de R$1.`,
          campaignId: c.id,
          action: { label: 'Pausar campanha', method: 'PATCH', path: `/mcp/campaigns/${c.metaCampaignId}/status`, body: { status: 'PAUSED' } },
        });
      } else if ((c.metaRoas ?? 0) > 5) {
        alerts.push({
          id: `scale-${c.id}`,
          type: 'opportunity',
          emoji: '🚀',
          message: `"${c.name}" está performando muito bem`,
          detail: `ROAS ${c.metaRoas?.toFixed(1)}x. Aumentar o orçamento pode gerar mais resultados agora.`,
          campaignId: c.id,
          action: null,
        });
      }
    }
    res.json({ alerts });
  }
});

// ─── GET /api/agent/chat-history ─────────────────────────────────────────────
// Retorna as últimas 60 mensagens do usuário, da mais antiga para a mais nova
router.get('/chat-history', async (req: AuthRequest, res: Response) => {
  const messages = await prisma.chatMessage.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: 'asc' },
    take: 60,
  });
  res.json(messages);
});

// ─── DELETE /api/agent/chat-history ──────────────────────────────────────────
// Apaga todo o histórico do usuário
router.delete('/chat-history', async (req: AuthRequest, res: Response) => {
  await prisma.chatMessage.deleteMany({ where: { userId: req.userId! } });
  res.json({ ok: true });
});

export default router;

