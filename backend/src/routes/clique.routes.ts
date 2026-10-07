// POST /api/clique — o site registra o clique do anúncio (07/10/2026).
//
// Quando o visitante toca no botão do WhatsApp, o site gera um código de 10
// letras/números, põe no "(ref. …~código)" da mensagem e manda aqui o código
// com o gclid/gbraid/wbraid que guardou da URL do anúncio (navigator.sendBeacon,
// que não espera resposta nem atrasa a abertura do WhatsApp). Quando o lead
// vira QUENTE, o bot acha o gclid por esse código e a conversão sobe ao Google
// ligada ao anúncio exato (whatsapp.service.ts, fireGoogleLeadConversion).
//
// PÚBLICO, sem login — por isso:
//   • montado ANTES do CORS global (que recusaria os domínios dos sites);
//   • só aceita Origin da lista CLIQUE_ORIGENS;
//   • valida o formato de cada campo e guarda só identificadores de clique
//     (nada que identifique a pessoa);
//   • limite de corpo e de pedidos por IP;
//   • nunca sobrescreve um código existente.
import { Router, text, type Request, type Response } from 'express';
import prisma from '../lib/prisma.js';
import { CODIGO_DO_CLIQUE } from '../services/whatsapp/origem.js';

const ORIGENS_PADRAO = [
  'https://segurosamazon.com',
  'https://www.segurosamazon.com',
  'https://novo.tabelasamel.com.br',
  'https://tabelasamel.com.br',
  'https://www.tabelasamel.com.br',
];

export function origensPermitidas(): string[] {
  const env = (process.env.CLIQUE_ORIGENS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return env.length ? env : ORIGENS_PADRAO;
}

// gclid/gbraid/wbraid: letras, números, "-" e "_" (base64url). Limite folgado.
const ID_DE_CLIQUE = /^[A-Za-z0-9_-]{10,250}$/;

export interface CliqueValido { codigo: string; gclid: string | null; gbraid: string | null; wbraid: string | null }

/** PURO. Valida o corpo; null = recusa. Pelo menos um identificador de clique. */
export function validarClique(raw: unknown): CliqueValido | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const codigo = typeof o.codigo === 'string' ? o.codigo : '';
  if (!CODIGO_DO_CLIQUE.test(codigo)) return null;
  const id = (k: string) => (typeof o[k] === 'string' && ID_DE_CLIQUE.test(o[k] as string) ? (o[k] as string) : null);
  const c = { codigo, gclid: id('gclid'), gbraid: id('gbraid'), wbraid: id('wbraid') };
  return c.gclid || c.gbraid || c.wbraid ? c : null;
}

// Limite simples por IP, em memória (um processo só no Render). Um visitante
// de verdade registra 1 clique por toque no botão.
const JANELA_MS = 60_000;
const MAX_POR_JANELA = 20;
const contagem = new Map<string, { inicio: number; n: number }>();
export function dentroDoLimite(ip: string, agora = Date.now()): boolean {
  const c = contagem.get(ip);
  if (!c || agora - c.inicio > JANELA_MS) {
    contagem.set(ip, { inicio: agora, n: 1 });
    if (contagem.size > 10_000) contagem.clear(); // não deixa a memória crescer sem fim
    return true;
  }
  c.n += 1;
  return c.n <= MAX_POR_JANELA;
}

const router = Router();

// sendBeacon manda texto (text/plain) para não precisar de preflight.
router.use(text({ type: '*/*', limit: '2kb' }));

router.options('/', (req: Request, res: Response) => {
  const origem = req.headers.origin;
  if (origem && origensPermitidas().includes(origem)) {
    res.setHeader('Access-Control-Allow-Origin', origem);
    res.setHeader('Access-Control-Allow-Methods', 'POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  res.sendStatus(204);
});

router.post('/', async (req: Request, res: Response) => {
  const origem = req.headers.origin ?? '';
  if (!origensPermitidas().includes(origem)) return res.sendStatus(403);
  res.setHeader('Access-Control-Allow-Origin', origem);
  if (!dentroDoLimite(req.ip ?? 'sem-ip')) return res.sendStatus(429);

  let corpo: unknown = req.body;
  if (typeof corpo === 'string') {
    try { corpo = JSON.parse(corpo); } catch { return res.sendStatus(400); }
  }
  const clique = validarClique(corpo);
  if (!clique) return res.sendStatus(400);

  try {
    // skipDuplicates: o código já registrado nunca é trocado por outro gclid.
    await prisma.cliqueDoSite.createMany({ data: [{ ...clique, site: origem }], skipDuplicates: true });
    return res.sendStatus(204);
  } catch (e) {
    console.error('[clique] falha ao gravar:', e instanceof Error ? e.message : 'erro desconhecido');
    return res.sendStatus(500);
  }
});

export default router;
