# meta-ads-agent — guia para quem vai mexer no código

Backend do **AdsGenius** para Meta Ads (Facebook/Instagram) e casa do **bot de WhatsApp**. Dono e único operador: **Luiz Claudio Brito**, corretor de planos de saúde em Manaus — experiência técnica mais teórica que prática, prefere resposta direta e comando pronto de colar.

> Histórico completo (auditorias, incidentes, decisões) no cofre Obsidian: `~/Desktop/claude - obsidian/AdsGenius/`.

## Isto é metade do produto

O outro repositório é **`google-ads-agent`**: o app que o cliente abre (React + Vite na Vercel) e todo o lado Google (46 edge functions Deno no Supabase). Para o cliente é um app só.

O frontend de lá fala com este backend por `/meta-api` (proxy do Vite em dev; `VITE_META_API_URL` em produção), autenticando por **SSO**: sessão Supabase → `POST /auth/sso` → token JWT guardado em `sessionStorage` na chave `meta_token`.

⚠️ O `frontend/` **deste** repo existe e tem testes, mas a UI que o cliente usa é a do `google-ads-agent`. Antes de consertar uma tela aqui, confirme qual está publicada.

## Onde roda

| | |
|---|---|
| Serviço | **Render** — `meta-ads-agent-backend`, sobe pelo **`backend/Dockerfile`** |
| Banco | **Neon** — o banco é o `neondb`, **não** o `evolution` |
| Build | Dockerfile: `npm ci` → `prisma generate` → `tsc` → `npm prune --production` |
| Boot | **`npx prisma migrate deploy && node dist/index.js`** ← leia a seção de migrations |
| Saúde | `GET /health` (só devolve `ok` + timestamp; **não diz a versão**) |

> ⚠️ O `render.yaml` está **desatualizado** (diz runtime node, preDeploy e um banco `meta-ads-db` do Render). Não é o que roda — a verdade é o painel do Render e o Dockerfile. Ver o aviso no topo do arquivo.

Crons `node-cron` dentro do próprio processo (`src/index.ts`): métricas de hora em hora, fila a cada 2min, status + automações a cada 15min, agente noturno às 5h.

## Como publicar

**Produção é a `main`, e merjar nela PUBLICA.** O Render observa a branch e faz o deploy sozinho. As migrations pendentes rodam no **boot** do container (`prisma migrate deploy`, CMD do Dockerfile), antes do servidor subir: se uma falhar, o container não sobe — o bot fica fora do ar até corrigir.

É o mesmo comportamento do frontend no `google-ads-agent`, onde a Vercel publica no merge para a `main`. A diferença que importa está lá: as **edge functions do Supabase não saem no push** — exigem `supabase functions deploy`. Aqui não há esse caso: tudo o que este repositório serve vai junto no deploy do Render.

Conferir o que está no ar: `GET /health` responde `ok` + timestamp, mas **não diz a versão** — para saber se o deploy subiu, olhe o painel do Render ou teste um comportamento novo.

## Comandos

```bash
cd backend
npm run dev     # tsx watch
npm test        # vitest run — ~445 testes, 38 arquivos
npx tsc --noEmit
```

O harness sobe um **PostgreSQL embutido na porta 5433** (`src/tests/globalSetup.ts`) e roda `prisma db push --force-reset` a cada arquivo — por isso `fileParallelism: false`. O Postgres cospe muito ruído no stderr; para ler falha de verdade:

```bash
npx vitest run <arquivo> --reporter=json --outputFile=/tmp/res.json
```

## ⚠️ Armadilhas que já custaram caro

**Até 05/10/2026 o schema de produção era reescrito por `prisma db push --accept-data-loss` a cada boot** — não pelas migrations. Resultado: 37 colunas e 2 tabelas fora de qualquer migration, a cadeia não reconstruía um banco do zero, e um `schema.prisma` sem uma coluna (merge ruim, revert) **apagaria a coluna e os dados de produção** no próximo restart, em silêncio. Corrigido pelos PRs #29–#31 ("caminho X"): a cadeia foi consertada e o boot passou a usar `migrate deploy`.

> **Regras daqui pra frente:**
> - **Mudança de schema só entra por migration nova.** Nunca `prisma db push` contra produção, nunca de volta no Dockerfile.
> - **Toda migration é idempotente** (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE/INDEX IF NOT EXISTS`, constraint dentro de `DO $$ … EXCEPTION WHEN duplicate_object`). Sem `DROP` nem `ALTER COLUMN TYPE` sem conversa antes.
> - **Valide antes do merge** com `node backend/scripts/check-drift-migration.mjs` (Postgres descartável: banco vazio + todas as migrations == `schema.prisma`; reaplicar não quebra; estado de produção + pendentes = no-op). Para uma migration só, `check-script-migration.mjs` aplica o SQL duas vezes.
> - Migration que falha **derruba o boot**: o bot fica mudo até o próximo deploy.

**A Meta responde erro com HTTP 200.** Todo `update_*` / `create_*` precisa validar `success`/`id` no retorno e lançar quando recusado. Descartar o retorno já fez a tela dizer "Pausado com sucesso" enquanto a campanha seguia gastando — inclusive nas automações.

**Publicação sem transação deixa campanha órfã e duplica na retentativa.** Se `create_adset`/`create_ad` falha, o `metaCampaignId` não é gravado, o cliente clica de novo e nasce a segunda campanha. Guarde os IDs criados e retome; nunca recrie do zero.

**Se a resposta traz ID, o objeto EXISTE.** Tratar como falha gera órfão.

**`PUT` que recria filhos apaga o que não foi reenviado** — `deleteMany` + `create` já descartou `metaAdSetId`, `metaAdId`, métricas e `audienceId`. O que o form não manda, morre.

**ROAS não julga conta de lead.** `purchase_roas` é sempre 0 para cliente de WhatsApp/lead — isso não é prejuízo, é ausência de valor cadastrado. Já gerou proposta de pausar as melhores campanhas com botão de 1 clique.

**Nunca logue `err` cru nem `access_token` em `params`** — o log do Render já foi caminho de vazamento de token de cliente.

**Cobrar crédito de IA em qualquer 2xx é defeito.** Rotas com retorno antecipado ou fallback algorítmico cobram sem chamar IA. O ledger deve liquidar quando a IA **entregou**.

**O bot só pode iniciar conversa quando ela NASCE do anúncio.** Depois de iniciada, ele responde tudo daquele número para sempre — foi assim que passou a importunar contato pessoal do Luiz.

**Mock acessado com `new` precisa ser uma CLASSE de verdade.** `vi.fn().mockImplementation(() => ({...}))` não é construtível: o `TypeError` é engolido pelo `try/catch` da produção e um `expect(...).not.toHaveBeenCalled()` passa **sempre**. Confirme que todo teste novo **reprova** o código antigo.

## Modo roteiro fixo do bot (25/09/2026)

Existem dois comportamentos no mesmo bot, e a chave é `WhatsappConfig.scriptEnabled`:

- **`false`** (padrão) — modo generativo: a IA escreve cada mensagem.
- **`true`** — roteiro fixo: o bot envia **literalmente** o texto da config, uma pergunta por vez, e a IA só **lê** a resposta para preencher um campo. Nada que a IA devolve chega ao cliente. No fim manda uma frase de encerramento, avisa o vendedor e cala para sempre naquele número (`handoff` é estado terminal).

Veio de um problema real: o bot gerava conversa fora de contexto com o lead. Separar **quem fala** de **quem entende** preserva o orçamento automático (que precisa de tipo + idades estruturados) sem devolver o microfone à IA.

⚠️ O `campo` de cada passo decide o rótulo **QUENTE/FRIO**, e o rótulo decide se a conversão de lead qualificado sobe para o Google e para o Meta. Roteiro sem o campo `urgencia` marca todo lead como frio e **para de reportar conversão, em silêncio**.

`upsertConfig` preserva o roteiro quando o payload não o traz (`??`) — lembre que `??` só cai em `null`/`undefined`: mandar `""` grava frase vazia, e `[]` apaga o roteiro de verdade.

## Segredos e contas

- `ENCRYPTION_KEY`, `META_APP_SECRET`, `ANTHROPIC_API_KEY`, `PIPEBOARD_API_KEY`: `sync: false` no `render.yaml` — configurados à mão no painel, **nunca no repo nem em log**.
- `FOUNDER_EMAILS` é obrigatória no Render: sem ela o Luiz perde o acesso ao módulo Meta.
- ⚠️ **Não mexer na conta do revisor do Meta** (`revisor.meta@adsgenius.net`): o App Review em andamento usa ela.
- App Meta: **AdGenius** `976210158289852`. Só `ads_read` aprovada; `ads_management`, `pages_show_list` e `pages_read_engagement` foram recusadas em 12/09 (o vídeo não mostrou criação ao vivo).

## Uso de modelo (pedido do Luiz, 08/10/2026)

A cota semanal é finita e uma sessão longa no Opus esgotou-a em 4 dias. Regra:

- **Sonnet** é o padrão para o que é mecânico ou bem especificado: gravar nota no cofre, ajuste de texto/tela, changelog, conferência de deploy, rodar testes, PR pequeno com o que fazer já claro.
- **Opus** só quando a tarefa exige julgamento: investigar causa de defeito, mexer em conversão/cobrança/migration, revisar diff arriscado, decisão de arquitetura.
- Uma sessão Opus que chega a uma parte mecânica **delega** ao Sonnet (subagente com `model: "sonnet"` ou sessão no Mac com `model: "claude-sonnet-5-5"`) em vez de fazer ela mesma.
- Ao sugerir a próxima sessão ao Luiz, diga qual modelo escolher.
- **Uma sessão por assunto.** Sessão longa reenvia o histórico inteiro a cada mensagem — é o que mais gasta.

## Convenções

- **Branch + PR**, nunca commit direto. Branch de trabalho atual do bot: `feat/bot-roteiro-fixo` (já merjada).
- **Commits e comentários em português**, explicando o *porquê*.
- Comando para o Luiz: **uma linha de bash, sem placeholder**, pronto para clicar Run.
- O CI usa **`node-version: 20` (npm 10)**. Se a sua máquina tiver npm 11, um `package-lock.json` gerado por ela **quebra o `npm ci` do CI** sem quebrar nada localmente. Regere o lock com o npm mais restritivo (`npx npm@10 install --package-lock-only`) e valide nos dois.
- **Verificação que existe e nunca roda é pior que nenhuma**: o `npm ci` quebrado escondeu 31 testes de frontend por semanas sem ninguém notar.
