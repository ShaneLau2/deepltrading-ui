/* 07 运行日志页 — 统一日志浏览 + 错误扫描。 */
"use strict";

/* ── 07 运行日志(统一日志浏览 + 错误扫描) ───────────────────────────── */
const LOGS = { file: "", q: "", line: 0, follow: true };

async function renderLogs() {
  const el = pageEl("logs");
  el.innerHTML = `<div class="card"><h3>错误扫描<span class="dim">(7 天内日志 · 每 6s 自动刷新)</span></h3>
      <div id="logsScan"><div class="loading">扫描中…</div></div></div>
    <div class="card"><h3>日志文件<span class="dim">(output/ + data/ 下所有 *.log)</span></h3>
      <div id="logsFiles"><div class="loading">加载中…</div></div></div>
    <div class="card"><h3>日志查看器</h3>
      <div class="form-grid inline">
        <label style="min-width:260px">文件 <select id="lvFile"></select></label>
        <label>过滤关键词 <input id="lvQ" placeholder="留空=全部" oninput="logsClearLine()"></label>
        <label>跳转行号 <input id="lvLine" type="number" min="1" style="width:90px"></label>
        <label class="chk"><input id="lvFollow" type="checkbox" checked> 跟随刷新(近底部时)</label>
        <button class="btn" onclick="logsView()">刷新</button>
      </div>
      <div id="lvMeta" class="dim" style="margin:6px 0"></div>
      <pre class="console" id="lvPre" style="height:52vh; max-height:520px; line-height:1.55"></pre>
    </div>`;
  refreshLogs();
  clearPolls();
  pollSet("logs", refreshLogs, 6000);
}

async function refreshLogs() {
  try {
    const [lst, scan] = await Promise.all([api("/api/logs/list"), api("/api/logs/scan")]);
    renderLogsScan(scan);
    renderLogsFiles(lst);
  } catch (_) { /* 瞬时失败忽略,下轮重试 */ }
  if (LOGS.file && !document.hidden) logsView(true);
}

function logsBadge(n) {
  if (!n) return `<span class="tag ok-tag">✓ 无错误</span>`;
  return `<span class="tag err-tag">🔴 ${n} 处</span>`;
}

function renderLogsScan(scan) {
  const box = document.getElementById("logsScan");
  if (!box) return;
  const rows = scan.files || [];
  if (!rows.length) {
    box.innerHTML = `<p class="dim">7 天内没有带错误/警告的日志(扫描于 ${esc(scan.scanned_at || "")})。</p>`;
    return;
  }
  let h = `<p class="dim">扫描于 ${esc(scan.scanned_at || "")} · ${scan.files_with_errors} 个文件含错误特征 · 共 ${scan.total_errors} 处。</p>
    <div class="table-scroll"><table class="grid-tbl"><thead><tr><th>文件</th><th>更新时间</th><th>错误</th><th>最新错误时间</th><th>错误预览</th><th></th></tr></thead><tbody>`;
  for (const r of rows) {
    const e0 = (r.errors && r.errors[0]) || {};
    h += `<tr><td><b>${esc(r.file)}</b></td><td>${esc(r.mtime)}</td>
      <td>${logsBadge(r.err_count)}</td>
      <td>${esc(r.last_err_ts || "—")}</td>
      <td class="dim" style="max-width:520px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${esc(e0.text || "")}</td>
      <td><button class="btn small" onclick="logsOpen('${esc(r.file)}', ${e0.n || 0})">定位</button></td></tr>`;
  }
  h += `</tbody></table></div>`;
  box.innerHTML = h;
}

function renderLogsFiles(lst) {
  const box = document.getElementById("logsFiles");
  if (!box) return;
  const sel = document.getElementById("lvFile");
  if (sel) {
    const prev = sel.value;
    sel.innerHTML = `<option value="">— 选择日志文件 —</option>` + (lst.rows || []).map(r =>
      `<option value="${esc(r.file)}">${esc(r.file)} (${r.size_kb}K)</option>`).join("");
    if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
    if (LOGS.file && !prev) sel.value = LOGS.file;
  }
  if (!lst.rows || !lst.rows.length) {
    box.innerHTML = `<p class="warn">未发现日志文件。</p>`;
    return;
  }
  let h = `<div class="table-scroll"><table class="grid-tbl"><thead><tr><th>文件</th><th>大小</th><th>行数(估)</th><th>更新时间</th><th></th></tr></thead><tbody>`;
  for (const r of lst.rows) {
    h += `<tr><td><b>${esc(r.file)}</b></td><td>${r.size_kb} KB</td><td>${fmtMoney(r.lines_est)}</td><td>${esc(r.mtime)}</td>
      <td><button class="btn small" onclick="logsOpen('${esc(r.file)}')">查看</button></td></tr>`;
  }
  h += `</tbody></table></div>`;
  box.innerHTML = h;
}

const LOG_ERR_RE = /Traceback|ERROR|CRITICAL|Exception|失败|❌|🔴|rc=[1-9]|错误|denied|refused|Segmentation/i;
const LOG_WARN_RE = /Warning|警告|⚠|🟡|跳过|疑似/i;

function logsOpen(file, line) {
  LOGS.file = file; LOGS.line = line || 0;
  LOGS.q = "";
  const q = document.getElementById("lvQ"); if (q) q.value = "";
  const ln = document.getElementById("lvLine"); if (ln) ln.value = line || "";
  const sel = document.getElementById("lvFile"); if (sel) sel.value = file;
  logsView(false);
}

function logsClearLine() {
  // 输入新关键词后不再受上次「定位」行号窗口限制(全文件搜索)
  const ln = document.getElementById("lvLine");
  if (ln && ln.value) ln.value = "";
}

async function logsView(quiet) {
  const pre = document.getElementById("lvPre");
  if (!pre) return;
  const file = LOGS.file || (document.getElementById("lvFile") || {}).value || "";
  const q = (document.getElementById("lvQ") || {}).value || "";
  const line = parseInt((document.getElementById("lvLine") || {}).value, 10) || 0;
  if (!file) { pre.textContent = "选择左侧/上方一个日志文件开始查看。"; return; }
  try {
    const r = await api(`/api/logs/read?file=${encodeURIComponent(file)}&q=${encodeURIComponent(q)}&limit=800${line ? `&line=${line}` : ""}`);
    if (!r.available) { pre.textContent = r.message || "读取失败"; return; }
    const nearBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 120;
    const jump = LOGS.line;
    const meta = document.getElementById("lvMeta");
    if (meta) meta.textContent = `${r.file} · ${r.size_kb} KB · 总行数 ${fmtMoney(r.total_lines)}${q ? ` · 匹配 ${r.matched} 行` : ""} · 更新 ${r.mtime}`;
    const lines = (r.lines || []).map(l => {
      const cls = LOG_ERR_RE.test(l.text) ? " log-err" : (LOG_WARN_RE.test(l.text) ? " log-warn" : "");
      return `<div class="log-line${cls}"><span class="ln">${l.n}</span>${esc(l.text)}</div>`;
    }).join("");
    if (!quiet || nearBottom || jump) {
      pre.innerHTML = lines;
      if (jump) {
        const target = [...pre.children].find(d => parseInt(d.querySelector(".ln").textContent, 10) >= jump);
        if (target) pre.scrollTop = target.offsetTop - 10;
        LOGS.line = 0;
      } else if (nearBottom && !jump) {
        pre.scrollTop = pre.scrollHeight;
      }
    }
  } catch (e) {
    if (!quiet) pre.textContent = "读取失败: " + e.message;
  }
}

