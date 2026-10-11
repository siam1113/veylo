import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { env } from './env.js';
import { createHash, timingSafeEqual } from 'node:crypto';
import { sqlClient } from '@veylo/db/client';
import { authenticate } from './auth.js';
import { alignmentRoutes } from './routes/alignments.js';
import { intentionRoutes } from './routes/intentions.js';
import { integrationRoutes } from './routes/integrations.js';
import { telemetryRoutes } from './routes/telemetry.js';
import { voiceRoutes } from './routes/voice-agent.js';
import { spaceInsightRoutes } from './routes/space-insight.js';
import { closeQueue } from './jobs/queue.js';
import { isCorsOriginAllowed, parseCorsOrigins } from './cors.js';

const app = Fastify({
  // OAuth callback URLs carry authorization codes and signed state in the query string.
  // Redact the full URL in Fastify's automatic request logs to keep those values out of logs.
  logger: { level: env.NODE_ENV === 'production' ? 'info' : 'debug', redact: ['req.headers.authorization', 'req.headers.x-metrics-token', 'req.url'] },
  trustProxy: env.NODE_ENV === 'production',
  bodyLimit: 256 * 1024,
});

const requestStarts = new WeakMap<object, bigint>();
const metricBuckets = [0.05, 0.1, 0.3, 1, 3, 10];
const requestCounts = new Map<string, number>();
const durationCounts = new Map<string, number>();
const durationSums = new Map<string, number>();
const durationBuckets = new Map<string, number[]>();
const metricKey = (method: string, route: string, status: number) => JSON.stringify([method, route, status]);
const routeKey = (method: string, route: string) => JSON.stringify([method, route]);
const escapeLabel = (value: string) => value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');

app.addHook('onRequest', async (request) => { requestStarts.set(request, process.hrtime.bigint()); });
app.addHook('onResponse', async (request, reply) => {
  const started = requestStarts.get(request);
  if (started === undefined) return;
  const route = request.routeOptions.url ?? 'unmatched';
  const status = reply.statusCode;
  const requestLabel = metricKey(request.method, route, status);
  requestCounts.set(requestLabel, (requestCounts.get(requestLabel) ?? 0) + 1);
  const durationLabel = routeKey(request.method, route);
  const seconds = Number(process.hrtime.bigint() - started) / 1_000_000_000;
  durationCounts.set(durationLabel, (durationCounts.get(durationLabel) ?? 0) + 1);
  durationSums.set(durationLabel, (durationSums.get(durationLabel) ?? 0) + seconds);
  const buckets = durationBuckets.get(durationLabel) ?? Array(metricBuckets.length).fill(0) as number[];
  metricBuckets.forEach((bound, index) => { if (seconds <= bound) buckets[index] = buckets[index]! + 1; });
  durationBuckets.set(durationLabel, buckets);
});

await app.register(helmet, { contentSecurityPolicy: false });
const allowedCorsOrigins = parseCorsOrigins(env.WEB_ORIGIN, env.CORS_ORIGINS);
await app.register(cors, { origin: (origin, callback) => callback(null, isCorsOriginAllowed(origin, allowedCorsOrigins, env.NODE_ENV !== 'production')), credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Authorization', 'Content-Type'] });
await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
app.addHook('preHandler', authenticate);

app.get('/health', async () => ({ status: 'ok', service: 'veylo-api' }));
app.get('/ready', async (_request, reply) => {
  try {
    await sqlClient`SELECT 1`;
    return { status: 'ready', service: 'veylo-api' };
  } catch {
    return reply.code(503).send({ status: 'not_ready', service: 'veylo-api' });
  }
});
app.get('/metrics', async (request, reply) => {
  if (!env.METRICS_TOKEN) return reply.code(404).send('not found');
  const supplied = request.headers['x-metrics-token'];
  const providedToken = Array.isArray(supplied) ? supplied[0] : supplied;
  if (!providedToken || !timingSafeEqual(createHash('sha256').update(providedToken).digest(), createHash('sha256').update(env.METRICS_TOKEN).digest())) {
    return reply.code(401).send('unauthorized');
  }
  const lines = ['# HELP veylo_http_requests_total Total HTTP responses served by the API.', '# TYPE veylo_http_requests_total counter'];
  for (const [serialized, count] of requestCounts) {
    const [method, route, status] = JSON.parse(serialized) as [string, string, number];
    lines.push(`veylo_http_requests_total{method="${escapeLabel(method)}",route="${escapeLabel(route)}",status_code="${status}"} ${count}`);
  }
  lines.push('# HELP veylo_http_request_duration_seconds HTTP response duration in seconds.', '# TYPE veylo_http_request_duration_seconds histogram');
  for (const [serialized, count] of durationCounts) {
    const [method, route] = JSON.parse(serialized) as [string, string];
    const labels = `method="${escapeLabel(method)}",route="${escapeLabel(route)}"`;
    const buckets = durationBuckets.get(serialized) ?? [];
    metricBuckets.forEach((bound, index) => {
      lines.push(`veylo_http_request_duration_seconds_bucket{${labels},le="${bound}"} ${buckets[index] ?? 0}`);
    });
    lines.push(`veylo_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${count}`);
    lines.push(`veylo_http_request_duration_seconds_sum{${labels}} ${durationSums.get(serialized) ?? 0}`);
    lines.push(`veylo_http_request_duration_seconds_count{${labels}} ${count}`);
  }
  const memory = process.memoryUsage();
  lines.push('# HELP process_uptime_seconds API process uptime in seconds.', '# TYPE process_uptime_seconds gauge', `process_uptime_seconds ${process.uptime()}`);
  lines.push('# HELP process_resident_memory_bytes API resident memory in bytes.', '# TYPE process_resident_memory_bytes gauge', `process_resident_memory_bytes ${memory.rss}`);
  lines.push('# HELP process_heap_used_bytes API heap memory in use.', '# TYPE process_heap_used_bytes gauge', `process_heap_used_bytes ${memory.heapUsed}`);
  reply.header('Cache-Control', 'no-store').type('text/plain; version=0.0.4; charset=utf-8').send(`${lines.join('\n')}\n`);
});
await app.register(intentionRoutes, { prefix: '/v1' });
await app.register(alignmentRoutes, { prefix: '/v1' });
await app.register(integrationRoutes, { prefix: '/v1' });
await app.register(telemetryRoutes, { prefix: '/v1' });
await app.register(voiceRoutes, { prefix: '/v1' });
await app.register(spaceInsightRoutes, { prefix: '/v1' });

app.setErrorHandler((error, request, reply) => {
  request.log.error({ err: error }, 'request failed');
  const statusCode = error instanceof Error && 'statusCode' in error
    && typeof error.statusCode === 'number' && error.statusCode >= 400 ? error.statusCode : 500;
  const message = error instanceof Error ? error.message : 'Request failed.';
  reply.code(statusCode).send({ error: statusCode >= 500 ? 'internal_error' : 'request_error', message: statusCode >= 500 ? 'Something went wrong. Try again.' : message });
});

if (env.NODE_ENV === 'production' && !env.METRICS_TOKEN) app.log.warn('Authenticated /metrics endpoint is disabled because METRICS_TOKEN is not configured.');
await app.listen({ port: env.PORT, host: env.HOST });

const shutdown = async () => {
  await app.close();
  await closeQueue();
  await sqlClient.end({ timeout: 5 });
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
