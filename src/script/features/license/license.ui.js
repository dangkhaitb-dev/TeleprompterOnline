import { showConfirm } from '../../components/confirm-popup.js';
import {
  clearLicense,
  getStoredLicense,
  isLicenseKeyFormatValid,
  validateAndSaveLicense,
  validateStoredLicense,
} from './license.logic.js';

function readCopy(root) {
  try {
    return JSON.parse(root.getElementById('licenseCopy')?.textContent || '{}');
  } catch {
    return {};
  }
}

function maskKey(key) {
  if (!key) return '';
  const visible = key.slice(-4);
  const prefix = key.includes('_') ? `${key.split('_')[0]}_` : '';
  return `${prefix}••••••••${visible}`;
}

function formatExpiry(value, copy) {
  if (!value) return copy.noExpiry || 'No expiration';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return copy.noExpiry || 'No expiration';
  return `${copy.validUntil || 'Valid until'} ${new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
  }).format(date)}`;
}

export function initLicenseUI({ root = document } = {}) {
  const form = root.getElementById('licenseForm');
  if (!form) return;

  const copy = readCopy(root);
  const input = root.getElementById('licenseKey');
  const submit = root.getElementById('licenseSubmit');
  const submitLabel = submit.querySelector('.license-submit-label');
  const submitLoading = submit.querySelector('.license-submit-loading');
  const message = root.getElementById('licenseFormMessage');
  const statusPanel = root.getElementById('licenseStatusPanel');
  const badge = root.getElementById('licenseBadge');
  const plan = root.getElementById('licensePlan');
  const displayKey = root.getElementById('licenseDisplayKey');
  const expiry = root.getElementById('licenseExpiry');
  const recheck = root.getElementById('licenseRecheck');
  const remove = root.getElementById('licenseRemove');
  const initialText = {
    badge: badge.textContent,
    plan: plan.textContent,
    key: displayKey.textContent,
    expiry: expiry.textContent,
  };

  function showMessage(text, variant = '') {
    message.textContent = text;
    message.dataset.variant = variant;
    message.hidden = !text;
  }

  function setLoading(loading) {
    submit.disabled = loading;
    input.disabled = loading;
    submitLabel.hidden = loading;
    submitLoading.hidden = !loading;
    form.setAttribute('aria-busy', String(loading));
  }

  function render(status, stored = getStoredLicense()) {
    const hasKey = Boolean(stored?.key);
    const active = status?.valid === true;
    statusPanel.hidden = !active;
    if (!active) return;
    const statusName = status?.keyStatus || 'invalid';
    badge.dataset.status = active ? 'active' : hasKey ? statusName : 'free';
    badge.textContent = active
      ? (copy.activeBadge || 'Active')
      : hasKey
        ? (copy[`${statusName}Badge`] || copy.invalidBadge || 'Invalid')
        : initialText.badge;
    plan.textContent = active ? (copy.unlimitedPlan || 'Licensed') : initialText.plan;
    displayKey.textContent = hasKey
      ? (status?.displayKey || stored.displayKey || maskKey(stored.key))
      : initialText.key;
    expiry.textContent = active ? formatExpiry(status.expiresAt, copy) : initialText.expiry;
    recheck.hidden = !hasKey;
    remove.hidden = !hasKey;
  }

  async function checkSaved() {
    const stored = getStoredLicense();
    if (!stored) return;
    recheck.disabled = true;
    try {
      render(await validateStoredLicense({ force: true }));
    } catch {
      showMessage(copy.networkMessage || 'The license service could not be reached.', 'error');
    } finally {
      recheck.disabled = false;
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage('');
    if (!isLicenseKeyFormatValid(input.value)) {
      showMessage(copy.formatMessage || 'Enter a complete license key.', 'error');
      input.focus();
      return;
    }
    setLoading(true);
    try {
      const status = await validateAndSaveLicense(input.value);
      if (!status.valid) {
        showMessage(copy.invalidMessage || 'This key is not active.', 'error');
        return;
      }
      input.value = '';
      render(status);
      showMessage(copy.validMessage || 'License verified.', 'success');
    } catch {
      showMessage(copy.networkMessage || 'The license service could not be reached.', 'error');
    } finally {
      setLoading(false);
    }
  });

  recheck.addEventListener('click', () => {
    showMessage('');
    void checkSaved();
  });

  remove.addEventListener('click', async () => {
    const confirmed = await showConfirm({
      title: copy.removeTitle,
      message: copy.removeMessage,
      confirmLabel: copy.removeConfirm,
      cancelLabel: copy.removeCancel,
      danger: true,
    });
    if (!confirmed) return;
    clearLicense();
    render(null, null);
    showMessage(copy.removedMessage || 'License removed.', 'success');
  });

  void checkSaved();
}
