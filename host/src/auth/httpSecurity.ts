import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  extensionIdFromOrigin,
  isAllowedBrowserOrigin,
  OVERLEAF_BROWSER_ORIGIN,
  type PairingService,
} from './pairing.js';

const PUBLIC_HTTP_PATHS = new Set(['/v1/health', '/v1/pair']);
export const EXTENSION_ID_HEADER = 'x-iris-extension-id';

function pathnameFor(request: FastifyRequest) {
  return request.url.split('?', 1)[0];
}

function setCorsHeaders(reply: FastifyReply, origin: string) {
  reply.header('Access-Control-Allow-Origin', origin);
  reply.header('Vary', 'Origin');
  reply.header('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  reply.header(
    'Access-Control-Allow-Headers',
    `authorization,content-type,${EXTENSION_ID_HEADER}`
  );
}

function bearerToken(request: FastifyRequest) {
  const authorization = request.headers.authorization;
  if (!authorization) return null;
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
  return match?.[1] ?? null;
}

export function registerHttpSecurity(
  server: FastifyInstance,
  authService: PairingService
) {
  server.addHook('onRequest', async (request, reply) => {
    const pathname = pathnameFor(request);
    const isPublic = PUBLIC_HTTP_PATHS.has(pathname);
    const origin = request.headers.origin;
    const extensionId = extensionIdFromOrigin(origin);
    const isOverleafOrigin = origin === OVERLEAF_BROWSER_ORIGIN;

    if (request.method === 'OPTIONS') {
      const allowed = isPublic
        ? isAllowedBrowserOrigin(origin)
        : Boolean(
            (extensionId && authService.hasPairedExtension(extensionId)) ||
              (isOverleafOrigin && authService.getStatus().paired)
          );
      if (!allowed || !origin) {
        reply.code(403).send({ error: 'origin_not_allowed' });
        return;
      }
      setCorsHeaders(reply, origin);
      reply.code(204).send();
      return;
    }

    if (isPublic) {
      if (origin) {
        if (!isAllowedBrowserOrigin(origin)) {
          reply.code(403).send({ error: 'origin_not_allowed' });
          return;
        }
        setCorsHeaders(reply, origin);
      }
      return;
    }

    if (!origin || (!extensionId && !isOverleafOrigin)) {
      reply.code(403).send({ error: 'origin_not_allowed' });
      return;
    }
    if (
      (extensionId && !authService.hasPairedExtension(extensionId)) ||
      (isOverleafOrigin && !authService.getStatus().paired)
    ) {
      reply.code(403).send({ error: 'origin_not_allowed' });
      return;
    }
    setCorsHeaders(reply, origin);

    const claimedExtensionId = request.headers[EXTENSION_ID_HEADER];
    if (
      typeof claimedExtensionId !== 'string' ||
      !authService.hasPairedExtension(claimedExtensionId) ||
      (extensionId !== null && claimedExtensionId !== extensionId)
    ) {
      reply.code(401).send({ error: 'unauthorized' });
      return;
    }

    const token = bearerToken(request);
    if (!token || !authService.verifyToken(token, claimedExtensionId)) {
      reply.code(401).send({ error: 'unauthorized' });
    }
  });
}
