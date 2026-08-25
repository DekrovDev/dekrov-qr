const types = {
  url: {
    fields: [{ key: 'url', label: 'Link', placeholder: 'https://example.com', value: 'https://example.com', type: 'url', autocomplete: 'url', inputMode: 'url', maxLength: 2048, required: true }],
    make: values => new URL(normaliseUrl(values.url)).href
  },
  text: {
    fields: [{ key: 'text', label: 'Text', placeholder: 'Write something', value: 'Hello! This is my QR code.', multiline: true, maxLength: 1800, required: true }],
    make: values => values.text.trim()
  },
  wifi: {
    fields: [
      { key: 'ssid', label: 'Network name', placeholder: 'My Wi-Fi', value: '', autocomplete: 'off', maxLength: 32, required: true },
      { key: 'password', label: 'Password', placeholder: 'At least 8 characters', value: '', type: 'password', autocomplete: 'new-password', maxLength: 64, required: true },
      { key: 'security', label: 'Security', select: ['WPA/WPA2', 'WEP', 'No password'], value: 'WPA/WPA2' }
    ],
    make: values => {
      const security = values.security === 'No password' ? 'nopass' : values.security === 'WEP' ? 'WEP' : 'WPA';
      const password = values.security === 'No password' ? '' : `P:${escapeWifi(values.password)};`;
      return `WIFI:T:${security};S:${escapeWifi(values.ssid.trim())};${password};`;
    }
  },
  phone: {
    fields: [{ key: 'phone', label: 'Phone number', placeholder: '+1 202 555 0147', value: '', type: 'tel', autocomplete: 'tel', inputMode: 'tel', maxLength: 32, required: true }],
    make: values => `tel:${normalisePhone(values.phone)}`
  },
  email: {
    fields: [
      { key: 'email', label: 'Email address', placeholder: 'hello@example.com', value: '', type: 'email', autocomplete: 'email', inputMode: 'email', maxLength: 254, required: true },
      { key: 'subject', label: 'Email subject (optional)', placeholder: 'Hello!', value: '', maxLength: 200 }
    ],
    make: values => `mailto:${values.email.trim()}${values.subject.trim() ? `?subject=${encodeURIComponent(values.subject.trim())}` : ''}`
  },
  contact: {
    fields: [
      { key: 'name', label: 'Name', placeholder: 'Alex Morgan', value: '', autocomplete: 'name', maxLength: 120, required: true },
      { key: 'phone', label: 'Phone (phone or email required)', placeholder: '+1 202 555 0147', value: '', type: 'tel', autocomplete: 'tel', inputMode: 'tel', maxLength: 32 },
      { key: 'email', label: 'Email (phone or email required)', placeholder: 'alex@example.com', value: '', type: 'email', autocomplete: 'email', inputMode: 'email', maxLength: 254 }
    ],
    make: values => {
      const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${escapeVCard(values.name.trim())}`];
      if (values.phone.trim()) lines.push(`TEL:${normalisePhone(values.phone)}`);
      if (values.email.trim()) lines.push(`EMAIL:${escapeVCard(values.email.trim())}`);
      lines.push('END:VCARD');
      return lines.join('\r\n');
    }
  }
};

const valuesByType = Object.fromEntries(Object.entries(types).map(([type, config]) => [type, Object.fromEntries(config.fields.map(field => [field.key, field.value]))]));
const touchedByType = Object.fromEntries(Object.keys(types).map(type => [type, new Set()]));
const forceErrorsByType = Object.fromEntries(Object.keys(types).map(type => [type, false]));

const state = {
  type: 'url', foreground: '#171a31', background: '#ffffff', size: 512, transparent: false,
  valuesByType, touchedByType, forceErrorsByType, ready: false, downloadable: false, blockReason: ''
};

const fields = document.querySelector('#fields');
const payloadPreview = document.querySelector('#payload-preview');
const canvas = document.querySelector('#qr-canvas');
const paper = document.querySelector('#qr-paper');
const emptyState = document.querySelector('#qr-empty-state');
const emptyMessage = document.querySelector('#qr-empty-message');
const previewStatus = document.querySelector('#preview-status');
const scanNote = document.querySelector('#scan-note');
const formMessage = document.querySelector('#form-message');
const appearanceMessage = document.querySelector('#appearance-message');
const foregroundInput = document.querySelector('#foreground');
const backgroundInput = document.querySelector('#background');
const transparentInput = document.querySelector('#transparent');
const pngButton = document.querySelector('#download-png');
const svgButton = document.querySelector('#download-svg');
const copyButton = document.querySelector('#copy-button');
let toastTimer;

function currentValues() { return state.valuesByType[state.type]; }
function currentTouched() { return state.touchedByType[state.type]; }
function escapeWifi(value) { return value.replace(/([\\;,:"'])/g, '\\$1'); }
function escapeVCard(value) { return value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([;,])/g, '\\$1'); }
function normaliseUrl(value) {
  const trimmed = value.trim();
  return trimmed && !/^https?:\/\//i.test(trimmed) ? `https://${trimmed}` : trimmed;
}
function normalisePhone(value) {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, '');
  return `${trimmed.startsWith('+') ? '+' : ''}${digits}`;
}
function validPhone(value) {
  if (!/^\+?[\d\s().-]+$/.test(value.trim())) return false;
  const digits = value.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}
function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()); }
function byteLength(value) { return new TextEncoder().encode(value).length; }

function validateCurrent() {
  const values = currentValues();
  const errors = {};
  let globalError = '';

  if (state.type === 'url') {
    const value = normaliseUrl(values.url);
    if (!value) errors.url = 'Enter a link.';
    else {
      try {
        const parsed = new URL(value);
        if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) errors.url = 'Enter a valid web link.';
      } catch { errors.url = 'Enter a valid web link.'; }
    }
  }

  if (state.type === 'text' && !values.text.trim()) errors.text = 'Enter some text.';

  if (state.type === 'wifi') {
    if (!values.ssid.trim()) errors.ssid = 'Enter the network name.';
    else if (byteLength(values.ssid.trim()) > 32) errors.ssid = 'A Wi-Fi name can be up to 32 bytes.';

    if (values.security === 'WPA/WPA2') {
      const isPassphrase = values.password.length >= 8 && values.password.length <= 63;
      const isRawKey = /^[0-9a-f]{64}$/i.test(values.password);
      if (!isPassphrase && !isRawKey) errors.password = 'Use 8-63 characters, or a 64-digit hex key.';
    }
    if (values.security === 'WEP') {
      const asciiLength = values.password.length === 5 || values.password.length === 13;
      const hexLength = /^(?:[0-9a-f]{10}|[0-9a-f]{26})$/i.test(values.password);
      if (!asciiLength && !hexLength) errors.password = 'Use 5 or 13 characters, or a 10/26-digit hex key.';
    }
  }

  if (state.type === 'phone') {
    if (!values.phone.trim()) errors.phone = 'Enter a phone number.';
    else if (!validPhone(values.phone)) errors.phone = 'Use a valid phone number with 7-15 digits.';
  }

  if (state.type === 'email') {
    if (!values.email.trim()) errors.email = 'Enter an email address.';
    else if (!validEmail(values.email)) errors.email = 'Enter a valid email address.';
  }

  if (state.type === 'contact') {
    if (!values.name.trim()) errors.name = 'Enter the contact name.';
    if (values.phone.trim() && !validPhone(values.phone)) errors.phone = 'Use a valid phone number with 7-15 digits.';
    if (values.email.trim() && !validEmail(values.email)) errors.email = 'Enter a valid email address.';
    if (!values.phone.trim() && !values.email.trim()) globalError = 'Add at least a phone number or an email address.';
  }

  const valid = Object.keys(errors).length === 0 && !globalError;
  return { valid, errors, globalError, payload: valid ? types[state.type].make(values) : '' };
}

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  return [0, 2, 4].map(index => Number.parseInt(value.slice(index, index + 2), 16));
}
function luminance(hex) {
  const channels = hexToRgb(hex).map(channel => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function validateAppearance() {
  if (state.transparent) return { valid: true, level: 'warning', message: 'Transparent QR codes depend on the surface behind them. Test the final placement.' };
  const foregroundLuminance = luminance(state.foreground);
  const backgroundLuminance = luminance(state.background);
  const ratio = (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
  if (ratio < 3) return { valid: false, level: 'error', message: 'Increase the contrast between the QR code and its background.' };
  if (foregroundLuminance > backgroundLuminance) return { valid: true, level: 'warning', message: 'A dark QR code on a light background scans more reliably.' };
  return { valid: true, level: '', message: '' };
}

function makeQr(payload) {
  qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
  const code = qrcode(0, 'M');
  code.addData(payload, 'Byte');
  code.make();
  return code;
}

function drawCanvas(code) {
  const context = canvas.getContext('2d');
  const modules = code.getModuleCount();
  const margin = 4;
  const dimension = modules + margin * 2;
  const cell = Math.max(1, Math.floor(state.size / dimension));
  const renderedSize = cell * dimension;
  const offset = Math.floor((state.size - renderedSize) / 2);
  canvas.width = state.size;
  canvas.height = state.size;
  context.clearRect(0, 0, state.size, state.size);
  if (!state.transparent) {
    context.fillStyle = state.background;
    context.fillRect(0, 0, state.size, state.size);
  }
  context.fillStyle = state.foreground;
  for (let row = 0; row < modules; row += 1) {
    for (let column = 0; column < modules; column += 1) {
      if (code.isDark(row, column)) context.fillRect(offset + (column + margin) * cell, offset + (row + margin) * cell, cell, cell);
    }
  }
}

function clearCanvas() {
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
}

function makeSvg(code) {
  const modules = code.getModuleCount();
  const margin = 4;
  const dimension = modules + margin * 2;
  let path = '';
  for (let row = 0; row < modules; row += 1) {
    for (let column = 0; column < modules; column += 1) {
      if (code.isDark(row, column)) path += `M${column + margin},${row + margin}h1v1h-1z`;
    }
  }
  const background = state.transparent ? '' : `<rect width="100%" height="100%" fill="${state.background}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${state.size}" height="${state.size}" viewBox="0 0 ${dimension} ${dimension}" shape-rendering="crispEdges">${background}<path fill="${state.foreground}" d="${path}"/></svg>`;
}

function showToast(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
}

function resizeTextarea(textarea) {
  textarea.style.height = 'auto';
  const height = Math.min(320, Math.max(86, textarea.scrollHeight));
  textarea.style.height = `${height}px`;
  textarea.style.overflowY = textarea.scrollHeight > 320 ? 'auto' : 'hidden';
}

function updateCounter(input) {
  const counter = fields.querySelector(`[data-counter-for="${input.dataset.key}"]`);
  if (counter) counter.textContent = `${input.value.length} / ${input.maxLength}`;
}

function createField(field) {
  const wrapper = document.createElement('label');
  wrapper.className = `field-wrap${field.multiline ? ' wide-field' : ''}`;
  wrapper.dataset.fieldWrap = field.key;
  const label = document.createElement('span');
  label.className = 'input-label';
  label.textContent = `${field.label}${field.required ? ' *' : ''}`;
  wrapper.append(label);

  let input;
  if (field.select) {
    input = document.createElement('select');
    field.select.forEach(value => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      input.append(option);
    });
  } else if (field.multiline) {
    input = document.createElement('textarea');
    input.rows = 3;
    input.classList.add('expanding-textarea');
  } else {
    input = document.createElement('input');
    input.type = field.type || 'text';
  }

  const inputId = `field-${state.type}-${field.key}`;
  const errorId = `${inputId}-error`;
  input.id = inputId;
  input.classList.add('text-input');
  input.dataset.key = field.key;
  input.value = currentValues()[field.key];
  input.setAttribute('aria-describedby', errorId);
  if (field.placeholder) input.placeholder = field.placeholder;
  if (field.autocomplete) input.autocomplete = field.autocomplete;
  if (field.inputMode) input.inputMode = field.inputMode;
  if (field.maxLength) input.maxLength = field.maxLength;
  if (field.required) input.required = true;
  wrapper.htmlFor = inputId;
  wrapper.append(input);

  const meta = document.createElement('span');
  meta.className = 'field-meta';
  const error = document.createElement('small');
  error.id = errorId;
  error.className = 'field-error';
  error.dataset.errorFor = field.key;
  meta.append(error);
  if (field.multiline && field.maxLength) {
    const counter = document.createElement('small');
    counter.className = 'field-counter';
    counter.dataset.counterFor = field.key;
    meta.append(counter);
  }
  wrapper.append(meta);

  const updateValue = () => {
    currentValues()[field.key] = input.value;
    currentTouched().add(field.key);
    if (input instanceof HTMLTextAreaElement) resizeTextarea(input);
    updateCounter(input);
    syncConditionalFields();
    renderQr();
  };
  input.addEventListener(field.select ? 'change' : 'input', updateValue);
  input.addEventListener('blur', () => { currentTouched().add(field.key); renderQr(); });
  return wrapper;
}

function renderFields() {
  const config = types[state.type];
  const row = document.createElement('div');
  row.className = `field-row${config.fields.length === 1 ? ' one' : ''}`;
  config.fields.forEach(field => row.append(createField(field)));
  fields.replaceChildren(row);
  fields.querySelectorAll('textarea').forEach(textarea => resizeTextarea(textarea));
  fields.querySelectorAll('[maxlength]').forEach(input => updateCounter(input));
  syncConditionalFields();
  renderQr();
}

function syncConditionalFields() {
  if (state.type !== 'wifi') return;
  const password = fields.querySelector('[data-key="password"]');
  if (!password) return;
  const noPassword = currentValues().security === 'No password';
  password.disabled = noPassword;
  password.closest('.field-wrap').hidden = noPassword;
}

function renderFieldErrors(validation, force = false) {
  const showAll = force || state.forceErrorsByType[state.type];
  Object.entries(validation.errors).forEach(([key, message]) => {
    const input = fields.querySelector(`[data-key="${key}"]`);
    const error = fields.querySelector(`[data-error-for="${key}"]`);
    if (!input || !error) return;
    const visible = showAll || currentTouched().has(key);
    error.textContent = visible ? message : '';
    input.classList.toggle('invalid', visible);
    input.setAttribute('aria-invalid', visible ? 'true' : 'false');
  });
  fields.querySelectorAll('[data-key]').forEach(input => {
    if (validation.errors[input.dataset.key]) return;
    input.classList.remove('invalid');
    input.setAttribute('aria-invalid', 'false');
    const error = fields.querySelector(`[data-error-for="${input.dataset.key}"]`);
    if (error) error.textContent = '';
  });
  const showGlobal = validation.globalError && showAll;
  formMessage.textContent = showGlobal ? validation.globalError : '';
  formMessage.classList.toggle('visible', Boolean(showGlobal));
}

function renderAppearanceMessage(result) {
  appearanceMessage.textContent = result.message;
  appearanceMessage.className = `appearance-message${result.level ? ` ${result.level}` : ''}${result.message ? ' visible' : ''}`;
}

function firstValidationError(validation) {
  return validation.globalError || Object.values(validation.errors)[0] || 'Complete the required fields.';
}

function setPreviewState(mode, message) {
  const ready = mode === 'ready' || mode === 'warning';
  paper.hidden = !ready;
  emptyState.hidden = ready;
  if (!ready) emptyMessage.textContent = message;
  previewStatus.className = `live-dot ${mode}`;
  previewStatus.querySelector('span').textContent = mode === 'ready' ? 'ready' : mode === 'warning' ? 'check colors' : mode === 'error' ? 'error' : 'waiting';
  scanNote.textContent = mode === 'ready' ? 'Use your camera to test the code' : mode === 'warning' ? message : 'The preview will appear when the data is valid';
}

function updateActionState(validation) {
  copyButton.classList.toggle('unavailable', !validation.valid);
  copyButton.setAttribute('aria-disabled', validation.valid ? 'false' : 'true');
  [pngButton, svgButton].forEach(button => {
    button.classList.toggle('unavailable', !state.downloadable);
    button.setAttribute('aria-disabled', state.downloadable ? 'false' : 'true');
  });
}

function syncBackgroundControl() {
  backgroundInput.disabled = state.transparent;
  backgroundInput.closest('.control-label').classList.toggle('disabled-control', state.transparent);
}

function renderQr(forceErrors = false) {
  if (forceErrors) state.forceErrorsByType[state.type] = true;
  const validation = validateCurrent();
  const appearance = validateAppearance();
  renderFieldErrors(validation, forceErrors);
  renderAppearanceMessage(appearance);
  syncBackgroundControl();
  payloadPreview.textContent = validation.valid ? validation.payload : 'Waiting for valid content';
  payloadPreview.title = validation.valid ? validation.payload : '';
  paper.classList.toggle('transparent', state.transparent);
  paper.style.backgroundColor = state.transparent ? 'transparent' : state.background;
  state.ready = false;
  state.downloadable = false;
  state.blockReason = '';

  if (!validation.valid) {
    clearCanvas();
    state.blockReason = firstValidationError(validation);
    setPreviewState('waiting', 'Complete the required fields to generate a QR code.');
    updateActionState(validation);
    return validation;
  }
  if (!window.qrcode) {
    clearCanvas();
    state.blockReason = 'The QR engine did not load. Refresh the page.';
    setPreviewState('error', state.blockReason);
    updateActionState(validation);
    return validation;
  }
  try {
    drawCanvas(makeQr(validation.payload));
    state.ready = true;
    state.downloadable = appearance.valid;
    state.blockReason = appearance.valid ? '' : appearance.message;
    setPreviewState(appearance.level === 'warning' || !appearance.valid ? 'warning' : 'ready', appearance.message);
  } catch {
    clearCanvas();
    state.blockReason = 'The content is too long. Shorten it and try again.';
    setPreviewState('error', state.blockReason);
  }
  updateActionState(validation);
  return validation;
}

document.querySelectorAll('.type-button').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.type-button').forEach(item => {
    item.classList.remove('active');
    item.setAttribute('aria-checked', 'false');
  });
  button.classList.add('active');
  button.setAttribute('aria-checked', 'true');
  state.type = button.dataset.type;
  renderFields();
}));

foregroundInput.addEventListener('input', event => {
  state.foreground = event.target.value;
  document.querySelector('#foreground-value').textContent = state.foreground.toUpperCase();
  renderQr();
});
backgroundInput.addEventListener('input', event => {
  state.background = event.target.value;
  document.querySelector('#background-value').textContent = state.background.toUpperCase();
  renderQr();
});
document.querySelector('#size').addEventListener('input', event => {
  state.size = Number(event.target.value);
  document.querySelector('#size-value').textContent = `${state.size} px`;
  renderQr();
});
transparentInput.addEventListener('change', event => {
  state.transparent = event.target.checked;
  renderQr();
});

async function copyPayload() {
  const validation = renderQr(true);
  if (!validation.valid) { showToast(firstValidationError(validation)); return; }
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(validation.payload);
    else {
      const helper = document.createElement('textarea');
      helper.value = validation.payload;
      helper.style.position = 'fixed';
      helper.style.opacity = '0';
      document.body.append(helper);
      helper.select();
      const copied = document.execCommand('copy');
      helper.remove();
      if (!copied) throw new Error('Copy failed');
    }
    showToast('Encoded content copied');
  } catch { showToast('Could not copy the content'); }
}
copyButton.addEventListener('click', copyPayload);

function downloadFile(blob, fileName) {
  const link = document.createElement('a');
  const fileUrl = URL.createObjectURL(blob);
  link.href = fileUrl;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(fileUrl), 500);
}

function canDownload() {
  renderQr(true);
  if (state.downloadable) return true;
  showToast(state.blockReason || 'Complete the required fields before downloading.');
  return false;
}

pngButton.addEventListener('click', () => {
  if (!canDownload()) return;
  canvas.toBlob(blob => {
    if (!blob) { showToast('Could not create the PNG'); return; }
    downloadFile(blob, `qrly-${state.type}.png`);
    showToast('PNG downloaded');
  }, 'image/png');
});

svgButton.addEventListener('click', () => {
  if (!canDownload()) return;
  try {
    const validation = validateCurrent();
    const svg = makeSvg(makeQr(validation.payload));
    downloadFile(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `qrly-${state.type}.svg`);
    showToast('SVG downloaded');
  } catch { showToast('Could not create the SVG'); }
});

renderFields();
