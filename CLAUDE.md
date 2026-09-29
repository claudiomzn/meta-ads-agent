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
| Serviço | **Render** — `meta-ads-agent-backend`, `rootDir: backend` |
| Banco | **Neon** — o banco é o `neondb`, **não** o `evolution` |
| Build | `npm ci && npx prisma generate && npx tsc` |
| Pré-deploy | **`npx prisma migrate deploy`** ← leia a seção de migrations |
| Saúde | `GET /health` (só devolve `ok` + timestamp; **não diz a versão**) |

Crons `node-cron` dentro do próprio processo (`src/index.ts`): métricas de hora em hora, fila a cada 2min, status + automações a cada 15min, agente noturno às 5h.

## Como publicar

**Produção é a `main`, e aqui `git push` PUBLICA.** O Render observa a branch e faz o deploy sozinho — merjar na `main` é publicar. A migration roda no `preDeployCommand`, antes do serviço subir.

⚠️ **É o oposto do `google-ads-agent`.** Lá a Vercel está configurada com *Production Branch* = `main`, mas a integração git não dispara deploy: quem publica é `vercel --prod`, da CLI, empacotando a árvore de trabalho. Os dois repositórios têm branch de produção com o mesmo nome e formas de publicar diferentes — é o erro fácil de cometer trabalhando nos dois no mesmo dia.

Conferir o que está no ar: `GET /health` responde `ok` + timestamp, mas **não diz a versão** — para saber se o deploy subiu, olhe o painel do Render ou teste um comportamento novo.

## Comandos

```bash
cd backend
npm run dev     # tsx watch
npm test        # vitest run — ~315 testes, 31 arquivos
npx tsc --noEmit
```

O harness sobe um **PostgreSQL embutido na porta 5433** (`src/tests/globalSetup.ts`) e roda `prisma db push --force-reset` a cada arquivo — por isso `fileParallelism: false`. O Postgres cospe muito ruído no stderr; para ler falha de verdade:

```bash
npx vitest run <arquivo> --reporter=json --outputFile=/tmp/res.json
```

## ⚠️ Armadilhas que já custaram caro

**O schema do Prisma tem drift: 34 campos (de 213) não existem em nenhuma migration.** Foram aplicados com `db push` e nunca entraram no histórico. Como o Render roda `prisma migrate deploy` no pré-deploy, **uma migration não idempotente derruba o deploy inteiro** ao colidir com coluna que já existe no banco.

> **Regra:** toda migration nova usa `ADD COLUMN IF NOT EXISTS` e nunca assume o estado do banco. Vale a pena validar contra um Postgres descartável antes — ver `backend/scripts/check-script-migration.mjs`, que aplica o SQL **duas vezes** e confere tipos, defaults e backfill.

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

## Convenções

- **Branch + PR**, nunca commit direto. Branch de trabalho atual do bot: `feat/bot-roteiro-fixo` (já merjada).
- **Commits e comentários em português**, explicando o *porquê*.
- Comando para o Luiz: **uma linha de bash, sem placeholder**, pronto para clicar Run.
- O CI usa **`node-version: 20` (npm 10)**. Se a sua máquina tiver npm 11, um `package-lock.json` gerado por ela **quebra o `npm ci` do CI** sem quebrar nada localmente. Regere o lock com o npm mais restritivo (`npx npm@10 install --package-lock-only`) e valide nos dois.
- **Verificação que existe e nunca roda é pior que nenhuma**: o `npm ci` quebrado escondeu 31 testes de frontend por semanas sem ninguém notar.
