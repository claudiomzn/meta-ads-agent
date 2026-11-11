// Defeito corrigido: o try/catch do cron de automações ficava só por REGRA. Um
// usuário cujo `createMetaMCPService` lança (token inválido) abortava o loop e
// os usuários seguintes nunca rodavam; e o `disconnect` não rodava em erro.
// O teste do 2º usuário reprova a lógica antiga (sem try/catch por usuário).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockConexoes = vi.fn();
const mockRegras = vi.fn();
const mockUpdate = vi.fn().mockResolvedValue({});
vi.mock('../lib/prisma.js', () => ({
  default: {
    mCPConnection: { findMany: (...a: unknown[]) => mockConexoes(...a) },
    automationRule: { findMany: (...a: unknown[]) => mockRegras(...a), update: (...a: unknown[]) => mockUpdate(...a) },
    ruleLog: { create: vi.fn().mockResolvedValue({}) },
  },
}));
vi.mock('../lib/ownership.js', () => ({ targetBelongsToUser: vi.fn().mockResolvedValue(true) }));

const mockCreate = vi.fn();
vi.mock('../services/meta.mcp.service.js', () => ({
  createMetaMCPService: (...a: unknown[]) => mockCreate(...a),
}));

import { executarAutomacoesDeTodos } from '../services/automacoes.cron.js';

const regra = (userId: string) => ({
  id: `r-${userId}`, userId, name: 'Regra', active: true, targetType: 'campaign', targetId: 'c1',
  trigger: 'spend', condition: 'gt', value: 100, window: 3, action: 'PAUSE',
  lastTriggeredAt: null, lastChecked: null,
});

describe('executarAutomacoesDeTodos — isolamento por usuário', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockConexoes.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]);
    mockRegras.mockImplementation(async ({ where }: { where: { userId: string } }) => [regra(where.userId)]);
  });

  it('⭐ o 1º usuário falha ao abrir o serviço Meta e o 2º ainda executa', async () => {
    const insights = vi.fn().mockResolvedValue({ spend: 500 });
    const pausa = vi.fn().mockResolvedValue(undefined);
    const disconnect = vi.fn().mockResolvedValue(undefined);
    mockCreate.mockImplementation(async (userId: string) => {
      if (userId === 'u1') throw new Error('token inválido');
      return { getCampaignInsights: insights, updateCampaignStatus: pausa, disconnect };
    });

    await expect(executarAutomacoesDeTodos()).resolves.toBeUndefined();

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(pausa).toHaveBeenCalledWith('c1', 'PAUSED');
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('a falha é logada só com a mensagem, nunca com o erro cru', async () => {
    const erro = Object.assign(new Error('token inválido'), { config: { params: { access_token: 'SEGREDO' } } });
    mockCreate.mockRejectedValue(erro);
    await executarAutomacoesDeTodos();
    const args = vi.mocked(console.error).mock.calls.flat();
    expect(args).toContain('token inválido');
    expect(args).not.toContain(erro);
  });

  it('desconecta o serviço ao terminar o usuário', async () => {
    const disconnect = vi.fn().mockResolvedValue(undefined);
    mockConexoes.mockResolvedValue([{ userId: 'u1' }]);
    mockCreate.mockResolvedValue({
      getCampaignInsights: vi.fn().mockResolvedValue({ spend: 1 }), updateCampaignStatus: vi.fn(), disconnect,
    });
    await executarAutomacoesDeTodos();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('falha ao listar as regras de um usuário também não derruba os seguintes', async () => {
    const disconnect = vi.fn().mockResolvedValue(undefined);
    mockRegras.mockImplementation(async ({ where }: { where: { userId: string } }) => {
      if (where.userId === 'u1') throw new Error('banco indisponível');
      return [regra('u2')];
    });
    mockCreate.mockResolvedValue({
      getCampaignInsights: vi.fn().mockResolvedValue({ spend: 500 }), updateCampaignStatus: vi.fn(), disconnect,
    });
    await executarAutomacoesDeTodos();
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
