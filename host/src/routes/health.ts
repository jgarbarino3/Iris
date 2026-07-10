import type { FastifyInstance } from 'fastify';
import type { PairingService } from '../auth/pairing.js';
import { reloadDotenv } from '../reloadDotenv.js';

import { getClaudeRuntimeStatus } from '../runtimes/claude/client.js';
import { getPiRuntimeStatus } from '../runtimes/pi/client.js';

// Captured once at module load — changes on host restart.
const startedAt = new Date().toISOString();

export function registerHealth(
  server: FastifyInstance,
  authService?: PairingService
) {
  server.get('/v1/health', async () => {
    if (authService) {
      return {
        status: 'ok',
        startedAt,
        pairing: {
          required: true,
          paired: authService.getStatus().paired,
        },
      };
    }

    // Re-read .env so API key changes (additions AND removals) take effect.
    reloadDotenv();
    return {
      status: 'ok',
      startedAt,
      claude: getClaudeRuntimeStatus(),
      pi: getPiRuntimeStatus(),
    };
  });
}
