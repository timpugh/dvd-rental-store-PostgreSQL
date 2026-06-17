import { Client } from 'pg';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Pagila seeder - CloudFormation custom-resource handler.
 *
 * Because Aurora is private, the database cannot be seeded from a laptop. This
 * Lambda runs INSIDE the VPC (on stack create/update) and loads the schema and
 * the INSERT-based sample data straight into Aurora over the in-VPC connection.
 *
 * It is idempotent: if the `film` table already has rows, it does nothing, so
 * re-deploys and CloudFormation retries are safe.
 *
 * Note: only the relational data is loaded. The JSONB sample data ships as
 * pg_restore custom-format backups, which a plain client cannot apply - the
 * jsonb tables are created (empty) by pagila-schema-jsonb.sql.
 */

// SQL files copied next to the handler at bundle time (see commandHooks in CDK).
const SQL_FILES = [
  'pagila-schema.sql',
  'pagila-schema-jsonb.sql',
  'pagila-insert-data.sql',
];

interface DBCredentials {
  username: string;
  password: string;
  host: string;
  port: number;
  dbname: string;
}

async function getCredentials(): Promise<DBCredentials> {
  const secretId = process.env.DB_SECRET_NAME;
  if (!secretId) {
    throw new Error('DB_SECRET_NAME environment variable not set');
  }
  const sm = new SecretsManagerClient({ region: process.env.AWS_REGION });
  const res = await sm.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!res.SecretString) {
    throw new Error('Secret value is empty');
  }
  const c = JSON.parse(res.SecretString);
  return {
    username: c.username,
    password: c.password,
    host: c.host ?? process.env.DB_HOST!,
    port: c.port ?? parseInt(process.env.DB_PORT ?? '5432', 10),
    dbname: c.dbname ?? process.env.DB_NAME ?? 'pagila',
  };
}

async function alreadySeeded(client: Client): Promise<boolean> {
  const reg = await client.query("SELECT to_regclass('public.film') AS t");
  if (!reg.rows[0].t) {
    return false;
  }
  const count = await client.query('SELECT count(*)::int AS n FROM film');
  return count.rows[0].n > 0;
}

async function seed(): Promise<string> {
  const creds = await getCredentials();
  const client = new Client({
    host: creds.host,
    port: creds.port,
    database: creds.dbname,
    user: creds.username,
    password: creds.password,
    connectionTimeoutMillis: 20000,
    statement_timeout: 0, // large data load; do not time out individual statements
  });

  await client.connect();
  try {
    if (await alreadySeeded(client)) {
      console.log('Pagila already seeded - skipping.');
      return 'skipped';
    }

    for (const file of SQL_FILES) {
      const sql = fs.readFileSync(path.join(__dirname, file), 'utf8');
      console.log(`Applying ${file} (${sql.length} bytes)...`);
      await client.query(sql);
    }

    const filmCount = await client.query('SELECT count(*)::int AS n FROM film');
    console.log(`Seed complete - film rows: ${filmCount.rows[0].n}`);
    return 'seeded';
  } finally {
    await client.end();
  }
}

interface CfnEvent {
  RequestType: 'Create' | 'Update' | 'Delete';
  PhysicalResourceId?: string;
}

export const handler = async (event: CfnEvent): Promise<{ PhysicalResourceId: string; Data?: Record<string, string> }> => {
  console.log('Seeder event:', event.RequestType);
  const physicalId = event.PhysicalResourceId ?? 'pagila-seed';

  // Nothing to undo on delete; the cluster is removed with the stack.
  if (event.RequestType === 'Delete') {
    return { PhysicalResourceId: physicalId };
  }

  const result = await seed();
  return { PhysicalResourceId: physicalId, Data: { result } };
};

export default handler;
