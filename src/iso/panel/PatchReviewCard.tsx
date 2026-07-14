import { useEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { StoredPatchReview } from './chatStore';
import { copyToClipboard } from './clipboard';
import { CloseIcon } from './ageaf-icons';
import { DiffReview } from './DiffReview';

export type Message = {
  id: string;
  role: 'system' | 'assistant' | 'user';
  content: string;
};

export const CopyIcon = () => (
  <svg
    class="ageaf-message__copy-icon"
    viewBox="0 0 20 20"
    aria-hidden="true"
    focusable="false"
  >
    <rect
      x="6.5"
      y="3.5"
      width="10"
      height="12"
      rx="2"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
    />
    <rect
      x="3.5"
      y="6.5"
      width="10"
      height="12"
      rx="2"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
    />
  </svg>
);

export const CheckIcon = () => (
  <svg
    class="ageaf-message__copy-check"
    viewBox="0 0 20 20"
    aria-hidden="true"
    focusable="false"
  >
    <path
      d="M5 10.5l3.2 3.2L15 7.2"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
);

const ExpandIcon = () => (
  <svg
    class="ageaf-patch-review__expand-icon"
    viewBox="0 0 20 20"
    aria-hidden="true"
    focusable="false"
  >
    <path
      d="M3 3h7M17 3v7M17 17h-7M3 17v-7M12 8l5-5m0 0h-5m5 0v5"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
);

type PatchReviewCardProps = {
  message: Message;
  patchReview: StoredPatchReview;
  status: 'pending' | 'accepted' | 'rejected';
  error: string | null;
  busy: boolean;
  canAct: boolean;
  copied: boolean;
  onCopy: () => void;
  onAccept: () => void;
  onFeedback: () => void;
  onReject: () => void;
  onStrictRebase?: () => void;
  onRetarget?: () => void;
  markAnimated: () => void;
  isLightMode?: boolean;
};

export function PatchReviewCard({
  message,
  patchReview,
  status,
  error,
  busy,
  canAct,
  copied,
  onCopy,
  onAccept,
  onFeedback,
  onReject,
  onStrictRebase,
  onRetarget,
  markAnimated,
  isLightMode,
}: PatchReviewCardProps) {
  // One-off: animate only the very first time this card is created.
  // Persist a flag so refreshes / subsequent renders do not animate.
  const shouldAnimateRef = useRef<boolean>(!(patchReview as any).hasAnimated);
  const [collapsed, setCollapsed] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [headerCopied, setHeaderCopied] = useState(false);
  const headerCopyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!shouldAnimateRef.current) return;
    markAnimated();
  }, []);

  useEffect(() => {
    return () => {
      if (headerCopyTimerRef.current != null) {
        window.clearTimeout(headerCopyTimerRef.current);
        headerCopyTimerRef.current = null;
      }
    };
  }, []);

  // ESC key handler for modal
  useEffect(() => {
    if (!showModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showModal]);

  let fileLabel: string | null = null;
  if (patchReview.kind === 'replaceRangeInFile') {
    fileLabel = patchReview.filePath;
  } else if (patchReview.kind === 'replaceSelection') {
    fileLabel = patchReview.fileName ?? 'selection.tex';
  } else if (patchReview.kind === 'insertAtCursor') {
    fileLabel = 'cursor';
  }

  let title =
    patchReview.kind === 'insertAtCursor'
      ? 'Review insertion'
      : 'Review changes';
  const conflict = patchReview.conflictPreview;
  if (conflict) {
    title = 'Edit conflict';
  } else if (status === 'accepted') {
    title = 'Review changes · Accepted';
  } else if (status === 'rejected') {
    title = 'Review changes · Rejected';
  }

  const startLineNumber =
    patchReview.kind === 'replaceSelection' ||
    patchReview.kind === 'replaceRangeInFile'
      ? patchReview.lineFrom
      : undefined;

  return (
    <div class="ageaf-patch-review">
      <div class="ageaf-patch-review__header">
        <div class="ageaf-patch-review__title">
          {title}
          {fileLabel ? <span> · {fileLabel}</span> : null}
        </div>
        <div class="ageaf-patch-review__actions">
          <button
            class="ageaf-patch-review__expand-btn"
            type="button"
            onClick={() => setShowModal(true)}
            title="Expand diff"
            aria-label="Expand diff to full screen"
          >
            <ExpandIcon />
          </button>
          <button
            class="ageaf-patch-review__expand-btn"
            type="button"
            onClick={() => {
              void (async () => {
                const ok = await copyToClipboard(
                  (patchReview as any).text ?? ''
                );
                if (!ok) return;
                setHeaderCopied(true);
                if (headerCopyTimerRef.current != null) {
                  window.clearTimeout(headerCopyTimerRef.current);
                }
                headerCopyTimerRef.current = window.setTimeout(() => {
                  setHeaderCopied(false);
                  headerCopyTimerRef.current = null;
                }, 3000);
              })();
            }}
            title="Copy proposed text"
            aria-label="Copy proposed text"
          >
            {headerCopied ? <CheckIcon /> : <CopyIcon />}
          </button>
          {status === 'pending' ? (
            <>
              {conflict ? (
                <>
                  <button
                    class="ageaf-panel__apply"
                    type="button"
                    disabled={
                      busy || !conflict.strictRebaseAvailable || !onStrictRebase
                    }
                    onClick={onStrictRebase}
                    title="Strict rebase"
                    aria-label="Strict rebase"
                  >
                    Strict rebase
                  </button>
                  <button
                    class="ageaf-panel__apply is-secondary"
                    type="button"
                    disabled={busy || !onRetarget}
                    onClick={onRetarget}
                    title="Retarget"
                    aria-label="Retarget"
                  >
                    Retarget
                  </button>
                  <button
                    class="ageaf-panel__apply is-secondary"
                    type="button"
                    disabled={busy}
                    onClick={onFeedback}
                    aria-label="Regenerate this conflicted change"
                  >
                    Regenerate
                  </button>
                  <button
                    class="ageaf-panel__apply is-secondary"
                    type="button"
                    disabled={busy}
                    onClick={onReject}
                    title="Reject"
                    aria-label="Reject"
                  >
                    ✕
                  </button>
                </>
              ) : (
                <>
                  <button
                    class="ageaf-panel__apply"
                    type="button"
                    disabled={!canAct || Boolean(error)}
                    onClick={onAccept}
                    title="Accept"
                    aria-label="Accept"
                  >
                    ✓
                  </button>
                  <button
                    class="ageaf-panel__apply is-secondary"
                    type="button"
                    disabled={busy}
                    onClick={onReject}
                    title="Reject"
                    aria-label="Reject"
                  >
                    ✕
                  </button>
                  {patchReview.kind !== 'insertAtCursor' ? (
                    <button
                      class="ageaf-panel__apply is-secondary"
                      type="button"
                      disabled={busy}
                      onClick={onFeedback}
                      aria-label="Provide feedback on this change"
                    >
                      Feedback
                    </button>
                  ) : null}
                </>
              )}
            </>
          ) : null}
        </div>
      </div>

      {error ? (
        <div class="ageaf-patch-review__warning">
          <span>{error}</span>
          <button
            class="ageaf-panel__apply is-secondary"
            type="button"
            onClick={onCopy}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
            <span>Copy proposed text</span>
          </button>
        </div>
      ) : null}

      {conflict ? (
        <div
          class="ageaf-patch-review__conflict"
          data-conflict-code={conflict.conflictCode}
        >
          <div class="ageaf-patch-review__warning">
            <span>
              {conflict.strictRebaseAvailable
                ? 'One exact anchor match is available. Rebasing creates a new review item and changes nothing in the editor.'
                : conflict.unavailableReason === 'NO_MATCH'
                ? 'Strict rebase unavailable: the exact recorded anchor no longer exists.'
                : conflict.unavailableReason === 'TOO_MANY_CANDIDATES'
                ? 'Strict rebase unavailable: more than 20 exact candidates were found.'
                : conflict.unavailableReason === 'AMBIGUOUS'
                ? `Strict rebase unavailable: ${conflict.candidateCount} exact candidates were found.`
                : conflict.unavailableReason === 'WRONG_PROJECT'
                ? 'Strict rebase unavailable: the recorded project does not match.'
                : 'Strict rebase unavailable: the recorded file identity does not match.'}
            </span>
          </div>
          <div class="ageaf-patch-review__conflict-grid">
            <section>
              <strong>Recorded expected</strong>
              <pre>{conflict.expectedText || '(insertion boundary)'}</pre>
            </section>
            <section>
              <strong>Current observed</strong>
              <pre>{conflict.currentObservedText || '(unavailable)'}</pre>
            </section>
            <section>
              <strong>Proposed</strong>
              <pre>{conflict.proposedText}</pre>
            </section>
          </div>
        </div>
      ) : null}

      <div
        class={`ageaf-patch-review__diff-wrap${
          collapsed ? ' is-collapsed' : ''
        }`}
      >
        {patchReview.kind === 'replaceRangeInFile' ? (
          <DiffReview
            oldText={patchReview.expectedOldText}
            newText={patchReview.text}
            fileName={patchReview.filePath}
            animate={shouldAnimateRef.current}
            startLineNumber={startLineNumber}
            isLightMode={isLightMode}
          />
        ) : patchReview.kind === 'replaceSelection' ? (
          <DiffReview
            oldText={patchReview.selection}
            newText={patchReview.text}
            fileName={patchReview.fileName ?? undefined}
            animate={shouldAnimateRef.current}
            startLineNumber={startLineNumber}
            isLightMode={isLightMode}
          />
        ) : patchReview.kind === 'insertAtCursor' ? (
          <DiffReview
            oldText=""
            newText={patchReview.text}
            fileName="cursor"
            animate={shouldAnimateRef.current}
            isLightMode={isLightMode}
          />
        ) : null}
        {collapsed ? (
          <button
            class="ageaf-patch-review__toggle"
            type="button"
            onClick={() => setCollapsed(false)}
          >
            Show more
          </button>
        ) : null}
      </div>
      {!collapsed ? (
        <button
          class="ageaf-patch-review__toggle"
          type="button"
          onClick={() => setCollapsed(true)}
        >
          Show less
        </button>
      ) : null}

      {showModal
        ? createPortal(
            <div class="ageaf-diff-modal__backdrop">
              <div
                class="ageaf-diff-modal"
                onClick={(e) => e.stopPropagation()}
              >
                <div class="ageaf-diff-modal__header">
                  <div class="ageaf-diff-modal__title">
                    {title}
                    {fileLabel ? <span> · {fileLabel}</span> : null}
                    <span class="ageaf-diff-modal__shortcut-hint">
                      ESC to close
                    </span>
                  </div>
                  <button
                    class="ageaf-diff-modal__close"
                    type="button"
                    onClick={() => setShowModal(false)}
                    title="Close (ESC)"
                    aria-label="Close diff modal"
                  >
                    <CloseIcon />
                  </button>
                </div>
                <div class="ageaf-diff-modal__content">
                  {patchReview.kind === 'replaceRangeInFile' ? (
                    <DiffReview
                      oldText={patchReview.expectedOldText}
                      newText={patchReview.text}
                      fileName={patchReview.filePath}
                      animate={false}
                      wrap={true}
                      startLineNumber={startLineNumber}
                      isLightMode={isLightMode}
                    />
                  ) : patchReview.kind === 'replaceSelection' ? (
                    <DiffReview
                      oldText={patchReview.selection}
                      newText={patchReview.text}
                      fileName={patchReview.fileName ?? undefined}
                      animate={false}
                      wrap={true}
                      startLineNumber={startLineNumber}
                      isLightMode={isLightMode}
                    />
                  ) : patchReview.kind === 'insertAtCursor' ? (
                    <DiffReview
                      oldText=""
                      newText={patchReview.text}
                      fileName="cursor"
                      animate={false}
                      wrap={true}
                      isLightMode={isLightMode}
                    />
                  ) : null}
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
