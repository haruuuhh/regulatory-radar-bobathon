/**
 * dashboard.js — generates dashboard.html
 *
 * Reads findings.json + partners.json and bakes them into a single
 * self-contained HTML file with:
 *   - Login screen (partner_id + company name as password)
 *   - Per-company compliance summary (score, gap count, severity breakdown)
 *   - Gap table filterable by severity / regulation family
 *   - Product-level heatmap
 *   - EcoComply admin view (all companies overview)
 *
 * Usage:
 *   node dashboard.js          → writes dashboard.html
 */

import { readFileSync, writeFileSync } from 'fs';

const partners = JSON.parse(readFileSync('../partners.json', 'utf8')).partners;
const { findings } = JSON.parse(readFileSync('findings.json', 'utf8'));

// ── build per-partner data ────────────────────────────────────────────────────
const partnerMap = {};
for (const p of partners) {
  partnerMap[p.partner_id] = {
    ...p,
    gaps: [],
  };
}
for (const f of findings) {
  partnerMap[f.partner_id].gaps.push(f);
}

// ── credentials: partner_id → company name (lowercased, spaces stripped)
// In production, replace with a real auth system.
const credentials = {};
for (const p of partners) {
  credentials[p.partner_id] = p.company.toLowerCase().replace(/\s+/g, '');
}

// ── inline data blobs for the HTML ───────────────────────────────────────────
const PARTNERS_JSON = JSON.stringify(Object.values(partnerMap));
const CREDENTIALS_JSON = JSON.stringify(credentials);

// ─────────────────────────────────────────────────────────────────────────────

function buildHtml(partnersJson, credentialsJson) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Regulatory Radar — Compliance Dashboard</title>
<style>
${CSS}
</style>
</head>
<body>

<!-- ═══ LOGIN ════════════════════════════════════════════════════════════════ -->
<div id="login-screen" class="login-wrap">
  <div class="login-box">
    <div class="login-logo">🛰️</div>
    <h1 class="login-title">Regulatory Radar</h1>
    <p class="login-sub">EU Compliance Dashboard · powered by EcoComply</p>
    <form id="login-form">
      <label>Company ID</label>
      <input id="inp-id" type="text" placeholder="e.g. P001 or ADMIN" autocomplete="username" spellcheck="false">
      <label>Password</label>
      <input id="inp-pw" type="password" placeholder="company name (no spaces)" autocomplete="current-password">
      <div id="login-err" class="login-err hidden">Invalid credentials — try again.</div>
      <button type="submit">Sign in →</button>
    </form>
    <p class="login-hint">Demo: use your company ID and company name (lowercase, no spaces) as password.<br>Admin: <strong>ADMIN</strong> / <strong>ecocomply</strong></p>
  </div>
</div>

<!-- ═══ APP ══════════════════════════════════════════════════════════════════ -->
<div id="app" class="hidden">

  <!-- top nav -->
  <header class="topbar">
    <span class="topbar-brand">🛰️ Regulatory Radar</span>
    <span id="topbar-company" class="topbar-company"></span>
    <div class="topbar-right">
      <span id="topbar-assessed" class="topbar-meta"></span>
      <button id="btn-logout" class="btn-ghost">Sign out</button>
    </div>
  </header>

  <!-- admin: company picker -->
  <div id="admin-bar" class="admin-bar hidden">
    <span class="admin-label">Admin view:</span>
    <select id="company-select"></select>
  </div>

  <!-- main content -->
  <main class="main">

    <!-- summary cards -->
    <section class="cards" id="summary-cards"></section>

    <!-- two-column: score ring + gap-by-regulation bar -->
    <section class="two-col">
      <div class="panel">
        <div class="panel-title">Compliance Score</div>
        <div class="score-wrap">
          <svg id="score-ring" viewBox="0 0 120 120" width="120" height="120">
            <circle cx="60" cy="60" r="50" fill="none" stroke="#e5e7eb" stroke-width="12"/>
            <circle id="score-arc" cx="60" cy="60" r="50" fill="none" stroke="#3b82d4"
                    stroke-width="12" stroke-linecap="round"
                    stroke-dasharray="314" stroke-dashoffset="314"
                    transform="rotate(-90 60 60)"/>
          </svg>
          <div class="score-label">
            <span id="score-pct" class="score-num">—</span>
            <span class="score-sub">compliant products</span>
          </div>
        </div>
      </div>
      <div class="panel" style="flex:2">
        <div class="panel-title">Gaps by Regulation</div>
        <div id="reg-bars"></div>
      </div>
    </section>

    <!-- product heatmap -->
    <section class="panel" id="heatmap-section">
      <div class="panel-title">Product Risk Heatmap</div>
      <div id="heatmap"></div>
    </section>

    <!-- gap table -->
    <section class="panel">
      <div class="panel-header">
        <div class="panel-title">Compliance Gaps</div>
        <div class="table-filters">
          <select id="filter-sev">
            <option value="">All severities</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select id="filter-reg">
            <option value="">All regulations</option>
          </select>
          <input id="filter-search" type="search" placeholder="Search…">
        </div>
      </div>
      <div class="table-wrap">
        <table id="gap-table">
          <thead>
            <tr>
              <th>Severity</th>
              <th>Product</th>
              <th>Regulation</th>
              <th>Gap</th>
              <th>Deadline</th>
              <th>Action</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody id="gap-tbody"></tbody>
        </table>
        <div id="gap-empty" class="empty-state hidden">No gaps match the current filters.</div>
      </div>
    </section>

  </main>
</div>

<script>
// ═══ DATA ═════════════════════════════════════════════════════════════════════
const PARTNERS   = ${partnersJson};
const CREDS      = ${credentialsJson};
const ADMIN_CREDS = { id: 'ADMIN', pw: 'ecocomply' };

// index by partner_id
const BY_ID = {};
for (const p of PARTNERS) BY_ID[p.partner_id] = p;

// ═══ AUTH ═════════════════════════════════════════════════════════════════════
let currentPartner = null;
let isAdmin = false;

document.getElementById('login-form').addEventListener('submit', e => {
  e.preventDefault();
  const id = document.getElementById('inp-id').value.trim().toUpperCase();
  const pw = document.getElementById('inp-pw').value.trim().toLowerCase();
  const err = document.getElementById('login-err');

  if (id === ADMIN_CREDS.id && pw === ADMIN_CREDS.pw) {
    isAdmin = true;
    err.classList.add('hidden');
    showApp(PARTNERS[0]);
    return;
  }
  if (CREDS[id] && pw === CREDS[id]) {
    isAdmin = false;
    err.classList.add('hidden');
    showApp(BY_ID[id]);
    return;
  }
  err.classList.remove('hidden');
});

document.getElementById('btn-logout').addEventListener('click', () => {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
  document.getElementById('inp-id').value = '';
  document.getElementById('inp-pw').value = '';
});

// ═══ APP INIT ═════════════════════════════════════════════════════════════════
function showApp(partner) {
  currentPartner = partner;
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');

  // Admin bar
  const adminBar = document.getElementById('admin-bar');
  if (isAdmin) {
    adminBar.classList.remove('hidden');
    const sel = document.getElementById('company-select');
    sel.innerHTML = PARTNERS.map(p =>
      \`<option value="\${p.partner_id}">\${p.company} (\${p.gaps.length} gaps)</option>\`
    ).join('');
    sel.addEventListener('change', () => {
      renderDashboard(BY_ID[sel.value]);
    });
  } else {
    adminBar.classList.add('hidden');
  }

  renderDashboard(partner);
}

// ═══ RENDER ═══════════════════════════════════════════════════════════════════
function renderDashboard(partner) {
  currentPartner = partner;

  document.getElementById('topbar-company').textContent = partner.company;
  document.getElementById('topbar-assessed').textContent =
    'Assessed: ' + (partner.gaps[0]?._meta?.assessed_at?.slice(0,10) ?? 'today');

  const gaps = partner.gaps;
  const high   = gaps.filter(g => g.severity === 'high').length;
  const medium = gaps.filter(g => g.severity === 'medium').length;
  const totalProducts = partner.products.length;
  const affectedProducts = new Set(gaps.map(g => g.product_id)).size;
  const cleanProducts = totalProducts - affectedProducts;
  const score = totalProducts === 0 ? 100 : Math.round((cleanProducts / totalProducts) * 100);

  // ── cards ──
  const cards = document.getElementById('summary-cards');
  cards.innerHTML = \`
    <div class="card \${high > 0 ? 'card-danger' : 'card-ok'}">
      <div class="card-num">\${high}</div>
      <div class="card-lbl">High-severity gaps</div>
    </div>
    <div class="card \${medium > 0 ? 'card-warn' : 'card-ok'}">
      <div class="card-num">\${medium}</div>
      <div class="card-lbl">Medium-severity gaps</div>
    </div>
    <div class="card">
      <div class="card-num">\${gaps.length}</div>
      <div class="card-lbl">Total gaps</div>
    </div>
    <div class="card">
      <div class="card-num">\${totalProducts}</div>
      <div class="card-lbl">Products scanned</div>
    </div>
    <div class="card \${affectedProducts > 0 ? 'card-warn' : 'card-ok'}">
      <div class="card-num">\${affectedProducts}</div>
      <div class="card-lbl">Products with gaps</div>
    </div>
  \`;

  // ── score ring ──
  const arc = document.getElementById('score-arc');
  const circumference = 314;
  const offset = circumference - (score / 100) * circumference;
  arc.style.strokeDashoffset = offset;
  arc.style.stroke = score >= 80 ? '#16a34a' : score >= 50 ? '#d97706' : '#dc2626';
  document.getElementById('score-pct').textContent = score + '%';
  document.getElementById('score-pct').style.color =
    score >= 80 ? '#16a34a' : score >= 50 ? '#d97706' : '#dc2626';

  // ── gap by regulation bars ──
  const regCount = {};
  for (const g of gaps) {
    const fam = regFamily(g.regulation);
    regCount[fam] = (regCount[fam] ?? 0) + 1;
  }
  const maxReg = Math.max(...Object.values(regCount), 1);
  const regBars = document.getElementById('reg-bars');
  if (Object.keys(regCount).length === 0) {
    regBars.innerHTML = '<div class="no-gaps">✅ No gaps detected</div>';
  } else {
    regBars.innerHTML = Object.entries(regCount)
      .sort((a,b) => b[1]-a[1])
      .map(([fam, cnt]) => \`
        <div class="bar-row">
          <span class="bar-label">\${fam}</span>
          <div class="bar-track">
            <div class="bar-fill" style="width:\${Math.round((cnt/maxReg)*100)}%"></div>
          </div>
          <span class="bar-count">\${cnt}</span>
        </div>
      \`).join('');
  }

  // ── product heatmap ──
  const heatmap = document.getElementById('heatmap');
  const gapsByProduct = {};
  for (const g of gaps) {
    (gapsByProduct[g.product_id] = gapsByProduct[g.product_id] ?? { product: g.product, high:0, medium:0, low:0 });
    gapsByProduct[g.product_id][g.severity]++;
  }
  heatmap.innerHTML = partner.products.map(prod => {
    const g = gapsByProduct[prod.product_id];
    const cls = !g ? 'heat-ok' : g.high > 0 ? 'heat-high' : g.medium > 0 ? 'heat-med' : 'heat-low';
    const label = !g ? '✓ Clean' : \`\${(g.high||0)+'H'} \${(g.medium||0)+'M'}\`;
    return \`<div class="heat-cell \${cls}" title="\${prod.name}: \${label}">
      <div class="heat-name">\${prod.name}</div>
      <div class="heat-label">\${label}</div>
    </div>\`;
  }).join('');

  // ── gap table ──
  renderGapTable(gaps);
  populateRegFilter(gaps);
}

function regFamily(regulation) {
  const m = regulation.match(/^([^—\\[]+)/);
  return m ? m[1].trim() : regulation.slice(0, 30);
}

function populateRegFilter(gaps) {
  const sel = document.getElementById('filter-reg');
  const families = [...new Set(gaps.map(g => regFamily(g.regulation)))].sort();
  sel.innerHTML = '<option value="">All regulations</option>' +
    families.map(f => \`<option value="\${f}">\${f}</option>\`).join('');
}

function renderGapTable(gaps) {
  const sev   = document.getElementById('filter-sev').value;
  const reg   = document.getElementById('filter-reg').value;
  const query = document.getElementById('filter-search').value.toLowerCase();

  let rows = gaps;
  if (sev)   rows = rows.filter(g => g.severity === sev);
  if (reg)   rows = rows.filter(g => regFamily(g.regulation) === reg);
  if (query) rows = rows.filter(g =>
    g.product.toLowerCase().includes(query) ||
    g.gap.toLowerCase().includes(query) ||
    g.regulation.toLowerCase().includes(query)
  );

  const tbody = document.getElementById('gap-tbody');
  const empty = document.getElementById('gap-empty');

  if (rows.length === 0) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  tbody.innerHTML = rows.map(g => \`
    <tr class="row-\${g.severity}">
      <td><span class="badge \${g.severity}">\${g.severity.toUpperCase()}</span></td>
      <td class="td-product">
        <div class="product-name">\${g.product}</div>
        <div class="product-id">\${g.product_id}</div>
      </td>
      <td class="td-reg">\${regFamily(g.regulation)}</td>
      <td class="td-gap">\${g.gap}</td>
      <td class="td-deadline">\${g.deadline ? formatDeadline(g.deadline) : '<span class="muted">In force</span>'}</td>
      <td class="td-action">\${g.recommended_action}</td>
      <td><a href="\${g.source_url}" target="_blank" rel="noopener" class="source-link">Source ↗</a></td>
    </tr>
  \`).join('');
}

function formatDeadline(d) {
  const dt = new Date(d);
  const now = new Date();
  const days = Math.ceil((dt - now) / 86400000);
  const str = dt.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
  if (days < 0)  return \`<span class="deadline-past">\${str}</span>\`;
  if (days < 90) return \`<span class="deadline-soon">\${str} (\${days}d)</span>\`;
  return \`<span class="deadline-ok">\${str}</span>\`;
}

// filters
['filter-sev','filter-reg','filter-search'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => {
    renderGapTable(currentPartner.gaps);
  });
});
</script>
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CSS
// ═══════════════════════════════════════════════════════════════════════════════
const CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, "Segoe UI", system-ui, sans-serif; font-size: 14px; line-height: 1.6; background: #f7f8fa; color: #1f2328; }
.hidden { display: none !important; }
.muted  { color: #57606a; }

/* ── login ── */
.login-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #f7f8fa; }
.login-box  { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 40px 36px; width: 360px; }
.login-logo { font-size: 36px; text-align: center; margin-bottom: 8px; }
.login-title { font-size: 20px; font-weight: 700; text-align: center; }
.login-sub  { font-size: 12px; color: #57606a; text-align: center; margin-bottom: 24px; }
.login-box label  { display: block; font-size: 12px; font-weight: 600; color: #57606a; margin-bottom: 4px; }
.login-box input  { width: 100%; padding: 9px 12px; border: 1px solid #e5e7eb; border-radius: 6px; font-size: 14px; margin-bottom: 14px; outline: none; }
.login-box input:focus { border-color: #3b82d4; }
.login-box button { width: 100%; padding: 10px; background: #3b82d4; color: #fff; border: none; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; margin-top: 4px; }
.login-box button:hover { background: #2563eb; }
.login-err  { background: #fee2e2; color: #991b1b; font-size: 12px; padding: 8px 10px; border-radius: 5px; margin-bottom: 12px; }
.login-hint { font-size: 11px; color: #57606a; text-align: center; margin-top: 16px; line-height: 1.5; }

/* ── topbar ── */
.topbar { background: #1f2328; color: #fff; display: flex; align-items: center; gap: 16px; padding: 0 24px; height: 48px; position: sticky; top: 0; z-index: 10; }
.topbar-brand   { font-weight: 700; font-size: 15px; white-space: nowrap; }
.topbar-company { font-size: 13px; color: #c9d1d9; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.topbar-right   { display: flex; align-items: center; gap: 14px; }
.topbar-meta    { font-size: 11px; color: #8b949e; white-space: nowrap; }
.btn-ghost { background: transparent; border: 1px solid #444; color: #c9d1d9; padding: 4px 12px; border-radius: 5px; font-size: 12px; cursor: pointer; }
.btn-ghost:hover { background: #30363d; }

/* ── admin bar ── */
.admin-bar { background: #fff; border-bottom: 1px solid #e5e7eb; padding: 8px 24px; display: flex; align-items: center; gap: 10px; }
.admin-label { font-size: 12px; font-weight: 600; color: #57606a; }
.admin-bar select { padding: 5px 10px; border: 1px solid #e5e7eb; border-radius: 5px; font-size: 13px; min-width: 260px; }

/* ── main ── */
.main { max-width: 1100px; margin: 0 auto; padding: 24px 24px 64px; }

/* ── cards ── */
.cards { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 20px; }
.card { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px 20px; min-width: 130px; flex: 1; }
.card-num { font-size: 28px; font-weight: 700; color: #1f2328; }
.card-lbl { font-size: 12px; color: #57606a; margin-top: 2px; }
.card-danger { border-left: 4px solid #dc2626; }
.card-warn   { border-left: 4px solid #d97706; }
.card-ok     { border-left: 4px solid #16a34a; }
.card-danger .card-num { color: #dc2626; }
.card-warn   .card-num { color: #d97706; }
.card-ok     .card-num { color: #16a34a; }

/* ── two-col ── */
.two-col { display: flex; gap: 16px; margin-bottom: 20px; }
.panel { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; }
.panel-title { font-size: 13px; font-weight: 600; color: #57606a; margin-bottom: 14px; text-transform: uppercase; letter-spacing: .05em; }
.panel-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-bottom: 14px; }

/* ── score ring ── */
.score-wrap { display: flex; align-items: center; gap: 20px; }
.score-label { display: flex; flex-direction: column; }
.score-num { font-size: 32px; font-weight: 700; }
.score-sub { font-size: 12px; color: #57606a; }

/* ── reg bars ── */
.bar-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.bar-label { font-size: 12px; width: 180px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex-shrink: 0; }
.bar-track { flex: 1; height: 10px; background: #f7f8fa; border-radius: 5px; overflow: hidden; border: 1px solid #e5e7eb; }
.bar-fill  { height: 100%; background: #3b82d4; border-radius: 5px; transition: width .4s; }
.bar-count { font-size: 12px; font-weight: 600; width: 20px; text-align: right; }
.no-gaps { color: #16a34a; font-weight: 600; font-size: 14px; padding: 20px 0; }

/* ── heatmap ── */
#heatmap-section { margin-bottom: 20px; }
#heatmap { display: flex; flex-wrap: wrap; gap: 10px; }
.heat-cell { border-radius: 6px; padding: 10px 14px; min-width: 150px; flex: 1; border: 1px solid transparent; }
.heat-name { font-size: 12px; font-weight: 600; }
.heat-label { font-size: 11px; margin-top: 4px; }
.heat-ok   { background: #f0fdf4; border-color: #86efac; color: #166534; }
.heat-high { background: #fee2e2; border-color: #fca5a5; color: #991b1b; }
.heat-med  { background: #fef3c7; border-color: #fcd34d; color: #92400e; }
.heat-low  { background: #dbeafe; border-color: #93c5fd; color: #1e40af; }

/* ── gap table ── */
.table-filters { display: flex; gap: 8px; flex-wrap: wrap; }
.table-filters select, .table-filters input {
  padding: 5px 10px; border: 1px solid #e5e7eb; border-radius: 5px; font-size: 13px;
}
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
thead th { background: #f7f8fa; text-align: left; padding: 8px 10px; font-weight: 600; border-bottom: 2px solid #e5e7eb; white-space: nowrap; }
tbody td { padding: 9px 10px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
tbody tr:hover td { background: #fafbfc; }
.row-high   td:first-child { border-left: 3px solid #dc2626; }
.row-medium td:first-child { border-left: 3px solid #d97706; }
.row-low    td:first-child { border-left: 3px solid #3b82d4; }
.td-gap    { max-width: 260px; }
.td-action { max-width: 200px; font-size: 12px; color: #57606a; }
.td-reg    { white-space: nowrap; font-size: 12px; font-weight: 600; }
.td-product .product-name { font-weight: 600; }
.td-product .product-id   { font-size: 11px; color: #57606a; }
.badge { display: inline-block; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 10px; letter-spacing: .04em; white-space: nowrap; }
.high   { background: #fee2e2; color: #991b1b; }
.medium { background: #fef3c7; color: #92400e; }
.low    { background: #dbeafe; color: #1e40af; }
.source-link { color: #3b82d4; text-decoration: none; font-size: 12px; white-space: nowrap; }
.source-link:hover { text-decoration: underline; }
.deadline-past { color: #dc2626; font-weight: 600; }
.deadline-soon { color: #d97706; font-weight: 600; }
.deadline-ok   { color: #1f2328; }
.empty-state { padding: 32px; text-align: center; color: #57606a; font-size: 13px; }
`;

// ── build + write (must be after CSS const) ───────────────────────────────────
const html = buildHtml(PARTNERS_JSON, CREDENTIALS_JSON);
writeFileSync('dashboard.html', html);
console.log('✓ wrote dashboard.html');
console.log('  Open dashboard.html in any browser — no server needed.');
console.log('\n  Demo credentials (partner_id / password):');
for (const [pid, pw] of Object.entries(credentials).slice(0, 5)) {
  console.log(`    ${pid}  /  ${pw}`);
}
console.log('    … (all 22 companies, password = company name lowercase no spaces)');
console.log('\n  Admin view: use  ADMIN  /  ecocomply  to see all companies.');
