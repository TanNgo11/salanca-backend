import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

// Local backup before owner-authorized seed. No credentials in arguments/logs.
const host = process.env.DATABASE_HOST;
if (!['localhost', '127.0.0.1', '::1'].includes(host) || process.env.DATABASE_URL) {
  throw new Error('Local snapshot requires explicit loopback database configuration.');
}
const directory = resolve('.tmp/owner-data');
mkdirSync(directory, { recursive: true });
const destination = resolve(directory, `before-${Date.now()}.dump`);
execFileSync('C:/Program Files/PostgreSQL/18/bin/pg_dump.exe', ['--format=custom', '--file', destination, '--host', host, '--port', process.env.DATABASE_PORT || '5432', '--username', process.env.DATABASE_USERNAME, '--dbname', process.env.DATABASE_NAME], { env: { ...process.env, PGPASSWORD: process.env.DATABASE_PASSWORD }, stdio: ['ignore', 'ignore', 'pipe'] });
console.log(`Local backup: ${destination} (${statSync(destination).size} bytes)`);
const client = new pg.Client({ host, port: Number(process.env.DATABASE_PORT || 5432), user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD, database: process.env.DATABASE_NAME });
await client.connect();
for (const table of ['home_pages', 'menu_pages', 'story_pages', 'space_pages', 'experience_pages', 'campaign_pages', 'booking_pages', 'contact_pages']) {
  const result = await client.query(`SELECT locale, count(*)::int AS rows, count(published_at)::int AS published FROM ${table} GROUP BY locale`);
  console.log(table, JSON.stringify(result.rows));
}
await client.end();
