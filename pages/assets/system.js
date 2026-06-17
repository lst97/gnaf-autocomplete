// G-NAF Address Autocomplete — System/Diagnostics Panel Logic
// =============================================================

async function sysFetch(url, label, opts) {
  const el = document.getElementById("sysResult");
  if (!el) return;
  const t0 = performance.now();
  try {
    const resp = await fetch(API + url, opts || {});
    const body = await resp.text();
    const ms = (performance.now() - t0).toFixed(1);
    let parsed;
    try {
      parsed = JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      parsed = body;
    }
    el.textContent = `// ${label} — HTTP ${resp.status} (${ms}ms)\n\n${parsed}`;
  } catch (e) {
    el.textContent = `// ${label} — NETWORK ERROR\n\n${e.message}`;
  }
}

// =============================================================
// Init system tab when loaded
// =============================================================
function initSystem() {
  document
    .getElementById("healthzBtn")
    .addEventListener("click", () => sysFetch("/healthz", "GET /healthz"));
  document
    .getElementById("readyzBtn")
    .addEventListener("click", () => sysFetch("/readyz", "GET /readyz"));
  document
    .getElementById("warmupBtn")
    .addEventListener("click", () => sysFetch("/warmup", "POST /warmup", { method: "POST" }));
}

document.addEventListener("tab-loaded", (e) => {
  if (e.detail.tab === "system") initSystem();
});

if (document.querySelector('.tab[data-tab="system"].active')) {
  document.addEventListener("DOMContentLoaded", () => setTimeout(initSystem, 100));
}
