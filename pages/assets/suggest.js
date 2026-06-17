// G-NAF Address Autocomplete — Suggest Panel Logic
// =============================================================

// Stored results for frontend pagination
let _suggestAllResults = [];
let _suggestMetaData = {};

function renderSuggestPage() {
  const off = parseInt(document.getElementById("soff").value, 10) || 0;
  const page = _suggestAllResults.slice(off, off + PAGE_SIZE);
  const total = _suggestAllResults.length;

  const tbody = document.querySelector("#suggestTable tbody");
  tbody.innerHTML = "";

  const meta = document.getElementById("suggestMeta");
  meta.innerHTML =
    `<span class="tier">${_suggestMetaData.tier || "-"}</span>` +
    (_suggestMetaData.cacheHit
      ? ` <span class="badge badge-info" title="Served from in-process LRU cache">↺ cache</span>`
      : "") +
    ` &middot; <span class="count">${total}</span> results &middot; ` +
    `server: <span class="ms">${_suggestMetaData.took_ms}ms</span> &middot; ` +
    `HTTP: ${_suggestMetaData.httpMs}ms`;

  page.forEach((r) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="lookup-link" title="Click to look up">${r.id}</td>
      <td>${esc(r.display)}</td>
      <td>${esc(r.locality)}</td>
      <td>${esc(r.state)}</td>
      <td>${esc(r.postcode)}</td>
      <td>${r.score != null ? r.score.toFixed(4) : '<span class="null">-</span>'}</td>
      <td>${r.lat != null ? r.lat : '<span class="null">-</span>'}</td>
      <td>${r.lon != null ? r.lon : '<span class="null">-</span>'}</td>`;
    tr.querySelector("td").addEventListener("click", () => {
      const pid = r.id;
      document.querySelector('[data-tab="detail"]').click();
      const panel = document.getElementById("panel-detail");
      if (panel?.dataset.loaded) {
        const pidEl = document.getElementById("pid");
        if (pidEl) {
          pidEl.value = pid;
          doDetail();
        }
      } else {
        const onLoaded = (e) => {
          if (e.detail.tab === "detail") {
            document.removeEventListener("tab-loaded", onLoaded);
            const pidEl = document.getElementById("pid");
            if (pidEl) {
              pidEl.value = pid;
              doDetail();
            }
          }
        };
        document.addEventListener("tab-loaded", onLoaded);
      }
    });
    tbody.appendChild(tr);
  });

  // Update pagination controls
  const pag = document.getElementById("suggestPagination");
  const pageInfo = document.getElementById("suggestPageInfo");
  if (pag && pageInfo) {
    const pageStart = off + 1;
    const pageEnd = Math.min(off + PAGE_SIZE, total);
    const hasPrev = off > 0;
    const hasNext = pageEnd < total;
    pageInfo.textContent = `${pageStart}–${pageEnd} of ${total}`;
    const prevBtn = pag.querySelector(".pagi-prev");
    const nextBtn = pag.querySelector(".pagi-next");
    if (prevBtn) prevBtn.disabled = !hasPrev;
    if (nextBtn) nextBtn.disabled = !hasNext;
    pag.style.display = total > PAGE_SIZE ? "flex" : "none";
    // Wire buttons (replace to drop old listeners)
    const np = prevBtn.cloneNode(true);
    const nn = nextBtn.cloneNode(true);
    prevBtn.replaceWith(np);
    nextBtn.replaceWith(nn);
    np.addEventListener("click", () => {
      document.getElementById("soff").value = Math.max(0, off - PAGE_SIZE);
      renderSuggestPage();
    });
    nn.addEventListener("click", () => {
      document.getElementById("soff").value = off + PAGE_SIZE;
      renderSuggestPage();
    });
  }
}

// =============================================================
// Suggest (advanced search)
// =============================================================
const PAGE_SIZE = 15;

async function doSuggest() {
  const q = document.getElementById("sq").value.trim();
  if (q.length < 2) {
    alert("Query must be at least 2 chars");
    return;
  }
  const state = document.getElementById("sstate").value;
  const postcode = document.getElementById("spc").value.trim();
  const limit = parseInt(document.getElementById("slim").value, 10) || 10;

  const params = new URLSearchParams({ q, limit: String(limit), offset: "0" });
  if (state) params.set("state", state);
  if (postcode) params.set("postcode", postcode);

  const btn = document.getElementById("suggestBtn");
  btn.classList.add("is-loading");
  btn.disabled = true;

  const t0 = performance.now();
  let resp;
  try {
    resp = await apiFetch(`${API}/suggest?${params}`);
  } catch (_e) {
    document.getElementById("suggestMeta").textContent = "Network error — is the API running?";
    btn.classList.remove("is-loading");
    btn.disabled = false;
    return;
  }
  const t1 = performance.now();
  const httpMs = (t1 - t0).toFixed(1);

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    const msg =
      err.code && ERROR_MESSAGES[err.code]
        ? ERROR_MESSAGES[err.code]
        : err.error || "Unknown error";
    if (err.code === "KEY_EXPIRED") {
      dispatchKeyExpired();
    }
    document.getElementById("suggestMeta").innerHTML =
      `<span class="text-red">HTTP ${resp.status}</span> — <span class="text-muted">${esc(msg)}</span> (HTTP: ${httpMs}ms)`;
    const pag = document.getElementById("suggestPagination");
    if (pag) pag.style.display = "none";
    btn.classList.remove("is-loading");
    btn.disabled = false;
    return;
  }

  const data = await resp.json();

  if (data.results && data.results.length > 0) {
    _suggestAllResults = data.results;
    _suggestMetaData = {
      tier: data.tier || "-",
      cacheHit: data.cache_status === "hit",
      took_ms: data.took_ms,
      httpMs,
    };
    document.getElementById("soff").value = "0";
    renderSuggestPage();
  } else {
    _suggestAllResults = [];
    const cacheTag = data.cache_status === "hit" ? " ↺ cache" : "";
    document.getElementById("suggestMeta").textContent =
      `No results${cacheTag} (server: ${data.took_ms}ms, HTTP: ${httpMs}ms)`;
    document.querySelector("#suggestTable tbody").innerHTML = "";
    const pag = document.getElementById("suggestPagination");
    if (pag) pag.style.display = "none";
  }

  btn.classList.remove("is-loading");
  btn.disabled = false;
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
  const items = acDropdown.querySelectorAll(".ac-item");
  if (!items.length) return;
  let idx = Array.from(items).findIndex((el) => el.classList.contains("highlighted"));
  items[idx]?.classList.remove("highlighted");
  idx = Math.max(0, Math.min(items.length - 1, idx + dir));
  items[idx].classList.add("highlighted");
  items[idx].scrollIntoView({ block: "nearest" });
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
      const msg =
        err.code && ERROR_MESSAGES[err.code]
          ? ERROR_MESSAGES[err.code]
          : err.error || "Unknown error";
      if (err.code === "KEY_EXPIRED") {
        dispatchKeyExpired();
      }
      acDropdown.innerHTML = `<div class="ac-empty">HTTP ${resp.status}: ${esc(msg)}</div>`;
      return;
    }
    const data = await resp.json();
    if (acAbort !== controller) return;

    if (!data.results || data.results.length === 0) {
      acDropdown.innerHTML = '<div class="ac-empty">No results found</div>';
      return;
    }

    acDropdown.innerHTML = data.results
      .map(
        (r, i) =>
          `<div class="ac-item${i === 0 ? " highlighted" : ""}" data-id="${escAttr(r.id)}" data-display="${escAttr(r.display)}" data-locality="${escAttr(r.locality)}" data-state="${escAttr(r.state)}" data-postcode="${escAttr(r.postcode)}" data-score="${r.score}" data-lat="${r.lat ?? ""}" data-lon="${r.lon ?? ""}">
        <div class="ac-display">${esc(r.display)}</div>
        <div class="ac-meta">
          <span>${esc(r.locality)}</span>
          <span>${esc(r.state)} ${esc(r.postcode)}</span>
          <span>score ${r.score != null ? r.score.toFixed(3) : "-"}</span>
          <span class="text-blue">${data.tier || ""}</span>
        </div>
      </div>`,
      )
      .join("");

    acDropdown.querySelectorAll(".ac-item").forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.dataset.id;
        const display = el.dataset.display;
        acDropdown.classList.remove("open");
        acInput.value = display;

        const pag = document.getElementById("suggestPagination");
        if (pag) pag.style.display = "none";
        const tbody = document.querySelector("#suggestTable tbody");
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
        tbody.querySelector("td.lookup-link")?.addEventListener("click", () => {
          document.querySelector('[data-tab="detail"]').click();
          const panel = document.getElementById("panel-detail");
          if (panel?.dataset.loaded) {
            const pidEl = document.getElementById("pid");
            if (pidEl) {
              pidEl.value = id;
              doDetail();
            }
          } else {
            const onLoaded = (e) => {
              if (e.detail.tab === "detail") {
                document.removeEventListener("tab-loaded", onLoaded);
                const pidEl = document.getElementById("pid");
                if (pidEl) {
                  pidEl.value = id;
                  doDetail();
                }
              }
            };
            document.addEventListener("tab-loaded", onLoaded);
          }
        });
        document.getElementById("suggestMeta").innerHTML =
          `Clicked: <strong>${esc(display)}</strong> &middot; <span class="tier">${data.tier || "-"}</span>`;

        const pidEl = document.getElementById("pid");
        if (pidEl) pidEl.value = id;
      });
    });
  } catch (e) {
    if (e.name === "AbortError") return;
    acDropdown.innerHTML = '<div class="ac-empty">Network error</div>';
  }
}

function doSuggestFromAc() {
  document.getElementById("sq").value = acInput.value;
  doSuggest();
}

// =============================================================
// Expired-key badge in the meta line
// =============================================================
document.addEventListener("key-expired", () => {
  const meta = document.getElementById("suggestMeta");
  if (meta && !meta.querySelector(".badge-expired")) {
    meta.insertAdjacentHTML(
      "afterbegin",
      '<span class="badge badge-expired" style="background:var(--red);color:#fff;padding:2px 6px;border-radius:3px;font-size:0.7rem;margin-right:6px">🔑 expired</span> ',
    );
  }
});

// =============================================================
// Init suggest tab when loaded
// =============================================================
let _suggestInitialized = false;

function initSuggest() {
  if (_suggestInitialized) return;
  _suggestInitialized = true;
  acInput = document.getElementById("acInput");
  acDropdown = document.getElementById("acDropdown");
  if (!acInput || !acDropdown) return;

  // Tab-specific API key input — saves to localStorage so apiFetch picks it up
  const suggestKeyInput = document.getElementById("suggestApiKey");
  const suggestKeySave = document.getElementById("suggestApiKeySave");
  const suggestKeyStatus = document.getElementById("suggestApiKeyStatus");
  if (suggestKeyInput && suggestKeySave && suggestKeyStatus) {
    const stored = localStorage.getItem("gnaf_api_key") || "";
    if (stored) {
      suggestKeyInput.value = stored;
      suggestKeyStatus.textContent = `✓ ${maskKey(stored)}`;
    }
    suggestKeySave.addEventListener("click", async () => {
      const key = suggestKeyInput.value.trim();
      if (key) {
        localStorage.setItem("gnaf_api_key", key);
        suggestKeyStatus.textContent = `✓ saved`;
        const statusEl = suggestKeyStatus;
        statusEl.textContent = "⏳ verifying...";
        try {
          const resp = await fetch("/api/keys/manage", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-API-Key": key },
            body: JSON.stringify({ domain: "verify-check", api_key: key }),
          });
          if (resp.ok || resp.status === 400) {
            // 400 means key is valid but domain check failed (expected for verify-check domain)
            const expires = resp.headers.get("X-Key-Expires-At");
            if (expires) {
              const d = new Date(expires);
              const days = Math.round((d.getTime() - Date.now()) / 86400000);
              if (days < 0) {
                statusEl.textContent = `✗ expired on ${d.toLocaleDateString()}`;
                return;
              }
              if (days <= 30) {
                statusEl.textContent = `✓ ${maskKey(key)} (expires in ${days}d)`;
                return;
              }
            }
            statusEl.textContent = `✓ ${maskKey(key)}`;
          } else if (resp.status === 401) {
            statusEl.textContent = "✗ Invalid or expired key";
          } else if (resp.status === 403) {
            const data = await resp.json().catch(() => ({}));
            if (data.code === "KEY_EXPIRED") {
              statusEl.textContent = "✗ Key expired — generate a new one";
            } else {
              statusEl.textContent = `✗ ${data.error || "Key rejected"}`;
            }
          } else {
            statusEl.textContent = `✓ ${maskKey(key)}`;
          }
        } catch {
          statusEl.textContent = `✓ ${maskKey(key)}`;
        }
      }
    });
  }

  acInput.addEventListener("input", () => {
    clearTimeout(acTimer);
    if (acAbort) {
      acAbort.abort();
      acAbort = null;
    }
    const val = acInput.value.trim();
    if (val.length < AC_MIN) {
      acDropdown.classList.remove("open");
      acDropdown.innerHTML = "";
      return;
    }
    acDropdown.innerHTML =
      '<div class="ac-loading"><span class="ac-spinner"></span> Searching…</div>';
    acDropdown.classList.add("open");
    acTimer = setTimeout(() => fetchSuggestions(val), AC_DEBOUNCE);
  });

  acInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      acDropdown.classList.remove("open");
      acInput.blur();
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      highlightNext(1);
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      highlightNext(-1);
    }
    if (e.key === "Enter") {
      const hl = acDropdown.querySelector(".highlighted");
      if (hl) {
        hl.click();
        return;
      }
      doSuggestFromAc();
    }
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".ac-wrap")) acDropdown.classList.remove("open");
  });

  document.getElementById("suggestBtn").addEventListener("click", doSuggest);
  document.getElementById("sq").addEventListener("keydown", (e) => {
    if (e.key === "Enter") doSuggest();
  });

  document.querySelectorAll("[data-q]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.getElementById("sq").value = btn.dataset.q;
      document.getElementById("sstate").value = btn.dataset.state || "";
      document.querySelector('[data-tab="suggest"]').click();
      doSuggest();
    });
  });
}

// Init on first tab load
document.addEventListener("tab-loaded", (e) => {
  if (e.detail.tab === "suggest") initSuggest();
});

// Also init if suggest tab is already active on page load
if (document.querySelector('.tab[data-tab="suggest"].active')) {
  document.addEventListener("DOMContentLoaded", () => setTimeout(initSuggest, 100));
}
