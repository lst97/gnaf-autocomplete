// G-NAF Address Autocomplete — API Key Management
// =============================================================

// ──────────────────────────────────────────────────────────
//  Error code→message mapping
// ──────────────────────────────────────────────────────────
const ERROR_MESSAGES = {
  KEY_EXPIRED:         'Your API key has expired. Generate a new one at the /keys tab.',
  MISSING_API_KEY:     'No API key set. Use the key bar at the top to add one.',
  INVALID_API_KEY:     'The API key is invalid. Check the key bar at the top.',
  DOMAIN_MISMATCH:     'The API key is not registered for this site\'s domain.',
  KEY_REVOKED:         'This API key has been revoked.',
  KEY_PENDING:         'Key is pending domain verification. Add the DNS TXT record and verify.',
  KEY_RATE_LIMITED:    'Per-key rate limit reached. Wait a few minutes and try again.',
  RATE_LIMITED:        'Too many requests. Slow down and try again.',
  CANNOT_SELF_REVOKE:  'You cannot revoke your own key while other active keys exist. Revoke them first, or use DNS recovery to revoke all.',
  RECOVERY_INVALID:    'Invalid or expired recovery session. Start recovery again.',
  PAYLOAD_TOO_LARGE:   'Request too large. Try again with a smaller payload.',
  DOMAIN_KEY_LIMIT:    'Maximum number of keys for this domain reached. Revoke an existing key first.',
  TURNSTILE_FAILED:    'Browser verification failed. Please try again.',
  DNS_ERROR:           'Could not query DNS. Check the domain name and try again.',
};

function handleApiError(data, defaultMsg) {
  if (data && data.code && ERROR_MESSAGES[data.code]) {
    return ERROR_MESSAGES[data.code];
  }
  if (data && data.error) return data.error;
  return defaultMsg || 'An error occurred.';
}

function dispatchKeyExpired() {
  document.dispatchEvent(new CustomEvent('key-expired', { detail: { timestamp: Date.now() } }));
}

// ──────────────────────────────────────────────────────────
//  Turnstile gate — single challenge for the entire tab
// ──────────────────────────────────────────────────────────
let _gateInited = false;
let _turnstileWidgetId = null;
let _turnstileToken = null;
let _turnstileTimestamp = 0;
let _turnstileSiteKey = null;
let _turnstileDevMode = false;

const TOKEN_TTL = 240000; // 4 min (Turnstile tokens expire at 5 min)

function initKeyGate() {
  if (_gateInited) return;
  const wrap = document.getElementById('keys-turnstile-wrap');
  if (!wrap) return;
  _gateInited = true;

  fetch('/api/config').then(r => r.json()).then(cfg => {
    _turnstileSiteKey = cfg.turnstileSiteKey || null;

    if (!_turnstileSiteKey || _turnstileSiteKey.startsWith('1x')) {
      _turnstileDevMode = true;
      hideGate();
      return;
    }

    renderTurnstile(wrap);
  }).catch(() => {
    hideGate();
  });
}

function renderTurnstile(wrap) {
  if (!window.turnstile) {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    s.async = true;
    s.onload = () => renderTurnstile(wrap);
    document.head.appendChild(s);
    return;
  }

  wrap.innerHTML = '';
  _turnstileWidgetId = window.turnstile.render(wrap, {
    sitekey: _turnstileSiteKey,
    callback: (token) => {
      _turnstileToken = token;
      _turnstileTimestamp = Date.now();
      hideGate();
    },
    'expired-callback': () => {
      _turnstileToken = null;
      showGate('Challenge expired. Please verify again.');
    },
    'error-callback': () => {
      showGate('Challenge failed. Please try again.');
    },
  });
}

function hideGate() {
  const gate = document.getElementById('keys-gate');
  const content = document.getElementById('keys-content');
  if (gate) gate.style.display = 'none';
  if (content) content.style.display = '';
}

function showGate(msg) {
  const gate = document.getElementById('keys-gate');
  const content = document.getElementById('keys-content');
  if (gate) gate.style.display = '';
  if (content) content.style.display = 'none';
  const status = document.getElementById('keys-gate-status');
  if (status) status.textContent = msg || '';
  if (_turnstileWidgetId != null && window.turnstile) {
    window.turnstile.reset(_turnstileWidgetId);
  }
  _turnstileToken = null;
}

function getValidToken() {
  if (_turnstileDevMode) return '';
  if (!_turnstileToken || !_turnstileTimestamp) return null;
  if (Date.now() - _turnstileTimestamp > TOKEN_TTL) return null;
  return _turnstileToken;
}

function requireToken() {
  const token = getValidToken();
  if (token !== null) return token;
  showGate('Session expired. Please verify again, then retry.');
  return null;
}

// ──────────────────────────────────────────────────────────
//  Key Generation
// ──────────────────────────────────────────────────────────
let _kgInit = false;

function initKeyGeneration() {
  const domainInput = document.getElementById('ak-domain');
  const submitBtn = document.getElementById('ak-submit');
  const resultEl = document.getElementById('ak-result');
  if (!domainInput || !submitBtn || !resultEl) return;

  if (_kgInit) return;
  _kgInit = true;

  function showResult(html) {
    resultEl.innerHTML = html;
    resultEl.style.display = 'block';
  }

  async function generateKey() {
    const domain = domainInput.value.trim();
    if (!domain) return;

    const token = requireToken();
    if (token === null) return;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Generating...';
    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, turnstile_token: token }),
      });
      const data = await res.json();
      if (res.ok) {
        const firstPrefix = data.keys[0] ? data.keys[0].key.slice(8, 16) : '';
        const verifyToken = data.keys[0] ? data.keys[0].verification_token : '';

        const tableRows = data.keys.map((k, idx) => {
          const keyPrefix = k.key.slice(8, 16);
          return '<tr>' +
            '<td style="padding:6px 8px;border-bottom:1px solid var(--border);color:var(--muted);font-size:0.7rem;width:2em">' + (idx + 1) + '</td>' +
            '<td style="padding:6px 8px;border-bottom:1px solid var(--border);font-family:var(--mono);font-size:var(--fs-xs);word-break:break-all">' + esc(k.key) + '</td>' +
            '<td style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:right;white-space:nowrap">' +
            '<button onclick="copyKey(\'' + esc(k.key) + '\',this)" style="background:transparent;border:1px solid var(--border);color:var(--base00);padding:3px 6px;border-radius:3px;cursor:pointer;vertical-align:middle;line-height:1" title="Copy key">' +
            '<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M5 4.5v-2A1.5 1.5 0 016.5 1h5A1.5 1.5 0 0113 2.5v7a1.5 1.5 0 01-1.5 1.5h-2"/><path d="M3 5.5A1.5 1.5 0 014.5 4h5A1.5 1.5 0 0111 5.5v7A1.5 1.5 0 019.5 14h-5A1.5 1.5 0 013 12.5z"/></svg>' +
            '</button></td></tr>';
        }).join('');

        showResult(
          '<div style="color:var(--green);font-weight:600;margin-bottom:6px">' + esc(String(data.generated_count)) + ' key(s) generated for <strong>' + esc(data.domain) + '</strong></div>' +
          '<div style="font-size:var(--fs-xs);color:var(--muted);margin-bottom:8px">' + esc(String(data.total_for_domain)) + ' of ' + esc(String(data.max_allowed)) + ' max keys used for this domain.</div>' +
          '<div style="border:1px solid var(--border);border-radius:var(--r-md);overflow:hidden;margin-bottom:8px"><table style="width:100%;border-collapse:collapse;font-size:var(--fs-sm);background:var(--surface)"><thead><tr>' +
          '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);color:var(--muted);font-weight:600;font-size:var(--fs-xs);text-transform:uppercase">#</th>' +
          '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);color:var(--muted);font-weight:600;font-size:var(--fs-xs);text-transform:uppercase">API Key</th>' +
          '<th style="text-align:right;padding:6px 8px;border-bottom:1px solid var(--border);color:var(--muted);font-weight:600;font-size:var(--fs-xs);text-transform:uppercase"></th></tr></thead><tbody>' +
          tableRows + '</tbody></table></div>' +
          '<div style="background:var(--surface-2);border:1px solid var(--border);border-radius:4px;padding:12px;margin-bottom:8px">' +
          '<div style="font-weight:600;font-size:var(--fs-sm);margin-bottom:4px">Verify domain ownership</div>' +
          '<div style="font-size:var(--fs-xs);color:var(--muted);margin-bottom:8px">Add this TXT record to <strong>' + esc(data.domain) + '</strong> DNS, then click Verify:</div>' +
          '<div style="display:flex;align-items:center;gap:6px;background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:8px 10px;margin-bottom:8px">' +
          '<span style="flex:1;font-family:var(--mono);font-size:var(--fs-xs);word-break:break-all;color:var(--cyan)">gnaf-verify=' + esc(verifyToken) + '</span>' +
          '<button onclick="copyKey(\'gnaf-verify=' + esc(verifyToken) + '\',this)" style="background:transparent;border:1px solid var(--border);color:var(--base00);padding:3px 6px;border-radius:3px;cursor:pointer;flex-shrink:0;line-height:1" title="Copy TXT record">' +
          '<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M5 4.5v-2A1.5 1.5 0 016.5 1h5A1.5 1.5 0 0113 2.5v7a1.5 1.5 0 01-1.5 1.5h-2"/><path d="M3 5.5A1.5 1.5 0 014.5 4h5A1.5 1.5 0 0111 5.5v7A1.5 1.5 0 019.5 14h-5A1.5 1.5 0 013 12.5z"/></svg></button></div>' +
          '<button onclick="verifyKey(\'' + esc(firstPrefix) + '\')" style="background:var(--blue);color:#fff;border:none;border-radius:4px;padding:6px 16px;cursor:pointer;font-size:var(--fs-sm)">Verify Now</button>' +
          '<span id="ak-verify-status" style="margin-left:8px;font-size:var(--fs-sm);color:var(--muted)"></span></div>' +
          '<div style="color:var(--orange);font-size:var(--fs-xs)">Save these keys now — they will not be shown again.</div>');
      } else {
        showResult('<div style="color:var(--orange);font-size:var(--fs-sm)">' + esc(handleApiError(data, 'Failed')) + '</div>');
      }
    } catch (e) {
      showResult('<div style="color:var(--orange);font-size:var(--fs-sm)">' + esc(e?.message || e || 'Network error') + '</div>');
    }
    submitBtn.disabled = false;
    submitBtn.textContent = 'Generate API Key';
  }

  submitBtn.addEventListener('click', generateKey);
  domainInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !submitBtn.disabled) generateKey(); });
}

// ──────────────────────────────────────────────────────────
//  Key Management (via existing API key)
// ──────────────────────────────────────────────────────────
let _kmInit = false;
let _mgmtKey = '';  // captured on successful manage, used for mgmt revoke calls

function initKeyManagement() {
  const domainInput = document.getElementById('ak-mgmt-domain');
  const keyInput = document.getElementById('ak-mgmt-key');
  const btn = document.getElementById('ak-mgmt-btn');
  const errorEl = document.getElementById('ak-mgmt-error');
  const resultEl = document.getElementById('ak-mgmt-result');
  if (!btn) return;

  if (_kmInit) return;
  _kmInit = true;

  btn.addEventListener('click', async () => {
    const domain = domainInput.value.trim();
    const apiKey = keyInput.value.trim();
    if (!domain || !apiKey) { errorEl.textContent = 'Enter both domain and API key.'; return; }
    errorEl.textContent = '⏳ Verifying...';

    try {
      const res = await fetch('/api/keys/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, api_key: apiKey }),
      });
      const data = await res.json();
      if (!res.ok) {
        errorEl.innerHTML = '<span style="color:var(--orange)">✗ ' + esc(handleApiError(data, data.error || 'Failed')) + '</span>';
        return;
      }
      errorEl.textContent = '';
      _mgmtKey = apiKey;  // capture for subsequent revoke calls
      renderMgmtTable(data.domain, data.keys);
    } catch (e) {
      errorEl.innerHTML = '<span style="color:var(--orange)">✗ ' + esc(e?.message || e || 'Network error') + '</span>';
    }
  });

  function renderMgmtTable(domain, keys) {
    const esc2 = s => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
    const fmt = n => n ? new Date(n).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Never';

    let html = '<div style="color:var(--green);font-weight:600;margin-bottom:8px">✓ Verified! Keys for <strong>' + esc2(domain) + '</strong>:</div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:var(--fs-xs)"><thead><tr>' +
      '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);color:var(--muted)">Prefix</th>' +
      '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);color:var(--muted)">Status</th>' +
      '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);color:var(--muted)">Expires</th>' +
      '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);color:var(--muted)">Created</th>' +
      '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);color:var(--muted)">Requests</th>' +
      '<th style="text-align:right;padding:6px 8px;border-bottom:1px solid var(--border);color:var(--muted)"></th></tr></thead><tbody>';

    for (const k of keys) {
      const sc = k.status === 'active' ? 'var(--green)' : k.status === 'pending' ? 'var(--orange)' : 'var(--muted)';
      let expiresHtml = '<td style="padding:6px 8px;border-bottom:1px solid var(--border);color:var(--muted)">' + (k.expires_at ? fmtExpiry(k.expires_at) : '-') + '</td>';
      html += '<tr>' +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--border);font-family:var(--mono)">' + esc2(k.prefix) + '</td>' +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--border);color:' + sc + '">' + esc2(k.status) + '</td>' +
        expiresHtml +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--border);color:var(--muted)">' + fmt(k.created_at) + '</td>' +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--border);color:var(--muted)">' + esc2(String(k.request_count)) + '</td>' +
        (k.status !== 'revoked'
          ? '<td style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:right"><button onclick="mgmtRevoke(\'' + esc2(k.prefix) + '\')" style="background:var(--red);color:#fff;border:none;border-radius:3px;padding:3px 10px;cursor:pointer;font-size:0.7rem">Revoke</button></td>'
          : '<td style="padding:6px 8px;border-bottom:1px solid var(--border)"></td>') +
        '</tr>';
    }
    html += '</tbody></table>';
    html += '<div style="font-size:0.65rem;color:var(--muted);margin-top:6px">' +
      'Your key is sent via X-API-Key header. Keys auto-extend on use — expires if unused for 90 days.</div>';
    resultEl.innerHTML = html;
  }

  window.mgmtRevoke = async function(prefix) {
    if (!prefix || !confirm('Revoke key prefix "' + prefix + '"?')) return;
    if (!_mgmtKey) { alert('Session expired. Re-enter your API key.'); return; }
    try {
      const res = await fetch('/api/keys/' + encodeURIComponent(prefix.trim()) + '/revoke', {
        method: 'POST',
        headers: { 'X-API-Key': _mgmtKey },
      });
      const data = await res.json();
      if (res.ok) {
        document.getElementById('ak-mgmt-btn').click();
      } else if (data.code === 'CANNOT_SELF_REVOKE') {
        alert(ERROR_MESSAGES.CANNOT_SELF_REVOKE);
      } else {
        alert(handleApiError(data, data.error || 'Failed'));
      }
    } catch (e) {
      alert(e?.message || e || 'Network error');
    }
  };
}

// ──────────────────────────────────────────────────────────
//  Key Recovery (DNS-verified domain ownership, fallback)
// ──────────────────────────────────────────────────────────
let _krInit = false;

function initKeyRecovery() {
  const domainInput = document.getElementById('ak-recover-domain');
  const btn = document.getElementById('ak-recover-btn');
  const stepEl = document.getElementById('ak-recover-step');
  const resultEl = document.getElementById('ak-recover-result');
  if (!btn) return;

  if (_krInit) return;
  _krInit = true;

  let currentToken = '';
  let currentDomain = '';

  btn.addEventListener('click', async () => {
    const domain = domainInput.value.trim();
    if (!domain) { stepEl.textContent = 'Enter a domain.'; return; }

    const turnstileToken = requireToken();
    if (turnstileToken === null) return;

    stepEl.innerHTML = '<span style="color:var(--muted)">⏳ Requesting verification token...</span>';

    try {
      const res = await fetch('/api/keys/recover/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, turnstile_token: turnstileToken }),
      });
      const data = await res.json();

      if (!res.ok) {
        stepEl.innerHTML = '<span style="color:var(--orange)">✗ ' + esc(handleApiError(data, data.error || 'Failed')) + '</span>';
        return;
      }

      currentToken = data.verification_token;
      currentDomain = data.domain;

      stepEl.innerHTML =
        '<div style="margin-top:8px">' +
        '<div style="font-weight:600;font-size:var(--fs-sm);margin-bottom:4px">📝 Add this TXT record to <strong>' + esc(data.domain) + '</strong> DNS:</div>' +
        '<div style="display:flex;align-items:center;gap:6px;background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:8px 10px;margin-bottom:8px">' +
        '<span style="flex:1;font-family:var(--mono);font-size:var(--fs-xs);word-break:break-all;color:var(--cyan)">gnaf-mgmt=' + esc(data.verification_token) + '</span>' +
        '<button onclick="copyKey(\'gnaf-mgmt=' + esc(data.verification_token) + '\',this)" style="background:transparent;border:1px solid var(--border);color:var(--base00);padding:3px 6px;border-radius:3px;cursor:pointer;flex-shrink:0;line-height:1" title="Copy TXT record">' +
        '<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M5 4.5v-2A1.5 1.5 0 016.5 1h5A1.5 1.5 0 0113 2.5v7a1.5 1.5 0 01-1.5 1.5h-2"/><path d="M3 5.5A1.5 1.5 0 014.5 4h5A1.5 1.5 0 0111 5.5v7A1.5 1.5 0 019.5 14h-5A1.5 1.5 0 013 12.5z"/></svg></button></div>' +
        '<button onclick="recoverVerify()" style="background:var(--blue);color:#fff;border:none;border-radius:4px;padding:6px 16px;cursor:pointer;font-size:var(--fs-sm)">Verify DNS & List Keys</button>' +
        '<span id="ak-recover-status" style="margin-left:8px;font-size:var(--fs-sm);color:var(--muted)"></span></div>';
    } catch (e) {
      stepEl.innerHTML = '<span style="color:var(--orange)">✗ ' + esc(e?.message || e || 'Network error') + '</span>';
    }
  });

  window.recoverVerify = async function() {
    const statusEl = document.getElementById('ak-recover-status');
    if (!statusEl || !currentToken) return;
    statusEl.textContent = '⏳ Verifying DNS...';

    const turnstileToken = requireToken();
    if (turnstileToken === null) return;

    try {
      const res = await fetch('/api/keys/recover/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: currentDomain,
          verification_token: currentToken,
          turnstile_token: turnstileToken,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        statusEl.innerHTML = '<span style="color:var(--orange)">✗ ' + esc(handleApiError(data, data.error || 'Verification failed')) + '</span>';
        return;
      }

      if (data.status === 'verified') {
        const esc2 = s => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
        const fmt = n => n ? new Date(n).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Never';

        let html = '<div style="color:var(--green);font-weight:600;margin-bottom:8px">✓ Domain verified — review keys below:</div>' +
          '<table style="width:100%;border-collapse:collapse;font-size:var(--fs-xs)"><thead><tr>' +
          '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);color:var(--muted)">Prefix</th>' +
          '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);color:var(--muted)">Status</th>' +
          '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);color:var(--muted)">Expires</th>' +
          '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);color:var(--muted)">Created</th>' +
          '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);color:var(--muted)">Requests</th>' +
          '<th style="text-align:right;padding:6px 8px;border-bottom:1px solid var(--border);color:var(--muted)"></th></tr></thead><tbody>';

        for (const k of data.keys) {
          const sc = k.status === 'active' ? 'var(--green)' : k.status === 'pending' ? 'var(--orange)' : 'var(--muted)';
          let expiresHtml = '<td style="padding:6px 8px;border-bottom:1px solid var(--border);color:var(--muted)">' + (k.expires_at ? fmtExpiry(k.expires_at) : '-') + '</td>';
          html += '<tr>' +
            '<td style="padding:6px 8px;border-bottom:1px solid var(--border);font-family:var(--mono)">' + esc2(k.prefix) + '</td>' +
            '<td style="padding:6px 8px;border-bottom:1px solid var(--border);color:' + sc + '">' + esc2(k.status) + '</td>' +
            expiresHtml +
            '<td style="padding:6px 8px;border-bottom:1px solid var(--border);color:var(--muted)">' + fmt(k.created_at) + '</td>' +
            '<td style="padding:6px 8px;border-bottom:1px solid var(--border);color:var(--muted)">' + esc2(String(k.request_count)) + '</td>' +
            '<td style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:right"></td>' +
            '</tr>';
        }
        html += '</tbody></table>';
        html += '<div style="font-size:0.65rem;color:var(--muted);margin-top:6px">Keys auto-extend on use — expires if unused for 90 days.</div>';

        // Bulk-revoke button
        html += '<div style="margin-top:12px;padding:10px;background:var(--surface-2);border:1px solid var(--border);border-radius:4px">' +
          '<div style="font-size:var(--fs-sm);margin-bottom:6px">🗑 Lost access to all keys? Bulk-revoke them here. This is <strong>irreversible</strong>.</div>' +
          '<button onclick="recoverBulkRevoke()" style="background:var(--red);color:#fff;border:none;border-radius:4px;padding:8px 20px;cursor:pointer;font-size:var(--fs-sm)">Revoke ALL keys for this domain</button>' +
          '<span id="ak-bulk-revoke-status" style="margin-left:8px;font-size:var(--fs-sm);color:var(--muted)"></span></div>';

        // Warning banner
        html += '<div style="background:var(--surface-2);border-left:3px solid var(--red);padding:8px 10px;margin-top:8px;font-size:var(--fs-xs)">' +
          '<strong>⚠ Remove the <code>gnaf-mgmt</code> TXT record</strong> from your DNS now. While it exists, anyone who can add DNS records for your domain can manage your keys.</div>';

        resultEl.innerHTML = html;
        statusEl.textContent = '';
      } else {
        statusEl.innerHTML = '<span style="color:var(--orange)">⏳ TXT record not found. It can take a few minutes to propagate.</span>';
      }
    } catch (e) {
      statusEl.textContent = e?.message || e || 'Network error';
    }
  };

  window.recoverBulkRevoke = async function() {
    const statusEl = document.getElementById('ak-bulk-revoke-status');
    if (!statusEl) return;
    if (!currentToken) { statusEl.textContent = 'Session expired. Start recovery again.'; return; }

    if (!confirm('⚠ Are you sure? This will revoke ALL active API keys for ' + currentDomain + '. This action is irreversible.')) return;

    statusEl.textContent = '⏳ Revoking all keys...';
    try {
      const res = await fetch('/api/keys/recover/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verification_token: currentToken }),
      });
      const data = await res.json();

      if (res.ok) {
        statusEl.innerHTML = '<span style="color:var(--green)">✓ Successfully revoked ' + esc(String(data.count)) + ' key(s) for ' + esc(data.domain) + '.</span>';
        // Clear the recovery flow since the token is now used
        currentToken = '';
        currentDomain = '';
      } else {
        statusEl.innerHTML = '<span style="color:var(--orange)">✗ ' + esc(handleApiError(data, data.error || 'Failed')) + '</span>';
      }
    } catch (e) {
      statusEl.innerHTML = '<span style="color:var(--orange)">✗ ' + esc(e?.message || e || 'Network error') + '</span>';
    }
  };
}

// ──────────────────────────────────────────────────────────
//  Global inline-callable functions
// ──────────────────────────────────────────────────────────

window.copyKey = async function(key, btn) {
  const orig = btn.innerHTML;
  try {
    await navigator.clipboard.writeText(key);
    btn.textContent = 'Copied';
    setTimeout(() => { btn.innerHTML = orig; }, 1500);
  } catch {
    btn.textContent = 'Failed';
    setTimeout(() => { btn.innerHTML = orig; }, 1500);
  }
};

window.revokeKey = async function(prefix) {
  const statusEl = document.getElementById('ak-revoke-status');
  if (!statusEl || !prefix) return;
  const keyFromUrl = new URLSearchParams(window.location.search).get('key');
  let apiKey = keyFromUrl || getApiKey();
  if (!apiKey) { statusEl.innerHTML = '<span style="color:var(--orange)">✗ No API key available. Set one in the header bar.</span>'; return; }

  statusEl.textContent = '⏳ Revoking...';
  try {
    const res = await fetch('/api/keys/' + encodeURIComponent(prefix.trim()) + '/revoke', {
      method: 'POST',
      headers: apiKey ? { 'X-API-Key': apiKey } : {},
    });
    const data = await res.json();
    if (res.ok) {
      statusEl.innerHTML = '<span style="color:var(--green)">✓ Key revoked. You can now generate a new one.</span>';
    } else if (data.code === 'CANNOT_SELF_REVOKE') {
      statusEl.innerHTML = '<span style="color:var(--orange)">✗ ' + esc(ERROR_MESSAGES.CANNOT_SELF_REVOKE) + '</span>';
    } else {
      statusEl.innerHTML = '<span style="color:var(--orange)">✗ ' + esc(handleApiError(data, data.error || 'Failed')) + '</span>';
    }
  } catch (e) {
    statusEl.innerHTML = '<span style="color:var(--orange)">✗ ' + esc(e?.message || e || 'Network error') + '</span>';
  }
};

window.verifyKey = async function(prefix) {
  const statusEl = document.getElementById('ak-verify-status');
  if (!statusEl) return;
  statusEl.textContent = '⏳ Checking DNS...';
  try {
    const res = await fetch('/api/keys/' + encodeURIComponent(prefix) + '/verify', { method: 'POST' });
    const data = await res.json();
    if (data.status === 'verified' || data.status === 'active') {
      statusEl.innerHTML = '<span style="color:var(--green)">✓ Verified! Key is active.</span>';
    } else if (data.status === 'pending') {
      statusEl.innerHTML = '<span style="color:var(--orange)">⏳ TXT record not found yet. It can take a few minutes to propagate.</span>';
    } else if (data.status === 'dns_error') {
      statusEl.innerHTML = '<span style="color:var(--orange)">⚠ Could not query DNS. Check the domain name.</span>';
    } else {
      statusEl.textContent = data.message || 'Verification failed.';
    }
  } catch (e) {
    statusEl.textContent = e?.message || e || 'Network error';
  }
};

// ──────────────────────────────────────────────────────────
//  Helper — format expiry date with color coding
// ──────────────────────────────────────────────────────────
function fmtExpiry(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '-';
  const now = Date.now();
  const daysLeft = Math.round((d.getTime() - now) / 86400000);
  const formatted = d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  if (daysLeft < 0) return '<span style="color:var(--red)" title="Key expired">' + formatted + ' (expired)</span>';
  if (daysLeft <= 30) return '<span style="color:var(--orange)" title="Expires soon — keep using the key to auto-extend">' + formatted + '</span>';
  return formatted;
}

// ──────────────────────────────────────────────────────────
//  Initialization
// ──────────────────────────────────────────────────────────

document.addEventListener('tab-loaded', (e) => {
  if (e.detail.tab === 'keys') {
    initKeyGate();
    initKeyGeneration();
    initKeyManagement();
    initKeyRecovery();
  }
});

if (document.querySelector('.tab[data-tab="keys"].active')) {
  document.addEventListener('DOMContentLoaded', () => setTimeout(() => {
    initKeyGate();
    initKeyGeneration();
    initKeyManagement();
    initKeyRecovery();
  }, 200));
}
