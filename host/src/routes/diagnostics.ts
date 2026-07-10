import type { FastifyInstance } from 'fastify';

import {
  runHostDiagnostics,
  type HostDiagnosticDependencies,
} from '../diagnostics/runHostDiagnostics.js';

export function registerDiagnostics(
  server: FastifyInstance,
  dependencies: Partial<HostDiagnosticDependencies> = {}
) {
  server.get('/v1/diagnostics', async () => runHostDiagnostics(dependencies));
}
