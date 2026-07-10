import type { FastifyInstance } from 'fastify';

import {
  extensionIdFromOrigin,
  isAllowedBrowserOrigin,
  PairingError,
  type PairRequestV1,
  type PairingService,
} from '../auth/pairing.js';

export function registerPairing(
  server: FastifyInstance,
  authService: PairingService
) {
  server.post('/v1/pair', async (request, reply) => {
    const body = request.body as Partial<PairRequestV1> | undefined;
    const code = typeof body?.code === 'string' ? body.code.trim() : '';
    const extensionInstanceId =
      typeof body?.extensionInstanceId === 'string'
        ? body.extensionInstanceId.trim()
        : '';
    const originExtensionId = extensionIdFromOrigin(request.headers.origin);

    if (
      !isAllowedBrowserOrigin(request.headers.origin) ||
      (originExtensionId && originExtensionId !== extensionInstanceId)
    ) {
      reply.code(403).send({ error: 'origin_not_allowed' });
      return;
    }

    try {
      reply.send(authService.pair({ code, extensionInstanceId }));
    } catch (error) {
      if (error instanceof PairingError) {
        reply
          .code(error.code === 'invalid_request' ? 400 : 401)
          .send({ error: error.code });
        return;
      }
      reply.code(500).send({ error: 'pairing_failed' });
    }
  });
}
