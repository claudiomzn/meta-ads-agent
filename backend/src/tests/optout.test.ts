// "Pare de mandar isso" tem que encerrar na hora. Mas fechar a conversa de um
// lead REAL por engano custa uma venda — então metade destes testes existe
// para garantir que frases legítimas NÃO sejam confundidas com pedido de
// parar. Em português "para" e "não quero" aparecem o tempo todo.
import { describe, it, expect } from 'vitest';
import { isOptOut } from '../services/whatsapp/whatsapp.service.js';

describe('isOptOut — reconhece quem pede para parar', () => {
  it('o caso real que motivou isto (22/09/2026)', () => {
    expect(isOptOut('Para de mandar isso pfv\nTa me atrapalhando.')).toBe(true);
  });

  it('variações comuns de pedido de parada', () => {
    for (const frase of [
      'pare de me mandar mensagem',
      'para de enviar essas mensagens',
      'pare com isso por favor',
      'não tenho interesse',
      'sem interesse, obrigado',
      'não quero receber nada disso',
      'não me manda mais',
      'me tira da lista',
      'quero me descadastrar',
      'STOP',
      'Pare!',
    ]) {
      expect(isOptOut(frase), frase).toBe(true);
    }
  });

  it('funciona sem acento e em caixa alta (gente escreve de qualquer jeito)', () => {
    expect(isOptOut('NAO TENHO INTERESSE')).toBe(true);
    expect(isOptOut('nao me mande mais isso')).toBe(true);
  });
});

describe('isOptOut — NÃO confunde lead de verdade com pedido de parar', () => {
  it('"para" como preposição não encerra nada', () => {
    for (const frase of [
      'quero um plano para minha empresa',
      'qual o valor para 3 pessoas?',
      'plano para família, por favor',
      'é para CNPJ',
      'estou pesquisando para meus pais',
    ]) {
      expect(isOptOut(frase), frase).toBe(false);
    }
  });

  it('"não quero" seguido de preferência é escolha, não recusa do atendimento', () => {
    expect(isOptOut('não quero o empresarial, quero o individual')).toBe(false);
    expect(isOptOut('não quero plano com coparticipação')).toBe(false);
  });

  it('palavras que CONTÊM "pare" não disparam', () => {
    expect(isOptOut('vou comparecer na unidade amanhã')).toBe(false);
    expect(isOptOut('preparem o orçamento por favor')).toBe(false);
  });

  it('mensagem vazia ou saudação comum não encerra', () => {
    expect(isOptOut('')).toBe(false);
    expect(isOptOut('bom dia, quero uma cotação')).toBe(false);
  });
});
