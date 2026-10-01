// Valida a migration de origem da conversa contra um Postgres descartável,
// no mesmo molde de check-script-migration.mjs: SQL válido, idempotente
// (rodar DUAS vezes — o deploy do Render depende disso por causa do drift),
// tipos certos, e conversa antiga intacta com origem NULL.
import EmbeddedPostgres from 'embedded-postgres';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import pg from 'pg';

const dataDir = mkdtempSync(join(tmpdir(), 'migcheck-origem-'));
const epg = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'test', port: 5435, persistent: false });
const SQL = readFileSync('prisma/migrations/20261001120000_add_whatsapp_conversation_origem/migration.sql', 'utf8');
const COLUNAS = ['origemCanal', 'origemRef', 'ctwaClid', 'origemAnuncioId'];

let falhas = 0;
const ok = (cond, msg) => { if (!cond) { falhas++; console.log('  ✗ ' + msg); } else console.log('  ✓ ' + msg); };

await epg.initialise();
await epg.start();
await epg.createDatabase('migcheck');
const client = new pg.Client({ host: 'localhost', port: 5435, user: 'postgres', password: 'test', database: 'migcheck' });
await client.connect();

try {
  await client.query('CREATE TABLE "WhatsappConversation" (id TEXT PRIMARY KEY, "leadPhone" TEXT)');
  await client.query(`INSERT INTO "WhatsappConversation" (id, "leadPhone") VALUES ('antiga', '5592999990000')`);
  // Simula o drift: uma das colunas JÁ existe no banco (aplicada fora do histórico).
  await client.query('ALTER TABLE "WhatsappConversation" ADD COLUMN "ctwaClid" TEXT');

  console.log('1ª aplicação (com uma coluna já existente, como no drift):');
  await client.query(SQL);
  ok(true, 'SQL executou sem erro');

  console.log('2ª aplicação (idempotência):');
  await client.query(SQL);
  ok(true, 'reaplicar não quebrou');

  console.log('Tipos:');
  const { rows } = await client.query(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'WhatsappConversation'`);
  for (const c of COLUNAS) {
    const r = rows.find((x) => x.column_name === c);
    ok(r && r.data_type === 'text' && r.is_nullable === 'YES', `${c} é text e anulável`);
  }

  console.log('Conversa que já existia:');
  const { rows: [antiga] } = await client.query(`SELECT * FROM "WhatsappConversation" WHERE id='antiga'`);
  ok(antiga.leadPhone === '5592999990000', 'dados antigos intactos');
  ok(COLUNAS.every((c) => antiga[c] === null), 'origem NULL (desconhecida), sem valor inventado');
} finally {
  await client.end();
  await epg.stop();
  rmSync(dataDir, { recursive: true, force: true });
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO OK');
process.exit(falhas ? 1 : 0);
