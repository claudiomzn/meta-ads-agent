// Quando o agente de otimização roda.
//
// Por que existe: o cron `0 5 * * *` quase nunca disparava — no Render Free o
// serviço dorme quando ninguém acessa e às 5h ele está dormindo (node-cron não
// recupera execução perdida). Decisão do dono: rodar o agente QUANDO o serviço
// acorda (no boot e no cron de hora em hora), sem custo extra, com uma trava de
// ~20h para não varrer todos os usuários a cada hora.
//
// É seguro rodar mais de uma vez: `scanUser` não duplica proposta — ele ignora
// o que já foi proposto (qualquer status) nos últimos 14 dias para o mesmo
// tipo + campanha/conjunto. A trava aqui é só para poupar leituras no banco.
//
// Onde fica a "última execução" (sem migration): o scan não grava nada quando
// não propõe nada, então a fonte é a MAIOR entre (a) a proposta mais recente
// no banco, que sobrevive a sono/restart, e (b) a memória do processo, que
// cobre o caso "rodou e não achou nada". Efeito aceito: depois de um restart
// sem proposta recente, o scan roda uma vez a mais — inofensivo (idempotente).

import prisma from '../lib/prisma.js';

export const INTERVALO_MINIMO_HORAS = 20;

let ultimaExecucaoEmMemoria: Date | null = null;
let emExecucao = false;

// Decisão pura: já passaram INTERVALO_MINIMO_HORAS desde a última execução?
// Sem execução conhecida = é hora.
export function horaDeRodarAgente(
  ultimaExecucao: Date | null | undefined,
  agora: Date = new Date(),
  intervaloHoras: number = INTERVALO_MINIMO_HORAS,
): boolean {
  if (!ultimaExecucao) return true;
  return agora.getTime() - ultimaExecucao.getTime() >= intervaloHoras * 60 * 60 * 1000;
}

async function ultimaExecucaoConhecida(): Promise<Date | null> {
  const ultimaProposta = await prisma.agentProposal.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  const candidatas = [ultimaProposta?.createdAt, ultimaExecucaoEmMemoria].filter((d): d is Date => !!d);
  if (!candidatas.length) return null;
  return new Date(Math.max(...candidatas.map((d) => d.getTime())));
}

// Roda o agente para todos os usuários conectados SE já for hora. Retorna
// quantas propostas foram criadas, ou null se pulou. Nunca lança.
export async function rodarAgenteSeForHora(origem: string, agora: Date = new Date()): Promise<number | null> {
  if (emExecucao) return null;
  emExecucao = true;
  try {
    if (!horaDeRodarAgente(await ultimaExecucaoConhecida(), agora)) return null;
    // Marca ANTES de varrer: boot + cron na mesma hora não rodam em duplicidade.
    ultimaExecucaoEmMemoria = agora;

    console.log(`[Agente] Analisando campanhas (${origem})...`);
    const connections = await prisma.mCPConnection.findMany({ where: { connected: true } });
    const { scanUser } = await import('./agentProposals.service.js');

    let total = 0;
    for (const conn of connections) {
      try {
        const created = await scanUser(conn.userId);
        total += created;
        if (created > 0) console.log(`[Agente] ${created} proposta(s) criada(s) para ${conn.userId}`);
      } catch (err) {
        // Só a mensagem: o erro cru já levou token de cliente ao log.
        console.error(`[Agente] Falha ao analisar ${conn.userId}:`, err instanceof Error ? err.message : 'erro desconhecido');
      }
    }
    return total;
  } catch (err) {
    console.error('[Agente] Falha na varredura:', err instanceof Error ? err.message : 'erro desconhecido');
    return null;
  } finally {
    emExecucao = false;
  }
}

// Só para teste.
export function _resetarEstadoDoAgente(): void {
  ultimaExecucaoEmMemoria = null;
  emExecucao = false;
}
