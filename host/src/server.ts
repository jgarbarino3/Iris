import Fastify from 'fastify';

import { registerHttpSecurity } from './auth/httpSecurity.js';
import { createPairingService, type PairingService } from './auth/pairing.js';
import type { HostDiagnosticDependencies } from './diagnostics/runHostDiagnostics.js';
import { registerAttachments } from './routes/attachments.js';
import { registerDiagnostics } from './routes/diagnostics.js';
import { registerHealth } from './routes/health.js';
import { registerJobs } from './routes/jobs.js';
import { registerPairing } from './routes/pairing.js';
import { registerRuntime } from './routes/runtime.js';
import registerSessionRoutes from './routes/sessions.js';
import { shutdownToolRuntime } from './runtimes/pi/toolRuntime.js';

export type BuildServerOptions = {
  diagnostics?: Partial<HostDiagnosticDependencies>;
  transport?: 'http' | 'native';
  authService?: PairingService;
};

export function buildServer(options: BuildServerOptions = {}) {
  const server = Fastify({ logger: false, bodyLimit: 50 * 1024 * 1024 });
  const transport = options.transport ?? 'native';
  const authService =
    transport === 'http'
      ? options.authService ?? createPairingService()
      : undefined;

  if (authService) {
    registerHttpSecurity(server, authService);
    registerPairing(server, authService);
  }

  registerHealth(server, authService);
  registerDiagnostics(server, options.diagnostics);
  registerAttachments(server);
  registerJobs(server);
  registerRuntime(server);
  void registerSessionRoutes(server);

  server.addHook('onClose', async () => {
    await shutdownToolRuntime();
  });

  return server;
}
