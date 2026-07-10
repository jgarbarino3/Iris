#!/usr/bin/env node
import 'dotenv/config';

import { resetPairingCredentials } from './pairing.js';

const { pairingCode } = resetPairingCredentials();
process.stdout.write('Iris local-host tokens revoked.\n');
process.stdout.write(`New pairing code: ${pairingCode}\n`);
