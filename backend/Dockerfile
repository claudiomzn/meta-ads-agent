FROM node:20-slim

# Instala OpenSSL necessário para Prisma no Debian slim
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copia arquivos de dependência
COPY package*.json ./
COPY prisma ./prisma/

# Instala TODAS as dependências (incluindo devDeps para build)
RUN npm ci

# Gera o Prisma Client
RUN npx prisma generate

# Copia o restante do código
COPY . .

# Compila TypeScript
RUN npx tsc

# Remove devDependencies após o build (reduz tamanho da imagem)
RUN npm prune --production

# Railway injeta PORT — app escuta em 0.0.0.0:PORT
EXPOSE 3000
# ⚠️ Schema em produção: hoje é o `db push` deste CMD que sincroniza o banco a
# cada start (não as migrations — ver drift em CLAUDE.md). O `--accept-data-loss`
# foi REMOVIDO: com ele, qualquer schema.prisma que chegasse sem uma coluna
# (merge ruim, revert) fazia o boot APAGAR a coluna e os dados dela, calado.
# Sem a flag, o `db push` RECUSA mudança destrutiva e o boot falha visível — o
# banco fica intacto. Como produção já está sincronizada com o schema, `db push`
# aqui é no-op no estado atual. Passo seguinte (caminho X): depois de baselinar
# produção (prisma migrate resolve --applied das 7 migrations não registradas),
# trocar este `db push` por `npx prisma migrate deploy`.
CMD ["sh", "-c", "npx prisma db push && node dist/index.js"]
