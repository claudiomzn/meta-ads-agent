// Regras puras do desfecho do lead (12/10/2026) — ver services/whatsapp/resultado.ts.
//
// Estes testes existem porque é AQUI que se decide o valor de uma venda real e
// a qual lead ela pertence. Interpretação torta grava receita errada em
// closed_sales e sobe conversão no clique errado.
import { describe, it, expect } from 'vitest';
import {
  categorizarMotivo,
  comoChamarOLead,
  dentroDoAtendimento,
  escolherEntreCandidatos,
  escolherLead,
  interpretarRespostaDoVendedor,
  janelaDeAtendimento,
  JANELA_PADRAO,
  lembreteDevido,
  lerValorEmCentavos,
  reais,
  telefoneDoAvisoCitado,
  type LeadAberto,
} from '../services/whatsapp/resultado.js';
import { detalheDoResumo, textoDoLembrete } from '../services/whatsapp/resultado.service.js';
import { hojeEmManaus } from '../services/whatsapp/venda.externa.js';
import { idDoEventoDaVenda } from '../services/whatsapp/venda.id.js';

describe('valor da venda, como brasileiro escreve', () => {
  it.each([
    ['fechou 1200', 120000],
    ['fechou 1.200,00', 120000],
    ['fechou R$ 1.200', 120000],
    ['fechou 1200,50', 120050],
    ['fechou 1200.50', 120050],
    ['fechou 1200,5', 120050],
    ['fechou 980', 98000],
    ['fechou 120.000', 12000000],
  ])('%s → %d centavos', (texto, cents) => {
    expect(lerValorEmCentavos(texto)).toBe(cents);
  });

  it('⭐ sem número nenhum não inventa valor', () => {
    expect(lerValorEmCentavos('fechou')).toBeNull();
    expect(lerValorEmCentavos('fechou com o joão')).toBeNull();
  });

  it('⭐ zero e valor absurdo são recusados (venda sem valor não ensina nada ao lance)', () => {
    expect(lerValorEmCentavos('fechou 0')).toBeNull();
    expect(lerValorEmCentavos('fechou 0,00')).toBeNull();
    expect(lerValorEmCentavos('fechou 99999999')).toBeNull();
    expect(lerValorEmCentavos('fechou 1.200.000')).toBeNull(); // acima do teto de sanidade
  });

  it('formata em reais para o aviso', () => {
    expect(reais(120000)).toBe('1.200,00');
    expect(reais(98050)).toBe('980,50');
  });
});

describe('o que o vendedor quis dizer', () => {
  it('⭐ venda com valor', () => {
    expect(interpretarRespostaDoVendedor('fechou 1.200,00')).toMatchObject({ resultado: 'venda', valorCents: 120000 });
    expect(interpretarRespostaDoVendedor('vendi 980 pro joão')).toMatchObject({ resultado: 'venda', valorCents: 98000 });
  });

  it('⭐ venda SEM valor não vira venda de valor zero — fica sem valor para o bot perguntar', () => {
    const r = interpretarRespostaDoVendedor('fechou');
    expect(r).toMatchObject({ resultado: 'venda' });
    expect(r?.valorCents).toBeUndefined();
  });

  it('⭐ "nao fechou" é PERDA, não venda (a ordem de leitura importa)', () => {
    expect(interpretarRespostaDoVendedor('nao fechou')).toMatchObject({ resultado: 'perdido' });
    expect(interpretarRespostaDoVendedor('não fechou, achou caro')).toMatchObject({ resultado: 'perdido', motivo: 'preco' });
  });

  it('perda com motivo, nas categorias simples', () => {
    expect(interpretarRespostaDoVendedor('perdeu preço')).toMatchObject({ resultado: 'perdido', motivo: 'preco' });
    expect(interpretarRespostaDoVendedor('perdeu já tem plano')).toMatchObject({ resultado: 'perdido', motivo: 'ja_tem_plano' });
    expect(interpretarRespostaDoVendedor('perdeu carência')).toMatchObject({ resultado: 'perdido', motivo: 'carencia' });
    expect(interpretarRespostaDoVendedor('perdeu, não respondeu mais')).toMatchObject({ resultado: 'perdido', motivo: 'nao_respondeu' });
    expect(interpretarRespostaDoVendedor('perdeu mudou de cidade')).toMatchObject({ resultado: 'perdido', motivo: 'outro' });
  });

  it('guarda o texto cru do motivo (categoria "outro" sem contexto não serve ao agente)', () => {
    expect(interpretarRespostaDoVendedor('perdeu mudou de cidade')?.motivoTexto).toBe('perdeu mudou de cidade');
  });

  it('em negociação', () => {
    expect(interpretarRespostaDoVendedor('em negociação')).toMatchObject({ resultado: 'negociando' });
    expect(interpretarRespostaDoVendedor('negociando ainda')).toMatchObject({ resultado: 'negociando' });
  });

  it('⭐ conversa do vendedor que NÃO é desfecho não registra nada', () => {
    expect(interpretarRespostaDoVendedor('bom dia')).toBeNull();
    expect(interpretarRespostaDoVendedor('me manda o número dele?')).toBeNull();
    expect(interpretarRespostaDoVendedor('')).toBeNull();
  });

  it('⭐ mensagem longa é recusada: "fechou" numa frase sobre outro assunto não é venda', () => {
    const longa = 'o escritório fechou mais cedo hoje porque teve aquele problema no ar condicionado '
      + 'e o pessoal todo saiu antes, amanhã a gente retoma aquele assunto que você me falou ontem ok';
    expect(longa.length).toBeGreaterThan(160);
    expect(interpretarRespostaDoVendedor(longa)).toBeNull();
  });

  it('motivo sem frase conhecida cai em "outro", nunca numa categoria chutada', () => {
    expect(categorizarMotivo('sei lá')).toBe('outro');
    expect(categorizarMotivo('')).toBe('outro');
  });
});

describe('a qual lead a resposta se refere', () => {
  const lead = (id: string, phone: string, nome: string | null): LeadAberto =>
    ({ id, leadPhone: phone, nome, handoffEm: new Date('2026-10-10T12:00:00Z') });

  const joao = lead('c1', '559291111001', 'João Silva');
  const maria = lead('c2', '559291111002', 'Maria Souza');

  it('lê o telefone do nosso próprio aviso citado', () => {
    expect(telefoneDoAvisoCitado('🔔 Novo lead qualificado!\nContato: 559291111002\nTipo: Empresa'))
      .toBe('559291111002');
    expect(telefoneDoAvisoCitado(null)).toBeNull();
    expect(telefoneDoAvisoCitado('qualquer outra mensagem')).toBeNull();
  });

  it('⭐ citação do WhatsApp decide, mesmo com vários leads abertos', () => {
    const r = escolherLead({ citacao: '🔔 Novo lead qualificado!\nContato: 559291111002', abertos: [joao, maria] });
    expect(r.lead?.id).toBe('c2');
  });

  it('⭐ com UM lead aberto, é ele (o caso comum do vendedor com um lead por vez)', () => {
    expect(escolherLead({ abertos: [joao] }).lead?.id).toBe('c1');
  });

  it('nome escrito na resposta desempata', () => {
    expect(escolherLead({ pista: 'joao', abertos: [joao, maria] }).lead?.id).toBe('c1');
  });

  it('telefone escrito na resposta desempata (com ou sem 55/9º dígito)', () => {
    expect(escolherLead({ pista: '9291111002', abertos: [joao, maria] }).lead?.id).toBe('c2');
  });

  it('⭐ NUNCA chuta: dois leads abertos e nada que desempate → pergunta de volta', () => {
    const r = escolherLead({ pista: '', abertos: [joao, maria] });
    expect(r.lead).toBeUndefined();
    expect(r.candidatos?.map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('⭐ nome que casa com DOIS leads também é dúvida, não escolha', () => {
    const outraMaria = lead('c3', '559291111003', 'Maria Lima');
    const r = escolherLead({ pista: 'maria', abertos: [maria, outraMaria] });
    expect(r.lead).toBeUndefined();
    expect(r.candidatos).toHaveLength(2);
  });

  it('sem lead aberto nenhum, não há o que escolher', () => {
    expect(escolherLead({ abertos: [] })).toEqual({});
  });

  it('resposta à pergunta "qual deles?": número da lista, nome ou telefone', () => {
    expect(escolherEntreCandidatos('2', [joao, maria])?.id).toBe('c2');
    expect(escolherEntreCandidatos('maria', [joao, maria])?.id).toBe('c2');
    expect(escolherEntreCandidatos('9291111001', [joao, maria])?.id).toBe('c1');
  });

  it('⭐ "fechou 1200" não seleciona o candidato 1200 (número só vale sozinho)', () => {
    expect(escolherEntreCandidatos('fechou 1200', [joao, maria])).toBeNull();
    expect(escolherEntreCandidatos('sei lá', [joao, maria])).toBeNull();
  });

  it('como o lead é chamado: nome quando tem, últimos 4 dígitos quando não', () => {
    expect(comoChamarOLead(joao)).toBe('João Silva');
    expect(comoChamarOLead({ nome: null, leadPhone: '559291111001' })).toBe('lead …1001');
  });
});

describe('lembrete nos dias 2, 5 e 10', () => {
  const base = {
    state: 'handoff', label: 'QUENTE' as string | null, resultado: null as string | null,
    handoffEm: new Date('2026-10-01T13:00:00Z'), lembretesEnviados: 0,
  };
  const dias = (n: number) => new Date(base.handoffEm.getTime() + n * 24 * 3600 * 1000);

  it('⭐ 1º no dia 2, 2º no dia 5, 3º no dia 10 — e nada depois', () => {
    expect(lembreteDevido({ ...base }, dias(1))).toBeNull();
    expect(lembreteDevido({ ...base }, dias(2))).toBe(1);
    expect(lembreteDevido({ ...base, lembretesEnviados: 1 }, dias(3))).toBeNull();
    expect(lembreteDevido({ ...base, lembretesEnviados: 1 }, dias(5))).toBe(2);
    expect(lembreteDevido({ ...base, lembretesEnviados: 2 }, dias(10))).toBe(3);
    expect(lembreteDevido({ ...base, lembretesEnviados: 3 }, dias(30))).toBeNull();
  });

  it('⭐ para quando houver desfecho', () => {
    expect(lembreteDevido({ ...base, resultado: 'venda' }, dias(10))).toBeNull();
    expect(lembreteDevido({ ...base, resultado: 'perdido' }, dias(10))).toBeNull();
  });

  it('⭐ "em negociação" NÃO é desfecho: segue elegível (o relógio é rezerado por quem grava)', () => {
    expect(lembreteDevido({ ...base, resultado: 'negociando' }, dias(2))).toBe(1);
  });

  it('só lead QUENTE já entregue ao vendedor', () => {
    expect(lembreteDevido({ ...base, label: 'FRIO' }, dias(10))).toBeNull();
    expect(lembreteDevido({ ...base, state: 'qualifying' }, dias(10))).toBeNull();
    expect(lembreteDevido({ ...base, handoffEm: null }, dias(10))).toBeNull();
  });

  it('texto diz quem é e pede as três palavras que o bot entende de volta', () => {
    const texto = textoDoLembrete({
      nome: 'João Silva', leadPhone: '559291111001',
      resumo: 'Tipo: Empresa (CNPJ)\nPessoas: 3\nIntenção: quer contratar nos próximos dias',
    });
    expect(texto).toBe('Lead João Silva (empresa, 3 vidas) segue em aberto. Fechou, perdeu ou em negociação?');
  });

  it('resumo sem dado utilizável não inventa parênteses', () => {
    expect(detalheDoResumo(null)).toBe('');
    expect(detalheDoResumo('Idades: não respondeu')).toBe('');
    expect(detalheDoResumo('Tipo: Pessoa física/família')).toBe(' (pessoa física)');
  });
});

describe('horário de atendimento (texto livre da config)', () => {
  it('lê o que o cliente escreveu', () => {
    expect(janelaDeAtendimento('Seg a Sex, 8h às 18h')).toEqual({ inicio: 8, fim: 18, dias: [1, 2, 3, 4, 5] });
    expect(janelaDeAtendimento('segunda a sábado, 08:00-19:00')).toEqual({ inicio: 8, fim: 19, dias: [1, 2, 3, 4, 5, 6] });
    expect(janelaDeAtendimento('todos os dias, das 7 as 22')).toEqual({ inicio: 7, fim: 22, dias: [0, 1, 2, 3, 4, 5, 6] });
  });

  it('⭐ o que não dá para ler cai na janela PADRÃO, nunca numa mais larga', () => {
    expect(janelaDeAtendimento(null)).toEqual(JANELA_PADRAO);
    expect(janelaDeAtendimento('quando der')).toEqual(JANELA_PADRAO);
    expect(janelaDeAtendimento('das 18 as 8')).toEqual(JANELA_PADRAO); // invertido: não é janela
  });

  it('⭐ decide pelo fuso de Manaus (UTC-4), não pelo UTC do servidor', () => {
    // 2026-10-13 é segunda. 11:00 UTC = 7h em Manaus → fora de 8h-18h.
    expect(dentroDoAtendimento('Seg a Sex, 8h às 18h', new Date('2026-10-13T11:00:00Z'))).toBe(false);
    // 13:00 UTC = 9h em Manaus → dentro.
    expect(dentroDoAtendimento('Seg a Sex, 8h às 18h', new Date('2026-10-13T13:00:00Z'))).toBe(true);
    // 23:00 UTC de segunda = 19h em Manaus → fora.
    expect(dentroDoAtendimento('Seg a Sex, 8h às 18h', new Date('2026-10-13T23:00:00Z'))).toBe(false);
  });

  it('⭐ domingo fica de fora quando a config diz seg a sex/sáb', () => {
    // 2026-10-18 é domingo.
    expect(dentroDoAtendimento('Seg a Sex, 8h às 18h', new Date('2026-10-18T15:00:00Z'))).toBe(false);
  });
});

describe('a venda que sai daqui é a MESMA da tela de Vendas', () => {
  it('event_id/transactionId no formato que a tela já usa', () => {
    expect(idDoEventoDaVenda('abc-123')).toBe('venda_abc-123');
  });

  it('⭐ closed_at é a data de MANAUS: venda da noite não cai no dia seguinte', () => {
    // 2026-10-13T02:00:00Z é ainda dia 12 em Manaus (22h).
    expect(hojeEmManaus(new Date('2026-10-13T02:00:00Z'))).toBe('2026-10-12');
    expect(hojeEmManaus(new Date('2026-10-13T13:00:00Z'))).toBe('2026-10-13');
  });
});
