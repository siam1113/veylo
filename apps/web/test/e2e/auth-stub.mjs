import { createServer } from 'node:http';
import postgres from 'postgres';

const userId = '3078190f-ff7b-44ed-bf0e-739ef0219372';
const port = Number(process.env.AUTH_STUB_PORT ?? 54321);
const database = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
const user = {
  id: userId,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'playwright@veylo.test',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  is_anonymous: false,
};

const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (origin) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  response.setHeader('Access-Control-Allow-Headers', 'authorization, apikey, content-type, x-client-info');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (request.method === 'OPTIONS') { response.writeHead(204).end(); return; }
  if (request.url === '/health') { response.writeHead(200).end('ok'); return; }

  if (request.method === 'GET' && request.url?.startsWith('/auth/v1/user')) {
    if (request.headers.authorization !== 'Bearer veylo-playwright-user-token') {
      response.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ message: 'Invalid test token' }));
      return;
    }
    try {
      await database`INSERT INTO auth.users (id) VALUES (${userId}) ON CONFLICT (id) DO NOTHING`;
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(user));
    } catch {
      response.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ message: 'Test database is unavailable' }));
    }
    return;
  }

  response.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ message: 'Not found' }));
});

server.listen(port, '127.0.0.1');

async function close() {
  server.close();
  await database.end({ timeout: 5 });
}
process.once('SIGINT', () => void close().then(() => process.exit(0)));
process.once('SIGTERM', () => void close().then(() => process.exit(0)));
