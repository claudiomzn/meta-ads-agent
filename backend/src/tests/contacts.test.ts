// O veredito "esse número já é conhecido?" decide, no futuro, se o bot cala a
// boca. Calar com um lead real custa dinheiro — então a regra aqui é: na
// dúvida, `null` (não sei), nunca `true`.
import { describe, it, expect } from 'vitest';
import { judgeContacts } from '../services/whatsapp/contacts.js';

const LEAD = '5592999998888';

describe('judgeContacts', () => {
  it('sem resposta da Evolution → não sei (nunca "conhecido")', () => {
    expect(judgeContacts(null, LEAD).known).toBeNull();
    expect(judgeContacts(undefined, LEAD).known).toBeNull();
  });

  it('lista vazia → desconhecido, que é o caso do lead de anúncio', () => {
    const v = judgeContacts([], LEAD);
    expect(v.known).toBe(false);
  });

  it('contato com nome salvo → conhecido, e devolve o nome pro log', () => {
    const v = judgeContacts([{ remoteJid: `${LEAD}@s.whatsapp.net`, name: 'João Fornecedor' }], LEAD);
    expect(v.known).toBe(true);
    expect(v.name).toBe('João Fornecedor');
  });

  it('aceita pushName quando é o campo preenchido', () => {
    const v = judgeContacts([{ remoteJid: `${LEAD}@s.whatsapp.net`, pushName: 'Maria' }], LEAD);
    expect(v.known).toBe(true);
    expect(v.name).toBe('Maria');
  });

  it('contato existe mas SEM nome → não sei (já trocou mensagem ≠ está salvo)', () => {
    const v = judgeContacts([{ remoteJid: `${LEAD}@s.whatsapp.net`, pushName: '' }], LEAD);
    expect(v.known).toBeNull();
  });

  it('aceita a resposta embrulhada em { contacts: [...] }', () => {
    const v = judgeContacts({ contacts: [{ remoteJid: `${LEAD}@s.whatsapp.net`, name: 'Ana' }] }, LEAD);
    expect(v.known).toBe(true);
  });

  it('⭐ lista inteira sem o número pedido → não sei, NUNCA conhecido', () => {
    // Issue #896 da Evolution: o filtro às vezes é ignorado e vem a agenda
    // toda. Sem conferir o número, todo lead viraria "conhecido" e o bot
    // emudeceria para todo mundo.
    const agendaInteira = [
      { remoteJid: '5511777776666@s.whatsapp.net', name: 'Outro' },
      { remoteJid: '5521555554444@s.whatsapp.net', name: 'Mais Outro' },
    ];
    const v = judgeContacts(agendaInteira, LEAD);
    expect(v.known).toBeNull();
    expect(v.reason).toContain('nenhum é este número');
  });

  it('casa o número mesmo com formatação diferente (com/sem 55, sufixo do jid)', () => {
    const v = judgeContacts([{ id: `${LEAD}@c.us`, name: 'Cliente Antigo' }], LEAD);
    expect(v.known).toBe(true);
  });
});
