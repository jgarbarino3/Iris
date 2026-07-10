export type NativeMessage = Record<string, unknown>;

export const MAX_NATIVE_HOST_OUTPUT_BYTES = 1_048_576;
export const MAX_NATIVE_INPUT_FRAME_BYTES = 64 * 1024 * 1024;

export class NativeMessageTooLargeError extends Error {
  readonly code = 'PAYLOAD_TOO_LARGE';

  constructor(
    public readonly actualBytes: number,
    public readonly maxBytes: number
  ) {
    super('Native message exceeds the host output limit');
    this.name = 'NativeMessageTooLargeError';
  }
}

export function encodeNativeMessage(
  message: NativeMessage,
  maxBodyBytes = MAX_NATIVE_HOST_OUTPUT_BYTES
): Buffer {
  const json = JSON.stringify(message);
  const body = Buffer.from(json, 'utf8');
  if (body.length > maxBodyBytes) {
    throw new NativeMessageTooLargeError(body.length, maxBodyBytes);
  }
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

export function decodeNativeMessages(buffer: Buffer): {
  messages: NativeMessage[];
  carry: Buffer;
  fatal: boolean;
} {
  const messages: NativeMessage[] = [];
  let offset = 0;

  while (buffer.length - offset >= 4) {
    const length = buffer.readUInt32LE(offset);
    if (length > MAX_NATIVE_INPUT_FRAME_BYTES) {
      console.error('Native messaging protocol: frame too large');
      return { messages, carry: Buffer.alloc(0), fatal: true };
    }
    if (buffer.length - offset - 4 < length) break;

    const payload = buffer
      .subarray(offset + 4, offset + 4 + length)
      .toString('utf8');

    try {
      messages.push(JSON.parse(payload) as NativeMessage);
    } catch {
      console.error('Native messaging protocol: malformed JSON frame');
      // Skip malformed frame and continue processing.
    }

    offset += 4 + length;
  }

  return { messages, carry: buffer.subarray(offset), fatal: false };
}
