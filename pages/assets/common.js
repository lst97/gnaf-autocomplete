// G-NAF Address Autocomplete — Common Utilities
// =============================================================

// API base detection
const API = location.protocol === 'file:' ? 'http://localhost:8000' : window.location.origin;
document.getElementById('apiUrlDisplay').textContent = API;

// Fetch G-NAF version and update header
fetch(API + '/api/config').then(r => r.json()).then(cfg => {
  const small = document.querySelector('.page-header h1 small');
  if (small && cfg.gnafVersion) {
    small.textContent = '16M Australian addresses · ' + cfg.gnafVersion;
  }
}).catch(() => {});

// =============================================================
// HTML escaping (XSS prevention)
// =============================================================
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// =============================================================
// API Key management (persisted in localStorage)
// =============================================================
const STORAGE_KEY = 'gnaf_api_key';

function getApiKey() { return localStorage.getItem(STORAGE_KEY); }

function setApiKey(key) {
  if (!key) { clearApiKey(); return; }
  localStorage.setItem(STORAGE_KEY, key);
  updateApiKeyUI();
}

function clearApiKey() {
  localStorage.removeItem(STORAGE_KEY);
  updateApiKeyUI();
}

function maskKey(key) {
  if (key.length <= 20) return key.slice(0, 8) + '…' + key.slice(-4);
  return key.slice(0, 14) + '…' + key.slice(-6);
}

function updateApiKeyUI() {
  const input = document.getElementById('apiKeyInput');
  const saveBtn = document.getElementById('apiKeySaveBtn');
  const clearBtn = document.getElementById('apiKeyClearBtn');
  const status = document.getElementById('apiKeyStatus');
  if (!input || !saveBtn || !clearBtn || !status) return;

  const key = getApiKey();
  if (key) {
    input.value = key;
    status.textContent = '✓ ' + maskKey(key);
    status.className = 'api-key-status key-ok';
    saveBtn.style.display = 'none';
    clearBtn.style.display = '';
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
  return fetch(url, options);
}

// Initialize API key bar
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('apiKeyInput');
  const saveBtn = document.getElementById('apiKeySaveBtn');
  const clearBtn = document.getElementById('apiKeyClearBtn');

  if (input && saveBtn && clearBtn) {
    updateApiKeyUI();

    saveBtn.addEventListener('click', () => setApiKey(input.value.trim()));
    clearBtn.addEventListener('click', clearApiKey);

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveBtn.click();
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
