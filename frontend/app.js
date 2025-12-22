/* =========================================================
   STATE
   ========================================================= */
const state = {
  raw: { pullRequests: [] },
  highRiskOnly: false,
  sortMode: "risk_desc",
  loading: false,
  progressTimer: null,
  repos: [],
  selectedRepo: null,
  prs: [],
  selectedPRs: new Set(),
  currentJobId: null,
  statusPollInterval: null
};

/* =========================================================
   API FUNCTIONS
   ========================================================= */
async function fetchRepos(githubToken) {
  try {
    const response = await fetch(`/api/repos?token=${encodeURIComponent(githubToken)}`);
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data.repos || [];
  } catch (error) {
    console.error("Error fetching repos:", error);
    throw error;
  }
}

async function fetchPRs(githubToken, owner, repo) {
  try {
    const response = await fetch(
      `/api/repos/${owner}/${repo}/prs?token=${encodeURIComponent(githubToken)}&state=open`
    );
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data.prs || [];
  } catch (error) {
    console.error("Error fetching PRs:", error);
    throw error;
  }
}

async function startAnalysis(githubToken, daytonaApiKey, openaiApiKey, owner, repo, prNumbers) {
  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        githubToken,
        daytonaApiKey,
        openaiApiKey,
        owner,
        repo,
        prNumbers
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    return data.jobId;
  } catch (error) {
    console.error("Error starting analysis:", error);
    throw error;
  }
}

async function getAnalysisStatus(jobId) {
  try {
    const response = await fetch(`/api/analyze/${jobId}/status`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error("Error fetching status:", error);
    throw error;
  }
}

async function getAnalysisResults(jobId) {
  try {
    const response = await fetch(`/api/analyze/${jobId}/results`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error("Error fetching results:", error);
    throw error;
  }
}

/* =========================================================
   UI HELPERS
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
  btn.textContent = isLoading ? "Analyzing..." : "Analyze ▷";
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

function updateProgress(progress) {
  const bar = document.getElementById("progressFill");
  if (bar) {
    bar.style.width = `${progress}%`;
  }
}

/* =========================================================
   REPO AND PR SELECTION
   ========================================================= */
function renderRepoDropdown(repos, searchTerm = "") {
  const dropdown = document.getElementById("repoDropdown");
  const options = document.getElementById("repoOptions");
  if (!dropdown || !options) return;
  
  const filtered = repos.filter(repo => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return repo.full_name.toLowerCase().includes(term) ||
           repo.name.toLowerCase().includes(term) ||
           repo.owner.toLowerCase().includes(term) ||
           (repo.description && repo.description.toLowerCase().includes(term));
  });
  
  if (filtered.length === 0) {
    options.innerHTML = '<div class="px-3 py-2 text-sm text-slate-400">No repositories found</div>';
    dropdown.classList.remove("hidden");
    return;
  }
  
  options.innerHTML = filtered.map(repo => `
    <div class="repo-option px-3 py-2 hover:bg-slate-800/50 cursor-pointer border-b border-slate-800/50 last:border-b-0" 
         data-value="${repo.owner}/${repo.name}" 
         data-full-name="${repo.full_name}">
      <div class="text-sm text-slate-200 font-medium">${repo.full_name}</div>
      ${repo.description ? `<div class="text-xs text-slate-400 mt-1 truncate">${repo.description}</div>` : ''}
    </div>
  `).join('');
  
  // Attach click handlers
  options.querySelectorAll('.repo-option').forEach(option => {
    option.addEventListener('click', () => {
      const value = option.getAttribute('data-value');
      const fullName = option.getAttribute('data-full-name');
      selectRepo(value, fullName);
    });
  });
  
  dropdown.classList.remove("hidden");
}

function selectRepo(repoValue, fullName) {
  const repoSearch = document.getElementById("repoSearch");
  const repoSelect = document.getElementById("repoSelect");
  const dropdown = document.getElementById("repoDropdown");
  
  if (repoSearch) {
    repoSearch.value = fullName;
  }
  if (repoSelect) {
    repoSelect.value = repoValue;
  }
  if (dropdown) {
    dropdown.classList.add("hidden");
  }
  
  // Load PRs for selected repo
  if (repoValue) {
    const [owner, repo] = repoValue.split('/');
    state.selectedRepo = { owner, repo };
    loadPRsForRepo(owner, repo);
  } else {
    document.getElementById("prSection")?.classList.add("hidden");
    document.getElementById("analyzeBtn")?.classList.add("hidden");
    state.selectedRepo = null;
    state.prs = [];
    state.selectedPRs.clear();
  }
}

async function handleLoadRepos() {
  const githubToken = document.getElementById("githubToken")?.value.trim();
  
  if (!githubToken) {
    setStatus("error", "Please enter your GitHub token first.");
    return;
  }
  
  try {
    setStatus("info", "Loading repositories...");
    const repos = await fetchRepos(githubToken);
    state.repos = repos;
    
    document.getElementById("repoSection")?.classList.remove("hidden");
    
    // Setup search input handler
    const repoSearch = document.getElementById("repoSearch");
    if (repoSearch) {
      repoSearch.addEventListener('input', (e) => {
        renderRepoDropdown(state.repos, e.target.value);
      });
      
      repoSearch.addEventListener('focus', () => {
        if (state.repos.length > 0) {
          renderRepoDropdown(state.repos, repoSearch.value);
        }
      });
      
      // Close dropdown when clicking outside
      document.addEventListener('click', (e) => {
        const dropdown = document.getElementById("repoDropdown");
        const search = document.getElementById("repoSearch");
        if (dropdown && search && !dropdown.contains(e.target) && e.target !== search) {
          dropdown.classList.add("hidden");
        }
      });
    }
    
    setStatus("success", `Loaded ${repos.length} repository(ies). Search and select one to continue.`);
  } catch (error) {
    setStatus("error", `Failed to load repositories: ${error.message}`);
  }
}

async function loadPRsForRepo(owner, repo) {
  const githubToken = document.getElementById("githubToken")?.value.trim();
  
  if (!githubToken) return;
  
  try {
    setStatus("info", "Loading pull requests...");
    const prs = await fetchPRs(githubToken, owner, repo);
    state.prs = prs;
    
    const prList = document.getElementById("prList");
    if (prList) {
      if (prs.length === 0) {
        prList.innerHTML = '<div class="text-xs text-slate-400">No open pull requests found.</div>';
      } else {
        prList.innerHTML = prs.map(pr => `
          <label class="flex items-center gap-2 p-2 rounded hover:bg-slate-800/30 cursor-pointer">
            <input type="checkbox" value="${pr.number}" class="pr-checkbox accent-emerald-400 w-4 h-4 bg-[#060c17] border border-cyan-500/40">
            <div class="flex-1">
              <div class="text-sm text-slate-200">#${pr.number}: ${pr.title}</div>
              <div class="text-xs text-slate-400">Updated: ${new Date(pr.updated_at).toLocaleDateString()}</div>
            </div>
          </label>
        `).join('');
        
        // Attach checkbox handlers
        prList.querySelectorAll('.pr-checkbox').forEach(checkbox => {
          checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
              state.selectedPRs.add(parseInt(e.target.value));
            } else {
              state.selectedPRs.delete(parseInt(e.target.value));
            }
            updateAnalyzeButton();
          });
        });
      }
      
      document.getElementById("prSection")?.classList.remove("hidden");
      updateAnalyzeButton();
    }
    
    setStatus("success", `Loaded ${prs.length} pull request(s). Select PRs to analyze.`);
  } catch (error) {
    setStatus("error", `Failed to load PRs: ${error.message}`);
  }
}

function updateAnalyzeButton() {
  const analyzeBtn = document.getElementById("analyzeBtn");
  if (analyzeBtn) {
    if (state.selectedPRs.size > 0) {
      analyzeBtn.classList.remove("hidden");
      analyzeBtn.disabled = false;
    } else {
      analyzeBtn.classList.add("hidden");
    }
  }
}

/* =========================================================
   ANALYSIS FLOW
   ========================================================= */
async function handleAnalyzeClick() {
  // Prevent multiple simultaneous requests
  if (state.loading) {
    setStatus("info", "Analysis already in progress. Please wait...");
    return;
  }
  
  const githubToken = document.getElementById("githubToken")?.value.trim();
  const daytonaApiKey = document.getElementById("daytonaApiKey")?.value.trim();
  const openaiApiKey = document.getElementById("openaiApiKey")?.value.trim();
  
  if (!githubToken || !daytonaApiKey || !openaiApiKey) {
    setStatus("error", "Please enter all three keys before analyzing.");
    return;
  }
  
  if (!state.selectedRepo || state.selectedPRs.size === 0) {
    setStatus("error", "Please select a repository and at least one PR.");
    return;
  }
  
  try {
    toggleAnalyzeLoading(true);
    setStatus("info", "Starting analysis...");
    startProgress();
    
    const prNumbers = Array.from(state.selectedPRs);
    const jobId = await startAnalysis(
      githubToken,
      daytonaApiKey,
      openaiApiKey,
      state.selectedRepo.owner,
      state.selectedRepo.repo,
      prNumbers
    );
    
    state.currentJobId = jobId;
    setStatus("info", "Analysis started. Monitoring progress...");
    
    // Start polling for status
    pollAnalysisStatus(jobId);
    
  } catch (err) {
    console.error(err);
    setStatus("error", err.message || "Failed to start analysis.");
    stopProgress(false);
    toggleAnalyzeLoading(false);
  }
}

async function pollAnalysisStatus(jobId) {
  // Clear any existing interval
  if (state.statusPollInterval) {
    clearInterval(state.statusPollInterval);
  }
  
  const poll = async () => {
    try {
      const status = await getAnalysisStatus(jobId);
      
      updateProgress(status.progress || 0);
      setStatus("info", status.message || "Processing...");
      
      if (status.status === "completed") {
        clearInterval(state.statusPollInterval);
        state.statusPollInterval = null;
        
        // Fetch results
        const results = await getAnalysisResults(jobId);
        state.raw = results;
        renderPullRequests(state.raw);
        
        setStatus("success", "Analysis complete! Results loaded.");
        stopProgress(true);
        toggleAnalyzeLoading(false);
      } else if (status.status === "error") {
        clearInterval(state.statusPollInterval);
        state.statusPollInterval = null;
        setStatus("error", status.message || "Analysis failed.");
        stopProgress(false);
        toggleAnalyzeLoading(false);
      }
    } catch (error) {
      console.error("Error polling status:", error);
      clearInterval(state.statusPollInterval);
      state.statusPollInterval = null;
      setStatus("error", `Error checking status: ${error.message}`);
      stopProgress(false);
      toggleAnalyzeLoading(false);
    }
  };
  
  // Poll immediately, then every 3 seconds
  poll();
  state.statusPollInterval = setInterval(poll, 3000);
}

/* =========================================================
   CLIENT-SIDE "INTELLIGENCE"
   ========================================================= */
function computeConfidence(pr) {
  const { errors, warnings, passed } = countByType(pr.coderabbitReviews);
  const maxErrorRisk = errors.length
    ? Math.max(...errors.map((e) => e.risk || 0))
    : 0;

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

  if (errors.length) {
    const top = [...errors].sort((a, b) => (b.risk || 0) - (a.risk || 0))[0];
    reasons.push(`Fails critical check: "${top.name}" (${top.risk}%)`);
  } else if (warnings.length) {
    const top = [...warnings].sort((a, b) => (b.risk || 0) - (a.risk || 0))[0];
    reasons.push(`Unresolved warning: "${top.name}" (${top.risk}%)`);
  }

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

  const genCount = pr.generatedTests?.length || 0;
  if (genCount >= 2)
    reasons.push(`Triggers additional test generation (${genCount} new tests)`);
  else if (genCount === 1)
    reasons.push("Triggers additional test generation (1 new test)");

  const unique = [...new Set(reasons)];
  return unique.slice(0, 3);
}

function computeFixOrder(pr) {
  const { errors, warnings } = countByType(pr.coderabbitReviews);
  const list = [...errors, ...warnings];

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

  return `
    <div class="h-2 rounded-full bg-slate-800/60 overflow-hidden flex">
      <div class="h-full bg-red-500/60" style="width:${eW}%"></div>
      <div class="h-full bg-yellow-400/60" style="width:${wW}%"></div>
      <div class="h-full bg-emerald-400/70" style="width:${pW}%"></div>
    </div>
  `;
}

function renderRiskCategories(riskCategories) {
  if (!riskCategories) return "";
  
  const categories = [
    { key: "security", label: "Security", color: "red" },
    { key: "performance", label: "Performance", color: "yellow" },
    { key: "maintainability", label: "Maintainability", color: "blue" },
    { key: "reliability", label: "Reliability", color: "orange" },
    { key: "compatibility", label: "Compatibility", color: "purple" }
  ];
  
  const getColorClass = (value) => {
    if (value >= 70) return "text-red-300";
    if (value >= 40) return "text-yellow-200";
    return "text-emerald-300";
  };
  
  return `
    <div class="grid grid-cols-2 md:grid-cols-5 gap-2 mt-2">
      ${categories.map(cat => {
        const value = riskCategories[cat.key] || 0;
        const colorClass = getColorClass(value);
        return `
          <div class="text-center p-2 rounded bg-[#0b1220] border border-slate-800">
            <div class="text-xs text-slate-400">${cat.label}</div>
            <div class="text-sm font-semibold ${colorClass}">${value}%</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderSpecificRisks(specificRisks) {
  if (!specificRisks || !Array.isArray(specificRisks) || specificRisks.length === 0) {
    return "";
  }
  
  const severityColors = {
    critical: "text-red-300 bg-red-500/10 border-red-500/20",
    high: "text-orange-300 bg-orange-500/10 border-orange-500/20",
    medium: "text-yellow-200 bg-yellow-500/10 border-yellow-500/20",
    low: "text-blue-300 bg-blue-500/10 border-blue-500/20"
  };
  
  return `
    <div class="space-y-2 mt-2">
      <div class="text-xs font-semibold text-slate-300 mb-2">Specific Risks Identified</div>
      ${specificRisks.map(risk => {
        const color = severityColors[risk.severity] || severityColors.medium;
        return `
          <div class="p-3 rounded bg-[#0b1220] border border-slate-800">
            <div class="flex items-start justify-between gap-2 mb-2">
              <span class="text-xs font-semibold text-slate-200">${risk.category}</span>
              <span class="inline-flex items-center px-2 py-1 rounded border ${color} text-xs">${risk.severity}</span>
            </div>
            <div class="text-sm text-slate-300 mb-1 whitespace-pre-wrap">${formatDescription(risk.description)}</div>
            <div class="text-xs text-slate-400 mb-1 whitespace-pre-wrap"><strong>Impact:</strong> ${formatDescription(risk.impact)}</div>
            <div class="text-xs text-emerald-300 whitespace-pre-wrap"><strong>Recommendation:</strong> ${formatDescription(risk.recommendation)}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderIssueItem(item) {
  const risk = riskMeta(item.risk || 0);
  const cleanDescription = formatDescription(item.description);
  return `
    <li class="p-3 rounded bg-[#0b1220] border border-slate-800">
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span>${iconByType(item.type)}</span>
            <span class="font-medium truncate">${item.name}</span>
          </div>
          <p class="text-sm text-slate-400 mt-1 whitespace-pre-wrap">${cleanDescription}</p>
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
  const cleanDescription = formatDescription(item.description);
  return `
    <li class="p-3 rounded bg-[#0b1220] border border-slate-800">
      <div class="flex items-start gap-2">
        <span>${iconByType(item.type)}</span>
        <div class="flex-1">
          <div class="font-medium">${item.name}</div>
          <p class="text-sm text-slate-400 mt-1 whitespace-pre-wrap">${cleanDescription}</p>
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

function cleanMarkdown(text) {
  if (!text) return '';
  
  // Remove markdown code blocks
  text = text.replace(/```[\s\S]*?```/g, '');
  // Remove inline code
  text = text.replace(/`([^`]+)`/g, '$1');
  // Remove markdown headers
  text = text.replace(/^#{1,6}\s+/gm, '');
  // Remove markdown links but keep text
  text = text.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
  // Remove markdown images
  text = text.replace(/!\[([^\]]*)\]\([^\)]+\)/g, '');
  // Remove markdown tables
  text = text.replace(/\|[^\n]*\|/g, '');
  // Remove markdown bold/italic
  text = text.replace(/\*\*([^\*]+)\*\*/g, '$1');
  text = text.replace(/\*([^\*]+)\*/g, '$1');
  text = text.replace(/__([^_]+)__/g, '$1');
  text = text.replace(/_([^_]+)_/g, '$1');
  // Remove markdown lists
  text = text.replace(/^\s*[-*+]\s+/gm, '');
  text = text.replace(/^\s*\d+\.\s+/gm, '');
  // Remove extra whitespace
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.replace(/[ \t]+/g, ' ');
  // Remove leading/trailing whitespace from each line
  text = text.split('\n').map(line => line.trim()).join('\n');
  
  return text.trim();
}

function formatDescription(text) {
  if (!text) return '';
  const cleaned = cleanMarkdown(text);
  // Escape HTML to prevent XSS
  return escapeHtml(cleaned);
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
            const cleanReason = formatDescription(t.reason || 'Generated by Coderabbit');
            return `
        <li class="p-3 rounded bg-[#0b1220] border border-slate-800">
          <div class="font-medium text-slate-200">${t.test}</div>
          <p class="text-sm text-slate-400 mt-1 whitespace-pre-wrap">Reason: ${cleanReason}</p>
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
    if (!pr.coderabbitReviews) {
      pr.coderabbitReviews = [];
    }
    
    pr.coderabbitReviews = pr.coderabbitReviews.map(review => {
      if (!review.risk && review.risk !== 0) {
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
  
  const derived = data.pullRequests.map(getDerivedPR);
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
                    <div class="text-xs text-slate-400 mt-1 whitespace-pre-wrap">${
                      formatDescription(x.description)
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

    // Add risk categories and specific risks if available
    const riskCategoriesHtml = pr.riskCategories ? renderRiskCategories(pr.riskCategories) : "";
    const specificRisksHtml = pr.specificRisks ? renderSpecificRisks(pr.specificRisks) : "";

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
          ${riskCategoriesHtml}
          ${specificRisksHtml}
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
   ACCORDION
   ========================================================= */
function openAccordion(btn, content, skipScroll = false) {
  btn.setAttribute("aria-expanded", "true");
  content.classList.remove("max-h-0", "opacity-0");
  content.classList.add("opacity-100", "max-h-[2000px]");
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
  
  // Bind repo and PR handlers
  const loadReposBtn = document.getElementById("loadReposBtn");
  if (loadReposBtn) {
    loadReposBtn.addEventListener("click", handleLoadRepos);
  }
  
  const analyzeBtn = document.getElementById("analyzeBtn");
  if (analyzeBtn) {
    analyzeBtn.addEventListener("click", handleAnalyzeClick);
  }
  
  // Initial render with empty data
  renderPullRequests(state.raw);
});
