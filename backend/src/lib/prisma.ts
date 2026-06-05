import { PrismaClient } from '@prisma/client';

// Singleton — uma única conexão compartilhada por toda a aplicação.
// Evita abrir dezenas de conexões ao banco (uma por módulo importado).
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});

export default prisma;
