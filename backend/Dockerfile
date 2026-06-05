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
CMD ["node", "dist/index.js"]
