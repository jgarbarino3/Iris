import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
const MAX_PAIRING_ATTEMPTS = 5;
export const OVERLEAF_BROWSER_ORIGIN = 'https://www.overleaf.com';

export type PairRequestV1 = {
  code: string;
  extensionInstanceId: string;
};

export type PairResponseV1 = {
  tokenId: string;
  token: string;
};

type StoredTokenV1 = {
  tokenId: string;
  tokenHash: string;
  extensionInstanceId: string;
  createdAt: string;
  lastUsedAt: string;
};

type StoredPairingV1 = {
  codeHash: string;
  expiresAt: string;
  failedAttempts: number;
  consumed: boolean;
};

type CredentialsFileV1 = {
  schemaVersion: 1;
  updatedAt: string;
  tokens: StoredTokenV1[];
  pairing?: StoredPairingV1;
};

type CredentialsState = {
  tokens: StoredTokenV1[];
  pairing?: StoredPairingV1;
};

export type PairingServiceOptions = {
  credentialsPath?: string;
  now?: () => Date;
  generatePairingCode?: () => string;
  generateToken?: () => string;
  generateTokenId?: () => string;
};

export type ResetPairingOptions = Pick<
  PairingServiceOptions,
  'credentialsPath' | 'now' | 'generatePairingCode'
>;

export type PairingService = ReturnType<typeof createPairingService>;

export class PairingError extends Error {
  constructor(
    public readonly code: 'invalid_request' | 'pairing_unavailable',
    message: string
  ) {
    super(message);
    this.name = 'PairingError';
  }
}

function defaultCredentialsPath() {
  return path.join(os.homedir(), '.iris', 'credentials.json');
}

function defaultPairingCode() {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

function defaultToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashSecret(value: string) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function hashesEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return (
    leftBuffer.length === rightBuffer.length &&
    leftBuffer.length > 0 &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function isExtensionId(value: string) {
  return /^[a-p]{32}$/.test(value);
}

export function extensionIdFromOrigin(
  origin: string | undefined
): string | null {
  if (!origin) return null;
  const match = /^chrome-extension:\/\/([a-p]{32})$/.exec(origin.trim());
  return match?.[1] ?? null;
}

export function isAllowedBrowserOrigin(origin: string | undefined) {
  return (
    origin === OVERLEAF_BROWSER_ORIGIN || extensionIdFromOrigin(origin) !== null
  );
}

function validToken(value: unknown): value is StoredTokenV1 {
  const token = value as Partial<StoredTokenV1> | null;
  return Boolean(
    token &&
      typeof token.tokenId === 'string' &&
      typeof token.tokenHash === 'string' &&
      typeof token.extensionInstanceId === 'string' &&
      typeof token.createdAt === 'string' &&
      typeof token.lastUsedAt === 'string'
  );
}

function validPairing(value: unknown): value is StoredPairingV1 {
  const pairing = value as Partial<StoredPairingV1> | null;
  return Boolean(
    pairing &&
      typeof pairing.codeHash === 'string' &&
      typeof pairing.expiresAt === 'string' &&
      Number.isInteger(pairing.failedAttempts) &&
      typeof pairing.consumed === 'boolean'
  );
}

function loadCredentials(credentialsPath: string): CredentialsState {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(credentialsPath, 'utf8')
    ) as Partial<CredentialsFileV1>;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.tokens)) {
      return { tokens: [] };
    }
    return {
      tokens: parsed.tokens.filter(validToken),
      pairing: validPairing(parsed.pairing) ? parsed.pairing : undefined,
    };
  } catch {
    return { tokens: [] };
  }
}

function persistCredentials(
  credentialsPath: string,
  now: Date,
  state: CredentialsState
) {
  const directory = path.dirname(credentialsPath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(directory, 0o700);
  } catch {
    // Best effort on filesystems that do not support POSIX permissions.
  }

  const payload: CredentialsFileV1 = {
    schemaVersion: 1,
    updatedAt: now.toISOString(),
    tokens: state.tokens,
    ...(state.pairing ? { pairing: state.pairing } : {}),
  };
  const temporaryPath = `${credentialsPath}.tmp-${
    process.pid
  }-${crypto.randomUUID()}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  try {
    fs.chmodSync(temporaryPath, 0o600);
  } catch {
    // Best effort on filesystems that do not support POSIX permissions.
  }
  fs.renameSync(temporaryPath, credentialsPath);
  try {
    fs.chmodSync(credentialsPath, 0o600);
  } catch {
    // Best effort on filesystems that do not support POSIX permissions.
  }
}

function newPairing(code: string, now: Date): StoredPairingV1 {
  return {
    codeHash: hashSecret(code),
    expiresAt: new Date(now.getTime() + PAIRING_CODE_TTL_MS).toISOString(),
    failedAttempts: 0,
    consumed: false,
  };
}

export function resetPairingCredentials(options: ResetPairingOptions = {}) {
  const credentialsPath = options.credentialsPath ?? defaultCredentialsPath();
  const now = options.now ?? (() => new Date());
  const generatePairingCode = options.generatePairingCode ?? defaultPairingCode;
  const currentTime = now();
  const pairingCode = generatePairingCode();
  persistCredentials(credentialsPath, currentTime, {
    tokens: [],
    pairing: newPairing(pairingCode, currentTime),
  });
  return { pairingCode };
}

export function createPairingService(options: PairingServiceOptions = {}) {
  const credentialsPath = options.credentialsPath ?? defaultCredentialsPath();
  const now = options.now ?? (() => new Date());
  const generatePairingCode = options.generatePairingCode ?? defaultPairingCode;
  const generateToken = options.generateToken ?? defaultToken;
  const generateTokenId = options.generateTokenId ?? crypto.randomUUID;

  let state = loadCredentials(credentialsPath);
  let pairingCode = generatePairingCode();
  const initializeTime = now();
  state.pairing = newPairing(pairingCode, initializeTime);
  persistCredentials(credentialsPath, initializeTime, state);

  const reload = () => {
    state = loadCredentials(credentialsPath);
    return state;
  };

  const reset = () => {
    const result = resetPairingCredentials({
      credentialsPath,
      now,
      generatePairingCode,
    });
    pairingCode = result.pairingCode;
    reload();
    return result;
  };

  return {
    credentialsPath,

    getPairingCode() {
      return pairingCode;
    },

    getStatus() {
      const current = reload();
      const pairing = current.pairing;
      return {
        paired: current.tokens.length > 0,
        pairingAvailable: Boolean(
          pairing &&
            !pairing.consumed &&
            pairing.failedAttempts < MAX_PAIRING_ATTEMPTS &&
            now().getTime() <= Date.parse(pairing.expiresAt)
        ),
      };
    },

    hasPairedExtension(extensionInstanceId: string) {
      return reload().tokens.some(
        (token) => token.extensionInstanceId === extensionInstanceId
      );
    },

    pair(request: PairRequestV1): PairResponseV1 {
      const currentTime = now();
      const current = reload();
      const pairing = current.pairing;
      if (
        !isExtensionId(request.extensionInstanceId) ||
        !/^\d{6}$/.test(request.code)
      ) {
        throw new PairingError('invalid_request', 'Invalid pairing request');
      }
      if (
        !pairing ||
        pairing.consumed ||
        pairing.failedAttempts >= MAX_PAIRING_ATTEMPTS ||
        currentTime.getTime() > Date.parse(pairing.expiresAt)
      ) {
        throw new PairingError('pairing_unavailable', 'Pairing unavailable');
      }
      if (!hashesEqual(pairing.codeHash, hashSecret(request.code))) {
        pairing.failedAttempts += 1;
        persistCredentials(credentialsPath, currentTime, current);
        throw new PairingError('pairing_unavailable', 'Pairing unavailable');
      }

      const token = generateToken();
      const tokenId = generateTokenId();
      const timestamp = currentTime.toISOString();
      current.tokens = current.tokens.filter(
        (record) => record.extensionInstanceId !== request.extensionInstanceId
      );
      current.tokens.push({
        tokenId,
        tokenHash: hashSecret(token),
        extensionInstanceId: request.extensionInstanceId,
        createdAt: timestamp,
        lastUsedAt: timestamp,
      });
      pairing.consumed = true;
      persistCredentials(credentialsPath, currentTime, current);
      state = current;
      return { tokenId, token };
    },

    verifyToken(token: string, extensionInstanceId?: string) {
      if (!token) return false;
      if (extensionInstanceId && !isExtensionId(extensionInstanceId))
        return false;
      const current = reload();
      const candidateHash = hashSecret(token);
      const record = current.tokens.find(
        (entry) =>
          (!extensionInstanceId ||
            entry.extensionInstanceId === extensionInstanceId) &&
          hashesEqual(entry.tokenHash, candidateHash)
      );
      if (!record) return false;
      const currentTime = now();
      if (currentTime.getTime() - Date.parse(record.lastUsedAt) >= 60_000) {
        record.lastUsedAt = currentTime.toISOString();
        persistCredentials(credentialsPath, currentTime, current);
        state = current;
      }
      return true;
    },

    reset,
  };
}
