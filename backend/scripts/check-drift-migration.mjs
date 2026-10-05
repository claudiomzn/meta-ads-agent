// Valida a correção do drift do schema contra Postgres descartável. 3 testes:
//   a) banco VAZIO + TODAS as migrations em ordem == schema.prisma
//      (migrate diff --from-migrations precisa dar "No difference detected");
//   b) reaplicar as DUAS migrations novas não quebra (idempotência — é disso que
//      o boot/baseline dependem);
//   c) banco que SIMULA produção (schema atual via db push) + as migrations novas
//      não quebra (no-op em cima do que já existe).
//
// Descartável: roda, imprime, e o banco morre junto.
import EmbeddedPostgres from 'embedded-postgres';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';
import pg from 'pg';

const PORT = 5445;
const MIG = 'prisma/migrations';
const NOVAS = ['20260711000000_cria_whatsapp_charge', '20261005120000_registra_drift_do_schema'];

const dataDir = mkdtempSync(join(tmpdir(), 'driftcheck-pg-'));
const epg = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'test', port: PORT, persistent: false });
await epg.initialise();
await epg.start();

let falhas = 0;
const ok = (cond, msg) => { if (!cond) { falhas++; console.log('  ✗ ' + msg); } else console.log('  ✓ ' + msg); };
const migsEmOrdem = () => readdirSync(MIG).filter((d) => !d.endsWith('.toml')).sort();
const lerMig = (d) => readFileSync(join(MIG, d, 'migration.sql'), 'utf8');
const novoClient = async (db) => { const c = new pg.Client({ host: 'localhost', port: PORT, user: 'postgres', password: 'test', database: db }); await c.connect(); return c; };
const aplicarTodas = async (c) => { for (const d of migsEmOrdem()) await c.query(lerMig(d)); };

try {
  // ── Teste A: migrations == schema ────────────────────────────────────────────
  console.log('A) banco vazio + todas as migrations == schema.prisma:');
  await epg.createDatabase('shadow_a');
  let saida;
  try {
    saida = execSync(
      `node_modules/.bin/prisma migrate diff --from-migrations ${MIG} --to-schema-datamodel prisma/schema.prisma ` +
      `--shadow-database-url "postgresql://postgres:test@localhost:${PORT}/shadow_a" --exit-code`,
      { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    ok(true, 'No difference detected (migrations reconstroem exatamente o schema)');
  } catch (e) {
    // --exit-code: 2 = há diferença. Mostra o que sobrou.
    ok(false, 'AINDA há diferença entre migrations e schema:');
    console.log((e.stdout || '' + e.stderr || '').split('\n').map((l) => '      ' + l).join('\n'));
  }

  // ── Teste B: idempotência das migrations novas ───────────────────────────────
  console.log('B) reaplicar as migrations novas (idempotência):');
  await epg.createDatabase('b');
  const cb = await novoClient('b');
  await aplicarTodas(cb);
  ok(true, 'cadeia inteira aplicou numa vez');
  try { for (const d of NOVAS) await cb.query(lerMig(d)); ok(true, 'reaplicar as 2 novas não quebrou'); }
  catch (e) { ok(false, 'reaplicar quebrou: ' + e.message); }
  await cb.end();

  // ── Teste C: simula produção (db push do schema) + migrations novas ──────────
  console.log('C) banco no estado de produção (db push) + migrations novas:');
  await epg.createDatabase('prod_sim');
  execSync('node_modules/.bin/prisma db push --skip-generate --accept-data-loss',
    { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'ignore', 'ignore'],
      env: { ...process.env, DATABASE_URL: `postgresql://postgres:test@localhost:${PORT}/prod_sim` } });
  const cc = await novoClient('prod_sim');
  try { for (const d of NOVAS) await cc.query(lerMig(d)); ok(true, 'migrations novas são no-op sobre o schema de produção'); }
  catch (e) { ok(false, 'migration quebrou sobre produção simulada: ' + e.message); }
  await cc.end();
} finally {
  await epg.stop();
  rmSync(dataDir, { recursive: true, force: true });
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO OK');
process.exit(falhas ? 1 : 0);
