import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeProjectChat } from '../src/iso/panel/chatStore.ts';

test('replacement card projections retain durable transaction identity across reload', () => {
  const normalized = normalizeProjectChat({
    version: 1,
    activeProvider: 'claude',
    providers: {
      claude: {
        activeConversationId: 'conversation-1',
        conversations: [
          {
            id: 'conversation-1',
            createdAt: 1,
            updatedAt: 2,
            messages: [
              {
                role: 'system',
                content: '',
                patchReview: {
                  kind: 'replaceSelection',
                  selection: 'remove me',
                  from: 4,
                  to: 13,
                  text: '',
                  status: 'pending',
                  fileName: 'main.tex',
                  transactionId: 'selection-transaction',
                  transactionRevision: 3,
                  projectId: 'project-1',
                  transactionError: 'reconcile before retry',
                },
              },
              {
                role: 'system',
                content: '',
                patchReview: {
                  kind: 'replaceRangeInFile',
                  filePath: 'chapters/main.tex',
                  expectedOldText: 'old text',
                  text: 'new text',
                  from: 20,
                  to: 28,
                  status: 'pending',
                  transactionId: 'file-transaction',
                  transactionRevision: 5,
                  projectId: 'project-1',
                },
              },
            ],
          },
        ],
      },
      codex: { activeConversationId: null, conversations: [] },
      pi: { activeConversationId: null, conversations: [] },
    },
  });

  assert.ok(normalized);
  const messages = normalized.providers.claude.conversations[0]!.messages;
  assert.deepEqual(messages[0]!.patchReview, {
    kind: 'replaceSelection',
    selection: 'remove me',
    from: 4,
    to: 13,
    text: '',
    status: 'pending',
    fileName: 'main.tex',
    transactionId: 'selection-transaction',
    transactionRevision: 3,
    projectId: 'project-1',
    transactionError: 'reconcile before retry',
  });
  assert.deepEqual(messages[1]!.patchReview, {
    kind: 'replaceRangeInFile',
    filePath: 'chapters/main.tex',
    expectedOldText: 'old text',
    text: 'new text',
    from: 20,
    to: 28,
    status: 'pending',
    transactionId: 'file-transaction',
    transactionRevision: 5,
    projectId: 'project-1',
  });
});
