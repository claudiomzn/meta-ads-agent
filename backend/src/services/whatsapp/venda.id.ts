/**
 * event_id/transactionId da venda — o MESMO no Google e na Meta, e o mesmo que
 * a tela de Vendas usa (`_shared/sale-conversion.ts` no google-ads-agent).
 *
 * Em arquivo próprio para não arrastar prisma/CAPI para dentro de um teste que
 * só quer conferir o formato do id.
 */
export const idDoEventoDaVenda = (saleId: string) => `venda_${saleId}`;
