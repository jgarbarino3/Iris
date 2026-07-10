#!/usr/bin/env node
import 'dotenv/config';

import { runHostDiagnostics } from './diagnostics/runHostDiagnostics.js';

const report = runHostDiagnostics();

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write(`Iris Doctor: ${report.overallStatus}\n`);
  for (const check of report.checks) {
    process.stdout.write(`[${check.status}] ${check.summary}\n`);
    if (check.repair) {
      process.stdout.write(`  Repair guidance: ${check.repair.summary}\n`);
      if (check.repair.command) {
        process.stdout.write(`  Command: ${check.repair.command}\n`);
      }
    }
  }
}

process.exitCode = report.overallStatus === 'broken' ? 1 : 0;
