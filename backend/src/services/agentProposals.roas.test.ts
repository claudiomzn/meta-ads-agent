// O agente noturno não pode propor "Pausar" campanha de lead por ROAS 0, e a
// execução da proposta só grava no banco depois que a Meta aceitou.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/prisma.js', () => ({
  default: {
    agentProposal: { findMany: vi.fn(), create: vi.fn() },
    campaign: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    adSet: { update: vi.fn() },
  },
}));

const svcMock = {
  updateCampaignStatus: vi.fn(),
  updateAdSetStatus: vi.fn(),
  disconnect: vi.fn().mockResolvedValue(undefined),
};
vi.mock('./meta.mcp.service.js', () => ({
  createMetaMCPService: vi.fn(async () => svcMock),
}));

import prisma from '../lib/prisma.js';
import { executeProposal, scanUser } from './agentProposals.service.js';

function campanha(over: Record<string, unknown>) {
  return {
    id: 'c1', name: 'Plano de saúde — leads', metaCampaignId: 'mc1', metaStatus: 'ACTIVE',
    metaSpend: 500, metaRoas: 0, adSets: [], ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.agentProposal.findMany).mockResolvedValue([]);
  vi.mocked(prisma.agentProposal.create).mockResolvedValue({} as never);
});

describe('scanUser — pause_low_roas', () => {
  it('NÃO propõe pausar campanha de lead (ROAS 0 = sem valor de conversão)', async () => {
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([
      campanha({ id: 'zero', metaRoas: 0 }),
      campanha({ id: 'nulo', metaRoas: null }),
    ] as never);

    expect(await scanUser('u1')).toBe(0);
    expect(prisma.agentProposal.create).not.toHaveBeenCalled();
  });

  it('continua propondo quando há valor de conversão e o retorno é baixo', async () => {
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([campanha({ id: 'loja', metaRoas: 0.3 })] as never);

    expect(await scanUser('u1')).toBe(1);
    expect(vi.mocked(prisma.agentProposal.create).mock.calls[0][0].data.type).toBe('pause_low_roas');
  });
});

describe('executeProposal', () => {
  const proposta = {
    id: 'p1', userId: 'u1', type: 'pause_low_roas',
    payload: JSON.stringify({ campaignId: 'c1', metaCampaignId: 'mc1', campaignName: 'Loja' }),
  };

  it('Meta recusou: lança e NÃO grava metaStatus PAUSED', async () => {
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue({ metaRoas: 0.3 } as never);
    const recusa = Object.assign(new Error('A Meta rejeitou a alteração da campanha: sem permissão'), {
      name: 'MetaToolResponseError',
    });
    svcMock.updateCampaignStatus.mockRejectedValueOnce(recusa);

    await expect(executeProposal(proposta)).rejects.toThrow(/A Meta rejeitou/);
    expect(prisma.campaign.update).not.toHaveBeenCalled();
    expect(svcMock.disconnect).toHaveBeenCalled();
  });

  it('proposta antiga numa campanha de lead não pausa nada', async () => {
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue({ metaRoas: 0 } as never);
    svcMock.updateCampaignStatus.mockResolvedValue(undefined);

    await expect(executeProposal(proposta)).rejects.toMatchObject({ name: 'PropostaObsoletaError' });
    expect(svcMock.updateCampaignStatus).not.toHaveBeenCalled();
    expect(prisma.campaign.update).not.toHaveBeenCalled();
  });

  it('Meta aceitou: pausa e grava', async () => {
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue({ metaRoas: 0.3 } as never);
    svcMock.updateCampaignStatus.mockResolvedValue(undefined);

    await executeProposal(proposta);
    expect(svcMock.updateCampaignStatus).toHaveBeenCalledWith('mc1', 'PAUSED');
    expect(prisma.campaign.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { metaStatus: 'PAUSED' } });
  });
});
