// O robô SÓ fala por roteiro (Luiz, 15/10/2026).
//
// Até aqui havia dois modos: o roteiro fixo e o "modo IA", em que a IA
// escrevia cada mensagem com as perguntas da config só como sugestão. O modo
// IA mandou mensagens fora de contexto a leads de verdade — e, em plano de
// saúde, uma IA solta pode prometer preço, cobertura ou carência que ninguém
// autorizou. Decisão do dono: a IA não fala com o lead, ponto.
//
// Este módulo decide QUAL roteiro vale para uma config:
//   1. o roteiro salvo (scriptSteps), se houver — `scriptEnabled` deixa de
//      importar: não existe mais outro modo para onde cair;
//   2. senão, as "Perguntas de qualificação" que o cliente escreveu para o
//      modo IA, convertidas para roteiro: cada pergunta vai literal, com o
//      campo deduzido do texto, e a pergunta de urgência é acrescentada se
//      faltar (sem ela todo lead sai FRIO e a conversão para de subir);
//   3. senão, roteiro vazio — o bot fica mudo (e a tela de ativação avisa).
//
// PURO: sem banco, sem IA. A tela do app faz a mesma conversão para mostrar
// o roteiro ao cliente revisar (src/pages/meta/roteiro.ts no google-ads-agent).

import { lerRoteiro, type CampoDoRoteiro, type PassoDoRoteiro } from './script.service.js';

export const PERGUNTA_DE_URGENCIA = 'Você pretende contratar nos próximos dias ou ainda está pesquisando?';
export const ENCERRAMENTO_PADRAO =
  'Obrigado! Já passei suas respostas para o nosso consultor, que vai te chamar por aqui em breve.';

export interface RoteiroEfetivo {
  intro: string | null;
  passos: PassoDoRoteiro[];
  encerramento: string | null;
  /** true = montado a partir das perguntas do antigo modo IA. */
  convertido: boolean;
}

function normalizar(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Ordem importa: "qual a idade de cada uma? (se empresa: quantos funcionários?)"
 *  é de idade, não de quantidade — por isso idade vem antes de vidas. */
const REGRAS: [CampoDoRoteiro, RegExp][] = [
  ['urgencia', /contratar|pesquisando|so pesquisa|quando (voce )?pretende|prazo|urgen/],
  ['idades', /idade/],
  ['vidas', /quantas (pessoas|vidas)|quantos (beneficiarios|dependentes|funcionarios)/],
  ['plano_atual', /(ja tem|possui|tem algum|tem hoje)[^?]*plano|plano (atual|hoje)/],
  ['tipo', /empresa|cnpj|\bmei\b|famil|pessoa fisica|para voce/],
];

/** PURO. Qual campo uma pergunta coleta — null quando o texto não diz. */
export function campoDaPergunta(pergunta: string): CampoDoRoteiro | null {
  const t = normalizar(pergunta);
  for (const [campo, re] of REGRAS) if (re.test(t)) return campo;
  return null;
}

/**
 * PURO. Converte as perguntas do antigo modo IA em roteiro.
 *
 * Linhas do começo SEM "?" são apresentação ("Olá, meu nome é Daniele…") e vão
 * juntas na 1ª mensagem. Daí em diante, cada linha é uma pergunta, literal.
 * Cada campo é coletado uma vez só: a segunda pergunta do mesmo tipo vai sem
 * campo (o vendedor lê a resposta no resumo).
 */
export function roteiroDasPerguntas(perguntas: unknown): { intro: string | null; passos: PassoDoRoteiro[] } {
  const linhas = (Array.isArray(perguntas) ? perguntas : [])
    .filter((q): q is string => typeof q === 'string')
    .flatMap((q) => q.split('\n'))
    .map((q) => q.trim())
    .filter(Boolean);

  const intro: string[] = [];
  let i = 0;
  while (i < linhas.length && !linhas[i].includes('?')) intro.push(linhas[i++]);

  const usados = new Set<CampoDoRoteiro>();
  const passos: PassoDoRoteiro[] = linhas.slice(i).map((pergunta) => {
    const campo = campoDaPergunta(pergunta);
    if (!campo || usados.has(campo)) return { pergunta, campo: null };
    usados.add(campo);
    return { pergunta, campo };
  });
  // Só apresentação e nenhuma pergunta: não há roteiro (apresentar e calar
  // seria pior do que não responder).
  if (!passos.length) return { intro: null, passos: [] };
  if (!usados.has('urgencia')) passos.push({ pergunta: PERGUNTA_DE_URGENCIA, campo: 'urgencia' });
  return { intro: intro.length ? intro.join(' ') : null, passos };
}

/** PURO. O roteiro que o robô segue para esta config. */
export function roteiroEfetivo(config: {
  scriptSteps: unknown;
  scriptIntro: string | null;
  scriptClosing: string | null;
  questions: unknown;
}): RoteiroEfetivo {
  const salvo = lerRoteiro(config.scriptSteps);
  if (salvo.length) {
    return {
      intro: config.scriptIntro?.trim() || null,
      passos: salvo,
      encerramento: config.scriptClosing?.trim() || null,
      convertido: false,
    };
  }
  const { intro, passos } = roteiroDasPerguntas(config.questions);
  if (!passos.length) return { intro: null, passos: [], encerramento: null, convertido: false };
  return {
    intro: config.scriptIntro?.trim() || intro,
    passos,
    // Quem vinha do modo IA nunca escreveu encerramento: sem ele o lead
    // responderia a última pergunta e ficaria sem retorno nenhum.
    encerramento: config.scriptClosing?.trim() || ENCERRAMENTO_PADRAO,
    convertido: true,
  };
}
