#!/bin/bash
# Build script para produção (Railway/Render)
# Troca provider SQLite → PostgreSQL antes de compilar

set -e

echo "🔄 Configurando schema para PostgreSQL..."
sed -i 's/provider = "sqlite"/provider = "postgresql"/' prisma/schema.prisma

echo "🔨 Gerando Prisma Client..."
# Garante que DATABASE_URL existe para o prisma generate (mesmo que seja placeholder)
export DATABASE_URL="${DATABASE_URL:-postgresql://placeholder:placeholder@localhost:5432/placeholder}"
npx prisma generate

echo "🔨 Compilando TypeScript..."
npx tsc

echo "✅ Build concluído!"
