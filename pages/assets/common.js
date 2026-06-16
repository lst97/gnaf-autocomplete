// G-NAF Address Autocomplete — Common Utilities
// =============================================================

// API base detection
const API = location.protocol === 'file:' ? 'http://localhost:8000' : window.location.origin;

// Fetch G-NAF version and update header
fetch(API + '/api/config').then(r => r.json()).then(cfg => {
  const small = document.querySelector('.page-header h1 small');
  if (small && cfg.gnafVersion) {
    small.textContent = '16M Australian addresses · ' + cfg.gnafVersion;
  }
}).catch(() => {});

// Check for new G-NAF release and show badge
fetch(API + '/api/check-update').then(r => r.json()).then(data => {
  const h1 = document.querySelector('.page-header h1');
  if (!h1) return;
  // Remove existing version indicators
  const existing = h1.querySelector('.version-badge');
  if (existing) existing.remove();
  const existingCurrent = h1.querySelector('.version-current');
  if (existingCurrent) existingCurrent.remove();

  if (data.status === 'update_available' && data.latestAvailableVersion) {
    const badge = document.createElement('span');
    badge.className = 'version-badge';
    badge.textContent = 'New version available: ' + data.latestAvailableVersion;
    badge.title = 'Click to download the new G-NAF dataset';
    badge.addEventListener('click', function(e) {
      e.stopPropagation();
      showUpdateModal(data.currentVersion, data.latestAvailableVersion, data.downloadUrl);
    });
    h1.appendChild(badge);
  } else if (data.status === 'up_to_date') {
    const indicator = document.createElement('span');
    indicator.className = 'version-current';
    indicator.textContent = 'Up to date';
    indicator.title = 'G-NAF dataset is current';

    h1.appendChild(indicator);
  }
}).catch(() => {});

// =============================================================
// Version update notification modal
// =============================================================
function showUpdateModal(currentVersion, latestVersion, downloadUrl) {
  // Remove existing modal if any
  const existing = document.getElementById('updateModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'updateModal';
  modal.className = 'update-modal-overlay';
  modal.innerHTML =
    '<div class="update-modal-card">' +
      '<h2>New G-NAF Dataset Available</h2>' +
      '<p>A newer version of the G-NAF dataset is available:</p>' +
      '<p class="update-modal-versions">' +
        esc(currentVersion) + ' &rarr; ' + esc(latestVersion) +
      '</p>' +
      '<div class="update-modal-actions">' +
        '<a href="' + escAttr(downloadUrl || '#') + '" target="_blank" rel="noopener" class="btn btn-sm btn-green">Download from data.gov.au &nearr;</a>' +
        ' <button type="button" class="btn btn-sm btn-ghost" id="updateModalDismiss">Dismiss</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(modal);

  function closeModal() {
    const m = document.getElementById('updateModal');
    if (m) m.remove();
    document.removeEventListener('keydown', onKeyDown);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') closeModal();
  }

  // Close on backdrop click
  modal.addEventListener('click', function(e) {
    if (e.target === modal) closeModal();
  });
  // Dismiss button
  document.getElementById('updateModalDismiss').addEventListener('click', closeModal);
  // Escape key
  document.addEventListener('keydown', onKeyDown);
}

// =============================================================
// HTML escaping (XSS prevention)
// =============================================================
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// =============================================================
// API Key management (persisted in localStorage)
// =============================================================
const STORAGE_KEY = 'gnaf_api_key';
const EXPIRES_KEY = 'gnaf_api_key_expires_at';

function getApiKey() { return localStorage.getItem(STORAGE_KEY); }

function setApiKey(key, expiresAt) {
  if (!key) { clearApiKey(); return; }
  localStorage.setItem(STORAGE_KEY, key);
  if (expiresAt) localStorage.setItem(EXPIRES_KEY, expiresAt);
  updateApiKeyUI();
}

function clearApiKey() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(EXPIRES_KEY);
  updateApiKeyUI();
}

function maskKey(key) {
  if (key.length <= 20) return key.slice(0, 8) + '…' + key.slice(-4);
  return key.slice(0, 14) + '…' + key.slice(-6);
}

function getStoredExpiresAt() {
  const v = localStorage.getItem(EXPIRES_KEY);
  return v ? new Date(v) : null;
}

function updateApiKeyUI() {
  const input = document.getElementById('apiKeyInput');
  const saveBtn = document.getElementById('apiKeySaveBtn');
  const clearBtn = document.getElementById('apiKeyClearBtn');
  const status = document.getElementById('apiKeyStatus');
  if (!input || !saveBtn || !clearBtn || !status) return;

  saveBtn.textContent = 'Save';
  const key = getApiKey();
  const expires = getStoredExpiresAt();

  if (key) {
    input.value = key;
    clearBtn.style.display = '';

    if (expires && expires.getTime() < Date.now()) {
      // Expired
      status.textContent = '✗ Key expired';
      status.className = 'api-key-status key-expired';
      saveBtn.textContent = 'Replace';
      saveBtn.style.display = '';
    } else if (expires && (expires.getTime() - Date.now()) < 30 * 86400000) {
      // Expiring within 30 days
      const days = Math.round((expires.getTime() - Date.now()) / 86400000);
      status.textContent = '✓ ' + maskKey(key) + ' (expires in ' + days + 'd)';
      status.className = 'api-key-status key-expiring';
      saveBtn.style.display = 'none';
    } else {
      status.textContent = '✓ ' + maskKey(key);
      status.className = 'api-key-status key-ok';
      saveBtn.style.display = 'none';
    }
  } else {
    input.value = '';
    status.textContent = 'No key set — requests will fail';
    status.className = 'api-key-status key-missing';
    saveBtn.style.display = '';
    clearBtn.style.display = 'none';
  }
}

async function apiFetch(url, options = {}) {
  const key = getApiKey();
  if (key) {
    options.headers = { ...options.headers, 'X-API-Key': key };
  }
  // Bypass browser HTTP cache so the server-side LRU cache can serve
  // cache_status: "hit" on repeated requests. The server sets
  // Cache-Control: public, max-age=30 which browsers would otherwise use
  // to serve stale responses (with old took_ms and cache_status: "miss").
  return fetch(url, { ...options, cache: "no-store" });
}

// Listen for key-expired events from suggest/detail/keys panels
document.addEventListener('key-expired', () => {
  const status = document.getElementById('apiKeyStatus');
  if (status) {
    const key = getApiKey();
    status.textContent = '✗ Key expired: ' + (key ? maskKey(key) : '');
    status.className = 'api-key-status key-expired';
  }
});

// Initialize API key bar
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('apiKeyInput');
  const saveBtn = document.getElementById('apiKeySaveBtn');
  const clearBtn = document.getElementById('apiKeyClearBtn');

  if (input && saveBtn && clearBtn) {
    // Startup check: warn if stored key is expired
    const storedExpires = getStoredExpiresAt();
    if (getApiKey() && storedExpires && storedExpires.getTime() < Date.now()) {
      const status = document.getElementById('apiKeyStatus');
      if (status) {
        status.textContent = '✗ Stored API key has expired — generate a new one at the /keys tab';
        status.className = 'api-key-status key-expired';
      }
    }

    updateApiKeyUI();

    saveBtn.addEventListener('click', () => setApiKey(input.value.trim()));
    clearBtn.addEventListener('click', clearApiKey);

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveBtn.click();
    });

    input.addEventListener('input', () => {
      const stored = getApiKey();
      const current = input.value.trim();
      if (stored && current !== stored) {
        saveBtn.textContent = 'Replace';
        saveBtn.style.display = '';
        clearBtn.style.display = 'none';
      } else {
        updateApiKeyUI();
      }
    });
  }
});

// =============================================================
// Tab switching with lazy-load
// =============================================================
const tabCache = {};

async function fetchTabContent(tabName) {
  if (tabCache[tabName]) return tabCache[tabName];
  try {
    const resp = await fetch(`/${tabName}-tab.html`);
    if (!resp.ok) return `<p class="text-red">Failed to load ${tabName} tab (HTTP ${resp.status}).</p>`;
    const html = await resp.text();
    tabCache[tabName] = html;
    return html;
  } catch {
    return `<p class="text-red">Network error loading ${tabName} tab.</p>`;
  }
}

function setupTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', async () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const panel = document.getElementById('panel-' + tab.dataset.tab);
      panel.classList.add('active');

      // Lazy-load tab content on first access
      if (!panel.dataset.loaded) {
        panel.innerHTML = '<p style="padding:12px;color:var(--muted);font-size:var(--fs-sm)">Loading…</p>';
        const content = await fetchTabContent(tab.dataset.tab);
        panel.innerHTML = content;
        panel.dataset.loaded = 'true';

        // Reinitialize tab-specific handlers after content loads
        document.dispatchEvent(new CustomEvent('tab-loaded', { detail: { tab: tab.dataset.tab } }));
      }
    });
  });

  // Activate tab from URL query param (?tab=xxx)
  const urlTab = new URLSearchParams(window.location.search).get('tab');
  if (urlTab) {
    const targetTab = document.querySelector(`.tab[data-tab="${urlTab}"]`);
    if (targetTab) setTimeout(() => targetTab.click(), 50);
    return;
  }

  // Auto-load the initially active tab (no click event fired on page load)
  const activeTab = document.querySelector('.tab.active');
  if (activeTab) {
    const panel = document.getElementById('panel-' + activeTab.dataset.tab);
    if (panel && !panel.dataset.loaded) {
      fetchTabContent(activeTab.dataset.tab).then((content) => {
        panel.innerHTML = content;
        panel.dataset.loaded = 'true';
        document.dispatchEvent(new CustomEvent('tab-loaded', { detail: { tab: activeTab.dataset.tab } }));
      });
    }
  }
}

// Initialize tabs on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupTabs);
} else {
  setupTabs();
}
