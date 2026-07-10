import { strict as assert } from 'node:assert';
import test from 'node:test';

import { sendCompactCommand } from '../src/compaction/sendCompact.js';

test('Codex compact rejects if no threadId provided', async () => {
  const mockEvents: any[] = [];
  const emitEvent = (event: any) => mockEvents.push(event);

  const payload = {
    runtime: {
      codex: {
        threadId: '',
      },
    },
  };

  try {
    await sendCompactCommand('codex', payload, emitEvent);
    assert.fail('Should have thrown missing threadId error');
  } catch (error: any) {
    assert.match(error.message, /No Codex thread/i);
  }
});

test('Codex compact rejects if threadId is whitespace only', async () => {
  const mockEvents: any[] = [];
  const emitEvent = (event: any) => mockEvents.push(event);

  const payload = {
    runtime: {
      codex: {
        threadId: '   ',
      },
    },
  };

  try {
    await sendCompactCommand('codex', payload, emitEvent);
    assert.fail('Should have thrown missing threadId error');
  } catch (error: any) {
    assert.match(error.message, /No Codex thread/i);
  }
});

test('Claude compact rejects concurrent compaction', async () => {
  const conversationId = 'test-conversation';
  const mockEvents: any[] = [];
  const emitEvent = (event: any) => mockEvents.push(event);

  let signalStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve;
  });
  let releaseFirst!: () => void;
  const release = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const runClaudeText = async () => {
    signalStarted();
    await release;
    return { resultText: 'compacted', emittedPatchFiles: new Set<string>() };
  };

  const payload = {
    runtime: {
      claude: {
        conversationId,
        cliPath: process.execPath,
      },
    },
  };

  const firstCompact = sendCompactCommand('claude', payload, emitEvent, { runClaudeText });
  await started;

  await assert.rejects(
    sendCompactCommand('claude', payload, emitEvent, { runClaudeText }),
    /already in progress/i
  );

  releaseFirst();
  await firstCompact;
});
