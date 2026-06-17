import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from 'aws-lambda';
import { Client } from 'pg';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

/**
 * Pagila Query Handler Lambda Function
 *
 * Handles POST requests to /query endpoint
 * - Retrieves database credentials from Secrets Manager
 * - Executes SQL queries against Aurora PostgreSQL
 * - Returns results as JSON for both SELECT and non-SELECT queries
 *
 * Environment Variables:
 * - DB_SECRET_NAME: Name of secret in Secrets Manager
 * - DB_HOST: Database host (Aurora endpoint)
 * - DB_PORT: Database port (default: 5432)
 * - DB_NAME: Database name (default: pagila)
 * - NODE_ENV: Execution environment
 */

interface DBCredentials {
  username: string;
  password: string;
  host: string;
  port: number;
  dbname: string;
}

interface QueryRequest {
  query: string;
}

interface QueryResponse {
  success: boolean;
  rows?: Array<Record<string, unknown>>;
  count?: number;
  message?: string;
  error?: string;
  executedAt?: string;
}

/**
 * Get database credentials from Secrets Manager
 */
async function getDBCredentials(): Promise<DBCredentials> {
  const secretName = process.env.DB_SECRET_NAME;

  if (!secretName) {
    throw new Error('DB_SECRET_NAME environment variable not set');
  }

  const secretsClient = new SecretsManagerClient({
    region: process.env.AWS_REGION || 'us-east-1',
  });

  try {
    const response = await secretsClient.send(
      new GetSecretValueCommand({ SecretId: secretName })
    );

    if (!response.SecretString) {
      throw new Error('Secret value is empty');
    }

    const credentials = JSON.parse(response.SecretString);
    return {
      username: credentials.username,
      password: credentials.password,
      host: credentials.host || process.env.DB_HOST || 'localhost',
      port: credentials.port || parseInt(process.env.DB_PORT || '5432', 10),
      dbname: credentials.dbname || process.env.DB_NAME || 'pagila',
    };
  } catch (error) {
    console.error('Error retrieving database credentials:', error);
    throw new Error(`Failed to retrieve database credentials: ${error}`);
  }
}

/**
 * Execute SQL query and return results
 */
async function executeQuery(client: Client, query: string): Promise<QueryResponse> {
  try {
    // Validate query is not empty
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return {
        success: false,
        error: 'Query cannot be empty',
      };
    }

    console.log('Executing query:', trimmedQuery.substring(0, 100));

    // Execute the query
    const result = await client.query(trimmedQuery);

    // Handle SELECT queries - return rows
    if (trimmedQuery.toUpperCase().startsWith('SELECT')) {
      return {
        success: true,
        rows: result.rows,
        count: result.rows.length,
        executedAt: new Date().toISOString(),
      };
    }

    // Handle INSERT, UPDATE, DELETE, etc.
    return {
      success: true,
      message: `Query executed successfully. ${result.rowCount || 0} rows affected.`,
      count: result.rowCount || 0,
      executedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Query execution error:', error);
    return {
      success: false,
      error: `Query execution failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Parse request body and extract query
 */
function parseRequest(event: APIGatewayProxyEvent): { query: string } | null {
  try {
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    const query = body?.query;

    if (!query || typeof query !== 'string') {
      return null;
    }

    return { query };
  } catch (error) {
    console.error('Error parsing request:', error);
    return null;
  }
}

/**
 * Create API Gateway response
 */
function createResponse(
  statusCode: number,
  body: QueryResponse
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
    body: JSON.stringify(body),
  };
}

/**
 * Main Lambda handler
 */
export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  console.log('Received event:', JSON.stringify(event, null, 2));
  console.log('Function ARN:', context.invokedFunctionArn);

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return createResponse(200, {
      success: true,
      message: 'CORS preflight OK',
    });
  }

  // Parse the incoming request
  const parsedRequest = parseRequest(event);

  if (!parsedRequest) {
    return createResponse(400, {
      success: false,
      error: 'Invalid request. Body must contain JSON with "query" field.',
    });
  }

  const { query } = parsedRequest;

  let client: Client | null = null;

  try {
    // Get database credentials
    console.log('Retrieving database credentials...');
    const credentials = await getDBCredentials();

    // Create PostgreSQL client
    client = new Client({
      host: credentials.host,
      port: credentials.port,
      database: credentials.dbname,
      user: credentials.username,
      password: credentials.password,
      // Connection timeout: 10 seconds
      connectionTimeoutMillis: 10000,
      // Query timeout: 30 seconds
      statement_timeout: 30000,
    });

    // Connect to database
    console.log('Connecting to database...');
    await client.connect();
    console.log('Connected to database successfully');

    // Execute the query
    const result = await executeQuery(client, query);

    // Determine status code
    const statusCode = result.success ? 200 : 400;

    return createResponse(statusCode, result);
  } catch (error) {
    console.error('Lambda execution error:', error);

    const errorMessage =
      error instanceof Error ? error.message : String(error);

    return createResponse(500, {
      success: false,
      error: `Internal server error: ${errorMessage}`,
    });
  } finally {
    // Close database connection
    if (client) {
      try {
        console.log('Closing database connection...');
        await client.end();
      } catch (closeError) {
        console.error('Error closing database connection:', closeError);
      }
    }
  }
};

/**
 * Export handler for CDK to reference
 */
export default handler;
