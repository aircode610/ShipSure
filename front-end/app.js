/* =========================================================
   BACKEND FETCH
   Sends credentials to backend and expects { pullRequests: [...] }
   ========================================================= */
async function fetchPullRequests(payload) {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Backend error (${response.status}): ${errorText || "Unknown error"}`
    );
  }

  return response.json();
}

/* =========================================================
   DEMO DATA (used before first analysis for UI development)
   ========================================================= */
const DEMO_DATA = {
  pullRequests: [
    {
      id: "demo-1",
      title: "Harden onboarding OAuth + audit logging",
      link: "#",
      risk: 72,
      coderabbitReviews: [
        {
          name: "Token leakage check",
          type: "danger",
          risk: 84,
          description: "OAuth callback path can log sensitive params.",
        },
        {
          name: "PII masking",
          type: "warning",
          risk: 55,
          description: "Audit log omits masking on email + phone.",
        },
        {
          name: "Happy path tests",
          type: "success",
          description: "Primary OAuth flow passes regression suite.",
        },
      ],
      generatedTests: [
        {
          test: "Invalid state token",
          reason: "State param not validated against session store.",
        },
        {
          test: "PII masking snapshot",
          reason: "Ensure masked email/phone in audit log entries.",
        },
      ],
    },
  ],
};

/* =========================================================
   STATE
   ========================================================= */
const state = {
  raw: DEMO_DATA,
  highRiskOnly: false,
  sortMode: "risk_desc",
  loading: false,
  progressTimer: null,
};

/* =========================================================
   HELPERS
   ========================================================= */
function iconByType(type) {
  if (type === "danger") return "❌";
  if (type === "warning") return "⚠️";
  if (type === "success") return "✅";
  return "ℹ️";
}

function riskMeta(risk) {
  if (risk >= 70)
    return {
      label: "High Risk",
      badge: "text-red-300 bg-red-500/10 border-red-500/20",
    };
  if (risk >= 40)
    return {
      label: "Medium Risk",
      badge: "text-yellow-200 bg-yellow-500/10 border-yellow-500/20",
    };
  return {
    label: "Low Risk",
    badge: "text-emerald-300 bg-emerald-500/10 border-emerald-500/20",
  };
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function countByType(reviews = []) {
  const list = Array.isArray(reviews) ? reviews : [];
  const errors = list.filter((r) => r.type === "danger");
  const warnings = list.filter((r) => r.type === "warning");
  const passed = list.filter((r) => r.type === "success");
  return { errors, warnings, passed };
}

/* =========================================================
   CLIENT-SIDE "INTELLIGENCE"
   ========================================================= */
function computeConfidence(pr) {
  const { errors, warnings, passed } = countByType(pr.coderabbitReviews);
  const maxErrorRisk = errors.length
    ? Math.max(...errors.map((e) => e.risk || 0))
    : 0;

  // Simple, explainable scoring:
  // Start at 60, add for passed, subtract for warnings/errors & very high error risk.
  let score = 60;
  score += passed.length * 6;
  score += (pr.generatedTests?.length || 0) * 2;
  score -= warnings.length * 8;
  score -= errors.length * 18;
  score -= maxErrorRisk * 0.12;

  return clamp(Math.round(score), 0, 100);
}

function computeWhyRisky(pr) {
  const reviews = pr.coderabbitReviews || [];
  const text = `${pr.title} ${reviews
    .map((r) => `${r.name} ${r.description}`)
    .join(" ")}`.toLowerCase();
  const { errors, warnings } = countByType(reviews);

  const reasons = [];

  // 1) Highest risk failing signal
  if (errors.length) {
    const top = [...errors].sort((a, b) => (b.risk || 0) - (a.risk || 0))[0];
    reasons.push(`Fails critical check: "${top.name}" (${top.risk}%)`);
  } else if (warnings.length) {
    const top = [...warnings].sort((a, b) => (b.risk || 0) - (a.risk || 0))[0];
    reasons.push(`Unresolved warning: "${top.name}" (${top.risk}%)`);
  }

  // 2) Keyword heuristics (frontend-only, no backend cost)
  const keywordRules = [
    {
      k: ["auth", "token", "login", "session", "jwt"],
      r: "Touches authentication/session logic",
    },
    {
      k: ["sql", "query", "db", "database", "injection"],
      r: "Interacts with data layer / query logic",
    },
    {
      k: ["cache", "caching", "invalidation"],
      r: "Changes caching & invalidation behavior",
    },
    {
      k: ["payment", "billing", "invoice"],
      r: "Affects payment/billing surfaces",
    },
    {
      k: ["encryption", "crypto", "secret", "key"],
      r: "Touches secrets / encryption boundaries",
    },
  ];

  for (const rule of keywordRules) {
    if (rule.k.some((x) => text.includes(x))) {
      reasons.push(rule.r);
    }
  }

  // 3) Generated tests imply risk/uncertainty
  const genCount = pr.generatedTests?.length || 0;
  if (genCount >= 2)
    reasons.push(`Triggers additional test generation (${genCount} new tests)`);
  else if (genCount === 1)
    reasons.push("Triggers additional test generation (1 new test)");

  // Keep it minimal
  const unique = [...new Set(reasons)];
  return unique.slice(0, 3);
}

function computeFixOrder(pr) {
  const { errors, warnings } = countByType(pr.coderabbitReviews);
  const list = [...errors, ...warnings];

  // Danger before warning, then higher risk first
  const weight = (x) => (x.type === "danger" ? 1000 : 0) + (x.risk || 0);
  list.sort((a, b) => weight(b) - weight(a));

  return list.slice(0, 3);
}

/* =========================================================
   UI BUILDERS
   ========================================================= */
function renderRiskBadge({ label, badge }, extra = "") {
  return `<span class="inline-flex items-center gap-2 px-3 py-1 rounded-full border ${badge} text-xs ${extra}">${label}</span>`;
}

function renderBreakdownBar(errorsCount, warningsCount, passedCount) {
  const total = errorsCount + warningsCount + passedCount;
  if (total === 0) {
    return `<div class="h-2 rounded-full bg-slate-800/60 overflow-hidden"></div>`;
  }

  const eW = Math.round((errorsCount / total) * 100);
  const wW = Math.round((warningsCount / total) * 100);
  const pW = Math.max(0, 100 - eW - wW);

  // Minimal, subtle tones
  return `
    <div class="h-2 rounded-full bg-slate-800/60 overflow-hidden flex">
      <div class="h-full bg-red-500/60" style="width:${eW}%"></div>
      <div class="h-full bg-yellow-400/60" style="width:${wW}%"></div>
      <div class="h-full bg-emerald-400/70" style="width:${pW}%"></div>
    </div>
  `;
}

function renderIssueItem(item) {
  const risk = riskMeta(item.risk || 0);
  return `
    <li class="p-3 rounded bg-[#0b1220] border border-slate-800">
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span>${iconByType(item.type)}</span>
            <span class="font-medium truncate">${item.name}</span>
          </div>
          <p class="text-sm text-slate-400 mt-1">${item.description}</p>
        </div>

        <div class="text-right shrink-0">
          ${renderRiskBadge(risk)}
          <div class="text-[11px] text-slate-400 mt-1">${item.risk}%</div>
        </div>
      </div>
    </li>
  `;
}

function renderPassedItem(item) {
  return `
    <li class="p-3 rounded bg-[#0b1220] border border-slate-800">
      <div class="flex items-start gap-2">
        <span>${iconByType(item.type)}</span>
        <div>
          <div class="font-medium">${item.name}</div>
          <p class="text-sm text-slate-400 mt-1">${item.description}</p>
        </div>
      </div>
    </li>
  `;
}

function renderSection(title, items, kind) {
  if (!items.length) return "";

  const listHtml = items
    .map((it) => {
      if (kind === "risk") return renderIssueItem(it);
      return renderPassedItem(it);
    })
    .join("");

  return `
    <section class="space-y-2">
      <h3 class="text-sm font-semibold text-slate-300">${title}</h3>
      <ul class="space-y-2">${listHtml}</ul>
    </section>
  `;
}

/* =========================================================
   RENDER MAIN
   ========================================================= */
function getDerivedPR(pr) {
  const coderabbitReviews = pr.coderabbitReviews || [];
  const generatedTests = pr.generatedTests || [];
  const groups = countByType(coderabbitReviews);
  const confidence = computeConfidence(pr);
  const why = computeWhyRisky(pr);
  const fixFirst = computeFixOrder(pr);

  return {
    ...pr,
    coderabbitReviews,
    generatedTests,
    ...groups,
    confidence,
    why,
    fixFirst,
  };
}

function applyFiltersAndSort(prs) {
  let list = (prs || []).slice();

  if (state.highRiskOnly) {
    list = list.filter((pr) => riskMeta(pr.risk).label === "High Risk");
  }

  const compare = {
    risk_desc: (a, b) => b.risk - a.risk,
    errors_desc: (a, b) => b.errors.length - a.errors.length,
    warnings_desc: (a, b) => b.warnings.length - a.warnings.length,
    confidence_desc: (a, b) => b.confidence - a.confidence,
  }[state.sortMode] || (() => 0);

  list.sort(compare);
  return list;
}

function renderPullRequests(data) {
  const container = document.getElementById("accordion");
  container.innerHTML = "";

  const dataset = Array.isArray(data?.pullRequests) ? data.pullRequests : [];
  if (dataset.length === 0) {
    container.innerHTML = `
      <div class="rounded-lg bg-[#0f172a] border border-slate-800 p-6 text-slate-400">
        No pull requests loaded. Enter your credentials above and click Analyze.
      </div>
    `;
    return;
  }

  const derived = dataset.map(getDerivedPR);
  const view = applyFiltersAndSort(derived);

  if (!view.length) {
    container.innerHTML = `
      <div class="rounded-lg bg-[#0f172a] border border-slate-800 p-6 text-slate-400">
        No pull requests match your filter.
      </div>
    `;
    return;
  }

  view.forEach((pr) => {
    const prRisk = riskMeta(pr.risk);
    const confMeta =
      pr.confidence >= 75
        ? {
            label: "High Confidence",
            badge: "text-emerald-300 bg-emerald-500/10 border-emerald-500/20",
          }
        : pr.confidence >= 45
        ? {
            label: "Medium Confidence",
            badge: "text-yellow-200 bg-yellow-500/10 border-yellow-500/20",
          }
        : {
            label: "Low Confidence",
            badge: "text-red-300 bg-red-500/10 border-red-500/20",
          };

    const headerCounts = `
      <div class="flex items-center gap-3 text-xs text-slate-400 mt-2">
        <span>❌ <span class="text-slate-200">${pr.errors.length}</span></span>
        <span>⚠️ <span class="text-slate-200">${pr.warnings.length}</span></span>
        <span>✅ <span class="text-slate-200">${pr.passed.length}</span></span>
      </div>
    `;

    const breakdownBar = renderBreakdownBar(
      pr.errors.length,
      pr.warnings.length,
      pr.passed.length
    );

    const whyHtml = pr.why.length
      ? `
        <div class="rounded-md bg-[#0b1220] border border-slate-800 p-3">
          <div class="text-xs font-semibold text-slate-300 mb-2">Why this PR is ${
            prRisk.label
          }</div>
          <ul class="text-sm text-slate-400 list-disc pl-5 space-y-1">
            ${pr.why.map((x) => `<li>${x}</li>`).join("")}
          </ul>
        </div>
      `
      : "";

    const fixHtml = pr.fixFirst.length
      ? `
        <div class="rounded-md bg-[#0b1220] border border-slate-800 p-3">
          <div class="text-xs font-semibold text-slate-300 mb-2">Fix this first</div>
          <ol class="text-sm text-slate-400 space-y-2">
            ${pr.fixFirst
              .map((x, i) => {
                const r = riskMeta(x.risk || 0);
                return `
                <li class="flex items-start justify-between gap-4">
                  <div class="min-w-0">
                    <div class="text-slate-200">
                      ${i + 1}. ${iconByType(
                  x.type
                )} <span class="font-medium">${x.name}</span>
                    </div>
                    <div class="text-xs text-slate-400 mt-1">${
                      x.description
                    }</div>
                  </div>
                  <div class="shrink-0 text-right">
                    ${renderRiskBadge(r)}
                    <div class="text-[11px] text-slate-400 mt-1">${
                      x.risk
                    }%</div>
                  </div>
                </li>
              `;
              })
              .join("")}
          </ol>
        </div>
      `
      : "";

    const card = document.createElement("div");
    card.className = "rounded-lg bg-[#0f172a] border border-slate-800";

    card.innerHTML = `
      <!-- HEADER -->
      <button class="w-full p-4 text-left hover:bg-slate-800/30 transition flex flex-col md:flex-row md:items-start md:justify-between gap-3"
              data-toggle aria-expanded="false">
        <div class="min-w-0">
          <div class="flex items-center gap-3">
            <h2 class="text-lg font-medium truncate">${pr.title}</h2>
          </div>
          <div class="mt-1">
            <a href="${pr.link}" target="_blank"
               class="text-sm text-emerald-400 hover:underline">
              View Pull Request
            </a>
          </div>

          ${headerCounts}

          <div class="mt-3">
            ${breakdownBar}
          </div>
        </div>

        <div class="text-right shrink-0 flex flex-col gap-2 items-end">
          ${renderRiskBadge(prRisk, "text-sm")}
          <div class="text-xs text-slate-400">Risk Score: <span class="text-slate-200">${
            pr.risk
          }%</span></div>

          ${renderRiskBadge(confMeta)}
          <div class="text-xs text-slate-400">Confidence: <span class="text-slate-200">${
            pr.confidence
          }%</span></div>
        </div>
      </button>

      <!-- CONTENT (animated accordion) -->
      <div class="accordion-content overflow-hidden max-h-0 opacity-0 transition-[max-height,opacity] duration-300 ease-in-out">
        <div class="px-4 pb-4 pt-2 space-y-4">

          <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
            ${whyHtml}
            ${fixHtml}
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div class="lg:col-span-2 space-y-4">
              ${renderSection("❌ Errors", pr.errors, "risk")}
              ${renderSection("⚠️ Warnings", pr.warnings, "risk")}
              ${renderSection("✅ Passed Tests", pr.passed, "passed")}
            </div>

            <div class="space-y-2">
              <h3 class="text-sm font-semibold text-slate-300">Generated Tests</h3>
              <ul class="space-y-2">
                ${(pr.generatedTests || [])
                  .map(
                    (t) => `
                  <li class="p-3 rounded bg-[#0b1220] border border-slate-800">
                    <div class="font-medium">${t.test}</div>
                    <p class="text-sm text-slate-400 mt-1">Reason: ${t.reason}</p>
                  </li>
                `
                  )
                  .join("")}
                ${
                  !pr.generatedTests || pr.generatedTests.length === 0
                    ? `
                  <li class="p-3 rounded bg-[#0b1220] border border-slate-800 text-sm text-slate-400">
                    No generated tests.
                  </li>
                `
                    : ""
                }
              </ul>

              <div class="pt-2">
                <a href="${pr.link}" target="_blank"
                   class="inline-flex items-center gap-2 text-sm text-emerald-400 hover:underline">
                  Open PR <span class="text-slate-500">→</span>
                </a>
              </div>
            </div>
          </div>

        </div>
      </div>
    `;

    container.appendChild(card);

    // Auto-expand High Risk PRs
    const shouldAutoOpen = riskMeta(pr.risk).label === "High Risk";
    if (shouldAutoOpen) {
      const headerBtn = card.querySelector("[data-toggle]");
      const content = card.querySelector(".accordion-content");
      openAccordion(headerBtn, content, true);
    }
  });

  attachAccordionHandlers();
}

/* =========================================================
   ANALYZE FORM + STATUS
   ========================================================= */
function setStatus(tone, message) {
  const el = document.getElementById("analysisStatus");
  if (!el) return;

  const toneStyles = {
    info: "text-slate-300 bg-slate-900/60 border border-slate-800",
    success: "text-emerald-300 bg-emerald-500/10 border border-emerald-500/30",
    error: "text-red-300 bg-red-500/10 border border-red-500/30",
  };

  const base = "text-xs rounded-md px-3 py-2";
  el.className = `${base} ${toneStyles[tone] || toneStyles.info}`;
  el.textContent = message;
}

function toggleAnalyzeLoading(isLoading) {
  const btn = document.getElementById("analyzeBtn");
  if (!btn) return;
  state.loading = isLoading;
  btn.disabled = isLoading;
  btn.textContent = isLoading ? "Analyzing..." : "Analyze";
}

function startProgress() {
  const track = document.getElementById("progressContainer");
  const bar = document.getElementById("progressFill");
  if (!track || !bar) return;

  let pct = 6;
  bar.style.width = `${pct}%`;
  track.classList.remove("hidden");

  clearInterval(state.progressTimer);
  state.progressTimer = setInterval(() => {
    pct = Math.min(pct + Math.random() * 12, 92);
    bar.style.width = `${pct}%`;
  }, 350);
}

function stopProgress(success = true) {
  const track = document.getElementById("progressContainer");
  const bar = document.getElementById("progressFill");
  if (!track || !bar) return;

  clearInterval(state.progressTimer);
  state.progressTimer = null;
  bar.style.width = success ? "100%" : "0%";

  setTimeout(() => {
    bar.style.width = "0%";
    track.classList.add("hidden");
  }, success ? 500 : 0);
}

async function handleAnalyzeClick() {
  const githubToken = document.getElementById("githubToken")?.value.trim();
  const daytonaApiKey = document.getElementById("daytonaApiKey")?.value.trim();
  const openaiApiKey = document.getElementById("openaiApiKey")?.value.trim();

  if (!githubToken || !daytonaApiKey || !openaiApiKey) {
    setStatus("error", "Please enter all three keys before analyzing.");
    return;
  }

  let success = false;
  try {
    toggleAnalyzeLoading(true);
    setStatus("info", "Analyzing pull requests...");
    startProgress();
    const data = await fetchPullRequests({
      githubToken,
      daytonaApiKey,
      openaiApiKey,
    });
    state.raw = data;
    renderPullRequests(state.raw);
    setStatus("success", "Analysis complete. Results loaded.");
    success = true;
  } catch (err) {
    console.error(err);
    setStatus("error", err.message || "Failed to analyze pull requests.");
  } finally {
    stopProgress(success);
    toggleAnalyzeLoading(false);
  }
}

function bindAnalyze() {
  const analyzeBtn = document.getElementById("analyzeBtn");
  if (!analyzeBtn) return;
  analyzeBtn.addEventListener("click", () => handleAnalyzeClick());
}

/* =========================================================
   ACCORDION
   ========================================================= */
function openAccordion(btn, content, skipScroll = false) {
  btn.setAttribute("aria-expanded", "true");
  content.classList.remove("max-h-0", "opacity-0");
  content.classList.add("opacity-100", "max-h-[2000px]");
  if (!skipScroll) {
    // optional: keep minimal, no auto scroll
  }
}

function closeAccordion(btn, content) {
  btn.setAttribute("aria-expanded", "false");
  content.classList.add("max-h-0", "opacity-0");
  content.classList.remove("opacity-100", "max-h-[2000px]");
}

function attachAccordionHandlers() {
  document.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const content = btn.nextElementSibling;
      const expanded = btn.getAttribute("aria-expanded") === "true";
      if (expanded) closeAccordion(btn, content);
      else openAccordion(btn, content);
    });
  });
}

/* =========================================================
   CONTROLS
   ========================================================= */
function bindControls() {
  const highRiskOnly = document.getElementById("highRiskOnly");
  const sortMode = document.getElementById("sortMode");
  if (!highRiskOnly || !sortMode) return;

  highRiskOnly.addEventListener("change", (e) => {
    state.highRiskOnly = e.target.checked;
    renderPullRequests(state.raw);
  });

  sortMode.addEventListener("change", (e) => {
    state.sortMode = e.target.value;
    renderPullRequests(state.raw);
  });
}

/* =========================================================
   INIT
   ========================================================= */
document.addEventListener("DOMContentLoaded", () => {
  bindControls();
  bindAnalyze();
  setStatus(
    "info",
    "Showing demo data. Provide your tokens and click Analyze to fetch live pull request insights."
  );
  renderPullRequests(state.raw);
});
