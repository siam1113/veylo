import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireOwner } from '../auth.js';

const reportedErrorSchema = z.object({
  source: z.enum(['web', 'ios', 'android']),
  errorType: z.enum(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'unknown']),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export const telemetryRoutes: FastifyPluginAsync = async (app) => {
  app.post('/telemetry/client-errors', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    requireOwner(request);
    const parsed = reportedErrorSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_error_report' });
    request.log.error({
      event: 'client_render_error',
      source: parsed.data.source,
      errorType: parsed.data.errorType,
      fingerprint: parsed.data.fingerprint,
    }, 'client render error reported');
    return reply.code(202).send({ accepted: true });
  });
};
