import { execSync } from 'child_process';

// Banco isolado para testes (PostgreSQL embutido — ver globalSetup.ts)
process.env.DATABASE_URL = 'postgresql://postgres:test@localhost:5433/metaads_test';
process.env.JWT_SECRET = 'test-jwt-secret-32chars-minimum!!';
process.env.ENCRYPTION_KEY = 'test-enc-key-32chars-minimum-ok!';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
process.env.META_MCP_URL = 'https://test.mcp.example.com/';
process.env.META_WEBHOOK_VERIFY_TOKEN = 'test-webhook-token';
process.env.META_APP_SECRET = 'test-app-secret';

// Aplica o schema antes dos testes
execSync('npx prisma db push --force-reset', { stdio: 'ignore' });
