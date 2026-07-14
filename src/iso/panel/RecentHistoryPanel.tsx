import type {
  RecentHistoryEntryV1,
  RecentHistoryV1,
} from '../../transactions/contracts';

type RecentHistoryPanelProps = {
  history: RecentHistoryV1 | null;
  busy: boolean;
  error: string | null;
  actionBusyId: string | null;
  onClose: () => void;
  onRefresh: () => void;
  onExport: () => void;
  onRevert: (entry: RecentHistoryEntryV1) => void;
  onFindCard: (transactionId: string) => void;
  onNavigateFile: (filePath: string) => void;
};

function statusLabel(entry: RecentHistoryEntryV1): string {
  switch (entry.status) {
    case 'inverse_proposed':
      return 'Inverse proposed';
    case 'recovery_required':
      return 'Recovery required';
    case 'preflighted':
      return 'Preflighted';
    default:
      return entry.status.charAt(0).toUpperCase() + entry.status.slice(1);
  }
}

function relationshipLabel(entry: RecentHistoryEntryV1): string | null {
  if (entry.relationshipStatus === 'missing') return 'Relationship missing';
  if (entry.relationshipStatus === 'corrupt') return 'Relationship invalid';
  if (entry.revertsTransactionId) {
    return `Inverse of ${entry.revertsTransactionId.slice(0, 8)}`;
  }
  if (entry.inverseTransactionId) {
    return `Inverse ${entry.inverseTransactionId.slice(0, 8)}`;
  }
  if (entry.supersededByTransactionId) {
    return `Superseded by ${entry.supersededByTransactionId.slice(0, 8)}`;
  }
  if (entry.supersedesTransactionId) {
    return `Successor of ${entry.supersedesTransactionId.slice(0, 8)}`;
  }
  return null;
}

function inverseStatusLabel(entry: RecentHistoryEntryV1): string | null {
  if (!entry.inverseTransactionId) return null;
  if (entry.status === 'reverted') return 'Reverted';
  if (entry.inverseFailureCode === 'RECOVERY_REQUIRED') {
    return 'Inverse recovery required';
  }
  if (entry.inverseState === 'conflicted') return 'Inverse conflicted';
  if (entry.inverseState === 'failed') return 'Inverse failed';
  if (entry.inverseState === 'applied') return 'Inverse applied';
  if (entry.inverseState) return 'Inverse proposed';
  return 'Inverse unavailable';
}

export function RecentHistoryPanel({
  history,
  busy,
  error,
  actionBusyId,
  onClose,
  onRefresh,
  onExport,
  onRevert,
  onFindCard,
  onNavigateFile,
}: RecentHistoryPanelProps) {
  return (
    <section class="ageaf-history" aria-label="Recent edit history">
      <header class="ageaf-history__header">
        <div>
          <strong>Recent edits</strong>
          <span>Durable project history</span>
        </div>
        <div class="ageaf-history__header-actions">
          <button
            type="button"
            class="ageaf-history__button"
            disabled={busy}
            onClick={onRefresh}
          >
            Refresh
          </button>
          <button
            type="button"
            class="ageaf-history__button"
            disabled={busy}
            onClick={onExport}
          >
            Export JSON
          </button>
          <button
            type="button"
            class="ageaf-history__close"
            aria-label="Close recent edit history"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </header>
      {error ? <div class="ageaf-history__error">{error}</div> : null}
      {busy && !history ? (
        <div class="ageaf-history__empty">Loading history…</div>
      ) : null}
      {!busy && history?.entries.length === 0 ? (
        <div class="ageaf-history__empty">No durable edits yet.</div>
      ) : null}
      <div class="ageaf-history__list">
        {history?.entries.map((entry) => {
          const relationship = relationshipLabel(entry);
          const inverseStatus = inverseStatusLabel(entry);
          const actionBusy = actionBusyId === entry.transactionId;
          return (
            <article
              class="ageaf-history__item"
              key={entry.transactionId}
              data-history-transaction-id={entry.transactionId}
              data-history-status={entry.status}
              data-history-revertible={entry.safelyRevertible ? 'true' : 'false'}
            >
              <div class="ageaf-history__item-main">
                <button
                  class="ageaf-history__file"
                  type="button"
                  title={`Open ${entry.filePath}`}
                  onClick={() => onNavigateFile(entry.filePath)}
                >
                  {entry.filePath}
                </button>
                <span class="ageaf-history__type">
                  {entry.editType === 'inverse'
                    ? 'inverse'
                    : entry.intent === 'insert'
                      ? 'insertion'
                      : 'replacement'}
                </span>
                <time dateTime={new Date(entry.updatedAt).toISOString()}>
                  {new Date(entry.updatedAt).toLocaleString()}
                </time>
              </div>
              <div class="ageaf-history__status-row">
                <span class={`ageaf-history__status is-${entry.status}`}>
                  {statusLabel(entry)}
                </span>
                {relationship ? <span>{relationship}</span> : null}
                {inverseStatus ? <span>{inverseStatus}</span> : null}
              </div>
              <div class="ageaf-history__item-actions">
                <button
                  type="button"
                  class="ageaf-history__button"
                  onClick={() => onFindCard(entry.transactionId)}
                >
                  Find card
                </button>
                {entry.safelyRevertible ? (
                  <button
                    type="button"
                    class="ageaf-history__button is-primary"
                    disabled={actionBusy}
                    onClick={() => onRevert(entry)}
                  >
                    {actionBusy ? 'Creating inverse…' : 'Revert'}
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
