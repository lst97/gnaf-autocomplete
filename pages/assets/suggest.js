// G-NAF Address Autocomplete — Suggest Panel Logic
// =============================================================

// =============================================================
// Suggest (advanced search)
// =============================================================
async function doSuggest() {
  const q = document.getElementById('sq').value.trim();
  if (q.length < 2) { alert('Query must be at least 2 chars'); return; }
  const state = document.getElementById('sstate').value;
  const postcode = document.getElementById('spc').value.trim();
  const limit = parseInt(document.getElementById('slim').value) || 10;
  const offset = parseInt(document.getElementById('soff').value) || 0;

  const params = new URLSearchParams({ q, limit: String(limit), offset: String(offset) });
  if (state) params.set('state', state);
  if (postcode) params.set('postcode', postcode);

  const t0 = performance.now();
  let resp;
  try {
    resp = await apiFetch(`${API}/suggest?${params}`);
  } catch (e) {
    document.getElementById('suggestMeta').textContent = 'Network error — is the API running?';
    return;
  }
  const t1 = performance.now();
  const httpMs = (t1 - t0).toFixed(1);

  const tbody = document.querySelector('#suggestTable tbody');
  tbody.innerHTML = '';

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    document.getElementById('suggestMeta').innerHTML =
      `<span class="text-red">HTTP ${resp.status}</span> — <span class="text-muted">${err.error || 'Unknown error'}</span> (HTTP: ${httpMs}ms)`;
    return;
  }

  const data = await resp.json();
  const meta = document.getElementById('suggestMeta');

  if (data.results && data.results.length > 0) {
    const cacheBadge = data.cache_status === "hit"
      ? ` <span class="badge badge-info" title="Served from in-process LRU cache">↺ cache</span>`
      : "";
    meta.innerHTML =
      `<span class="tier">${data.tier || '-'}</span>${cacheBadge} &middot; ` +
      `<span class="count">${data.results.length}</span> results &middot; ` +
      `server: <span class="ms">${data.took_ms}ms</span> &middot; HTTP: ${httpMs}ms`;
    data.results.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="lookup-link" title="Click to look up">${r.id}</td>
        <td>${esc(r.display)}</td>
        <td>${esc(r.locality)}</td>
        <td>${esc(r.state)}</td>
        <td>${esc(r.postcode)}</td>
        <td>${r.score != null ? r.score.toFixed(4) : '<span class="null">-</span>'}</td>
        <td>${r.lat != null ? r.lat : '<span class="null">-</span>'}</td>
        <td>${r.lon != null ? r.lon : '<span class="null">-</span>'}</td>`;
      tr.querySelector('td').addEventListener('click', () => {
        const pid = r.id;
        document.querySelector('[data-tab="detail"]').click();
        const panel = document.getElementById('panel-detail');
        if (panel?.dataset.loaded) {
          const pidEl = document.getElementById('pid');
          if (pidEl) { pidEl.value = pid; doDetail(); }
        } else {
          const onLoaded = (e) => {
            if (e.detail.tab === 'detail') {
              document.removeEventListener('tab-loaded', onLoaded);
              const pidEl = document.getElementById('pid');
              if (pidEl) { pidEl.value = pid; doDetail(); }
            }
          };
          document.addEventListener('tab-loaded', onLoaded);
        }
      });
      tbody.appendChild(tr);
    });
  } else {
    const cacheTag = data.cache_status === "hit" ? " ↺ cache" : "";
    meta.textContent = `No results${cacheTag} (server: ${data.took_ms}ms, HTTP: ${httpMs}ms)`;
  }
}

// =============================================================
// Autocomplete (live as-you-type dropdown)
// =============================================================
let acTimer = null;
let acAbort = null;
const AC_MIN = 2;
const AC_DEBOUNCE = 250;
let acInput, acDropdown; // hoisted — assigned in initSuggest()

function highlightNext(dir) {
  const items = acDropdown.querySelectorAll('.ac-item');
  if (!items.length) return;
  let idx = Array.from(items).findIndex(el => el.classList.contains('highlighted'));
  items[idx]?.classList.remove('highlighted');
  idx = Math.max(0, Math.min(items.length - 1, idx + dir));
  items[idx].classList.add('highlighted');
  items[idx].scrollIntoView({ block: 'nearest' });
}

async function fetchSuggestions(q) {
  if (acAbort) acAbort.abort();
  const controller = new AbortController();
  acAbort = controller;

  try {
    const resp = await apiFetch(`${API}/suggest?q=${encodeURIComponent(q)}&limit=15`, {
      signal: controller.signal,
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      acDropdown.innerHTML = '<div class="ac-empty">HTTP ' + resp.status + ': ' + esc(err.error || 'Unknown error') + '</div>';
      return;
    }
    const data = await resp.json();
    if (acAbort !== controller) return;

    if (!data.results || data.results.length === 0) {
      acDropdown.innerHTML = '<div class="ac-empty">No results found</div>';
      return;
    }

    acDropdown.innerHTML = data.results.map((r, i) =>
      `<div class="ac-item${i === 0 ? ' highlighted' : ''}" data-id="${escAttr(r.id)}" data-display="${escAttr(r.display)}" data-locality="${escAttr(r.locality)}" data-state="${escAttr(r.state)}" data-postcode="${escAttr(r.postcode)}" data-score="${r.score}" data-lat="${r.lat ?? ''}" data-lon="${r.lon ?? ''}">
        <div class="ac-display">${esc(r.display)}</div>
        <div class="ac-meta">
          <span>${esc(r.locality)}</span>
          <span>${esc(r.state)} ${esc(r.postcode)}</span>
          <span>score ${r.score != null ? r.score.toFixed(3) : '-'}</span>
          <span class="text-blue">${data.tier || ''}</span>
        </div>
      </div>`
    ).join('');

    acDropdown.querySelectorAll('.ac-item').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.id;
        const display = el.dataset.display;
        acDropdown.classList.remove('open');
        acInput.value = display;

        const tbody = document.querySelector('#suggestTable tbody');
        tbody.innerHTML = `<tr>
          <td class="lookup-link">${esc(id)}</td>
          <td>${esc(el.dataset.display)}</td>
          <td>${esc(el.dataset.locality)}</td>
          <td>${esc(el.dataset.state)}</td>
          <td>${esc(el.dataset.postcode)}</td>
          <td>${el.dataset.score ? parseFloat(el.dataset.score).toFixed(4) : '<span class="null">-</span>'}</td>
          <td>${el.dataset.lat || '<span class="null">-</span>'}</td>
          <td>${el.dataset.lon || '<span class="null">-</span>'}</td>
        </tr>`;
        tbody.querySelector('td.lookup-link')?.addEventListener('click', () => {
          document.querySelector('[data-tab="detail"]').click();
          const panel = document.getElementById('panel-detail');
          if (panel?.dataset.loaded) {
            const pidEl = document.getElementById('pid');
            if (pidEl) { pidEl.value = id; doDetail(); }
          } else {
            const onLoaded = (e) => {
              if (e.detail.tab === 'detail') {
                document.removeEventListener('tab-loaded', onLoaded);
                const pidEl = document.getElementById('pid');
                if (pidEl) { pidEl.value = id; doDetail(); }
              }
            };
            document.addEventListener('tab-loaded', onLoaded);
          }
        });
        document.getElementById('suggestMeta').innerHTML = `Clicked: <strong>${esc(display)}</strong> &middot; <span class="tier">${data.tier || '-'}</span>`;

        const pidEl = document.getElementById('pid');
        if (pidEl) pidEl.value = id;
      });
    });
  } catch (e) {
    if (e.name === 'AbortError') return;
    acDropdown.innerHTML = '<div class="ac-empty">Network error</div>';
  }
}

function doSuggestFromAc() {
  document.getElementById('sq').value = acInput.value;
  doSuggest();
}

// Wrap doSuggest to sync acInput with sq
const origDoSuggest = doSuggest;
doSuggest = function() {
  acInput.value = document.getElementById('sq').value;
  return origDoSuggest.apply(this, arguments);
};

// =============================================================
// Init suggest tab when loaded
// =============================================================
function initSuggest() {
  acInput = document.getElementById('acInput');
  acDropdown = document.getElementById('acDropdown');
  if (!acInput || !acDropdown) return;

  acInput.addEventListener('input', () => {
    clearTimeout(acTimer);
    if (acAbort) { acAbort.abort(); acAbort = null; }
    const val = acInput.value.trim();
    if (val.length < AC_MIN) {
      acDropdown.classList.remove('open');
      acDropdown.innerHTML = '';
      return;
    }
    acDropdown.innerHTML = '<div class="ac-loading"><span class="ac-spinner"></span> Searching…</div>';
    acDropdown.classList.add('open');
    acTimer = setTimeout(() => fetchSuggestions(val), AC_DEBOUNCE);
  });

  acInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { acDropdown.classList.remove('open'); acInput.blur(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); highlightNext(1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); highlightNext(-1); }
    if (e.key === 'Enter') {
      const hl = acDropdown.querySelector('.highlighted');
      if (hl) { hl.click(); return; }
      doSuggestFromAc();
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.ac-wrap')) acDropdown.classList.remove('open');
  });

  document.getElementById('suggestBtn').addEventListener('click', doSuggestFromAc);
  document.getElementById('sq').addEventListener('keydown', e => { if (e.key === 'Enter') doSuggest(); });

  document.querySelectorAll('[data-q]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('sq').value = btn.dataset.q;
      document.getElementById('sstate').value = btn.dataset.state || '';
      document.querySelector('[data-tab="suggest"]').click();
      doSuggest();
    });
  });
}

// Init on first tab load
document.addEventListener('tab-loaded', (e) => {
  if (e.detail.tab === 'suggest') initSuggest();
});

// Also init if suggest tab is already active on page load
if (document.querySelector('.tab[data-tab="suggest"].active')) {
  document.addEventListener('DOMContentLoaded', () => setTimeout(initSuggest, 100));
}
