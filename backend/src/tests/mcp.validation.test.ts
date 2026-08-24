import { describe, it, expect, vi } from 'vitest';
import {
  MetaToolResponseError,
  MetaMCPService,
  resolveOptimizationGoal,
} from '../services/meta.mcp.service.js';
import type { CampaignPlan } from '../types/meta.types.js';

function makePlan(overrides: Partial<CampaignPlan> = {}): CampaignPlan {
  return {
    localId: 'local-1',
    adAccountId: 'act_123456789',
    pageId: '456789123',
    name: 'Campanha Teste',
    objective: 'LEAD_GENERATION',
    adSets: [
      {
        name: 'Conjunto 1',
        dailyBudget: 50,
        targeting: { age_min: 25, age_max: 45 },
        optimizationGoal: 'LEAD_GENERATION',
        billingEvent: 'IMPRESSIONS',
        ads: [
          {
            name: 'Anúncio 1',
            headline: 'Título do anúncio',
            bodyText: 'Texto do anúncio para teste',
            ctaType: 'LEARN_MORE',
            destinationUrl: 'https://seusite.com',
            imageUrl: 'https://cdn.example.com/anuncio.jpg',
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('MetaMCPService.validatePlan', () => {
  const svc = new MetaMCPService('user-test');

  it('valida plano correto sem erros', async () => {
    const result = await svc.validatePlan(makePlan());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejeita plano sem nome', async () => {
    const result = await svc.validatePlan(makePlan({ name: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Nome da campanha é obrigatório');
  });

  it('rejeita plano sem adAccountId', async () => {
    const result = await svc.validatePlan(makePlan({ adAccountId: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('ID da conta de anúncios é obrigatório');
  });

  it('rejeita plano sem Página do Facebook', async () => {
    const result = await svc.validatePlan(makePlan({ pageId: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Página do Facebook é obrigatória');
  });

  it('rejeita plano sem adSets', async () => {
    const result = await svc.validatePlan(makePlan({ adSets: [] }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('A campanha precisa ter pelo menos um conjunto de anúncios');
  });

  it('rejeita conjunto com orçamento zero', async () => {
    const plan = makePlan();
    plan.adSets[0].dailyBudget = 0;
    const result = await svc.validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('orçamento diário mínimo'))).toBe(true);
  });

  it('rejeita R$ 5 por dia antes de criar campanha na Meta', async () => {
    const plan = makePlan();
    plan.adSets[0].dailyBudget = 5;
    const result = await svc.validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Conjunto "Conjunto 1": orçamento diário mínimo é R$ 10.00');
  });

  it('rejeita anúncio sem headline', async () => {
    const plan = makePlan();
    plan.adSets[0].ads[0].headline = '';
    const result = await svc.validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('headline'))).toBe(true);
  });

  it('rejeita anúncio sem URL de destino', async () => {
    const plan = makePlan();
    plan.adSets[0].ads[0].destinationUrl = '';
    const result = await svc.validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('URL de destino'))).toBe(true);
  });

  it('rejeita anúncio sem imagem nem vídeo', async () => {
    const plan = makePlan();
    plan.adSets[0].ads[0].imageUrl = undefined;
    const result = await svc.validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('imagem ou vídeo'))).toBe(true);
  });

  it('gera warning para headline muito longa', async () => {
    const plan = makePlan();
    plan.adSets[0].ads[0].headline = 'A'.repeat(260);
    const result = await svc.validatePlan(plan);
    expect(result.warnings.some((w) => w.includes('255 caracteres'))).toBe(true);
  });

  it('acumula múltiplos erros', async () => {
    const plan = makePlan({ name: '', adAccountId: '' });
    plan.adSets[0].ads[0].headline = '';
    plan.adSets[0].ads[0].destinationUrl = '';
    const result = await svc.validatePlan(plan);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe('MetaMCPService — contrato de publicação Pipeboard', () => {
  function mockCall(svc: MetaMCPService, response: object) {
    return vi.spyOn(
      svc as unknown as { call: (tool: string, args: Record<string, unknown>) => Promise<object> },
      'call',
    ).mockResolvedValue(response);
  }

  it('usa create_adset com account_id', async () => {
    const svc = new MetaMCPService('user-test');
    const call = mockCall(svc, { id: 'adset-1' });
    await svc.createAdSet({
      accountId: 'act_123', campaignId: 'campaign-1', name: 'Conjunto', dailyBudget: 20,
      targeting: {}, optimizationGoal: 'LINK_CLICKS', billingEvent: 'IMPRESSIONS', status: 'PAUSED',
    });
    expect(call).toHaveBeenCalledWith('create_adset', expect.objectContaining({ account_id: 'act_123' }));
  });

  it('cria o criativo separado com Página e mídia', async () => {
    const svc = new MetaMCPService('user-test');
    const call = mockCall(svc, { creative_id: 'creative-1' });
    await svc.createAdCreative({
      accountId: 'act_123', name: 'Criativo', pageId: 'page-1', linkUrl: 'https://adsgenius.net',
      message: 'Texto', headline: 'Título', callToActionType: 'LEARN_MORE', imageHash: 'hash-1',
    });
    expect(call).toHaveBeenCalledWith('create_ad_creative', expect.objectContaining({
      account_id: 'act_123', page_id: 'page-1', image_hash: 'hash-1',
    }));
  });

  it('cria o anúncio referenciando o creative_id', async () => {
    const svc = new MetaMCPService('user-test');
    const call = mockCall(svc, { id: 'ad-1' });
    await svc.createAd({
      accountId: 'act_123', adSetId: 'adset-1', name: 'Anúncio', creativeId: 'creative-1', status: 'PAUSED',
    });
    expect(call).toHaveBeenCalledWith('create_ad', {
      account_id: 'act_123', adset_id: 'adset-1', name: 'Anúncio', creative_id: 'creative-1', status: 'PAUSED',
    });
  });

  it('normaliza o objetivo legado para o objetivo atual da Meta', async () => {
    const svc = new MetaMCPService('user-test');
    const call = mockCall(svc, { id: 'campaign-1' });
    await svc.createCampaign({ adAccountId: 'act_123', name: 'Campanha', objective: 'TRAFFIC', status: 'PAUSED' });
    expect(call).toHaveBeenCalledWith('create_campaign', expect.objectContaining({
      objective: 'OUTCOME_TRAFFIC', use_adset_level_budgets: true,
    }));
  });

  it('normaliza o rótulo em português salvo pelo assistente', async () => {
    const svc = new MetaMCPService('user-test');
    const call = mockCall(svc, { id: 'campaign-1' });
    await svc.createCampaign({
      adAccountId: 'act_123',
      name: 'Campanha',
      objective: 'Tráfego para o site',
      status: 'PAUSED',
    });
    expect(call).toHaveBeenCalledWith('create_campaign', expect.objectContaining({
      objective: 'OUTCOME_TRAFFIC', use_adset_level_budgets: true,
    }));
  });

  it('substitui meta de leads incompatível com campanha de tráfego', () => {
    expect(resolveOptimizationGoal('Tráfego para o site', 'LEAD_GENERATION'))
      .toBe('LINK_CLICKS');
  });

  it('preserva meta de otimização compatível com campanha de tráfego', () => {
    expect(resolveOptimizationGoal('OUTCOME_TRAFFIC', 'LANDING_PAGE_VIEWS'))
      .toBe('LANDING_PAGE_VIEWS');
  });

  // Estas três metas exigem `promoted_object` (pixel ou formulário instantâneo),
  // que o createAdSet não envia. Aceitá-las fazia a Meta recusar o conjunto com
  // "Invalid parameter" DEPOIS de já ter criado a campanha lá.
  it('nunca devolve meta que exige promoted_object', () => {
    const proibidas = ['LEAD_GENERATION', 'OFFSITE_CONVERSIONS', 'VALUE'];
    const objetivos = [
      'Geração de leads', 'Vendas', 'Tráfego para o site',
      'Reconhecimento de marca', 'Engajamento', 'Mensagens no WhatsApp',
    ];
    for (const objetivo of objetivos) {
      // sem sugestão, e com cada uma das proibidas sugeridas pela IA
      expect(proibidas).not.toContain(resolveOptimizationGoal(objetivo));
      for (const sugerida of proibidas) {
        expect(proibidas).not.toContain(resolveOptimizationGoal(objetivo, sugerida));
      }
    }
  });

  it('campanha de leads vira clique no link, que é publicável hoje', () => {
    expect(resolveOptimizationGoal('Geração de leads')).toBe('LINK_CLICKS');
    expect(resolveOptimizationGoal('Geração de leads', 'LEAD_GENERATION')).toBe('LINK_CLICKS');
    expect(resolveOptimizationGoal('Vendas', 'OFFSITE_CONVERSIONS')).toBe('LINK_CLICKS');
  });

  it('devolve motivo seguro e acionável quando a Meta rejeita o conjunto', async () => {
    const svc = new MetaMCPService('user-test');
    mockCall(svc, { error: { message: 'Daily budget is below the minimum.' } });
    await expect(svc.createAdSet({
      accountId: 'act_123',
      campaignId: 'campaign-1',
      name: 'Conjunto',
      dailyBudget: 5,
      targeting: {},
      optimizationGoal: 'LINK_CLICKS',
      billingEvent: 'IMPRESSIONS',
      status: 'PAUSED',
    })).rejects.toEqual(new MetaToolResponseError(
      'conjunto de anúncios',
      'Daily budget is below the minimum.',
    ));
  });

  // A explicação em linguagem de gente vem depois de message/code/error_subcode
  // dentro de um JSON escapado. O corte antigo em 240 caracteres a descartava e
  // sobrava "Invalid parameter, OAuthException, code 100" — inacionável.
  it('mostra a explicação da Meta em vez do JSON cru', async () => {
    const svc = new MetaMCPService('user-test');
    // Exatamente como chega: JSON escapado dentro de outro JSON, com a
    // explicação depois de message/code/error_subcode.
    const bruto = String.raw`[{"type":"text","text":"create_adset failed: {\n \"message\": \"Invalid parameter\",\n \"type\": \"OAuthException\",\n \"code\": 100,\n \"error_subcode\": 1885097,\n \"is_transient\": false,\n \"error_user_title\": \"Público muito restrito\",\n \"error_user_msg\": \"Ajuste a segmentação para alcançar mais pessoas.\"\n}"}]`;
    mockCall(svc, { error: { message: bruto } });
    await expect(svc.createAdSet({
      accountId: 'act_123',
      campaignId: 'campaign-1',
      name: 'Conjunto',
      dailyBudget: 20,
      targeting: {},
      optimizationGoal: 'LINK_CLICKS',
      billingEvent: 'IMPRESSIONS',
      status: 'PAUSED',
    })).rejects.toEqual(new MetaToolResponseError(
      'conjunto de anúncios',
      'Público muito restrito — Ajuste a segmentação para alcançar mais pessoas.',
    ));
  });

  it('sanitiza também falha de transporte ao criar o conjunto', async () => {
    const svc = new MetaMCPService('user-test');
    vi.spyOn(svc as never, 'call').mockRejectedValueOnce(
      new Error('Invalid optimization goal for campaign objective.'),
    );
    await expect(svc.createAdSet({
      accountId: 'act_123',
      campaignId: 'campaign-1',
      name: 'Conjunto',
      dailyBudget: 5,
      targeting: {},
      optimizationGoal: 'LINK_CLICKS',
      billingEvent: 'IMPRESSIONS',
      status: 'PAUSED',
    })).rejects.toMatchObject({
      name: 'MetaToolResponseError',
      message: 'A Meta rejeitou conjunto de anúncios: Invalid optimization goal for campaign objective.',
    });
  });
});

// A recusa da Meta tem dois caminhos: JSON legítimo com `error` dentro (coberto
// acima) e `isError` do MCP. O segundo virava `Error` cru, a rota não
// reconhecia o tipo e o cliente lia "Não foi possível publicar a campanha no
// Meta." — sem motivo. Aconteceu de verdade ao criar o ANÚNCIO: campanha,
// conjunto e criativo tinham sido criados, e a tela não dizia o que faltava.
describe('MetaMCPService — recusa sinalizada como isError pelo MCP', () => {
  // A explicação da Meta, como chega: JSON escapado dentro de outro JSON.
  const RECUSA = String.raw`create_ad failed: {\n \"message\": \"Invalid parameter\",\n \"type\": \"OAuthException\",\n \"code\": 100,\n \"error_subcode\": 1487215,\n \"error_user_title\": \"Criativo incompatível\",\n \"error_user_msg\": \"O criativo não pode ser usado com esse conjunto de anúncios.\"\n}`;

  function fakeMCP(svc: MetaMCPService, response: object) {
    const client = { callTool: vi.fn().mockResolvedValue(response) };
    Object.assign(svc, { client, connected: true, accessToken: 'token-de-teste' });
    return client;
  }

  it('createAd entrega a explicação da Meta, não erro genérico', async () => {
    const svc = new MetaMCPService('user-test');
    fakeMCP(svc, { isError: true, content: [{ type: 'text', text: RECUSA }] });

    await expect(svc.createAd({
      accountId: 'act_123',
      adSetId: 'adset-1',
      name: 'Anúncio',
      creativeId: 'creative-1',
      status: 'PAUSED',
    })).rejects.toMatchObject({
      name: 'MetaToolResponseError',
      message:
        'A Meta rejeitou o anúncio: Criativo incompatível — O criativo não pode ser usado com esse conjunto de anúncios.',
    });
  });

  it('guarda a resposta crua para o log do servidor', async () => {
    const svc = new MetaMCPService('user-test');
    fakeMCP(svc, { isError: true, content: [{ type: 'text', text: RECUSA }] });

    await expect(svc.createAd({
      accountId: 'act_123',
      adSetId: 'adset-1',
      name: 'Anúncio',
      creativeId: 'creative-1',
      status: 'PAUSED',
    })).rejects.toMatchObject({ raw: RECUSA });
  });

  // Gateway devolvendo HTML/texto virava SyntaxError e caía no mesmo buraco.
  it('resposta que não é JSON também vira recusa tipada', async () => {
    const svc = new MetaMCPService('user-test');
    fakeMCP(svc, { content: [{ type: 'text', text: 'Bad Gateway' }] });

    await expect(svc.createAd({
      accountId: 'act_123',
      adSetId: 'adset-1',
      name: 'Anúncio',
      creativeId: 'creative-1',
      status: 'PAUSED',
    })).rejects.toMatchObject({
      name: 'MetaToolResponseError',
      message: 'A Meta rejeitou o anúncio: Bad Gateway',
    });
  });

  // Conta de anúncios como OBJETO na Graph API só existe com `act_`. O ID é
  // gravado pelado e repassado cru; o create_ad é o único que consulta o
  // objeto, e por isso foi o único a quebrar — depois de campanha, conjunto e
  // criativo já criados de verdade na conta do cliente.
  it('createAd manda a conta com act_ antes de tentar pelada', async () => {
    const svc = new MetaMCPService('user-test');
    const client = fakeMCP(svc, { content: [{ type: 'text', text: '{"id":"ad-1"}' }] });

    await svc.createAd({
      accountId: '355520187901770',
      adSetId: 'adset-1',
      name: 'Anúncio',
      creativeId: 'creative-1',
      status: 'PAUSED',
    });

    expect(client.callTool).toHaveBeenCalledTimes(1);
    expect(client.callTool.mock.calls[0][0].arguments).toMatchObject({
      account_id: 'act_355520187901770',
    });
  });

  it('cai para a conta pelada quando o objeto não é encontrado', async () => {
    const svc = new MetaMCPService('user-test');
    const naoEncontrado = {
      isError: true,
      content: [{ type: 'text', text: '## Object Not Found\n"355520187901770" was not found.' }],
    };
    const client = fakeMCP(svc, naoEncontrado);
    client.callTool
      .mockResolvedValueOnce(naoEncontrado)
      .mockResolvedValueOnce({ content: [{ type: 'text', text: '{"id":"ad-9"}' }] });

    await expect(svc.createAd({
      accountId: 'act_355520187901770',
      adSetId: 'adset-1',
      name: 'Anúncio',
      creativeId: 'creative-1',
      status: 'PAUSED',
    })).resolves.toEqual({ id: 'ad-9' });

    expect(client.callTool.mock.calls[1][0].arguments).toMatchObject({
      account_id: '355520187901770',
    });
  });

  // Repetir depois de um erro que NÃO é 404 pode duplicar o anúncio — o
  // primeiro pode ter sido criado antes da recusa.
  it('não repete o create_ad em recusa que não seja objeto não encontrado', async () => {
    const svc = new MetaMCPService('user-test');
    const client = fakeMCP(svc, {
      isError: true,
      content: [{ type: 'text', text: 'create_ad failed: orçamento diário abaixo do mínimo' }],
    });

    await expect(svc.createAd({
      accountId: 'act_355520187901770',
      adSetId: 'adset-1',
      name: 'Anúncio',
      creativeId: 'creative-1',
      status: 'PAUSED',
    })).rejects.toMatchObject({ name: 'MetaToolResponseError' });

    expect(client.callTool).toHaveBeenCalledTimes(1);
  });

  it('não trata resposta válida como recusa', async () => {
    const svc = new MetaMCPService('user-test');
    fakeMCP(svc, { content: [{ type: 'text', text: '{"id":"ad-1"}' }] });

    await expect(svc.createAd({
      accountId: 'act_123',
      adSetId: 'adset-1',
      name: 'Anúncio',
      creativeId: 'creative-1',
      status: 'PAUSED',
    })).resolves.toEqual({ id: 'ad-1' });
  });
});
