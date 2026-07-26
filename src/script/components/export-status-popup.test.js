/* @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest';
import { createExportStatusPopup } from './export-status-popup.js';

describe('createExportStatusPopup', () => {
  it('shows progress, exposes Download on success, and Retry on failure', () => {
    const onDownload = vi.fn();
    const onRetry = vi.fn();
    const onClose = vi.fn();
    const popup = createExportStatusPopup({ onDownload, onRetry, onClose });
    document.body.append(popup.el);

    popup.openProcessing(3);
    popup.updateProgress({ progress: 0.42, fileIndex: 2, fileCount: 3 });
    expect(popup.el.querySelector('[data-role="progress-value"]').textContent).toBe('42%');
    // The X is available while packaging so the user can cancel.
    expect(popup.el.querySelector('[data-role="close"]').hidden).toBe(false);

    popup.setSuccess();
    const primary = popup.el.querySelector('[data-role="primary"]');
    expect(primary.textContent).toBe('Download');
    primary.click();
    expect(onDownload).toHaveBeenCalledOnce();
    popup.el.querySelector('[data-role="close"]').click();
    expect(onClose).toHaveBeenCalledOnce();

    popup.openProcessing(3);
    popup.setError();
    expect(primary.textContent).toBe('Retry');
    primary.click();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('cancels the in-flight export and dismisses when the X is clicked while processing', () => {
    const onCancel = vi.fn();
    const onClose = vi.fn();
    const popup = createExportStatusPopup({ onCancel, onClose });
    document.body.append(popup.el);

    popup.openProcessing(3);
    expect(popup.el.hidden).toBe(false);

    popup.el.querySelector('[data-role="close"]').click();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(popup.el.hidden).toBe(true);
  });
});
