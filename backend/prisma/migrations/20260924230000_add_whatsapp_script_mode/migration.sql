-- Modo ROTEIRO FIXO do bot WhatsApp.
--
-- Por que existe: até 24/09/2026 toda resposta do bot era uma geração de IA, e
-- as perguntas do cliente entravam no prompt apenas como "sugeridas". Ao vivo
-- (Amazon Corretora) isso virou conversa fora de contexto com o lead. O modo
-- roteiro separa QUEM FALA de QUEM ENTENDE: o texto enviado é literalmente o
-- da config, e a IA só lê a resposta para preencher um campo.
--
-- ⚠️ TODO comando aqui é `IF NOT EXISTS` de propósito. O schema deste projeto
-- tem campos que foram aplicados no Neon com `prisma db push` e nunca entraram
-- no histórico de migrations (`prepaidMessagesRemaining` é um exemplo — está no
-- schema.prisma e em nenhum migration.sql). O `preDeployCommand` do Render é
-- `prisma migrate deploy`, então uma migration não idempotente arriscaria
-- quebrar o deploy por colisão com uma coluna que já existe no banco. Nenhum
-- comando abaixo assume o estado do banco.
--
-- Todas as colunas são aditivas e com DEFAULT: nenhum backfill, nenhum
-- downtime, e o bot de hoje (scriptEnabled = false) continua idêntico.

-- ── Config do negócio: o roteiro em si ──────────────────────────────────────
-- scriptEnabled: chave mestra. FALSE mantém o comportamento generativo atual.
-- scriptIntro:   apresentação enviada junto com a 1ª pergunta.
-- scriptClosing: a ÚNICA frase que o bot diz depois de passar para o vendedor.
-- scriptSteps:   [{ "pergunta": "texto literal", "campo": "tipo" }, ...]
ALTER TABLE "WhatsappConfig" ADD COLUMN IF NOT EXISTS "scriptEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WhatsappConfig" ADD COLUMN IF NOT EXISTS "scriptIntro" TEXT;
ALTER TABLE "WhatsappConfig" ADD COLUMN IF NOT EXISTS "scriptClosing" TEXT;
ALTER TABLE "WhatsappConfig" ADD COLUMN IF NOT EXISTS "scriptSteps" JSONB NOT NULL DEFAULT '[]';

-- ── Conversa: onde o roteiro parou ──────────────────────────────────────────
-- scriptStep:    índice do passo que está pendente de resposta.
-- scriptRetried: já repetimos esta pergunta uma vez? (só se insiste uma vez)
-- scriptData:    o que foi coletado. Campo AUSENTE = ainda não perguntado;
--                campo com `null` = perguntado e o lead não respondeu. O resumo
--                do vendedor depende dessa diferença para mostrar a lacuna.
ALTER TABLE "WhatsappConversation" ADD COLUMN IF NOT EXISTS "scriptStep" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WhatsappConversation" ADD COLUMN IF NOT EXISTS "scriptRetried" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WhatsappConversation" ADD COLUMN IF NOT EXISTS "scriptData" JSONB NOT NULL DEFAULT '{}';
