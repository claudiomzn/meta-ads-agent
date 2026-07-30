import Anthropic from '@anthropic-ai/sdk';

export const META_CONNECTION_STAGES = [
  'prerequisites',
  'portfolio_id',
  'account_id',
  'partner_access',
  'review',
  'submitted',
] as const;

export type MetaConnectionStage = typeof META_CONNECTION_STAGES[number];

export interface ConnectionAssistantMessage {
  role: 'user' | 'assistant';
  content: string;
}

const STAGE_CONTEXT: Record<MetaConnectionStage, string> = {
  prerequisites:
    'Confirmar que a pessoa é administradora do Portfólio Empresarial e tem acesso à conta de anúncios.',
  portfolio_id:
    'Encontrar o ID do Portfólio empresarial nas informações do negócio.',
  account_id:
    'Encontrar o ID da conta em Configurações do negócio > Contas > Contas de anúncios.',
  partner_access:
    'Adicionar o AdsGenius como parceiro pelo ID empresarial informado na tela e compartilhar somente a conta escolhida.',
  review:
    'Revisar o Portfólio, a conta e confirmar que o acesso do parceiro foi concedido.',
  submitted:
    'Explicar o status da solicitação e o que acontece enquanto a equipe conclui a conexão.',
};

// Tokens Meta normalmente começam com EAA. A segunda regra bloqueia sequências
// longas típicas de credenciais mesmo que o prefixo mude no futuro.
const META_TOKEN_PATTERN = /\bEAA[A-Za-z0-9_-]{20,}\b/i;
const LONG_SECRET_PATTERN = /\b[A-Za-z0-9_-]{80,}\b/;

export function containsLikelySecret(value: string): boolean {
  return META_TOKEN_PATTERN.test(value) || LONG_SECRET_PATTERN.test(value);
}

function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('AI_UNAVAILABLE');
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

export async function answerMetaConnectionQuestion(params: {
  stage: MetaConnectionStage;
  message: string;
  history: ConnectionAssistantMessage[];
  partnerBusinessId?: string;
  verificationState?: 'not_submitted' | 'waiting' | 'verified' | 'needs_adjustment';
}): Promise<string> {
  if (containsLikelySecret(params.message)) throw new Error('SECRET_NOT_ALLOWED');
  if (params.history.some((item) => containsLikelySecret(item.content))) {
    throw new Error('SECRET_NOT_ALLOWED');
  }

  const system = `Você é o Agente de Conexão Meta do AdsGenius.
Sua única função é diagnosticar, em português brasileiro simples, dúvidas sobre a etapa fixa de conexão Meta exibida pelo AdsGenius.

Regras obrigatórias:
- Responda em no máximo 120 palavras, com passos curtos.
- As instruções fixas exibidas na tela são a fonte de verdade. Não invente outro caminho, menu ou nome de botão.
- Você pode repetir ou esclarecer apenas o objetivo da etapa atual. Se a interface for diferente, peça que a pessoa descreva o que vê, sem adivinhar.
- Nunca peça, repita, processe ou aceite token, senha, chave, código de autenticação ou segredo no chat.
- O cliente NÃO deve criar usuário do sistema, aplicativo nem token. A equipe AdsGenius conclui essa parte internamente.
- Oriente apenas a localizar o ID do Portfólio, localizar o ID da conta e adicionar o AdsGenius como parceiro empresarial.
- Ao adicionar o parceiro, oriente a compartilhar somente a conta de anúncios escolhida com permissão para ver desempenho e gerenciar campanhas.
- O ID empresarial do parceiro AdsGenius é: ${params.partnerBusinessId || 'ainda não configurado'}. Se estiver indisponível, diga para aguardar a configuração do AdsGenius; não invente um número.
- Resultado real da verificação: ${params.verificationState || 'not_submitted'}.
- Se estiver "verified", diga que o acesso já foi confirmado automaticamente e que não é necessário refazer os passos.
- Se estiver "waiting", diga que o AdsGenius ainda não enxerga a conta e sugira conferir se a conta de anúncios, e não apenas o portfólio, foi compartilhada.
- Nunca diga que a autorização funcionou baseado apenas na afirmação do cliente.
- Não afirme que você clicou, criou ou validou algo na Meta.
- Não responda perguntas sobre campanhas, marketing ou outros assuntos.
- A interface da Meta pode variar. Use os nomes "Configurações do negócio", "Portfólio empresarial", "Parceiros" e "Contas de anúncios", avisando que o nome pode variar.

Etapa atual: ${params.stage}
Objetivo desta etapa: ${STAGE_CONTEXT[params.stage]}`;

  const response = await getClient().messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 350,
    system,
    messages: [
      ...params.history.slice(-8).map((item) => ({
        role: item.role,
        content: item.content,
      })),
      { role: 'user' as const, content: params.message },
    ],
  });

  const text = response.content.find((item) => item.type === 'text');
  const answer = text?.type === 'text' ? text.text.trim() : '';
  if (containsLikelySecret(answer)) {
    return 'Por segurança, não vou exibir códigos no chat. Você só precisa informar os IDs numéricos pedidos na tela.';
  }
  return answer || 'Não consegui responder agora. Continue pelo passo mostrado na tela.';
}
