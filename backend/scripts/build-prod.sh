#!/bin/bash
# Build script para produção (Railway/Render)
# Troca provider SQLite → PostgreSQL antes de compilar

set -e

echo "🔄 Configurando schema para PostgreSQL..."
sed -i 's/provider = "sqlite"/provider = "postgresql"/' prisma/schema.prisma

echo "🔨 Gerando Prisma Client..."
npx prisma generate

echo "🔨 Compilando TypeScript..."
npx tsc

echo "✅ Build concluído!"
