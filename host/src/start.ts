#!/usr/bin/env node
import 'dotenv/config';
import { createPairingService } from './auth/pairing.js';
import { buildServer } from './server.js';
import { shutdownToolRuntime } from './runtimes/pi/toolRuntime.js';
import { assertLoopbackHost } from './transport/loopback.js';

// HTTP server entrypoint for development mode
const port = Number(process.env.PORT ?? 3210);
const host = process.env.HOST ?? '127.0.0.1';
assertLoopbackHost(host);
const authService = createPairingService();
const server = buildServer({ transport: 'http', authService });

server
  .listen({ port, host })
  .then((address) => {
    console.log(`Iris host listening on ${address}`);
    console.log(`Iris local pairing code: ${authService.getPairingCode()}`);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

// Graceful shutdown: close HTTP + tool runtime
async function gracefulShutdown(signal: string) {
  console.log(`\n${signal} received — shutting down…`);
  await Promise.allSettled([server.close(), shutdownToolRuntime()]);
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
