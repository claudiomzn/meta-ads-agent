import EmbeddedPostgres from 'embedded-postgres';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Sobe um PostgreSQL embutido (binários via npm, sem Docker) uma única vez
// para toda a suíte. O setup.ts de cada arquivo aplica o schema via prisma db push.
const dataDir = mkdtempSync(join(tmpdir(), 'metaads-test-pg-'));

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password: 'test',
  port: 5433,
  persistent: false,
});

export async function setup() {
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('metaads_test');
}

export async function teardown() {
  await pg.stop();
  rmSync(dataDir, { recursive: true, force: true });
}
