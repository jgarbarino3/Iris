import type { FastifyInstance } from 'fastify';
import {
  decodeNativeMessages,
  encodeNativeMessage,
  NativeMessageTooLargeError,
} from './nativeMessaging/protocol.js';
import { subscribeToJobEvents } from './routes/jobs.js';
import type { JobEvent } from './types.js';

export type NativeHostRequest = {
  id: string;
  kind: 'request';
  request: {
    method: 'GET' | 'POST' | 'DELETE';
    path: string;
    headers?: Record<string, string>;
    body?: unknown;
    stream?: boolean;
  };
};

export type NativeHostResponse =
  | {
      id: string;
      kind: 'response';
      status: number;
      body?: unknown;
      headers?: Record<string, string>;
    }
  | { id: string; kind: 'event'; event: JobEvent }
  | { id: string; kind: 'end' }
  | { id: string; kind: 'error'; message: string };

const NATIVE_REQUEST_ID_MAX_LENGTH = 128;
const NATIVE_PATH_MAX_LENGTH = 4096;

function isAllowedNativeRoute(method: string, path: string, stream: boolean) {
  let url: URL;
  try {
    url = new URL(path, 'http://native.local');
  } catch {
    return false;
  }
  if (
    url.origin !== 'http://native.local' ||
    !url.pathname.startsWith('/v1/')
  ) {
    return false;
  }

  const route = `${method} ${url.pathname}`;
  if (stream) {
    return method === 'GET' && /^\/v1\/jobs\/[^/]+\/events$/.test(url.pathname);
  }
  if (
    new Set([
      'POST /v1/jobs',
      'GET /v1/runtime/claude/metadata',
      'POST /v1/runtime/codex/metadata',
      'POST /v1/runtime/claude/preferences',
      'GET /v1/runtime/claude/context',
      'POST /v1/runtime/codex/context',
      'GET /v1/runtime/pi/metadata',
      'POST /v1/runtime/pi/preferences',
      'GET /v1/runtime/pi/context',
      'GET /v1/health',
      'GET /v1/diagnostics',
      'POST /v1/attachments/open',
      'POST /v1/attachments/validate',
    ]).has(route)
  ) {
    return true;
  }
  return (
    (method === 'POST' && /^\/v1\/jobs\/[^/]+\/respond$/.test(url.pathname)) ||
    (method === 'DELETE' &&
      /^\/v1\/sessions\/(claude|codex|pi)\/[^/]+$/.test(url.pathname))
  );
}

export function validateNativeHostRequest(
  value: unknown
): NativeHostRequest | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<NativeHostRequest>;
  if (
    candidate.kind !== 'request' ||
    typeof candidate.id !== 'string' ||
    candidate.id.length < 1 ||
    candidate.id.length > NATIVE_REQUEST_ID_MAX_LENGTH ||
    !candidate.request ||
    typeof candidate.request !== 'object'
  ) {
    return null;
  }
  const request = candidate.request;
  if (
    !['GET', 'POST', 'DELETE'].includes(request.method) ||
    typeof request.path !== 'string' ||
    request.path.length < 1 ||
    request.path.length > NATIVE_PATH_MAX_LENGTH ||
    request.headers !== undefined ||
    (request.stream !== undefined && typeof request.stream !== 'boolean') ||
    !isAllowedNativeRoute(request.method, request.path, request.stream === true)
  ) {
    return null;
  }
  return candidate as NativeHostRequest;
}

export function runNativeMessagingHost({
  server,
  input = process.stdin,
  output = process.stdout,
}: {
  server: FastifyInstance;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}) {
  // Use the broad Buffer type to avoid ArrayBuffer vs SharedArrayBuffer generic mismatches
  // across Node versions (subarray() can return Buffer<ArrayBufferLike>).
  let carry: Buffer = Buffer.alloc(0) as Buffer;
  const activeSubscriptions = new Map<string, () => void>();
  let processingChain = Promise.resolve();

  const send = (message: NativeHostResponse) => {
    try {
      output.write(encodeNativeMessage(message));
    } catch (error) {
      if (!(error instanceof NativeMessageTooLargeError)) throw error;
      output.write(
        encodeNativeMessage({
          id:
            message.id.length <= NATIVE_REQUEST_ID_MAX_LENGTH
              ? message.id
              : 'invalid-request',
          kind: 'error',
          message: 'PAYLOAD_TOO_LARGE',
        })
      );
    }
  };

  const cleanup = () => {
    for (const unsubscribe of activeSubscriptions.values()) {
      unsubscribe();
    }
    activeSubscriptions.clear();
  };

  const processMessage = async (value: unknown) => {
    const request = validateNativeHostRequest(value);
    if (!request) {
      send({
        id: 'invalid-request',
        kind: 'error',
        message: 'INVALID_REQUEST',
      });
      return;
    }

    if (
      request.request.stream &&
      /\/v1\/jobs\/[^/]+\/events$/.test(request.request.path)
    ) {
      const match = request.request.path.match(/\/v1\/jobs\/([^/]+)\/events/);
      const jobId = match?.[1];
      if (!jobId) {
        send({ id: request.id, kind: 'error', message: 'invalid_job_id' });
        return;
      }

      const subscription = subscribeToJobEvents(jobId, {
        send: (event) => send({ id: request.id, kind: 'event', event }),
        end: () => {
          send({ id: request.id, kind: 'end' });
          activeSubscriptions.delete(request.id);
        },
      });

      if (!subscription.ok) {
        send({ id: request.id, kind: 'error', message: subscription.error });
        return;
      }

      if (subscription.done) {
        // Already completed, no cleanup needed
        return;
      }

      // Track subscription for cleanup
      activeSubscriptions.set(request.id, subscription.unsubscribe);
      return;
    }

    try {
      // Fastify's inject types can be overly broad/thenable depending on TS/Node libs.
      // Treat the response as a minimal shape we need.
      const reply = (await server.inject({
        method: request.request.method,
        url: request.request.path,
        payload: request.request.body as any,
        headers: request.request.headers as any,
      } as any)) as any;

      const bodyText: string =
        typeof reply.body === 'string' ? reply.body : String(reply.body ?? '');
      let body: unknown = bodyText;
      try {
        body = bodyText ? (JSON.parse(bodyText) as unknown) : undefined;
      } catch {
        body = bodyText;
      }

      // Normalize headers to string values only
      const normalizedHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(reply.headers)) {
        if (typeof value === 'string') {
          normalizedHeaders[key] = value;
        } else if (Array.isArray(value)) {
          normalizedHeaders[key] = value.join(', ');
        } else if (typeof value === 'number') {
          normalizedHeaders[key] = String(value);
        }
      }

      send({
        id: request.id,
        kind: 'response',
        status: typeof reply.statusCode === 'number' ? reply.statusCode : 500,
        headers: normalizedHeaders,
        body,
      });
    } catch (error) {
      send({
        id: request.id,
        kind: 'error',
        message: 'native_host_error',
      });
    }
  };

  input.on('data', (chunk: Buffer) => {
    const {
      messages,
      carry: nextCarry,
      fatal,
    } = decodeNativeMessages(Buffer.concat([carry, chunk]));
    carry = nextCarry;

    if (fatal) {
      cleanup();
      input.removeAllListeners('data');
      if ('destroy' in input && typeof input.destroy === 'function') {
        input.destroy();
      }
      return;
    }

    for (const message of messages) {
      processingChain = processingChain
        .then(() => processMessage(message))
        .catch(() => {
          console.error('Native messaging host processing error');
        });
    }
  });

  input.on('end', cleanup);
  input.on('close', cleanup);
  input.on('error', cleanup);
}
