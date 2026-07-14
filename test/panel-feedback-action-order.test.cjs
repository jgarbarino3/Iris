const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('Patch review action buttons are ordered accept, reject, feedback', () => {
  const cardPath = path.join(
    __dirname,
    '..',
    'src',
    'iso',
    'panel',
    'PatchReviewCard.tsx'
  );
  const contents = fs.readFileSync(cardPath, 'utf8');

  const pendingStart = contents.indexOf("status === 'pending'");
  assert.ok(pendingStart >= 0, 'expected pending patch review actions');
  const pendingEnd = contents.indexOf(') : null}', pendingStart);
  assert.ok(pendingEnd >= 0, 'expected end of pending patch review actions');
  const section = contents.slice(pendingStart, pendingEnd);

  // Conflict recovery has its own explicit Strict rebase → Retarget →
  // Regenerate → Reject ordering. Locate the ordinary review branch from its
  // Accept handler so the legacy action-order contract remains scoped to the
  // non-conflict card.
  const acceptIdx = section.indexOf('onClick={onAccept}');
  const rejectIdx = section.indexOf('onClick={onReject}', acceptIdx);
  const feedbackIdx = section.indexOf('onClick={onFeedback}', rejectIdx);
  assert.ok(acceptIdx >= 0, 'expected accept button');
  assert.ok(rejectIdx >= 0, 'expected reject button');
  assert.ok(feedbackIdx >= 0, 'expected feedback button');
  assert.ok(
    acceptIdx < rejectIdx && rejectIdx < feedbackIdx,
    'expected order accept < reject < feedback'
  );
});
