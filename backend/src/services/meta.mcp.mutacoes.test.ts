// Mutadores da Meta (`update_*`, `duplicate_*`) e escala de orçamento.
//
// Sem banco: o prisma é mock e o cliente MCP é injetado. A Meta responde
// recusa com HTTP 200 — o teste simula exatamente isso (JSON com `error` ou
// `success: false`, sem `isError`) e exige que o método LANCE e que nada seja
// gravado no banco. O código antigo devolvia sucesso nesses casos.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/prisma.js', () => ({
  default: {
    campaign: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    adSet: { update: vi.fn() },
  },
}));

vi.mock('./crypto.service.js', () => ({ decrypt: (v: string) => v, encrypt: (v: string) => v }));

import prisma from '../lib/prisma.js';
import { MetaMCPService, emCentavos, requireOk } from './meta.mcp.service.js';

type CallTool = ReturnType<typeof vi.fn>;

function respostaTexto(valor: unknown) {
  return { content: [{ type: 'text', text: typeof valor === 'string' ? valor : JSON.stringify(valor) }] };
}

function servicoCom(callTool: CallTool): MetaMCPService {
  const svc = new MetaMCPService('user-1');
  // `connect()` exige token criptografado e Pipeboard de verdade; aqui o que
  // importa é o que o serviço faz com a RESPOSTA, então o cliente é injetado.
  Object.assign(svc as unknown as Record<string, unknown>, {
    client: { callTool },
    connected: true,
    accessToken: 'token-de-teste',
  });
  return svc;
}

const recusaComErro = respostaTexto({
  error: { message: 'Invalid parameter', code: 100, error_user_msg: 'Você não tem permissão para editar esta campanha.' },
});
const recusaSuccessFalse = respostaTexto({ success: false });
const ok = respostaTexto({ success: true });

beforeEach(() => {
  vi.mocked(prisma.campaign.findFirst).mockReset();
  vi.mocked(prisma.campaign.update).mockReset();
  vi.mocked(prisma.adSet.update).mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('requireOk — recusa da Meta com HTTP 200', () => {
  it('sucesso da Graph API passa: { success: true } e o true puro', () => {
    expect(requireOk({ success: true }, 'update_campaign')).toEqual({ success: true });
    expect(requireOk(true, 'update_campaign')).toBe(true);
  });

  it.each([
    ['updateCampaignStatus', (s: MetaMCPService) => s.updateCampaignStatus('c1', 'PAUSED')],
    ['updateCampaignBudget', (s: MetaMCPService) => s.updateCampaignBudget('c1', 50)],
    ['updateAdSetStatus', (s: MetaMCPService) => s.updateAdSetStatus('as1', 'PAUSED')],
    ['updateAdStatus', (s: MetaMCPService) => s.updateAdStatus('ad1', 'PAUSED')],
    ['updateAdSetBudget', (s: MetaMCPService) => s.updateAdSetBudget('as1', 30)],
    ['duplicateAdSet', (s: MetaMCPService) => s.duplicateAdSet('as1')],
  ])('%s lança quando a resposta traz `error`', async (_nome, chamar) => {
    const svc = servicoCom(vi.fn().mockResolvedValue(recusaComErro));
    await expect(chamar(svc)).rejects.toMatchObject({
      name: 'MetaToolResponseError',
      message: expect.stringContaining('Você não tem permissão para editar esta campanha.'),
    });
  });

  it.each([
    ['updateCampaignStatus', (s: MetaMCPService) => s.updateCampaignStatus('c1', 'PAUSED')],
    ['updateAdSetStatus', (s: MetaMCPService) => s.updateAdSetStatus('as1', 'ACTIVE')],
    ['updateAdStatus', (s: MetaMCPService) => s.updateAdStatus('ad1', 'ACTIVE')],
  ])('%s lança quando a resposta traz `success: false`', async (_nome, chamar) => {
    const svc = servicoCom(vi.fn().mockResolvedValue(recusaSuccessFalse));
    await expect(chamar(svc)).rejects.toMatchObject({ name: 'MetaToolResponseError' });
  });

  it('aceita `success: true`', async () => {
    const svc = servicoCom(vi.fn().mockResolvedValue(ok));
    await expect(svc.updateCampaignStatus('c1', 'PAUSED')).resolves.toBeUndefined();
  });

  it('recusa retorno que não é objeto', () => {
    expect(() => requireOk(null, 'update_campaign')).toThrow(/A Meta rejeitou a alteração da campanha/);
    expect(() => requireOk([], 'update_campaign')).toThrow(/A Meta rejeitou/);
  });

  it('duplicateAdSet devolve o ID da cópia mesmo em campo com outro nome', async () => {
    const svc = servicoCom(vi.fn().mockResolvedValue(respostaTexto({ success: true, new_adset_id: '999' })));
    await expect(svc.duplicateAdSet('as1')).resolves.toMatchObject({ id: '999' });
  });
});

describe('centavos inteiros', () => {
  it('19,99 vira 1999, não 1998.9999999999998', () => {
    expect(19.99 * 100).not.toBe(1999); // o defeito que justifica o arredondamento
    expect(emCentavos(19.99)).toBe(1999);
  });

  it('createAdSet manda daily_budget inteiro', async () => {
    const callTool = vi.fn().mockResolvedValue(respostaTexto({ id: '123' }));
    const svc = servicoCom(callTool);
    await svc.createAdSet({
      accountId: 'act_1', campaignId: 'c1', name: 'Conjunto', dailyBudget: 19.99,
      targeting: {}, optimizationGoal: 'LINK_CLICKS', billingEvent: 'IMPRESSIONS', status: 'PAUSED',
    } as Parameters<MetaMCPService['createAdSet']>[0]);
    expect(callTool.mock.calls[0][0].arguments.daily_budget).toBe(1999);
  });
});

describe('scaleCampaignBudget — escala nos CONJUNTOS, pelo orçamento diário', () => {
  it('SCALE_UP sobe o dailyBudget de cada conjunto e nunca manda o mensal como diário', async () => {
    // Campanha de R$ 600/MÊS com dois conjuntos de R$ 10 e R$ 19,99 por dia.
    vi.mocked(prisma.campaign.findFirst).mockResolvedValue({
      id: 'local-1',
      budget: 600,
      adSets: [
        { id: 'as-local-1', metaAdSetId: 'meta-as-1', dailyBudget: 10 },
        { id: 'as-local-2', metaAdSetId: 'meta-as-2', dailyBudget: 19.99 },
      ],
    } as never);
    const callTool = vi.fn().mockResolvedValue(ok);
    const svc = servicoCom(callTool);

    const resultado = await svc.scaleCampaignBudget('meta-c-1', 1.2);

    const chamadas = callTool.mock.calls.map(([c]) => ({ name: c.name, args: c.arguments }));
    // Nada de `update_campaign` com R$ 720/dia (600 × 1,2 × 100).
    expect(chamadas.some((c) => c.name === 'update_campaign')).toBe(false);
    expect(chamadas).toEqual([
      { name: 'update_ad_set', args: expect.objectContaining({ ad_set_id: 'meta-as-1', daily_budget: 1200 }) },
      { name: 'update_ad_set', args: expect.objectContaining({ ad_set_id: 'meta-as-2', daily_budget: 2399 }) },
    ]);
    expect(prisma.adSet.update).toHaveBeenCalledWith({ where: { id: 'as-local-1' }, data: { dailyBudget: 12 } });
    expect(prisma.adSet.update).toHaveBeenCalledWith({ where: { id: 'as-local-2' }, data: { dailyBudget: 23.99 } });
    expect(prisma.campaign.update).not.toHaveBeenCalled();
    expect(resultado).toMatchObject({ escalado: true });
  });

  it('não grava nada no banco quando a Meta recusa', async () => {
    vi.mocked(prisma.campaign.findFirst).mockResolvedValue({
      id: 'local-1',
      budget: 600,
      adSets: [{ id: 'as-local-1', metaAdSetId: 'meta-as-1', dailyBudget: 20 }],
    } as never);
    const svc = servicoCom(vi.fn().mockResolvedValue(recusaComErro));

    await expect(svc.scaleCampaignBudget('meta-c-1', 1.2)).rejects.toMatchObject({ name: 'MetaToolResponseError' });
    expect(prisma.adSet.update).not.toHaveBeenCalled();
    expect(prisma.campaign.update).not.toHaveBeenCalled();
  });

  it('campanha sem conjunto com orçamento conhecido (CBO/importada) NÃO escala e diz o motivo', async () => {
    vi.mocked(prisma.campaign.findFirst).mockResolvedValue({ id: 'local-1', budget: 600, adSets: [] } as never);
    const callTool = vi.fn().mockResolvedValue(ok);
    const svc = servicoCom(callTool);

    const resultado = await svc.scaleCampaignBudget('meta-c-1', 1.2);

    expect(resultado).toMatchObject({ escalado: false, motivo: expect.stringContaining('não foi alterado') });
    expect(callTool).not.toHaveBeenCalled();
    expect(prisma.campaign.update).not.toHaveBeenCalled();
  });

  it('SCALE_DOWN para no mínimo diário da Meta', async () => {
    vi.mocked(prisma.campaign.findFirst).mockResolvedValue({
      id: 'local-1',
      budget: 300,
      adSets: [{ id: 'as-local-1', metaAdSetId: 'meta-as-1', dailyBudget: 11 }],
    } as never);
    const callTool = vi.fn().mockResolvedValue(ok);
    const svc = servicoCom(callTool);

    await svc.scaleCampaignBudget('meta-c-1', 0.8);
    expect(callTool.mock.calls[0][0].arguments.daily_budget).toBe(1000);
  });
});
