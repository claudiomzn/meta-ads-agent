// Ativação do WhatsApp leads (06/10/2026) — em que pé está o robô deste
// cliente, para o "Primeiros passos" do app mostrar o próximo passo e, quando
// algo impede o resultado, O MOTIVO (nunca só "pendente").
//
// A regra mora aqui, no servidor, e o app só exibe: duas cópias da mesma
// regra (tela e backend) divergem em silêncio — foi o que deixou o texto do
// gatilho na tela dizendo uma coisa e o robô fazendo outra.
import { lerRoteiro } from './script.service.js';
import { parseTriggerKeywords } from './whatsapp.service.js';

export type ChaveDoPasso = 'whatsapp' | 'roteiro' | 'simulador' | 'primeiro_quente';

export interface PassoDeAtivacao {
  chave: ChaveDoPasso;
  ok: boolean;
  /** Por que não está ok — em linguagem de cliente. null quando ok. */
  motivo: string | null;
  /** Não impede o passo, mas o cliente precisa saber. */
  aviso: string | null;
  /** Quando aconteceu (ensaio concluído, 1º QUENTE). */
  em: string | null;
}

export interface EntradaDaAtivacao {
  config: {
    enabled: boolean;
    handoffContact: string | null;
    triggerKeyword: string | null;
    scriptEnabled: boolean;
    scriptSteps: unknown;
    questions: unknown;
  } | null;
  /** Estado da conexão: 'open' = conectado; null = transporte sem consulta. */
  conexao: { estado: string; erro?: string | null } | null;
  ensaioConcluidoEm: Date | null;
  primeiroQuenteEm: Date | null;
}

/** PURO. Avalia os quatro passos do caminho WhatsApp. */
export function avaliarAtivacaoWhatsapp(e: EntradaDaAtivacao): PassoDeAtivacao[] {
  const passo = (chave: ChaveDoPasso, ok: boolean, motivo: string | null, aviso: string | null = null, em: Date | null = null): PassoDeAtivacao =>
    ({ chave, ok, motivo: ok ? null : motivo, aviso, em: em ? em.toISOString() : null });

  // 1) WhatsApp conectado
  const conectado = e.conexao?.estado === 'open';
  const motivoConexao = !e.conexao
    ? 'Conecte o WhatsApp do seu número na tela do robô (leitura do QR code).'
    : e.conexao.estado === 'error'
      ? 'Não deu para confirmar a conexão do WhatsApp agora. Abra a tela do robô e confira se ele está conectado.'
      : 'O WhatsApp está desconectado. Abra a tela do robô e leia o QR code de novo.';

  // 2) Roteiro / configuração que faz o lead virar QUENTE
  const c = e.config;
  let roteiroOk = false;
  let motivoRoteiro: string | null = null;
  let avisoRoteiro: string | null = null;
  if (!c) {
    motivoRoteiro = 'O robô ainda não foi configurado.';
  } else if (!c.enabled) {
    motivoRoteiro = 'O robô está desligado. Marque "Ativo" na tela do robô.';
  } else if (!c.handoffContact?.trim()) {
    motivoRoteiro = 'Falta o WhatsApp do vendedor: sem ele ninguém é avisado quando o lead termina o atendimento.';
  } else if (c.scriptEnabled) {
    const passos = lerRoteiro(c.scriptSteps);
    if (!passos.length) {
      motivoRoteiro = 'O roteiro fixo está ligado, mas sem perguntas: o robô fica mudo.';
    } else if (!passos.some((p) => p.campo === 'urgencia')) {
      // Ver CLAUDE.md: roteiro sem `urgencia` marca todo lead como FRIO e para
      // de reportar conversão, em silêncio.
      motivoRoteiro = 'O roteiro não tem a pergunta de urgência ("pretende contratar nos próximos dias?"). Sem ela nenhum lead vira QUENTE e a conversão não sobe ao Google nem à Meta.';
    } else {
      roteiroOk = true;
    }
  } else {
    const perguntas = Array.isArray(c.questions) ? c.questions.filter((q) => typeof q === 'string' && q.trim()) : [];
    roteiroOk = perguntas.length > 0;
    motivoRoteiro = 'O robô não tem perguntas de qualificação.';
    avisoRoteiro = 'O robô está no modo IA, que escreve as próprias mensagens. O roteiro fixo manda as suas perguntas palavra por palavra e é o recomendado.';
  }
  if (c && !parseTriggerKeywords(c.triggerKeyword ?? '').length) {
    const semGatilho = 'Sem palavra-gatilho, o robô só atende quem clica em anúncio da Meta ou vem do seu site com o código "(ref. …)". Lead de outro site ou de anúncio do Google sem o código não é atendido.';
    avisoRoteiro = avisoRoteiro ? `${avisoRoteiro} ${semGatilho}` : semGatilho;
  }

  return [
    passo('whatsapp', conectado, motivoConexao),
    passo('roteiro', roteiroOk, motivoRoteiro, avisoRoteiro),
    passo('simulador', Boolean(e.ensaioConcluidoEm),
      'Faça uma conversa de teste no simulador da tela do robô, até o fim. Nada é enviado a ninguém.', null, e.ensaioConcluidoEm),
    passo('primeiro_quente', Boolean(e.primeiroQuenteEm),
      'Ainda nenhum lead QUENTE. Ele aparece quando alguém do anúncio responde o roteiro dizendo que quer contratar.', null, e.primeiroQuenteEm),
  ];
}
