// Valida a migration do modo roteiro contra um Postgres descartável:
// 1. o SQL é sintaticamente válido;
// 2. rodar DUAS vezes não quebra (é isso que o `IF NOT EXISTS` promete, e o
//    deploy do Render depende dessa promessa por causa do drift do schema);
// 3. as colunas nascem com os tipos e defaults que o Prisma espera.
//
// Descartável de propósito: roda, imprime, e o banco morre junto.
import EmbeddedPostgres from 'embedded-postgres';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import pg from 'pg';

const dataDir = mkdtempSync(join(tmpdir(), 'migcheck-pg-'));
const epg = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'test', port: 5434, persistent: false });

const SQL = readFileSync('prisma/migrations/20260924230000_add_whatsapp_script_mode/migration.sql', 'utf8');

const ESPERADO = {
  WhatsappConfig: {
    scriptEnabled: ['boolean', 'false'],
    scriptIntro: ['text', null],
    scriptClosing: ['text', null],
    scriptSteps: ['jsonb', "'[]'::jsonb"],
  },
  WhatsappConversation: {
    scriptStep: ['integer', '0'],
    scriptRetried: ['boolean', 'false'],
    scriptData: ['jsonb', "'{}'::jsonb"],
  },
};

let falhas = 0;
const ok = (cond, msg) => { if (!cond) { falhas++; console.log('  ✗ ' + msg); } else console.log('  ✓ ' + msg); };

await epg.initialise();
await epg.start();
await epg.createDatabase('migcheck');
const client = new pg.Client({ host: 'localhost', port: 5434, user: 'postgres', password: 'test', database: 'migcheck' });
await client.connect();

try {
  // Tabelas como estavam ANTES da migration (só o que ela toca).
  await client.query('CREATE TABLE "WhatsappConfig" (id TEXT PRIMARY KEY)');
  await client.query('CREATE TABLE "WhatsappConversation" (id TEXT PRIMARY KEY)');
  // Uma linha preexistente: prova que o backfill dos defaults acontece.
  await client.query(`INSERT INTO "WhatsappConfig" (id) VALUES ('antiga')`);

  console.log('1ª aplicação:');
  await client.query(SQL);
  ok(true, 'SQL executou sem erro');

  console.log('2ª aplicação (idempotência — é disso que o deploy depende):');
  await client.query(SQL);
  ok(true, 'reaplicar não quebrou');

  console.log('Tipos e defaults:');
  for (const [tabela, cols] of Object.entries(ESPERADO)) {
    const { rows } = await client.query(
      `SELECT column_name, data_type, column_default, is_nullable
         FROM information_schema.columns WHERE table_name = $1`, [tabela]);
    for (const [col, [tipo, def]] of Object.entries(cols)) {
      const r = rows.find((x) => x.column_name === col);
      if (!r) { falhas++; console.log(`  ✗ ${tabela}.${col} não existe`); continue; }
      ok(r.data_type === tipo, `${tabela}.${col} é ${r.data_type} (esperado ${tipo})`);
      ok((r.column_default ?? null) === def, `${tabela}.${col} default = ${r.column_default ?? 'NULL'}`);
    }
  }

  console.log('Linha que já existia antes da migration:');
  const { rows: [antiga] } = await client.query(`SELECT "scriptEnabled", "scriptSteps" FROM "WhatsappConfig" WHERE id='antiga'`);
  ok(antiga.scriptEnabled === false, 'scriptEnabled backfilled para false — bot atual segue igual');
  ok(JSON.stringify(antiga.scriptSteps) === '[]', 'scriptSteps backfilled para []');
} finally {
  await client.end();
  await epg.stop();
  rmSync(dataDir, { recursive: true, force: true });
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO OK');
process.exit(falhas ? 1 : 0);
