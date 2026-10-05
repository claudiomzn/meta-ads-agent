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
# Schema em produção: agora pelas MIGRATIONS (caminho X). A cada start, o
# `migrate deploy` aplica as migrations pendentes e para — não reescreve o
# schema a partir do schema.prisma como o `db push` fazia (que foi a origem do
# drift e do risco de perda de dados).
#
# 1º boot após esta troca: produção tinha 7 migrations registradas e o repo tem
# 16; as 9 pendentes são TODAS idempotentes (IF NOT EXISTS / guardas), então o
# migrate deploy as aplica como no-op sobre o schema que já existe e as registra
# — produção se baselina sozinha, sem ninguém rodar nada à mão. Provado pelo
# teste C de scripts/check-drift-migration.mjs (estado de produção + as 9
# pendentes = no-op).
#
# Daqui pra frente: toda mudança de schema entra por uma migration nova
# (prisma migrate dev no ambiente local), e o deploy a aplica aqui.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
