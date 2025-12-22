/* =========================================================
   FETCH FROM API
   ========================================================= */
async function fetchPullRequests() {
  try {
    console.log("Fetching PRs from /api/pull-requests...");
    const response = await fetch("/api/pull-requests");
    if (!response.ok) {
      const errorText = await response.text();
      console.error("API error:", response.status, errorText);
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    console.log("Fetched data:", data);
    console.log(`Found ${data.pullRequests?.length || 0} PR(s)`);
    return data;
  } catch (error) {
    console.error("Error fetching PRs:", error);
    // Fallback to empty data on error
    return { pullRequests: [] };
  }
}

/* =========================================================
   MOCK DATA (FALLBACK - NOT USED IN PRODUCTION)
   ========================================================= */
function getMockData() {
  return {
    pullRequests: [
      {
        id: 1,
        title: "Fix auth bypass in login",
        link: "https://github.com/org/repo/pull/42",
        risk: 78,
        coderabbitReviews: [
          {
            name: "SQL Injection test",
            type: "danger",
            risk: 85,
            description:
              "Potential unsafe query detected in data access layer.",
          },
          {
            name: "Auth edge case test",
            type: "warning",
            risk: 55,
            description: "Token expiry edge case not fully covered.",
          },
          {
            name: "Login happy path",
            type: "success",
            description: "Basic login flow passed.",
          },
          {
            name: "Session invalidation",
            type: "success",
            description: "Logout invalidates session.",
          },
        ],
        generatedTests: [
          {
            test: "Expired JWT validation",
            reason: "Auth middleware did not handle expired tokens.",
          },
          {
            test: "Malformed payload test",
            reason: "Missing schema validation for login payload.",
          },
        ],
      },
      {
        id: 2,
        title: "Refactor dashboard UI components",
        link: "https://github.com/org/repo/pull/51",
        risk: 28,
        coderabbitReviews: [
          {
            name: "Snapshot stability",
            type: "warning",
            risk: 42,
            description: "Snapshot test might be brittle after layout changes.",
          },
          {
            name: "Build pipeline",
            type: "success",
            description: "Build and lint passed.",
          },
          {
            name: "UI regression suite",
            type: "success",
            description: "Core UI flows passed.",
          },
        ],
        generatedTests: [
          {
            test: "Visual regression for sidebar",
            reason: "Large UI refactor changed layout structure.",
          },
        ],
      },
      {
        id: 3,
        title: "Optimize query + caching layer",
        link: "https://github.com/org/repo/pull/63",
        risk: 66,
        coderabbitReviews: [
          {
            name: "N+1 query detection",
            type: "warning",
            risk: 62,
            description: "Potential N+1 pattern if cache misses.",
          },
          {
            name: "Cache invalidation",
            type: "warning",
            risk: 58,
            description:
              "Invalidate key strategy unclear under concurrent writes.",
          },
          {
            name: "Perf baseline",
            type: "success",
            description: "Perf tests improved vs baseline.",
          },
        ],
        generatedTests: [
          {
            test: "Concurrent invalidation test",
            reason: "Caching logic may break under concurrent writes.",
          },
        ],
      },
    ],
  };
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

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderGeneratedTestsAccordion(tests) {
  const testCount = tests.length;
  const testListHtml = tests.length
    ? tests
        .map(
          (t) => {
            const testCode = t.code ? `
          <details class="mt-2">
            <summary class="text-xs text-slate-500 cursor-pointer hover:text-slate-400">
              View Test Code
            </summary>
            <pre class="mt-2 p-2 bg-[#0a0f1a] border border-slate-700 rounded text-xs text-slate-300 overflow-x-auto"><code>${escapeHtml(t.code)}</code></pre>
          </details>
        ` : '';
            return `
        <li class="p-3 rounded bg-[#0b1220] border border-slate-800">
          <div class="font-medium text-slate-200">${t.test}</div>
          <p class="text-sm text-slate-400 mt-1">Reason: ${t.reason || 'Generated by Coderabbit'}</p>
          ${testCode}
        </li>
      `;
          }
        )
        .join("")
    : `
    <li class="p-3 rounded bg-[#0b1220] border border-slate-800 text-sm text-slate-400">
      No generated tests.
    </li>
  `;

  return `
    <section class="space-y-2">
      <button class="w-full flex items-center justify-between p-3 rounded-lg bg-[#0b1220] border border-slate-800 hover:bg-slate-800/30 transition text-left"
              data-test-toggle aria-expanded="false">
        <h3 class="text-sm font-semibold text-slate-300">
          🧪 Generated Tests <span class="text-slate-500">(${testCount})</span>
        </h3>
        <span class="text-slate-400 text-xs transition-transform" data-test-arrow>▼</span>
      </button>
      <div class="test-accordion-content overflow-hidden max-h-0 opacity-0 transition-[max-height,opacity] duration-300 ease-in-out">
        <ul class="space-y-2 pl-2">${testListHtml}</ul>
      </div>
    </section>
  `;
}

/* =========================================================
   RENDER MAIN
   ========================================================= */
function getDerivedPR(pr) {
  try {
    // Ensure coderabbitReviews exists and is an array
    if (!pr.coderabbitReviews) {
      pr.coderabbitReviews = [];
    }
    
    // Ensure all reviews have required fields
    pr.coderabbitReviews = pr.coderabbitReviews.map(review => {
      if (!review.risk && review.risk !== 0) {
        // Set default risk based on type
        if (review.type === "danger") review.risk = 85;
        else if (review.type === "warning") review.risk = 55;
        else if (review.type === "success") review.risk = 0;
        else review.risk = 30;
      }
      return review;
    });
    
    const groups = countByType(pr.coderabbitReviews);
    const confidence = computeConfidence(pr);
    const why = computeWhyRisky(pr);
    const fixFirst = computeFixOrder(pr);

    return { ...pr, ...groups, confidence, why, fixFirst };
  } catch (error) {
    console.error("Error processing PR:", pr.id, error);
    // Return PR with defaults
    return {
      ...pr,
      errors: [],
      warnings: [],
      passed: [],
      confidence: 0,
      why: [],
      fixFirst: []
    };
  }
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
  if (!container) {
    console.error("Accordion container not found!");
    return;
  }
  
  container.innerHTML = "";
  
  console.log("Rendering PRs, data:", data);
  console.log("Number of PRs:", data.pullRequests?.length || 0);

  const derived = data.pullRequests.map(getDerivedPR);
  console.log("Derived PRs:", derived.length);
  
  const view = applyFiltersAndSort(derived);
  console.log("Filtered/sorted PRs:", view.length);

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

          <div class="space-y-4">
            ${renderSection("❌ Errors", pr.errors, "risk")}
            ${renderGeneratedTestsAccordion(pr.generatedTests || [])}
            ${renderSection("⚠️ Warnings", pr.warnings, "risk")}
            ${renderSection("✅ Passed Tests", pr.passed, "passed")}
          </div>

          <div class="pt-2 border-t border-slate-800">
            <a href="${pr.link}" target="_blank"
               class="inline-flex items-center gap-2 text-sm text-emerald-400 hover:underline">
              Open PR <span class="text-slate-500">→</span>
            </a>
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
  // Main PR accordion handlers
  document.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const content = btn.nextElementSibling;
      const expanded = btn.getAttribute("aria-expanded") === "true";
      if (expanded) closeAccordion(btn, content);
      else openAccordion(btn, content);
    });
  });

  // Generated Tests accordion handlers
  document.querySelectorAll("[data-test-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const content = btn.nextElementSibling;
      const arrow = btn.querySelector("[data-test-arrow]");
      const expanded = btn.getAttribute("aria-expanded") === "true";
      
      if (expanded) {
        btn.setAttribute("aria-expanded", "false");
        content.classList.add("max-h-0", "opacity-0");
        content.classList.remove("opacity-100", "max-h-[1000px]");
        if (arrow) arrow.style.transform = "rotate(0deg)";
      } else {
        btn.setAttribute("aria-expanded", "true");
        content.classList.remove("max-h-0", "opacity-0");
        content.classList.add("opacity-100", "max-h-[1000px]");
        if (arrow) arrow.style.transform = "rotate(180deg)";
      }
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
document.addEventListener("DOMContentLoaded", async () => {
  console.log("DOM loaded, initializing...");
  bindControls();
  
  try {
    state.raw = await fetchPullRequests();
    console.log("State.raw:", state.raw);
    
    if (!state.raw || !state.raw.pullRequests) {
      console.error("No pullRequests in response:", state.raw);
      document.getElementById("accordion").innerHTML = `
        <div class="rounded-lg bg-[#0f172a] border border-slate-800 p-6 text-slate-400">
          <p>No data received from API.</p>
          <p class="text-xs mt-2">Check console for errors.</p>
        </div>
      `;
      return;
    }
    
    if (state.raw.pullRequests.length === 0) {
      console.warn("Empty pullRequests array");
      document.getElementById("accordion").innerHTML = `
        <div class="rounded-lg bg-[#0f172a] border border-slate-800 p-6 text-slate-400">
          <p>No pull requests found in results.</p>
          <p class="text-xs mt-2">Run analysis first: python main.py owner/repo</p>
        </div>
      `;
      return;
    }
    
    renderPullRequests(state.raw);
  } catch (error) {
    console.error("Initialization error:", error);
    document.getElementById("accordion").innerHTML = `
      <div class="rounded-lg bg-[#0f172a] border border-red-800 p-6 text-red-400">
        <p>Error loading data: ${error.message}</p>
        <p class="text-xs mt-2">Check console for details.</p>
      </div>
    `;
  }
});
