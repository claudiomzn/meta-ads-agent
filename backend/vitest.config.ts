import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    globalSetup: ['./src/tests/globalSetup.ts'],
    setupFiles: ['./src/tests/setup.ts'],
    include: ['src/**/*.test.ts'],
    // Arquivos compartilham o mesmo banco de teste — rodar em série evita
    // que o force-reset de um arquivo derrube as tabelas de outro
    fileParallelism: false,
    coverage: {
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/tests/**', 'src/index.ts'],
    },
  },
});
