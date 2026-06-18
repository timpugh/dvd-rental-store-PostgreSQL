import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { validateReadOnly } from './sql-guard';
import { PAGILA_SCHEMA } from './pagila-schema-context';

const region = process.env.AWS_REGION || 'us-east-1';
const MODEL_ID = process.env.BEDROCK_MODEL_ID as string;
const QUERY_FN = process.env.QUERY_FUNCTION_NAME as string;
const bedrock = new BedrockRuntimeClient({ region });
const lambda = new LambdaClient({ region });

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const resp = (statusCode: number, body: object): APIGatewayProxyResult => ({
  statusCode,
  headers: CORS,
  body: JSON.stringify(body),
});

async function converse(system: string, user: string, maxTokens: number, temperature: number): Promise<string> {
  const out = await bedrock.send(
    new ConverseCommand({
      modelId: MODEL_ID,
      system: [{ text: system }],
      messages: [{ role: 'user', content: [{ text: user }] }],
      inferenceConfig: { maxTokens, temperature },
    }),
  );
  return out.output?.message?.content?.[0]?.text?.trim() ?? '';
}

async function runSql(sql: string): Promise<{ success: boolean; rows?: Record<string, unknown>[]; error?: string }> {
  const out = await lambda.send(
    new InvokeCommand({
      FunctionName: QUERY_FN,
      Payload: Buffer.from(JSON.stringify({ body: JSON.stringify({ query: sql }) })),
    }),
  );
  const envelope = JSON.parse(Buffer.from(out.Payload as Uint8Array).toString()); // { statusCode, body }
  return JSON.parse(envelope.body); // { success, rows, count, error }
}

const SQL_SYSTEM = `You convert a natural-language question into ONE read-only PostgreSQL query for the Pagila database.
Output ONLY the SQL inside a \`\`\`sql code block. Exactly one statement. SELECT or WITH only — never modify data.
Prefer explicit column lists and add a sensible LIMIT.

Schema:
${PAGILA_SCHEMA}`;

const EXPLAIN_SYSTEM =
  'You explain SQL query results to someone learning SQL, in 1-3 plain-English sentences. Be concise and specific about what the data shows. Do not restate the SQL.';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  if (event.httpMethod === 'OPTIONS') return resp(200, { ok: true });

  let prompt = '';
  try {
    prompt = String(JSON.parse(event.body || '{}').prompt || '').trim();
  } catch {
    /* fall through to validation below */
  }
  if (!prompt) return resp(400, { error: 'Provide a "prompt" in the request body.' });

  try {
    const generated = await converse(SQL_SYSTEM, prompt, 400, 0);
    const guard = validateReadOnly(generated);
    if (!guard.ok) return resp(200, { prompt, sql: generated, error: guard.error });
    const sql = guard.sql as string;

    const result = await runSql(sql);
    if (!result.success) return resp(200, { prompt, sql, error: `Database error: ${result.error ?? 'unknown'}` });

    const rows = result.rows ?? [];
    const columns = rows.length ? Object.keys(rows[0]) : [];
    const explanation = await converse(
      EXPLAIN_SYSTEM,
      `Question: ${prompt}\nColumns: ${columns.join(', ')}\nRows (up to 20): ${JSON.stringify(
        rows.slice(0, 20),
      )}\nTotal rows: ${rows.length}`,
      300,
      0.3,
    );

    return resp(200, { prompt, sql, columns, rows, explanation });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return resp(200, { prompt, error: `Sorry, something went wrong: ${msg}` });
  }
};

export default handler;
