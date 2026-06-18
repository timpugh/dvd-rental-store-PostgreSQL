export interface GuardResult {
  ok: boolean;
  sql?: string;
  error?: string;
}

// Reject anything that can write or run a second statement. Intentionally
// conservative for a training sandbox.
const FORBIDDEN =
  /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|merge|call|do|vacuum|reindex|comment|begin|commit|rollback)\b/i;

/** Pull SQL from a ```sql fenced block if present, else the whole text; drop a trailing ';'. */
export function extractSql(modelText: string): string {
  const fence = modelText.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  const raw = (fence ? fence[1] : modelText).trim();
  return raw.replace(/;\s*$/, '').trim();
}

/** Validate the model output is a single read-only SELECT/WITH and ensure a LIMIT. */
export function validateReadOnly(input: string): GuardResult {
  const sql = extractSql(input);
  if (!sql) return { ok: false, error: 'No SQL was generated.' };
  if (sql.includes(';')) return { ok: false, error: 'Only a single statement is allowed.' };
  if (!/^(select|with)\b/i.test(sql)) {
    return { ok: false, error: 'Only read-only SELECT queries are allowed.' };
  }
  if (FORBIDDEN.test(sql)) {
    return { ok: false, error: 'Only read-only SELECT queries are allowed.' };
  }
  const limited = /\blimit\b/i.test(sql) ? sql : `${sql} LIMIT 100`;
  return { ok: true, sql: limited };
}
