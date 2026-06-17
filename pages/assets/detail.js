// G-NAF Address Autocomplete — Address Detail Panel Logic
// =============================================================

async function doDetail() {
  const pid = document.getElementById("pid").value.trim();
  if (!pid) {
    alert("Enter an address_detail_pid");
    return;
  }

  const t0 = performance.now();
  let resp;
  try {
    resp = await apiFetch(`${API}/address/${encodeURIComponent(pid)}`);
  } catch (_e) {
    document.getElementById("detailMeta").textContent = "Network error";
    return;
  }
  const httpMs = (performance.now() - t0).toFixed(1);

  const data = await resp.json();
  const serverMs = data.took_ms ?? data.meta?.took_ms;
  if (!resp.ok) {
    const msg =
      data.code && ERROR_MESSAGES[data.code]
        ? ERROR_MESSAGES[data.code]
        : data.error || "Unknown error";
    if (data.code === "KEY_EXPIRED") {
      dispatchKeyExpired();
    }
    document.getElementById("detailMeta").innerHTML =
      `<span class="text-red">HTTP ${resp.status}</span> — <span class="text-muted">${esc(msg)}</span>` +
      ` &middot; server: <span class="ms">${serverMs ?? "?"}ms</span> &middot; HTTP: ${httpMs}ms`;
  } else {
    document.getElementById("detailMeta").innerHTML =
      `server: <span class="ms">${serverMs}ms</span> &middot; HTTP: ${httpMs}ms`;
  }
  document.getElementById("detailResult").textContent = JSON.stringify(data, null, 2);
}

// =============================================================
// Init detail tab when loaded
// =============================================================
function initDetail() {
  document.getElementById("detailBtn").addEventListener("click", doDetail);
  document.getElementById("pid").addEventListener("keydown", (e) => {
    if (e.key === "Enter") doDetail();
  });
}

document.addEventListener("tab-loaded", (e) => {
  if (e.detail.tab === "detail") initDetail();
});

if (document.querySelector('.tab[data-tab="detail"].active')) {
  document.addEventListener("DOMContentLoaded", () => setTimeout(initDetail, 100));
}
