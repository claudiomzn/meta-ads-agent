// Integração com o Asaas (gateway de cobrança BR) — usada para cobrar o
// excedente de conversas do bot de WhatsApp (ver whatsapp.service.ts).
//
// Modelo: sem cartão salvo. Ao atingir o limite de excedente, criamos uma
// cobrança (PIX/boleto/cartão à escolha do pagador) e mandamos o link por
// e-mail. Requer o secret ASAAS_API_KEY (e opcionalmente ASAAS_SANDBOX=true
// para testar contra o sandbox antes de operar com dinheiro de verdade).

import axios from 'axios';

const BASE_URL = process.env.ASAAS_SANDBOX === 'true'
  ? 'https://sandbox.asaas.com/api/v3'
  : 'https://api.asaas.com/v3';

function client() {
  const apiKey = process.env.ASAAS_API_KEY;
  if (!apiKey) throw new Error('ASAAS_API_KEY não configurada — cobrança de excedente desativada');
  return axios.create({
    baseURL: BASE_URL,
    headers: { access_token: apiKey, 'Content-Type': 'application/json' },
    timeout: 15000,
  });
}

export function asaasConfigured(): boolean {
  return !!process.env.ASAAS_API_KEY;
}

export interface AsaasCustomerInput {
  name: string;
  email: string;
  cpfCnpj: string;
  /** userId do AdsGenius — usado como externalReference p/ achar o cliente sem duplicar. */
  externalReference: string;
}

// Busca o cliente Asaas pelo externalReference (idempotente — nunca duplica
// cliente por causa de retry/corrida). Cria se não existir.
export async function ensureAsaasCustomer(input: AsaasCustomerInput): Promise<string> {
  const api = client();

  const existing = await api.get('/customers', {
    params: { externalReference: input.externalReference },
  });
  const found = existing.data?.data?.[0];
  if (found?.id) return found.id;

  const created = await api.post('/customers', {
    name: input.name,
    email: input.email,
    cpfCnpj: input.cpfCnpj.replace(/\D/g, ''),
    externalReference: input.externalReference,
  });
  if (!created.data?.id) {
    throw new Error(`Asaas não retornou id do cliente: ${JSON.stringify(created.data)}`);
  }
  return created.data.id;
}

export interface OverageChargeResult {
  asaasPaymentId: string;
  invoiceUrl: string;
}

// Cria a cobrança do excedente. billingType "UNDEFINED" deixa o pagador
// escolher PIX/boleto/cartão na própria página de fatura do Asaas — não
// precisamos coletar forma de pagamento antecipadamente.
export async function createOverageCharge(
  customerId: string,
  amountCents: number,
  description: string,
): Promise<OverageChargeResult> {
  const api = client();
  const dueDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10); // amanhã

  const resp = await api.post('/payments', {
    customer: customerId,
    billingType: 'UNDEFINED',
    value: amountCents / 100,
    dueDate,
    description,
  });

  if (!resp.data?.id || !resp.data?.invoiceUrl) {
    throw new Error(`Asaas não retornou cobrança válida: ${JSON.stringify(resp.data)}`);
  }
  return { asaasPaymentId: resp.data.id, invoiceUrl: resp.data.invoiceUrl };
}
