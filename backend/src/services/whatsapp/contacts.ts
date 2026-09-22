// "Esse número já é um contato conhecido?" — pergunta à Evolution antes de o
// bot atender um lead NOVO.
//
// Pedido do Luiz (22/09/2026): o bot não deve responder quem já está na lista
// de contatos (cliente antigo, fornecedor, conhecido) — só quem chega pelo
// anúncio. O gatilho de frase já filtra a maior parte, mas quem tem o número
// salvo e manda um "bom dia" passa.
//
// ⚠️ MODO OBSERVAÇÃO. Hoje isto só RESPONDE e LOGA — nada é bloqueado. Motivo:
// o campo que diria "está salvo na agenda" (pushName) é conhecidamente vazio
// em várias versões da Evolution, e os endpoints de contato mudam entre elas.
// Errar pro lado de calar o bot custa um lead real; errar pro outro lado só
// incomoda. Então primeiro medimos na instância de verdade (o log mostra o que
// a Evolution respondeu), e só depois, com dado, ligamos o bloqueio.

export type ContactVerdict = {
  /** true = conhecido, false = desconhecido, null = não deu pra saber. */
  known: boolean | null;
  /** Por que chegamos nessa conclusão — é isto que queremos ver no log. */
  reason: string;
  /** Nome que a Evolution devolveu, se algum. */
  name?: string;
};

type EvolutionContact = { id?: string; remoteJid?: string; pushName?: string; name?: string };

// PURA: decide o veredito a partir do que a Evolution devolveu. Separada do
// fetch justamente para poder testar as formas de resposta sem rede.
export function judgeContacts(found: unknown, phone: string): ContactVerdict {
  if (found === null || found === undefined) return { known: null, reason: 'sem resposta da Evolution' };

  // Algumas versões devolvem { contacts: [...] }, outras o array direto.
  const list: EvolutionContact[] = Array.isArray(found)
    ? found as EvolutionContact[]
    : Array.isArray((found as { contacts?: unknown }).contacts)
      ? (found as { contacts: EvolutionContact[] }).contacts
      : [];

  if (list.length === 0) return { known: false, reason: 'nenhum contato com esse número' };

  // O endpoint já foi reportado devolvendo a lista inteira quando o filtro não
  // pega (issue #896) — sem conferir o número, qualquer lead viraria
  // "conhecido" e o bot emudeceria geral. Então confirmamos a correspondência.
  const digits = phone.replace(/\D/g, '');
  const match = list.find((c) => {
    const id = String(c.remoteJid ?? c.id ?? '').replace(/\D/g, '');
    return id.length > 0 && (id === digits || id.endsWith(digits) || digits.endsWith(id));
  });
  if (!match) {
    return { known: null, reason: `resposta com ${list.length} contato(s), nenhum é este número` };
  }

  const name = (match.name ?? match.pushName ?? '').trim();
  if (!name) {
    // Existe no store, mas sem nome: pode ser só "já trocou mensagem alguma
    // vez", que NÃO é o mesmo que estar salvo na agenda.
    return { known: null, reason: 'contato existe mas sem nome — não dá pra afirmar que está salvo' };
  }
  return { known: true, reason: 'contato salvo com nome', name };
}

// Consulta a Evolution. Nunca lança: qualquer falha vira veredito null.
export async function lookupContact(instance: string, phone: string): Promise<ContactVerdict> {
  const base = (process.env.EVOLUTION_URL ?? '').replace(/\/$/, '');
  const apikey = process.env.EVOLUTION_API_KEY ?? '';
  if (!base || !apikey || !instance) return { known: null, reason: 'Evolution não configurada' };

  const digits = phone.replace(/\D/g, '');
  try {
    const resp = await fetch(`${base}/chat/findContacts/${instance}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey },
      body: JSON.stringify({ where: { remoteJid: `${digits}@s.whatsapp.net` } }),
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return { known: null, reason: `Evolution respondeu ${resp.status}` };
    return judgeContacts(await resp.json(), digits);
  } catch (e) {
    return { known: null, reason: `falha na consulta: ${e instanceof Error ? e.message : String(e)}` };
  }
}
