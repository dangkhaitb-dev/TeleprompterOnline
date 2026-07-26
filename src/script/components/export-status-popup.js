// Shared modal status for multi-file ZIP creation.
// States: processing -> success (Download) or error (Retry).

const ICON_CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg>';
const ICON_PROCESSING = '<svg class="export-status-spinner" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5"/></svg>';
const ICON_SUCCESS = '<svg viewBox="0 0 24 24"><path d="m7 12.5 3.2 3.2L17.5 8.5"/></svg>';
const ICON_ERROR = '<svg viewBox="0 0 24 24"><path d="M12 7.5v6M12 17h.01"/></svg>';
let popupCount = 0;

export function createExportStatusPopup({ labels = {}, onDownload, onRetry, onClose, onCancel } = {}) {
  popupCount += 1;
  const titleId = `export-status-title-${popupCount}`;
  const overlay = document.createElement('div');
  overlay.className = 'export-status-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <section class="export-status" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
      <button class="export-status-close" type="button" data-role="close"
        aria-label="${labels.close || 'Close'}" hidden>${ICON_CLOSE}</button>
      <div class="export-status-mark" data-role="mark" aria-hidden="true"></div>
      <h2 class="export-status-title" id="${titleId}"></h2>
      <p class="export-status-message" data-role="message"></p>
      <div class="export-progress" data-role="progress-wrap">
        <div class="export-progress-meta">
          <span data-role="progress-detail"></span>
          <strong data-role="progress-value">0%</strong>
        </div>
        <div class="export-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <span data-role="progress-bar"></span>
        </div>
      </div>
      <div class="export-status-actions" data-role="actions" hidden>
        <button class="export-status-btn primary" type="button" data-role="primary"></button>
      </div>
    </section>`;

  const title = overlay.querySelector('.export-status-title');
  const mark = overlay.querySelector('[data-role="mark"]');
  const message = overlay.querySelector('[data-role="message"]');
  const progressWrap = overlay.querySelector('[data-role="progress-wrap"]');
  const progressTrack = overlay.querySelector('.export-progress-track');
  const progressBar = overlay.querySelector('[data-role="progress-bar"]');
  const progressValue = overlay.querySelector('[data-role="progress-value"]');
  const progressDetail = overlay.querySelector('[data-role="progress-detail"]');
  const actions = overlay.querySelector('[data-role="actions"]');
  const closeButton = overlay.querySelector('[data-role="close"]');
  const primaryButton = overlay.querySelector('[data-role="primary"]');
  let state = 'idle';

  closeButton.addEventListener('click', () => {
    // While packaging, the X cancels the in-flight ZIP instead of dismissing a
    // finished popup. onCancel aborts the export; the caller's catch swallows
    // the resulting AbortError.
    if (state === 'processing') {
      onCancel?.();
      close({ force: true });
      return;
    }
    close();
  });
  primaryButton.addEventListener('click', () => {
    if (state === 'success') onDownload?.();
    if (state === 'error') onRetry?.();
  });

  function openProcessing(fileCount) {
    state = 'processing';
    overlay.hidden = false;
    overlay.dataset.state = state;
    mark.innerHTML = ICON_PROCESSING;
    title.textContent = labels.zipPreparingTitle || 'Preparing your ZIP';
    message.textContent = labels.zipPreparingMessage || 'Packaging the original recordings. Keep this page open.';
    progressWrap.hidden = false;
    actions.hidden = true;
    closeButton.hidden = false;
    closeButton.setAttribute('aria-label', labels.cancel || 'Cancel');
    updateProgress({ progress: 0, fileIndex: 0, fileCount });
  }

  function updateProgress({ progress, fileIndex, fileCount }) {
    const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
    progressBar.style.width = `${percent}%`;
    progressValue.textContent = `${percent}%`;
    progressDetail.textContent = fileIndex
      ? `${labels.zipFile || 'File'} ${fileIndex} / ${fileCount}`
      : `${fileCount} ${labels.zipFiles || 'files'}`;
    progressTrack.setAttribute('aria-valuenow', String(percent));
  }

  function setSuccess() {
    state = 'success';
    overlay.dataset.state = state;
    mark.innerHTML = ICON_SUCCESS;
    title.textContent = labels.zipReadyTitle || 'ZIP is ready';
    message.textContent = labels.zipReadyMessage || 'Your original recordings have been packaged successfully.';
    progressWrap.hidden = true;
    actions.hidden = false;
    closeButton.hidden = false;
    closeButton.setAttribute('aria-label', labels.close || 'Close');
    primaryButton.textContent = labels.download || 'Download';
    primaryButton.focus();
  }

  function setError(errorMessage) {
    state = 'error';
    overlay.dataset.state = state;
    mark.innerHTML = ICON_ERROR;
    title.textContent = labels.zipFailedTitle || 'Could not create ZIP';
    message.textContent = errorMessage
      || labels.zipFailedMessage
      || 'Something went wrong while packaging your recordings.';
    progressWrap.hidden = true;
    actions.hidden = false;
    closeButton.hidden = false;
    closeButton.setAttribute('aria-label', labels.close || 'Close');
    primaryButton.textContent = labels.retry || 'Retry';
    primaryButton.focus();
  }

  function close({ force = false } = {}) {
    if (state === 'processing' && !force) return;
    state = 'idle';
    overlay.hidden = true;
    onClose?.();
  }

  return { el: overlay, openProcessing, updateProgress, setSuccess, setError, close };
}
