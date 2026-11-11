// Reconhece a recusa da Meta (`MetaToolResponseError`) pelo NOME, não por
// `instanceof`. As suítes de rota mockam `meta.mcp.service.js` inteiro e a
// classe não existe no mock — um `instanceof` ali estoura "No export defined
// on the mock" justamente no caminho de erro, que é o que se quer testar.
//
// A mensagem de `MetaToolResponseError` já sai sanitizada (sem link, sem
// token, cortada) por `safeToolErrorDetail`; é seguro mostrá-la ao cliente.
export function mensagemDaRecusaMeta(err: unknown): string | undefined {
  if (err instanceof Error && err.name === 'MetaToolResponseError') return err.message;
  return undefined;
}

// Para log: nunca o `err` cru — o objeto de erro do axios/MCP já carregou
// `access_token` em `config.params` e foi parar no log do Render.
export function motivoParaLog(err: unknown): string {
  return err instanceof Error ? err.message.slice(0, 400) : 'erro desconhecido';
}
