// Agente de otimização no Render Free: roda quando o serviço acorda, no máximo
// 1x a cada ~20h. Cobre a decisão pura e a orquestração (sem banco real).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUltima = vi.fn();
const mockConexoes = vi.fn();
vi.mock('../lib/prisma.js', () => ({
  default: {
    agentProposal: { findFirst: (...a: unknown[]) => mockUltima(...a) },
    mCPConnection: { findMany: (...a: unknown[]) => mockConexoes(...a) },
  },
}));
const mockScan = vi.fn();
vi.mock('../services/agentProposals.service.js', () => ({ scanUser: (...a: unknown[]) => mockScan(...a) }));

import {
  horaDeRodarAgente, rodarAgenteSeForHora, _resetarEstadoDoAgente, INTERVALO_MINIMO_HORAS,
} from '../services/agenteScan.cron.js';

const H = 60 * 60 * 1000;
const agora = new Date('2026-11-11T12:00:00Z');
const haHoras = (n: number) => new Date(agora.getTime() - n * H);

describe('horaDeRodarAgente (decisão pura)', () => {
  it('sem execução conhecida: é hora', () => expect(horaDeRodarAgente(null, agora)).toBe(true));
  it('19h atrás: ainda não', () => expect(horaDeRodarAgente(haHoras(19), agora)).toBe(false));
  it('exatamente 20h: é hora', () => expect(horaDeRodarAgente(haHoras(INTERVALO_MINIMO_HORAS), agora)).toBe(true));
  it('25h atrás: é hora', () => expect(horaDeRodarAgente(haHoras(25), agora)).toBe(true));
});

describe('rodarAgenteSeForHora', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetarEstadoDoAgente();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockConexoes.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]);
    mockScan.mockResolvedValue(1);
  });

  it('pula quando a última proposta no banco é recente (sobrevive a restart)', async () => {
    mockUltima.mockResolvedValue({ createdAt: haHoras(3) });
    expect(await rodarAgenteSeForHora('teste', agora)).toBeNull();
    expect(mockScan).not.toHaveBeenCalled();
  });

  it('roda quando a última proposta tem mais de 20h e varre todos', async () => {
    mockUltima.mockResolvedValue({ createdAt: haHoras(30) });
    expect(await rodarAgenteSeForHora('teste', agora)).toBe(2);
    expect(mockScan).toHaveBeenCalledTimes(2);
  });

  it('roda uma vez só: a 2ª chamada logo depois pula (mesmo sem proposta nova)', async () => {
    mockUltima.mockResolvedValue(null);
    mockScan.mockResolvedValue(0);
    expect(await rodarAgenteSeForHora('boot', agora)).toBe(0);
    expect(await rodarAgenteSeForHora('cron', new Date(agora.getTime() + H))).toBeNull();
    expect(mockScan).toHaveBeenCalledTimes(2); // 2 usuários da 1ª, nenhum da 2ª
  });

  it('falha de um usuário não impede os seguintes e o log só leva a mensagem', async () => {
    mockUltima.mockResolvedValue(null);
    const erro = new Error('falhou');
    mockScan.mockRejectedValueOnce(erro).mockResolvedValueOnce(2);
    expect(await rodarAgenteSeForHora('teste', agora)).toBe(2);
    expect(vi.mocked(console.error).mock.calls.flat()).not.toContain(erro);
  });
});
