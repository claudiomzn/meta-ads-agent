FROM node:20-alpine

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

# Railway injeta PORT automaticamente — o app usa process.env.PORT
# Sem EXPOSE fixo para não conflitar com a porta dinâmica do Railway
CMD ["node", "dist/index.js"]
