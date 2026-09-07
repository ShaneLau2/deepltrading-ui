/* deepltrading Web 控制台 — 前端逻辑 */
"use strict";

const $ = (s) => document.querySelector(s);
// 容器重定向: 研究流水线页把 train/backtest/evolve/pipeline 子区渲染到页内折叠容器
// (一级导航隐藏后, 原 renderX 通过 pageEl(name) 取容器, 重定向到研究页内的子容器)
const PAGE_TARGET = {};
const pageEl = (id) => document.getElementById(PAGE_TARGET[id] || ("page-" + id));

/* 后端连接(API 地址 / token / 页头连接框)在 backend.js——必须于本文件之前加载,
   此处经 Backend.init() 启动, 见文件末尾 boot 处。 */

/* ── 工具 ─────────────────────────────────────────────────────────── */
async function api(path, opts = {}) {
  const headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
  if (API_TOKEN && /^[A-Za-z0-9_\-]+$/.test(API_TOKEN)) headers["Authorization"] = "Bearer " + API_TOKEN;
  let res = await fetch(API_BASE + path, Object.assign({}, opts, { headers }));
  if (res.status === 401 && !opts._authed) {
    // 本机页面: 401 时自动取 token 重试一次; 公网页取不到, 走下方报错提示
    const tok = await tryFetchToken();
    if (tok) {
      headers["Authorization"] = "Bearer " + tok;
      res = await fetch(API_BASE + path, Object.assign({}, opts, { headers }));
    }
  }
  if (!res.ok) {
    let detail = res.status + " " + res.statusText;
    try { const j = await res.json(); detail = j.detail || detail; } catch (_) {}
    throw new Error(detail);
  }
  return res.json();
}

let toastTimer = null;
function toast(msg, ok = true) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast " + (ok ? "ok" : "err");
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4200);
}

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isBad = (x) => x === null || x === undefined || x === "" || (typeof x === "number" && Number.isNaN(x));
const fmtPct = (x, d = 1) => isBad(x) ? "—" : (x * 100).toFixed(d) + "%";
const fmtP = (x, d = 1) => isBad(x) ? "—" : (x * 100).toFixed(d) + "%";
const fmt = (x, d = 2) => isBad(x) ? "—" : Number(x).toFixed(d);
const fmtMoney = (x) => isBad(x) ? "—" : Number(x).toLocaleString("en-US", { maximumFractionDigits: 0 });

const charts = {};
function chart(id, config) {
  const el = document.getElementById(id);
  if (!el) return;
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(el, config);
}
const CHART_STYLE = {
  color: "#aab3c5", borderColor: "rgba(255,255,255,0.07)",
  font: { family: "ui-monospace, SFMono-Regular, Menlo, monospace", size: 13 },
  grid: { color: "rgba(255,255,255,0.06)" },
  ticks: { color: "#8a94a8" },
};
const TT_FONT = { bodyFont: { size: 13.5 }, titleFont: { size: 13.5 } };

/* ── 导航 ─────────────────────────────────────────────────────────── */
const POLLS = {};
function clearPolls() { Object.values(POLLS).forEach(clearInterval); Object.keys(POLLS).forEach(k => delete POLLS[k]); }
// 覆写式注册轮询: 先清旧再建新,避免重复渲染时泄漏多个并行定时器
// (修复: 任务结束后页面反复刷新的根因 —— 完成分支触发的重渲染从不清理自己的 interval)
function pollSet(key, fn, ms) { clearInterval(POLLS[key]); delete POLLS[key]; POLLS[key] = setInterval(fn, ms); }
function pollDrop(key) { clearInterval(POLLS[key]); delete POLLS[key]; }

function showPage(name) {
  clearPolls();
  closePxModal();
  try { localStorage.setItem("dl_web_page", name); } catch (_) {}
  document.querySelectorAll(".step").forEach(s => s.classList.toggle("active", s.dataset.page === name));
  document.querySelectorAll(".page").forEach(s => s.classList.toggle("active", s.dataset.page === name));
  const renderers = { overview: renderOverview, research: renderResearch, signals: renderSignals, paper: renderPaper, logs: renderLogs, train: renderTrain, backtest: renderBacktest, evolve: renderEvolve, pipeline: renderPipeline };
  renderers[name]();
}

/* ── 头部状态 ─────────────────────────────────────────────────────── */
async function pollHeader() {
  try {
    const sts = await Promise.all([
      api("/api/train/status").then(r => r.status),
      api("/api/backtest/status").then(r => r.status),
      api("/api/signals/status").then(r => r.status),
      api("/api/evolve/status").then(r => r.status),
      api("/api/research/status").then(r => r.status),
      api("/api/backtest/panorama/status").then(r => r.status),
      api("/api/validate/status").then(r => ({ active: !!(r.fold6 && r.fold6.status && r.fold6.status.active) || !!(r.rolling && r.rolling.status && r.rolling.status.active) })),
      api("/api/pipeline/status").then(r => r.job),
    ]);
    const any = sts.some(s => s && s.active);
    const pill = $("#jobPill");
    pill.className = "pill " + (any ? "busy" : "");
    pill.innerHTML = any
      ? `<i class="pill-dot"></i>运行中(${sts.filter(s => s.active).length})`
      : `<i class="pill-dot"></i>空闲`;
  } catch (_) {}
}

/* ── 通用组件 ─────────────────────────────────────────────────────── */
function tile(label, value, sub, cls = "") {
  return `<div class="tile ${cls}"><div class="tile-label">${esc(label)}</div>
    <div class="tile-value">${value}</div>${sub ? `<div class="tile-sub">${sub}</div>` : ""}</div>`;
}

function logConsole(containerId) {
  return `<div class="console-wrap"><div class="console-head">运行日志</div>
    <pre class="console" id="${containerId}"></pre></div>`;
}

function pollLog(containerId, url, active) {
  if (active) {
    pollSet("log-" + containerId, async () => {
      try {
        const r = await api(url);
        const el = document.getElementById(containerId);
        if (!el) return;
        const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        el.textContent = r.lines.join("\n");
        if (nearBottom) el.scrollTop = el.scrollHeight;
      } catch (_) {}
    }, 2000);
  }
}

function busySection(job) {
  if (!job || !job.active) return "";
  const label = job.job ? job.job.label : "";
  return `<div class="busy-bar"><i class="spin"></i> 后台任务运行中: ${esc(label)}
    <button class="btn danger" onclick="stopActive()">停止</button></div>`;
}

/* 00 总览 · 平均年化增长卡片(CAGR 主值 + 实际逐年年化 + α 分解)。
   基准 symbol 与净值曲线共用(同 localStorage 键, 切任一即双双重算)。 */
function buildGrowthCard(g) {
  if (!g || !g.available || !Array.isArray(g.years) || !g.years.length) return "";
  const yrs = g.years;
  const bench = g.bench_symbol || "SPY";
  const rows = yrs.map((y, i) => {
    const first = i === 0, lastY = i === yrs.length - 1;
    const mark = first ? "首年·年中起" : (lastY ? "未完年(YTD)" : "");
    const nav = fmtPct(y.actual, 1);
    const naked = y.naked_actual != null ? fmtPct(y.naked_actual, 1) : "—";
    const benchV = y.bench_actual != null ? fmtPct(y.bench_actual, 1) : "—";
    const expo = y.avg_exposure != null ? fmtPct(y.avg_exposure, 0) : "—";
    const beta = y.beta != null ? fmt(y.beta, 2) : "—";
    const mkt = y.market_contrib != null ? fmtPct(y.market_contrib, 1) : "—";
    const resA = y.residual_alpha != null ? fmtPct(y.residual_alpha, 1) : "—";
    return `<tr><td><b>${y.year}</b>${mark ? ` <span class="dim" style="font-weight:400">${mark}</span>` : ""}</td>
      <td>${y.n_days}</td>
      <td><b>${nav}</b></td>
      <td>${naked}</td><td>${benchV}</td>
      <td>${expo}</td>
      <td>${beta}</td><td>${mkt}</td>
      <td><b class="${y.residual_alpha != null && y.residual_alpha < 0 ? "err" : "ok"}">${resA}</b></td>
      <td class="dim">${esc(y.start)} → ${esc(y.end)}</td></tr>`;
  }).join("");
  const chips = [];
  chips.push(`<span class="tile-value" style="color:var(--green)">${fmtPct(g.cagr, 1)}</span>`);
  if (g.cagr_naked != null) chips.push(`<span class="tag">V2裸 ${fmtPct(g.cagr_naked, 1)}</span>`);
  if (g.cagr_bench != null) chips.push(`<span class="tag">${bench} ${fmtPct(g.cagr_bench, 1)}</span>`);
  if (g.beta != null) chips.push(`<span class="tag">市场 β ${fmt(g.beta, 2)}</span>`);
  if (g.residual_alpha_cagr != null) chips.push(`<span class="tag">残差 α CAGR ${fmtPct(g.residual_alpha_cagr, 1)}</span>`);
  // 近端行业归因摘要(如可用)
  let indNote = "";
  const ind = g.industry;
  if (ind && ind.available) {
    const top = (ind.sectors || []).slice(0, 3).map(s =>
      `${esc(s.sector)} ${s.tilt >= 0 ? "+" : ""}${(s.tilt * 100).toFixed(0)}%`).join(" / ");
    indNote = `<p class="dim">近端行业归因(${esc(ind.start)} → ${esc(ind.end)} · ${ind.n_days} 交易日 · 重建每日 top30 vs panel 等权): ` +
      `累计超额 <b>${fmtPct(ind.excess, 1)}</b> = 行业配置 ${fmtPct(ind.alloc, 1)} + 选股 ${fmtPct(ind.sel, 1)} + 交互 ${fmtPct(ind.inter, 1)}` +
      `${ind.corr_vs_engine != null ? ` · 与引擎裸净值 corr ${fmt(ind.corr_vs_engine, 2)}` : ""}<br>超配前 3: ${top}(配置贡献见存档快照 ⑤b)</p>`;
  }
  return `<div class="card" id="growthCard">
    <h3>平均年化增长 · 逐年 α 分解<span class="tag ok-tag">几何 CAGR</span>
      <span class="ov-bench" style="display:inline-flex;align-items:center;gap:6px;float:right;font-weight:400">
        <label style="font-size:12px;margin:0">基准(与净值图共用)
          <input id="growthBench" list="ovBenchList" value="${esc(bench)}" autocomplete="off" spellcheck="false"
                 style="width:92px;font-size:13px">
        </label>
      </span>
    </h3>
    <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin:2px 0 8px">
      ${chips.join("")}
      <span class="dim">${esc(g.start)} → ${esc(g.end)} · ${g.n_days} 交易日 · 复利 (末日/首日)^(252/交易日) − 1</span>
    </div>
    <div class="table-scroll"><table class="grid-tbl">
      <thead><tr><th>年份</th><th>交易日</th>
        <th>V2 生产(实际)</th><th>V2裸(无风控)</th><th>${esc(bench)} 同窗口</th>
        <th>平均暴露</th><th>β(对${esc(bench)})</th><th>市场贡献</th><th>α(去β)</th><th>区间</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    ${indNote}
    <p class="dim">口径: <b>V2 生产</b>(裸 k30 × DD阶梯×IC) / <b>V2裸</b>(去风控覆盖 ∏(1+net/暴露)) / <b>${esc(bench)}</b>(同窗口)。` +
      `<b>市场贡献</b> = 该年 β × ${esc(bench)}实际(β 用该年日收益对基准区间对齐回归;champion 曲线为信号日口径, 日 d 收益在 d→d+1 实现);` +
      `<b>α(去β)</b> = (1+实际)/(1+市场贡献) − 1, 即剔除市场 beta 后的选股/择时/风控净效果。` +
      `每年末回撤与年内最深回撤列见「验证证据链快照 ⑤」(存档)。数据源 data/champion_equity.csv。切换基准 → α 列/市场贡献/β 实时重算。</p>
  </div>`;
}

/* 总览基准切换(净值曲线 + 年化卡片共用同一 symbol, 双双重算) */
async function refreshOverviewBench(sym) {
  sym = (sym || "").trim().toUpperCase();
  if (!sym) return;
  localStorage.setItem("ov_bench_sym", sym);
  ["ovBench", "growthBench"].forEach(id => { const e = document.getElementById(id); if (e) e.value = sym; });
  try {
    const [nd, gd] = await Promise.all([
      api(`/api/overview/equity?symbol=${encodeURIComponent(sym)}`),
      api(`/api/overview/growth?symbol=${encodeURIComponent(sym)}`).catch(() => null),
    ]);
    const used = (nd && nd.bench_symbol) || sym;
    window.OV_EQ = nd;
    if (nd && nd.available && nd.points.length) ovDrawCurve();
    const tag = document.getElementById("ovBenchTag");
    if (tag) tag.textContent = `绿=V2 生产 · 琥珀虚线=V2裸(无覆盖) · 灰点=基准(${used})`;
    const h3 = document.querySelector("#page-overview h3");
    if (h3) h3.textContent = `净值曲线 · V2 生产 / V2裸 / ${used}(三线同图)`;
    const wrap = document.getElementById("growthCardWrap");
    if (wrap) { wrap.innerHTML = buildGrowthCard(gd && gd.available ? gd : null); attachBenchListeners(); }
    if (nd && !nd.available) toast(`基准 ${used} 无行情数据`, false);
  } catch (err) {
    toast("基准切换失败: " + err.message, false);
  }
}

/* 把基准输入(#ovBench 净值图 + #growthBench 年化卡)绑定到共用切换 —— 双双重算。
   刷新/重建后需重新调用(growthCard 内部 input 会随 innerHTML 重建)。 */
function attachBenchListeners() {
  ["ovBench", "growthBench"].forEach(id => {
    const e = document.getElementById(id);
    if (e && !e.dataset.bound) {
      e.dataset.bound = "1";
      e.addEventListener("change", (ev) => refreshOverviewBench(ev.target.value));
    }
  });
}

/* 00 总览 · 窗口文案简化: 「全窗口(2021-08 → 2026-08-28 面板末)」→「2021-08 → 2026-08-28」 */
function fmtWindow(w) {
  const s = String(w || "");
  const m = s.match(/\(([^)]+)\)$/);
  return m ? m[1].replace(/面板末$/, "").trim() : s;
}

/* ── 00 总览 ──────────────────────────────────────────────────────── */
async function renderOverview() {
  const el = pageEl("overview");
  el.innerHTML = `<div class="loading">加载总览…</div>`;
  let data, eq, ic, syms, g0;
  const benchSym0 = (localStorage.getItem("ov_bench_sym") || "QQQ").toUpperCase();
  try { [data, eq, ic, syms, g0] = await Promise.all([
      api("/api/overview"),
      api(`/api/overview/equity?symbol=${encodeURIComponent(benchSym0)}`),
      api("/api/overview/ic"),
      api("/api/overview/symbols").then(s => s || [], () => []),
      api(`/api/overview/growth?symbol=${encodeURIComponent(benchSym0)}`).catch(() => null),
    ]); }
  catch (e) { el.innerHTML = `<div class="err-box">加载失败: ${esc(e.message)}</div>`; return; }
  const benchSym = (eq && eq.bench_symbol) || benchSym0;
  // 年化卡片与净值图共用基准: 优先按当前 symbol 拉取, 失败回退 /api/overview 内嵌 SPY 版
  const growthData = (g0 && g0.available) ? g0 : (data.growth || null);

  const ch = data.champion || {};
  const rm = data.risk_metrics || {};
  const mv = data.model_validity || {};
  const v2 = data.v2_exposure || {};
  const sig = data.latest_signal || {};

  const win = fmtWindow(rm.window);
  const tiles = [
    tile("V2 净值(生产)", fmt(ch.eq, 2), `${ch.date || "—"} · 起点 1 元 → 当前 ${fmt(ch.eq, 2)} 元`, "green"),
    tile("V2 回撤(当前)", fmtPct(ch.dd), `${ch.date || v2.date || "—"} · 距历史最高点回落 · 当日仓位 ${fmtP(ch.exposure, 0)}`, ch.dd < -0.08 ? "red" : (ch.dd < -0.03 ? "amber" : "green")),
    tile("当前仓位(风控后)", fmtP(v2.composite_exposure, 0), v2.ic_fallback ? "⚠ 风控回退: 仅按回撤降仓" : `系统按回撤+模型强度自动调仓 · 60日IC ${fmtP(v2.ic_rolling_mean_60)}`, "amber"),
    tile("模型 IC(60日)", fmt(mv.ic, 4), `预测与未来60日收益的相关性,越接近1越准 · t=${fmt(mv.t_nw, 1)} · ${mv.date || "—"}`, mv.ok ? "green" : "red"),
    tile("OOS IC(样本外)", fmt(mv.oos_ic, 4), mv.oos_ok ? "样本外预测力 · 显著通过 ✅" : "样本外预测力未通过 ⚠", mv.oos_ok ? "green" : "red"),
    tile("Sharpe(全期)", fmt(rm.sharpe, 2), `收益风险比(越高越好) · Sortino ${fmt(rm.sortino, 2)} · ${esc(win)}`, "green"),
    tile("最大回撤(V2)", fmtPct(rm.max_dd), `历史最坏: 从最高点最多跌 ${fmtPct(Math.abs(rm.max_dd))} · Calmar ${fmt(rm.calmar, 2)} · ${esc(win)}`, "amber"),
    tile("累计收益(V2)", fmtPct(rm.total_return, 0), rm.annual_return != null ? `年化 ${fmtPct(rm.annual_return, 0)}` : `${esc(win)} 区间总涨幅(已含风控与成本)`, "green"),
    tile("最新信号", sig.date || "—", sig.rows ? `${sig.rows} 只候选` : "尚未生成", sig.date ? "green" : "amber"),
  ];

  const cal = data.caliber || {};
  const guardOk = !!(cal.guard && cal.guard.verdict === "ok");
  const guardTxt = guardOk
    ? `<span class="tag ok-tag">守卫 ✓</span>`
    : `<span class="tag err-tag">守卫 ✗ 漂移</span>`;

  const benchEsc = esc(benchSym);
  const growthHtml = buildGrowthCard(growthData);
  let html = `<div class="grid tiles">${tiles.join("")}</div>
  <div id="growthCardWrap">${growthHtml}</div>
  <details class="caliber-panel">
    <summary>口径说明 · 生产配置 as-if 全窗口
      ${cal.dd_recover_confirm_days != null ? `(dd_recover_confirm_days=${cal.dd_recover_confirm_days})` : ""}
      ${guardTxt}</summary>
    <table class="kv"><tbody>
      <tr><td>生效配置</td><td>dd_recover_confirm_days = ${cal.dd_recover_confirm_days ?? "—"}。约定(2026-09-06): 生产配置变更按 <b>as-if 全窗口</b> 应用——净值曲线 / 周报 / 审计表全部以「当前规则从 2021-08 起一直生效」重算;执行本身是因果的, 配置变更天然只影响未来, 不产生分歧。</td></tr>
      <tr><td>净值曲线 champion_equity.csv</td><td>→ ${esc(cal.equity_end || "—")}(OOS 回测 + 逐日延伸)</td></tr>
      <tr><td>风控指标表 risk_metrics.md</td><td>→ ${esc(cal.risk_metrics_end || "—")}(OOS 面板末, 同配置同口径)</td></tr>
      <tr><td>V2 暴露快照 v2_exposure_now.json</td><td>${esc(cal.v2_exposure_date || "—")}(每日执行暴露)</td></tr>
      <tr><td>口径守卫 caliber_guard.py</td><td>${guardOk ? "✓ 通过" : "✗ 脱节"} · 最近检查 ${esc((cal.guard && cal.guard.checked_at) || "—")}。每日/每周链自动对拍曲线 vs 审计表, 脱节即硬失败阻断(2026-09-05 −8.3% vs −10.2% 分叉事故的防线)。</td></tr>
    </tbody></table>
  </details>
  <div class="grid two">
    <div class="card"><h3>净值曲线 · V2 生产 / V2裸 / ${benchEsc}(三线同图)</h3>
      <div class="form-grid inline ov-tools">
        <label>口径 <span class="tag ok-tag" id="ovBenchTag">绿=V2 生产 · 琥珀虚线=V2裸(无覆盖) · 灰点=基准(${benchEsc})</span></label>
        <label class="ov-bench">基准 symbol
          <input id="ovBench" list="ovBenchList" value="${benchEsc}" placeholder="QQQ" autocomplete="off" spellcheck="false">
          <datalist id="ovBenchList"></datalist>
        </label>
      </div>
      <canvas id="ovEquity"></canvas>
      <p class="dim">三线 = 同一裸 k30 基座的三条路径: <b>V2 生产</b>(裸 k30 × DD阶梯×IC 暴露, 2026-08-27 起生产, 周报/日报同源) · <b>V2裸</b>(去覆盖反解 net/exposure, 已核对与周报裸基线同源: MDD −51.2% / 终值 13.9) · <b>${benchEsc}</b>(Close 归一同起点)。<b>叠加回撤 = 每一条线各自的自身回撤</b>(各自净值相对自身历史峰值, 右轴%): 生产很浅(−10%), 裸很深(−51%), 基准居中——三条回撤不同源不同刻度, 别拿生产线的浅回撤当成裸的。裸更高 ≠ 更优: V2 用浅回撤换终值。基准可在上方输入框换成任意 panel 内 symbol(记忆上次选择)。</p>
    </div>
    <div class="card"><h3>模型有效性 IC 趋势(周检)</h3><canvas id="ovIc"></canvas></div>
  </div>
  <div class="grid two">`;

  const cc = data.champion_config || {};
  if (Object.keys(cc).length) {
    html += `<div class="card"><h3>冻结生产配置(FROZEN)</h3>
      <table class="kv"><tbody>
        <tr><td>选股分数</td><td>${esc(cc.score || "—")}</td></tr>
        <tr><td>持仓数</td><td>${esc(cc.top_k)}</td></tr>
        <tr><td>重平衡</td><td>${esc(cc.rebalance || "—")}</td></tr>
        <tr><td>ATR 止损</td><td>${cc.atr_mult == null ? "无(裸基座)" : esc(cc.atr_mult)}</td></tr>
        <tr><td>威科夫吸筹过滤</td><td>${esc(cc.wyckoff || "—")}</td></tr>
      </tbody></table>
      <ul class="note-list">${data.frozen_notes.map(n => `<li>⚠ ${esc(n)}</li>`).join("")}</ul></div>`;
  }

  if (data.degradation_alert) {
    const d = data.degradation_alert;
    html += `<div class="card warn"><h3>🔴 退化告警已触发</h3>
      <p>指标 <b>${esc(d.metric)}</b> 于 ${esc(d.triggered_at)} 触发,动作 <b>${esc(d.action)}</b>,
      PF=${fmt(d.pf, 2)} 胜率=${fmtP(d.win_rate, 0)} (n=${esc(d.n)})</p></div>`;
  } else {
    const md = data.model_death;
    html += `<div class="card"><h3>监控状态</h3>
      <p>${md ? `${esc(md.status || "—")}${md.health != null ? `(健康分 ${esc(md.health)})` : ""}${md.date ? ` · 标签成熟日 ${esc(md.date)}` : ""}` : "无退化告警,模型健康监控正常"}</p>
      <p class="dim">死亡测试口径: 滚动 20/40/60/120D IC 需 60 日标签实现窗 —— 「标签成熟日」= 最后可判分日(≈ 面板末 − 60 交易日), 不是数据滞后; 面板滞后看四灯新鲜度守卫。</p>
      <p class="dim">${(rm.sharpe != null)
        ? `生产 V2 冻结档案(当前口径 · as-if 全窗口): 净Sharpe ${fmt(rm.sharpe, 2)} · 累计 ${fmtPct(rm.total_return, 1)} · MDD ${fmtPct(rm.max_dd, 1)} · ${esc(rm.window || "")}`
        : ""}</p>
      <p class="dim">V1 历史档案(2026-08-27 切换前,已不监控): 净Sharpe 2.08 · 累计 +586% · MDD -29.2% —— 仅供对照,非生产口径。</p></div>`;
  }
  html += `</div>`;

  // OOS 面板数据末日 + 落后交易日(按面板模式: live=需新鲜, fixed/frozen=设计窗口)
  const pf = data.panel_freshness || {};
  if (pf.panels && pf.panels.length) {
    const pRows = pf.panels.map(pp => {
      let tag, tcls, note;
      if (pp.mode === "fixed") {
        tag = "固定窗口(设计)"; tcls = "ok-tag";
        note = `末日 ${esc(pp.last)} · 5 折研究 vintage 固定止于末折测试窗(2026-06-01),不追最新;折6 的 cat/tri 延展在 tri_panel.parquet`;
      }
      else if (pp.mode === "frozen") {
        tag = "冻结存档(设计)"; tcls = "ok-tag";
        note = `末日 ${esc(pp.last)} · 冻结线处,按 FROZEN 规则 2027-01-01 前只读不扩`;
      }
      else if (pp.behind == null || pp.behind <= 0) { tag = "✅ 新鲜"; tcls = "ok-tag"; note = `末日 ${esc(pp.last)} = 最新交易日`; }
      else { tag = `⚠ 落后 ${pp.behind} 交易日`; tcls = "err-tag"; note = `末日 ${esc(pp.last)} · 应到 ${esc(pf.latest_date || "最新")} —— 盘后链(2b1 步)在下一交易日自动延展(oos_fold_extend --append,预测冻结不重训);持续落后可手动补跑: .venv/bin/python src/oos_fold_extend.py --append`; }
      return `<tr><td><b>${esc(pp.name)}</b></td><td>${esc(pp.last || "—")}</td><td><span class="tag ${tcls}">${tag}</span></td><td class="dim">${esc(pp.desc)}</td><td class="dim">${note}</td></tr>`;
    }).join("");
    html += `<div class="card"><h3>OOS 面板数据末日<span class="tag warn-tag">冻结线 ${esc(pf.freeze_line || "—")}</span></h3>
      <div class="table-scroll"><table class="grid-tbl"><thead><tr><th>面板</th><th>数据末日</th><th>状态</th><th>性质</th><th>说明</th></tr></thead><tbody>${pRows}</tbody></table></div>
      <p class="dim">三面板各司其职:<b>oos_earnings</b>(live)= 生产信号面板,panel 出现新交易日即由盘后链自动延展(oos_fold_extend --append,预测冻结不重训),它是唯一需要新鲜的;<b>model_family_oos</b>(fixed)= 研究候选面板(cat/tri 等非生产模型),5 折测试窗固定止于 2026-06-01,末日 ≈05-29 属设计,折6 的 cat/tri 延展在 tri_panel.parquet;<b>oos_final</b>(frozen)= 冻结存档,FROZEN 规则 2027-01-01 前只读。冻结线 = fold6 分界 ${esc(pf.freeze_line || "—")}(模型训练从未见过的数据分界线);「落后」仅对 oos_earnings 有意义 = 末日与最新交易日(panel 末日 ${esc(pf.latest_date || "—")})之间的交易日数,盘后链 2b1 步自动延展。</p>
    </div>`;
  }

  // 验证证据链(折6 / 参数体检漂移 / 9起点矩阵 / 竞技场通过名单)
  const vc = data.validation_chain || {};
  if (vc.chains && vc.chains.length) {
    const vcLevel = { green: ["ok-tag", "✅"], amber: ["warn-tag", "⚠"], red: ["err-tag", "❌"] }[vc.level] || ["warn-tag", "⚠"];
    const vcRows = vc.chains.map(c => {
      const tag = c.ok ? `<span class="tag ok-tag">✅ 通过</span>` : (c.id === "param" ? `<span class="tag warn-tag">⚠ 漂移</span>` : `<span class="tag err-tag">未通过</span>`);
      let extra = "";
      if (c.id === "fold6" && c.rows && c.rows.length) {
        extra = `<div class="dim" style="margin-top:4px">${c.rows.map(r => `${esc(r.feat_set)} (${esc(r.date || "—")}): IC ${fmt(r.ic, 4)} · t ${fmt(r.t, 1)}${r.ok ? " ✅" : ""}`).join("<br>")}</div>`;
      }
      if (c.id === "arena" && c.passed_models && c.passed_models.length) {
        extra = `<div class="dim" style="margin-top:4px">通过名单: ${esc(c.passed_models.join(", "))}</div>`;
      }
      return `<tr><td><b>${esc(c.label)}</b><div class="dim">${esc(c.file || "")}</div></td>
        <td>${esc(c.date || "—")}</td><td>${tag}</td>
        <td class="dim">${esc(c.detail || "")}${extra}</td></tr>`;
    }).join("");
    html += `<div class="card"><h3>验证证据链<span class="tag ${vcLevel[0]}">${esc(vc.summary || "")}</span></h3>
      <div class="btn-row" style="margin:2px 0 8px">
        <button class="btn" onclick="exportValidationSnapshot('md')">导出快照 .md</button>
        <button class="btn" onclick="exportValidationSnapshot('html')">导出快照 .html</button>
      </div>
      <p class="${vc.level === "green" ? "ok" : vc.level === "amber" ? "warn" : "err-box"}">${vcLevel[1]} ${esc(vc.note || "")} —— 判定对象: 生产配置 ens(swing-33) · 冻结</p>
      <div class="table-scroll"><table class="grid-tbl"><thead><tr><th>验证链</th><th>数据日期</th><th>判定</th><th>明细</th></tr></thead><tbody>${vcRows}</tbody></table></div>
      <p class="dim">全部读本地文件,零计算: 折6(fold6_*_result.json, IC 显著性 t≥2 判过) · 参数体检(param_health.json, 双窗口最优点是否漂移) · 9起点(rolling_review.csv, base 基准 9 起点 Sharpe 是否全正) · 竞技场(model_arena.csv, 生产模型是否在双窗口通过名单)。参数体检漂移 = 最优点随窗口移动的敏感性警示,不直接等于模型失效;各链详情见对应页面卡片。</p>
    </div>`;
  }
  el.innerHTML = html;

  // 基准选择器: 填充 datalist + 切换时重取曲线(记忆选择)
  const dl = document.getElementById("ovBenchList");
  if (dl && Array.isArray(syms)) {
    for (const s of syms) {
      const o = document.createElement("option");
      o.value = s;
      dl.appendChild(o);
    }
  }
  attachBenchListeners();

  if (eq.available && eq.points.length) {
    window.OV_EQ = eq;
    ovDrawCurve();
  }
  if (ic.available && ic.points.length) {
    chart("ovIc", {
      type: "line",
      data: { labels: ic.points.map(p => p.date), datasets: [
        { label: "full IC", data: ic.points.map(p => p.ic_full), borderColor: "#38bdf8", pointRadius: 0, borderWidth: 1.5 },
        { label: "OOS IC", data: ic.points.map(p => p.ic_oos), borderColor: "#c084fc", pointRadius: 0, borderWidth: 1.5 },
      ]},
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: CHART_STYLE } },
        scales: { x: { grid: CHART_STYLE.grid, ticks: { color: "#8a94a8", maxTicksLimit: 8 } }, y: { grid: CHART_STYLE.grid, ticks: CHART_STYLE.ticks } } },
    });
  }
  pollSet("hdr", pollHeader, 4000);
}


/* 导出验证证据链快照(MD/HTML),数据来自 /api/overview/validation-snapshot(全本地文件) */
async function exportValidationSnapshot(fmt) {
  try {
    const r = await fetch(API_BASE + "/api/overview/validation-snapshot?format=" + fmt, { cache: "no-store", headers: (API_TOKEN && /^[A-Za-z0-9_\-]+$/.test(API_TOKEN)) ? { Authorization: "Bearer " + API_TOKEN } : {} });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const text = await r.text();
    const ext = fmt === "html" ? "html" : "md";
    const d = new Date();
    const pad = (x) => String(x).padStart(2, "0");
    const fname = `validation_snapshot_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.${ext}`;
    const blob = new Blob([text], { type: fmt === "html" ? "text/html;charset=utf-8" : "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast(`验证快照已导出: ${fname}`);
  } catch (e) {
    toast("导出失败: " + e.message, false);
  }
}


/* ── 00 总览净值曲线:口径选择 + 回撤叠加 ───────────────────────────── */
function ovSeries(key) {
  const pts = (window.OV_EQ && window.OV_EQ.points) || [];
  return pts.map(p => (p[key] != null ? p[key] : null));
}
function ovDrawCurve() {
  const pts = (window.OV_EQ && window.OV_EQ.points) || [];
  if (!pts.length) return;
  const benchSym = (window.OV_EQ && window.OV_EQ.bench_symbol) || "QQQ";
  const labels = pts.map(p => p.date);
  const nav = ovSeries("nav");
  const naked = ovSeries("naked");
  const bench = ovSeries("bench");
  const hasNaked = naked.some(v => v != null);
  const hasBench = bench.some(v => v != null);
  const ds = [
    { label: "V2 生产(DD×IC)", data: nav, borderColor: "#4ade80",
      backgroundColor: "rgba(74,222,128,0.06)", fill: true, pointRadius: 0, borderWidth: 1.8, yAxisID: "y" },
    { label: "V2裸(无覆盖)", data: hasNaked ? naked : null, borderColor: "#fbbf24",
      borderDash: [6, 4], fill: false, pointRadius: 0, borderWidth: 1.5, yAxisID: "y", hidden: !hasNaked },
    { label: `基准 ${benchSym}`, data: hasBench ? bench : null, borderColor: "#9aa4b2",
      borderDash: [2, 3], fill: false, pointRadius: 0, borderWidth: 1.2, yAxisID: "y", hidden: !hasBench },
  ];
  // 三条回撤各归各线(与对应净值线同色系): 生产实线 / 裸虚线 / 基准点线, 右轴 %
  // 负值线本身即"向下即回撤", 不再做面积填充(填充到 y=0 会把整图洗一层色)
  const dd = ovSeries("dd");
  const ddNaked = ovSeries("dd_naked");
  const ddBench = ovSeries("dd_bench");
  ds.push({ label: "回撤 V2 生产(右轴)",
    data: dd.map(v => (v == null ? null : v * 100)),
    borderColor: "#4ade80", borderDash: [], fill: false, pointRadius: 0, borderWidth: 1.1, yAxisID: "dd", tension: 0.15 });
  ds.push({ label: "回撤 V2裸(右轴)",
    data: ddNaked.map(v => (v == null ? null : v * 100)),
    borderColor: "#fbbf24", borderDash: [6, 4], fill: false, pointRadius: 0, borderWidth: 1.1, yAxisID: "dd", tension: 0.15 });
  ds.push({ label: `回撤 ${benchSym}(右轴)`,
    data: ddBench.map(v => (v == null ? null : v * 100)),
    borderColor: "#9aa4b2", borderDash: [2, 3], fill: false, pointRadius: 0, borderWidth: 1.1, yAxisID: "dd", tension: 0.15 });
  chart("ovEquity", { type: "line", data: { labels, datasets: ds },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      plugins: { legend: { labels: CHART_STYLE } },
      scales: {
        x: { grid: CHART_STYLE.grid, ticks: { color: "#8a94a8", maxTicksLimit: 10 } },
        y: { grid: CHART_STYLE.grid, ticks: CHART_STYLE.ticks },
        dd: { position: "right", grid: { drawOnChartArea: false }, beginAtZero: false,
          ticks: { color: "#8a94a8", callback: (v) => fmt(v, 0) + "%" } },
      } } });
}

/* ── 01 研究流水线(一键研究 + 训练/回测/自进化/特征 子区) ────────── */
const RS_ZONES = [
  ["train", "模型训练", "多管线训练 · 批量对比"],
  ["backtest", "策略回测", "资金曲线 · 绩效评估(含全景 OOS / 滚动复核)"],
  ["evolve", "模型自进化", "调度 · 重训 · 竞技场"],
  ["pipeline", "候选特征流水线", "挖掘 → 复核 → 竞技场"],
];
const RS_STEPS_QUICK = [["check", "模型自检"], ["feature", "特征筛查"], ["evolve", "自我进化"], ["bt", "回测"], ["suggest", "新方向建议"]];
const RS_STEPS_FULL = [["check", "模型自检"], ["mine", "特征挖掘"], ["feature", "特征复核"], ["phase0", "标签冗余度"], ["arena", "竞技场"], ["retrain", "重训"], ["bt", "回测"], ["suggest", "新方向建议"]];

async function renderResearch() {
  pollDrop("rs");
  const el = pageEl("research");
  el.innerHTML = `<div class="loading">加载研究流水线…</div>`;
  let st;
  try { st = await api("/api/research/status"); } catch (_) { st = { job: {}, state: {} }; }
  el.innerHTML = researchShell(st);
  loadResearchReport();
  const active = !!(st.job && st.job.active);
  if (active) {
    pollSet("rs", async () => {
      try {
        const r = await api("/api/research/status");
        const stepsEl = document.querySelector(".rs-steps");
        if (stepsEl) stepsEl.innerHTML = rsStepsHtml(r.state || {});
        const lc = document.getElementById("rsLog");
        if (lc) { lc.textContent = ((r.state || {}).log_tail || []).join("\n"); lc.scrollTop = lc.scrollHeight; }
        const box = document.getElementById("rsReport");
        if (box) renderResearchReport(box, r.state || {});
        if (!(r.job && r.job.active)) { renderResearch(); }
      } catch (_) {}
    }, 2500);
  } else {
    pollSet("hdr", pollHeader, 4000);
  }
}

function rsStepsHtml(state) {
  const cur = state.phase || "";
  const done = state.done || [];
  const steps = (state.mode === "full" ? RS_STEPS_FULL : RS_STEPS_QUICK);
  return steps.map(([k, label]) => {
    const cls = done.includes(k) ? "done" : (cur === k ? "active" : "");
    const icon = done.includes(k) ? "✓" : (cur === k ? "…" : "○");
    return `<div class="rs-step ${cls}"><i>${icon}</i><span>${label}</span></div>`;
  }).join("");
}

function researchShell(st) {
  const job = (st && st.job) || {};
  const state = (st && st.state) || {};
  const mode = (state.mode === "full") ? "full" : "quick";
  const prevDone = (state.done || []).length;
  const prevInterrupted = state.phase_label && !!(state.phase_label || "").startsWith("中断") && prevDone > 0;
  const stepsTag = mode === "full" ? "自检 → 挖掘 → 复核 → 竞技场 → 重训 → 回测 → 新方向" : "自检 → 特征 → 进化 → 回测 → 新方向";
  const hint = mode === "full"
    ? "顺序: ①模型自检(健康/死亡/衰减/参数体检) ②特征挖掘(auto_feature_mining 交互候选) ③特征全量复核(9 起点 + 打乱对照 + AGENTS 登记) ④标签冗余度地图(Phase 0, 正交训练前置) ⑤竞技场(model_arena 选股 + 止盈/止损/时点三角色,双窗口对决) ⑥重训(选股 IC 退化才重训;角色读竞技场胜出候选,护栏通过才切换) ⑦回测(Top30 · V2 · SPY 对照) ⑧聚合新方向建议。总耗时数小时,建议周末跑;日志实时滚动,各子环节完整详情在下方分区。"
    : "顺序: ①模型自检(健康/死亡/衰减/参数体检) ②特征筛查(待审候选 9 起点复核) ③自我进化(只读重训检查) ④回测(Top30 · V2 · SPY 对照) ⑤聚合新方向建议。总耗时约 3-10 分钟,日志实时滚动;重训/竞技场等训练类任务在下方分区手动跑,各子环节完整详情也在分区。";
  return `<div class="card"><h3>一键研究流水线<span class="tag ${mode === "full" ? "danger-tag" : "warn-tag"}">${stepsTag}</span></h3>
    ${busySection(job)}
    <div class="rs-steps">${rsStepsHtml(state)}</div>
    ${logConsole("rsLog")}
    <div class="btn-row">
      <button class="btn primary" onclick="startResearch('quick')">🚀 快速版</button>
      <button class="btn danger" onclick="startResearch('full')">🛠 全量版(挖掘·竞技场·重训)</button>
      ${prevInterrupted ? `<button class="btn" onclick="startResearch('full', { resume: true })">🔄 续跑(上次中断处)</button>` : ""}
      <button class="btn" onclick="stopResearch()">停止</button>
    </div>
    <div class="dim" style="margin:6px 0">跳过阶段(逗号分隔, 全量版用):
      <input id="rsSkip" value="" placeholder="如 arena,retrain" style="width:180px"/>
      <button class="btn" style="padding:2px 10px" onclick="startResearch('full', { skip: document.getElementById('rsSkip').value })">按跳过运行</button>
    </div>
    <p class="dim">${hint}</p></div>
    <div id="rsReport"></div>
    <div class="card"><h3>研究分区(内容与独立页一致,展开即用)</h3>
      <div class="rs-zones">${RS_ZONES.map(([name, title, sub]) =>
        `<details class="rs-zone" data-zone="${name}" ontoggle="researchZoneToggle('${name}')">
          <summary><b>${title}</b><span class="dim">${sub}</span></summary>
          <div class="rs-zone-body" id="rs-${name}"><div class="loading">展开后加载…</div></div></details>`).join("")}
      </div></div>`;
}

function researchZoneToggle(name) {
  document.querySelectorAll(".rs-zone").forEach(d => { if (d.dataset.zone !== name) d.open = false; });
  const el = document.getElementById("rs-" + name);
  if (!el || el.dataset.rendered) return;
  el.dataset.rendered = "1";
  PAGE_TARGET[name] = "rs-" + name;
  const fns = { train: renderTrain, backtest: renderBacktest, evolve: renderEvolve, pipeline: renderPipeline };
  (fns[name] || (() => {}))();
}

async function startResearch(mode, opts) {
  mode = mode || "quick";
  opts = opts || {};
  try {
    const r = await api("/api/research/start", { method: "POST", body: JSON.stringify({ mode, skip: opts.skip || "", resume: !!opts.resume }) });
    toast(opts.resume ? "已从上次中断处续跑" : (mode === "full" ? "全量版已启动(数小时,建议周末)" : "快速版已启动(约 3-10 分钟)"));
    renderResearch();
  }
  catch (e) { toast(e.message, false); }
}
async function stopResearch() {
  try { const r = await api("/api/research/stop", { method: "POST" }); toast(r.ok ? "已停止一键研究" : "无运行中任务"); renderResearch(); }
  catch (e) { toast(e.message, false); }
}
async function loadResearchReport() {
  try {
    const r = await api("/api/research/report");
    const box = document.getElementById("rsReport");
    if (!box || !r.available || !r.state) return;
    renderResearchReport(box, r.state);
  } catch (_) {}
}
function renderResearchReport(box, st) {
  let h = "";
  const sc = st.self_check || null;
  if (sc && Object.keys(sc).length) {
    h += `<div class="card"><h3>模型自检摘要</h3><table class="kv"><tbody>${
      Object.entries(sc).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</tbody></table></div>`;
  }
  const sugs = st.suggestions || [];
  h += `<div class="card"><h3>新方向建议(${sugs.length})<span class="tag">一键研究后自动聚合</span></h3>`
    + (sugs.length
      ? sugs.map(s => `<div class="sug ${esc(s.kind || "")}"><b>${esc(s.title)}</b><p>${esc(s.detail)}</p>${s.action ? `<span class="dim">→ ${esc(s.action)}</span>` : ""}</div>`).join("")
      : `<p class="dim">运行一键研究后,自动从竞技场新冠军 / 特征缺口 / 参数漂移 / 模型对比 / 拟合判定聚合方向建议。</p>`)
    + `</div>`;
  box.innerHTML = h;
}


/* ── 01 模型训练 ──────────────────────────────────────────────────── */
async function renderTrain() {
  pollDrop("train"); pollDrop("f6");
  const el = pageEl("train");
  el.innerHTML = `<div class="loading">加载训练状态…</div>`;
  let st, cfg, vst, bts;
  try { [st, cfg, vst, bts] = await Promise.all([api("/api/train/status"), api("/api/config"), api("/api/validate/status"), api("/api/train/batch/status")]); }
  catch (e) { el.innerHTML = `<div class="err-box">加载失败: ${esc(e.message)}</div>`; return; }
  const s = (cfg && cfg.settings) || {};

  const ds = st.dataset || {};
  const models = st.models || {};
  const prod = models.production || {};
  const active = st.status.active;
  const job = st.status.job || {};
  const mt = (st.model_types || {});
  const ict = st.ic_table || {};
  const cmp = st.compare || {};

  let html = `<div class="grid two">
    <div class="card"><h3>数据集</h3>${ds.available
      ? `<table class="kv"><tbody>
          <tr><td>文件</td><td>data/dataset.parquet</td></tr>
          <tr><td>样本</td><td>${fmtMoney(ds.rows)} 行 · ${ds.symbols} 只</td></tr>
          <tr><td>日期</td><td>${esc(ds.date_min)} → ${esc(ds.date_max)}</td></tr>
          <tr><td>更新</td><td>${esc(ds.mtime || "—")}</td></tr></tbody></table>`
      : `<p class="warn">${esc(ds.message || "数据集缺失")}</p>`}
      <p class="dim">训练前建议先重建数据集(signal_archive --rebuild-dataset)以吸收最新行情。</p></div>

    <div class="card"><h3>生产模型家族(只读 · 冻结)</h3>
      <table class="grid-tbl"><thead><tr><th>用途</th><th>家族</th><th>特征集</th><th>特征数</th><th>训练区间</th><th>IC(60D)</th><th>ICIR</th><th>t</th></tr></thead><tbody>`;
  const fams = prod.families || [];
  if (!fams.length) html += `<tr><td colspan="8" class="dim">生产模型缺失(models/)</td></tr>`;
  for (const f of fams) {
    const ic = f.ic;
    const icv = (k, d) => (ic && ic[k] != null ? fmt(ic[k], d) : "—");
    const icAlt = (k, d) => (ic && ic.alt && ic.alt[k] != null ? " / " + fmt(ic.alt[k], d) : "");
    html += `<tr><td>${esc(f.purpose)}</td><td>${esc(f.family)}</td><td>${esc(f.feat_set || "—")}</td><td>${esc(f.n_features ?? "—")}</td>
      <td>${esc(String(f.date_min || "").slice(0, 10))} → ${esc(String(f.date_max || "").slice(0, 10))}</td>
      <td title="${ic ? esc(ic.signal + (ic.alt ? " / " + ic.alt.signal : "")) : "未收录于 ic_report.csv"}"><b>${ic ? icv("ic", 4) + icAlt("ic", 4) : "—"}</b></td>
      <td>${ic ? icv("icir", 2) + icAlt("icir", 2) : "—"}</td>
      <td>${ic ? icv("t", 1) + icAlt("t", 1) : "—"}</td></tr>`;
  }
  html += `</tbody></table>
      <p class="dim">IC = 60D 面板 rank-IC(源 output/ic_report.csv,研究/周检口径;时点家族显示 高/低 双值)。跨用途不可横向比较(标签不同:选股=fwd_ret_60,止盈=fwd_high_60,止损=fwd_low_60,时点=fwd_days_to_*);LGB 高低点未收录于 ic_report,其 IC 见训练日志。选股家族为集成信号 ens_60,子模型 IC 见下方「全模型 IC 一览」。</p>
      ${prod.config ? `<p class="dim">主模型集成: ${esc(prod.config.ensemble || "—")} · LGBM: ${esc((prod.config.lgbm_models || []).join(", ") || "无")} · 文件: ${esc((prod.files || []).join(", "))}</p>` : ""}
      <ul class="note-list">${(st.frozen_notes || []).map(n => `<li>⚠ ${esc(n)}</li>`).join("")}</ul></div>
  </div>`;

  const mtOpts = Object.entries(mt).map(([key, spec]) =>
    `<option value="${key}">${esc(spec.label)}</option>`).join("");
  html += `<div class="card"><h3>训练(输出到实验目录 models_experiment/,不触碰生产)</h3>
    ${busySection(st.status)}
    <div class="form-grid">
      <label>模型类型 <select id="trModelType" onchange="onModelTypeChange()">${mtOpts || `<option value="main">主模型 MLP+LGBM</option>`}</select></label>
      <label>特征集 <select id="trFeat">
        <option value="swing">swing · 33特征(生产冠军)</option>
        <option value="base">base · 26特征</option>
        <option value="knife">knife · 32特征(接飞刀)</option>
        <option value="ar">ar · 27特征</option></select></label>
      <label>Epochs <input id="trEpochs" type="number" value="40" min="1" max="200"></label>
      <label>训练窗口 <select id="trWindow">
        <option value="expanding">expanding · 全历史</option>
        <option value="sliding-730">sliding-730 · 最近2年(日历日)</option>
        <option value="sliding-500d">sliding-500d · 最近500交易日</option></select></label>
      <label>留出测试集(月) <input id="trHoldout" type="number" min="0" max="36" value="0" title="把窗口末尾 N 个月作为真测试集: 训练时完全不可见,训练后自动评估并写入 holdout_report.json(逐日 IC/t + Top30 Sharpe)。0=不启用(全量训练)。"></label>
      <label>输出目录标签 <input id="trTag" placeholder="留空自动生成"></label>
      <label class="chk"><input id="trRebuild" type="checkbox"> 先重建数据集(吸收最新行情)</label>
      <label class="chk" id="trReviewedLbl"><input id="trReviewed" type="checkbox"> 叠加该角色已复核特征(--add-cols: 挖到新特征→训练该标签集)</label>
    </div>
    <p class="dim" id="trHint"></p>
    <div class="btn-row">
      <button class="btn primary" onclick="startTrain()">开始训练</button>
      <button class="btn danger" onclick="stopTrain()">停止</button>
    </div>
    ${logConsole("trainLog")}
  </div>`;

  // 批量训练对比卡(多组合排队,完成后按折6 Sharpe 排序)
  html += batchTrainCard(s, mt);

  // 全模型 IC 表(选股/止盈/止损/时点,来自 ic_report.csv)
  html += `<div class="card"><h3>全模型 IC 一览(ic_report.csv · ${esc(ict.mtime || "—")})</h3>`;
  if (ict.available && ict.rows && ict.rows.length) {
    html += `<table class="grid-tbl"><thead><tr><th>用途</th><th>信号</th><th>标签</th><th>IC</th><th>ICIR</th><th>t</th><th>备注</th></tr></thead><tbody>`;
    for (const r of ict.rows) {
      html += `<tr><td>${esc(r.purpose)}</td><td><b>${esc(r.signal)}</b></td><td>${esc(r.label)}</td>
        <td>${fmt(r.ic, 4)}</td><td>${fmt(r.icir, 2)}</td><td>${fmt(r.t, 1)}</td><td class="dim">${esc(r.note || "")}</td></tr>`;
    }
    html += `</tbody></table>`;
  } else {
    html += `<p class="warn">${esc(ict.message || "暂无 IC 数据")}</p>`;
  }
  html += `</div>`;

  // 9 变体统一对比(mlp_variant_comparison.json)
  html += `<div class="card"><h3>9 变体统一对比(mlp_variant_comparison · ${esc(cmp.mtime || "—")})</h3>`;
  if (cmp.available && cmp.rows && cmp.rows.length) {
    html += `<table class="grid-tbl"><thead><tr><th>模型</th><th>Sharpe</th><th>MaxDD</th><th>CAGR</th><th>Calmar</th><th>胜率</th><th>PF</th><th>交易数</th></tr></thead><tbody>`;
    for (const r of cmp.rows) {
      html += `<tr><td><b>${esc(r.model)}</b></td><td>${fmt(r.sharpe, 3)}</td><td>${fmt(r.max_dd_pct, 1)}%</td>
        <td>${fmt(r.cagr_pct, 1)}%</td><td>${fmt(r.calmar, 2)}</td><td>${fmt(r.win_rate, 1)}%</td>
        <td>${fmt(r.pf, 2)}</td><td>${esc(r.trades ?? "—")}</td></tr>`;
    }
    html += `</tbody></table><p class="dim">统一净值口径: Top30 + Hybrid B + VT15 + DD8(hold_management_unified)。</p>`;
  } else {
    html += `<p class="warn">${esc(cmp.message || "尚未运行对比任务(选「9 变体统一对比」训练类型)")}</p>`;
  }
  html += `</div>`;

  // 实验模型 + 部署
  html += `<div class="card"><h3>实验模型(models_experiment/)</h3>
    <table class="grid-tbl"><thead><tr><th>标签</th><th>特征集</th><th>特征数</th><th>训练区间</th><th>留出测试 IC(60d)</th><th>留出测试 Sharpe</th><th>文件</th><th>操作</th></tr></thead><tbody>`;
  const exps = models.experiments || [];
  if (!exps.length) html += `<tr><td colspan="8" class="dim">暂无实验模型</td></tr>`;
  for (const e of exps) {
    const c = e.config || {};
    const ho = (e.holdout && e.holdout.horizons && e.holdout.horizons["60"]) || null;
    const hoRange = e.holdout && e.holdout.test_range ? ` (${esc(e.holdout.test_range.join(" → "))})` : "";
    html += `<tr><td><b>${esc(e.tag)}</b></td><td>${esc(c.feat_set || "—")}</td><td>${esc(c.n_features ?? "—")}</td>
      <td>${esc(c.date_min || "—")} → ${esc(c.date_max || "—")}</td>
      <td title="留出测试集${hoRange}">${ho ? `<b>${fmt(ho.ic, 4)}</b><span class="dim"> (t ${fmt(ho.ic_t, 1)})</span>` : "—"}</td>
      <td>${ho ? `<b>${fmt(ho.sharpe, 2)}</b>` : "—"}</td>
      <td>${esc(e.files.map(f => f.name).join(", "))}</td>
      <td><button class="btn small" onclick="deployExp('${esc(e.tag)}')">部署到生产</button></td></tr>`;
  }
  html += `</tbody></table>
    <p class="dim">留出测试 = 训练窗口末尾 N 个月(训练不可见)的 ens_60 逐日秩相关 IC 与 Top30 标签均值年化 Sharpe(信号代理,非真实回测)。部署会先备份 models/ 到 models_backup_web_&lt;时间&gt;/,且需二次确认(违反冻结规则)。</p></div>`;

  // 6折样本外 + OOS 冻结卡片
  html += validateSection(vst);
  html += paramHealthSection(vst);

  el.innerHTML = html;
  renderBatchBox(bts, mt);
  document.getElementById("trModelType").value = s.train_model_type || "main";
  document.getElementById("trFeat").value = s.train_feat_set || "swing";
  document.getElementById("trEpochs").value = s.train_epochs || 40;
  document.getElementById("trWindow").value = s.train_window || "expanding";
  document.getElementById("trHoldout").value = s.train_holdout || 0;
  document.getElementById("trRebuild").checked = !!s.train_rebuild;
  const trv = document.getElementById("trReviewed");
  if (trv) trv.checked = !!s.train_reviewed;
  onModelTypeChange();
  pollLog("trainLog", "/api/train/log", active);
  const f6Active = (vst.fold6 && vst.fold6.status && vst.fold6.status.active);
  if (active) pollSet("train", () => { renderTrain(); }, 3000);
  else if (f6Active) pollSet("f6", () => { renderTrain(); }, 4000);
  else pollSet("hdr", pollHeader, 4000);
}

function onModelTypeChange() {
  const sel = document.getElementById("trModelType");
  const hint = document.getElementById("trHint");
  const feat = document.getElementById("trFeat");
  const epochs = document.getElementById("trEpochs");
  const win = document.getElementById("trWindow");
  if (!sel) return;
  const t = sel.value;
  const HINTS = {
    main: "主模型: MLP + LightGBM 逐日秩平均集成(生产同构),输出 config.json + model.pt + lgb_*.txt。",
    mlp: "纯 MLP: 跳过 LightGBM,仅 MLP 排名模型,训练更快。",
    high: "止盈模型: 预测 fwd_high_20/40/60(波段顶部目标价),输出 high_model.pt,信号页用作止盈参考。",
    low: "止损模型: 预测 fwd_low_20/40/60(下行风险),输出 low_model.pt,信号页用作止损参考。",
    lgb_hl: "LGB 高/低点: 训练 lgb_high/lgb_low,特征集仅支持 base/swing,输出 lgb_high_low_config.json。",
    timing: "择时模型: 预测 p_days_to_high/low(波段时点),输出 time_model.pt,信号页用作时点信号。",
    compare: "9 变体对比: 训练 7 个 MLP 变体 + LGB predict 模式,统一净值(Top30+HybridB+VT15+DD8)对比,结果写入 output/mlp_variant_comparison.json。",
    multitask: "多任务联合: 共享 trunk + 每任务组独立头,同时学选股 fwd_ret + 止盈 fwd_high + 止损 fwd_low + 时点 days_to_*(train_multitask.py);可先用「标签冗余度地图(Phase 0)」剔除冗余头。",
  };
  hint.textContent = HINTS[t] || "";
  const showFeat = t !== "timing" && t !== "compare";
  const showEpochs = t !== "lgb_hl" && t !== "compare";
  const showWin = t === "main" || t === "mlp";
  const showReviewed = t !== "lgb_hl" && t !== "compare";
  feat.closest("label").style.display = showFeat ? "" : "none";
  epochs.closest("label").style.display = showEpochs ? "" : "none";
  win.closest("label").style.display = showWin ? "" : "none";
  const hol = document.getElementById("trHoldout");
  if (hol) hol.closest("label").style.display = showWin ? "" : "none";
  const rl = document.getElementById("trReviewedLbl");
  if (rl) rl.style.display = showReviewed ? "" : "none";
}
async function startTrain() {
  try {
    const r = await api("/api/train/start", { method: "POST", body: JSON.stringify({
      model_type: $("#trModelType").value,
      feat_set: $("#trFeat").value, epochs: parseInt($("#trEpochs").value, 10) || 40,
      train_window: $("#trWindow").value,
      holdout_months: parseInt($("#trHoldout").value, 10) || 0,
      rebuild_dataset: $("#trRebuild").checked, out_tag: $("#trTag").value,
      reviewed: $("#trReviewed") ? $("#trReviewed").checked : false }) });
    toast(`训练已启动: ${r.model_label || r.feat_label} → ${r.out_dir}`);
    renderTrain();
  } catch (e) { toast(e.message, false); }
}
async function stopTrain() {
  try { const r = await api("/api/train/stop", { method: "POST" }); toast(r.ok ? "已请求停止训练" : "无运行中任务"); renderTrain(); }
  catch (e) { toast(e.message, false); }
}
async function deployExp(tag) {
  if (!confirm(`将实验模型「${tag}」部署到生产 models/?(生产处于冻结期,此操作违反 FROZEN_CHAMPION_V1 默认规则)\n\n再次确认请点确定。`)) return;
  try {
    const r = await api("/api/train/deploy", { method: "POST", body: JSON.stringify({ tag, confirm: true }) });
    toast(r.ok ? `已部署(备份: ${r.backup})` : r.message, r.ok);
    renderTrain();
  } catch (e) { toast(e.message, false); }
}

/* ── 02 策略回测 ──────────────────────────────────────────────────── */
async function renderBacktest() {
  pollDrop("bt"); pollDrop("rolling"); pollDrop("pano");
  const el = pageEl("backtest");
  el.innerHTML = `<div class="loading">加载回测状态…</div>`;
  let st, def, panoSt, panoRep, vst;
  try { [st, def, panoSt, panoRep, vst] = await Promise.all([api("/api/backtest/status"), api("/api/backtest/defaults"), api("/api/backtest/panorama/status"), api("/api/backtest/panorama/report"), api("/api/validate/status")]); }
  catch (e) { el.innerHTML = `<div class="err-box">加载失败: ${esc(e.message)}</div>`; return; }

  const active = st.status.active;
  const panoActive = panoSt.status.active;
  const atrSel = ["", "1.5", "2.0", "3.0"].map(v =>
    `<option value="${v}" ${String(def.atr_mult) === String(v) ? "selected" : ""}>${v ? v + " × ATR" : "无个股止损(生产裸基座)"}</option>`).join("");

  let html = `<div class="card"><h3>回测参数(引擎 = champion_stop.simulate · ens_60;成本固定 20bps/边)
    <span class="tag warn-tag">非冻结实验参数</span></h3>
    ${busySection(st.status)}
    <div class="form-grid">
      <label>Top-K <input id="btK" type="number" value="${def.k}" min="5" max="200"></label>
      <label>ATR 止损倍数 <select id="btAtr">${atrSel}</select></label>
      <label>净值 DD 门控(如 0.08) <input id="btDd" placeholder="留空=无" value="${esc(def.dd_thresh)}"></label>
      <label>波动率目标(如 0.15) <input id="btVt" placeholder="留空=无" value="${esc(def.vt_target)}"></label>
      <label>Rank 退出阈值(如 75) <input id="btRank" placeholder="留空=无" value="${esc(def.rank_exit || "")}"></label>
      <label>起始日期(样本外窗口) <input id="btSince" type="date" value="${esc(def.since || "")}"></label>
      <label>Benchmark(对照,如 SPY) <input id="btBench" placeholder="留空=无" value="${esc(def.benchmark || "")}"></label>
      <label class="chk"><input id="btV2" type="checkbox" ${def.v2 ? "checked" : ""}> 叠加 V2 风控(DD阶梯×IC)</label>
      <label>V2 恢复模式 <select id="btV2Recover">
        <option value="prod" ${def.v2_recover !== "fast" ? "selected" : ""}>生产(0日立即恢复)</option>
        <option value="fast" ${def.v2_recover === "fast" ? "selected" : ""}>立即恢复(0日无防抖)</option>
      </select></label>
    </div>
    <div class="btn-row">
      <button class="btn primary" onclick="startBacktest()">运行回测</button>
      <button class="btn" onclick="runSweep()">参数体检(topK/DD 敏感性)</button>
      <button class="btn danger" onclick="stopBacktest()">停止</button>
    </div>
    <div class="form-grid inline">
      <label>体检 topK 列表 <input id="btSweepK" value="20,30,50,100" placeholder="20,30,50"></label>
      <label>体检 DD 列表 <input id="btSweepDd" value="" placeholder="如 0.05,0.08,0.12"></label>
    </div>
    ${logConsole("btLog")}
  </div>
  <div id="btResult"><div class="loading">尚未运行回测;运行完成后此处展示绩效与资金曲线。</div></div>`;

  html += panoramaSection(panoSt, panoRep);
  html += `<div id="panoResult"></div>`;  // 全景对比表 + 资金曲线紧贴全景卡, 在 9 起点复核之上
  html += rollingSection(vst);
  html += `<div id="rollingMatrix"></div>`;
  html += `<div id="rollingResult"></div>`;

  el.innerHTML = html;
  pollLog("btLog", "/api/backtest/status", false); // 专用:见下
  if (active) {
    pollSet("bt", async () => {
      try {
        const r = await api("/api/backtest/status");
        const lc = document.getElementById("btLog");
        if (lc) { lc.textContent = r.log_tail.join("\n"); lc.scrollTop = lc.scrollHeight; }
        if (!r.status.active) { renderBacktest(); }
      } catch (_) {}
    }, 2000);
    if (st.status.job && st.status.job.label.includes("体检")) {
      renderSweepPending();
    }
  } else {
    pollSet("hdr", pollHeader, 4000);
    loadBtReport();
  }
  const rollingActive = (vst.rolling && vst.rolling.status && vst.rolling.status.active);
  if (rollingActive) {
    pollSet("rolling", async () => {
      try {
        const r = await api("/api/validate/status");
        const lc = document.getElementById("rollingLog");
        if (lc) { lc.textContent = (r.rolling.log_tail || []).join("\n"); lc.scrollTop = lc.scrollHeight; }
        if (!(r.rolling && r.rolling.status && r.rolling.status.active)) { renderBacktest(); }
      } catch (_) {}
    }, 2000);
  } else {
    renderRollingTable(vst);
    renderRollingMatrix(vst);
  }
  if (panoActive) {
    pollSet("pano", async () => {
      try {
        const r = await api("/api/backtest/panorama/status");
        const lc = document.getElementById("panoLog");
        if (lc) { lc.textContent = r.log_tail.join("\n"); lc.scrollTop = lc.scrollHeight; }
        if (!r.status.active) { renderBacktest(); }
      } catch (_) {}
    }, 2000);
  } else {
    loadPanoReport();
  }
}

function panoramaSection(panoSt, panoRep) {
  const st = panoSt.status || {};
  const busy = st.active ? `<div class="busy-bar"><i class="spin"></i> 全景 OOS 运行中(引擎注册表 × 双窗口,约 1-4 分钟)</div>` : "";
  return `<div class="card"><h3>全景 OOS 统一验证(引擎注册表 × 双窗口)<span class="tag warn-tag">统一口径</span></h3>
    ${busy}
    <div class="form-grid inline">
      <label>Top-K <input id="panoK" type="number" value="${st.job ? (st.job.label.match(/Top(\d+)/) || [0, 30])[1] : 30}" min="5" max="200"></label>
      <label>ATR 倍数 <input id="panoAtr" placeholder="留空=生产裸基座" value=""></label>
      <label>DD 门控 <input id="panoDd" placeholder="留空=无门控" value=""></label>
      <label>折6窗口月数 <input id="panoMonths" type="number" value="6" min="3" max="12"></label>
      <label>参考折6 Sharpe <input id="panoRef" placeholder="留空=ATR 绝对阈值" value=""></label>
      <label>Benchmark <input id="panoBench" placeholder="如 SPY(买入持有对照)" value=""></label>
      <label class="chk"><input id="panoV2" type="checkbox" title="追加 V2 生产风控引擎(DD阶梯×IC): 生成 champion_stop+V2 / canonical+V2 独立条目,与裸引擎并排对比"> 追加 V2 生产风控引擎(DD阶梯×IC)</label>
      <label>V2 恢复模式 <select id="panoV2Recover">
        <option value="prod">生产(现0日立即恢复)</option>
        <option value="prod,fast">生产 + 立即恢复(0日)对照</option>
        <option value="prod,0,2,5,10">恢复天数扫描(0/2/5/10)</option>
        <option value="fast">仅立即恢复(0日)</option>
      </select><span class="dim" style="font-size:11px">DD 回撤恢复确认天数,每项生成一独立 V2 引擎行并排对比</span></label>
    </div>
    <div class="btn-row">
      <button class="btn primary" onclick="startPanorama()">运行全景 OOS</button>
      <button class="btn danger" onclick="stopPanorama()">停止</button>
    </div>
    <p class="dim">引擎注册表: 裸引擎(champion_stop 生产信号 / canonical 生产权威 / unified_nav 实验口径)在相同数据、相同 OOS 冻结起点(预测表末日−N月)上并排;勾选 V2 追加 DD阶梯×IC 生产风控变体,填 Benchmark 追加买入持有对照。每引擎跑全窗口 + 折6样本外,ratio>1.4 判疑似拟合。unified 已截断到预测表末日,三引擎窗口完全一致。</p>
    ${panoramaDiffPanel()}
    ${logConsole("panoLog")}
  </div>`;
}


function panoramaDiffPanel() {
  const R = (dim, a, b, c, d) => `<tr><td class="dim"><b>${dim}</b></td><td>${a}</td><td>${b}</td><td>${c}</td><td>${d}</td></tr>`;
  return `<details class="cmp"><summary>为什么引擎的数字不同?口径逐项对照(引擎集合由注册表构建,可增删)</summary>
    <div class="table-scroll"><table class="grid-tbl cmp-tbl"><thead><tr><th>维度</th><th>champion_stop</th><th>canonical</th><th>unified_nav</th><th>V2 变体 / benchmark</th></tr></thead><tbody>
      ${R("职责", "生产信号引擎(逐日模拟)", "生产权威 NAV 引擎(冻结判定)", "实验口径(退出/门控研究)", "V2=裸引擎×生产暴露;benchmark=买入持有对照")}
      ${R("数据装配", "cs.load()(OOS 面板 + panel + atr)", "同 champion,同一份 m_full 输入", "une.load_data() 但<B>已截断到预测表末日</B>,窗口与①②一致", "与裸引擎同源;benchmark 取 panel 单标的 Close")}
      ${R("成本", "0.2%/边(COST 常量)", "20 bps/边", "引擎自带成本配置", "V2 继承裸引擎;benchmark 0 成本")}
      ${R("成交时点", "信号次日收盘成交(保守)", "信号当日收盘成交(FILL_AT_CLOSE,与实盘一致)", "引擎自有成交逻辑", "V2 继承裸引擎")}
      ${R("个股止损", "ATR×atr_mult;默认 null → 无", "ATR_MULT=0 → 无", "exit_baseline 含 ATR 止损", "V2 继承裸引擎")}
      ${R("净值 DD 门控", "dd 参数: 无门控 / DD8 / 自定义(生产由 V2 覆盖)", "同 champion(dd 透传 DD8)", "use_dd8=True → DD8 降半门控", "V2=DD阶梯×IC 复合暴露(risk_control_v2)")}
      ${R("调仓节奏", "60 交易日整仓换 + 退出不补位", "REBAL=60 整仓轮换", "60 日再平衡 + 逐日退出", "—")}
      ${R("范围过滤", "exclude_leveraged + exclude_crypto", "未做该类过滤", "未做该类过滤", "benchmark 单标的无过滤")}
    </tbody></table></div>
    <p class="dim"><b>一句话结论:</b>数字差异来源 = 成交时点(champion 次日 vs canonical 当日)、个股止损(unified 有 ATR 止损)、DD 门控(unified 默认开 DD8)与范围过滤。V2 变体与对应裸引擎的差 = 纯生产风控(DD阶梯×IC)贡献;benchmark 与策略的差 = alpha 含量。</p>
  </details>`;
}

async function startPanorama() {
  try {
    const r = await api("/api/backtest/panorama/start", { method: "POST", body: JSON.stringify({
      k: parseInt($("#panoK").value, 10) || 30,
      atr_mult: $("#panoAtr").value || null,
      dd_thresh: $("#panoDd").value || null,
      months: parseInt($("#panoMonths").value, 10) || 6,
      ref_oos_sharpe: $("#panoRef").value || null,
      v2: $("#panoV2") ? $("#panoV2").checked : false,
      v2_recover: $("#panoV2Recover") ? $("#panoV2Recover").value : "prod",
      benchmark: $("#panoBench") ? ($("#panoBench").value || "").trim() : "" }) });
    toast(`全景 OOS 已启动(Top${r.k} × ${r.n_engines}引擎)`);
    renderBacktest();
  } catch (e) { toast(e.message, false); }
}
async function stopPanorama() {
  try { const r = await api("/api/backtest/panorama/stop", { method: "POST" }); toast(r.ok ? "已停止全景 OOS" : "无运行中全景任务"); renderBacktest(); }
  catch (e) { toast(e.message, false); }
}

async function loadPanoReport() {
  try {
    const r = await api("/api/backtest/panorama/report");
    const box = document.getElementById("panoResult");
    if (!box || !r.available || !r.report || !r.report.panorama) return;
    const rep = r.report;
    const p = rep.params || {};
    const anyV2 = (rep.engines || []).some(e => e.v2);
    const v2RecoverTxt = (p.v2 && p.v2_recover && String(p.v2_recover) !== "prod")
      ? ` · V2 恢复模式: ${esc(p.v2_recover)}` : (p.v2 ? " · 叠加 V2 风控" : "");
    let html = `<div class="card"><h3>全景对比(${esc(p.full_start)} → ${esc(p.full_end)} · 折6起点 ${esc(p.oos_cut)} · ${esc(p.oos_days)} 天${v2RecoverTxt})</h3>
      <table class="grid-tbl"><thead><tr><th>引擎</th><th>全窗 Sharpe</th><th>全窗 MDD</th><th>全窗累计</th><th>折6 Sharpe</th><th>折6 MDD</th><th>折6累计</th>${anyV2 ? `<th>V2 暴露(均/末)</th>` : ""}<th>ratio</th><th>判定</th></tr></thead><tbody>`;
    for (const e of rep.engines || []) {
      const verdictCls = e.fitted ? "red" : "green";
      html += `<tr><td><b>${esc(e.label)}</b></td>
        <td>${fmt(e.full.sharpe, 2)}</td><td>${fmtPct(e.full.mdd)}</td><td>${fmtPct(e.full.cum, 0)}</td>
        <td>${fmt(e.oos.sharpe, 2)}</td><td>${fmtPct(e.oos.mdd)}</td><td>${fmtPct(e.oos.cum, 0)}</td>
        ${anyV2 ? `<td>${e.v2 ? fmtP(e.v2.mean_exposure, 0) + " / " + fmtP(e.v2.last_exposure, 0) + (e.v2.ic_fallback ? " ⚠IC回退" : "") : (e.benchmark ? `<span class="dim">对照</span>` : `<span class="dim">—</span>`)}</td>` : ""}
        <td>${fmt(e.ratio, 2)}</td><td class="${verdictCls}">${esc(e.verdict)}</td></tr>`;
    }
    html += `</tbody></table>
      <p class="dim">判定规则(dual_validate): 全窗口Sharpe / 折6Sharpe > 1.4 → 疑似拟合;引擎间差异来自成本模型/退出规则/门控实现,并排对照可定位口径偏差。${p.v2 ? `V2 引擎 = 裸引擎日收益 × DD阶梯×IC 复合暴露(risk_control_v2,与单回测 --v2 同源),与裸引擎并排展示;${p.v2_recover && String(p.v2_recover) !== "prod" ? `本次恢复模式对照(${esc(p.v2_recover)}): 防抖越长恢复越慢, 0日=立即恢复 —— 并排行差 = 恢复滞后成本。` : "生产恢复防抖(现=0日)。"}unified 自带 DD8 门控,无 V2 变体。` : ""}${p.benchmark ? ` benchmark:${esc(p.benchmark)} = 买入持有(0成本),不参与拟合判定。` : ""}</p></div>`;
    if ((rep.engines || []).length && (rep.engines || [])[0].full) {
      html += `<div class="card"><h3>资金曲线 · 全窗口(起点归 1)</h3>
        <p class="dim" style="margin:0">${esc(p.full_start || "")} → ${esc(p.full_end || "")}(${esc((rep.engines || [])[0].full.n_days || "")} 天);同图叠加所有引擎。</p>
        <canvas id="panoEquityFull"></canvas></div>`;
      html += `<div class="card"><h3>资金曲线 · 折6 OOS 窗口(起点归 1 · 放大)</h3>
        <p class="dim" style="margin:0">折6起点 ${esc(p.oos_cut || "")} 之后(${esc(p.oos_days || "")} 天),单独成图看清样本外斜率与形态。</p>
        <canvas id="panoEquityOos"></canvas></div>`;
    }
    box.innerHTML = html;
    const cv = rep.curves || {};
    const keys = Object.keys(cv);
    const palette = ["#4ade80", "#fbbf24", "#60a5fa", "#f472b6", "#a78bfa", "#34d399", "#f87171", "#22d3ee", "#94a3b8"];
    const colorOf = {}; let ci = 0;
    const colorFor = base => {
      if (!(base in colorOf)) colorOf[base] = palette[ci++ % palette.length];
      return colorOf[base];
    };
    const alignTo = (dates, arr) => {
      const idxOf = {}; dates.forEach((d, i) => { idxOf[d] = i; });
      const out = new Array(dates.length).fill(null); arr.forEach(p => { if (p.date in idxOf) out[idxOf[p.date]] = p.eq; }); return out;
    };
    const draw = (canvasId, keyFilter, labelSuffix) => {
      const ks = keys.filter(k => keyFilter(k));
      if (!ks.length) return;
      const allDates = [...new Set(ks.flatMap(k => cv[k].map(p => p.date)))].sort();
      const ds = ks.map(k => {
        const base = k.replace(/_oos$/, "");
        return { label: base + labelSuffix, data: alignTo(allDates, cv[k]),
          borderColor: colorFor(base), pointRadius: 0, borderWidth: 1.5, spanGaps: false };
      });
      chart(canvasId, { type: "line", data: { labels: allDates, datasets: ds },
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
          plugins: { legend: { labels: CHART_STYLE } },
          scales: { x: { grid: CHART_STYLE.grid, ticks: { color: "#8a94a8", maxTicksLimit: 10 } }, y: { grid: CHART_STYLE.grid, ticks: CHART_STYLE.ticks } } } });
    };
    // 拆双图: 全窗口 = 非 _oos 曲线;OOS = 仅 _oos 曲线(单独放大)
    draw("panoEquityFull", k => !k.endsWith("_oos"), "");
    draw("panoEquityOos", k => k.endsWith("_oos"), " · OOS");
  } catch (_) {}
}

function renderSweepPending() {
  const r = document.getElementById("btResult");
  if (r) r.innerHTML = `<div class="card"><div class="busy-bar"><i class="spin"></i> 参数体检运行中,完成后自动刷新</div></div>`;
}

async function loadBtReport() {
  try {
    const r = await api("/api/backtest/report");
    const box = document.getElementById("btResult");
    if (!box || !r.available || !r.report) return;
    const rep = r.report;
    if (rep.sweep) { BT_REPORT = null; renderSweep(rep); return; }
    BT_REPORT = rep;
    const m = rep.metrics || {};
    const v2m = rep.metrics_v2 || {};
    const hasV2 = v2m.sharpe != null;
    const bm = rep.benchmark || null;
    const bmSym = bm ? String(bm.symbol || "").toUpperCase() : "";
    const cmpCols = [["sharpe", "Sharpe"], ["sortino", "Sortino"], ["cum", "累计收益"],
      ["mdd", "最大回撤"], ["profit_factor", "盈亏比 PF"], ["win_rate", "日胜率"]];
    const cell = (row, k) => {
      const v = row ? row[k] : null;
      if (v == null) return `<span class="dim">—</span>`;
      if (k === "sharpe" || k === "sortino") return fmt(v, 2);
      if (k === "mdd") return fmtPct(v);
      if (k === "cum") return fmtPct(v, 0);
      if (k === "profit_factor") return fmt(v, 2);
      return fmtP(v, 0);
    };
    const cmpRow = (label, sub, row, strong) => `<tr><td><b>${label}</b>${sub ? `<div class="dim" style="font-weight:normal;font-size:11px">${sub}</div>` : ""}</td>${
      cmpCols.map(([k]) => `<td>${strong ? `<b>${cell(row, k)}</b>` : cell(row, k)}</td>`).join("")}</tr>`;
    const topNote = rep.period ? `${esc(rep.period.start)} → ${esc(rep.period.end)} (${esc(rep.period.n_days)}天)` : "";
    const kvRow = ([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`;
    const detailPairs = [
      ["Calmar", fmt(m.calmar, 2)], ["恢复因子", fmt(m.recovery_factor, 1)],
      ["最长回撤天数", `${esc(m.longest_dd_days ?? "—")} 天`], ["2022 段回撤", fmtPct(m.mdd_2022)],
      ["交易数", `${esc(m.trade_n ?? "—")} 笔`], ["交易胜率", fmtP(m.trade_win_rate, 0)],
      ["未平仓", esc(m.trade_open ?? "—")], ["交易级 PF", m.trade_pf == null ? "—" : fmt(m.trade_pf, 2)],
      ["换手/年", isBad(m.turnover_yr) ? "—" : fmt(m.turnover_yr, 1) + "x"],
      ["平均持仓", isBad(m.avg_held) ? "—" : fmt(m.avg_held, 1) + " 只"],
      ["止损 / 止盈", `${esc(m.stops ?? "—")} / ${esc(m.tp_hits ?? "—")} 次`], ["重平衡", `${esc(m.rebal ?? "—")} 次`],
    ];
    if (hasV2) {
      const recoverZh = (rep.v2.recover === "fast") ? "立即恢复(0日)" : "生产(0日立即恢复)";
      detailPairs.push(["V2 平均暴露", fmtP(rep.v2.mean_exposure, 0)],
        ["V2 末日暴露", fmtP(rep.v2.last_exposure, 0)],
        ["V2 恢复模式", recoverZh]);
      if (rep.v2.ic_fallback) detailPairs.push(["IC 回退", "⚠ 已启用"]);
    }
    let html = `<div class="card export-row"><h3 style="margin:0">回测报告</h3>
      <div class="btn-row">
        <button class="btn small" onclick="exportBtReport('md')">导出 Markdown</button>
        <button class="btn small" onclick="exportBtReport('pdf')">导出 PDF</button>
        <button class="btn small" onclick="exportBtReport('png')">导出 PNG</button>
      </div>
      <p class="dim" style="margin:0">指标 + 年度分解 + 资金曲线(源 output/web_backtest_report.json)</p></div>`;
    html += `<div class="card"><h3>风控前后对比<span class="tag">风控后 = × V2 生产暴露(DD阶梯×IC)</span></h3>
      <div class="table-scroll"><table class="grid-tbl cmp-tbl"><thead><tr><th>口径</th>${cmpCols.map(([, h]) => `<th>${h}</th>`).join("")}</tr></thead><tbody>
      ${cmpRow("风控前 · 引擎口径", topNote, m, true)}
      ${hasV2 ? cmpRow("风控后 · ×V2 暴露", `平均暴露 ${fmtP(rep.v2.mean_exposure, 0)} · 末日 ${fmtP(rep.v2.last_exposure, 0)}${rep.v2.ic_fallback ? " · ⚠ IC回退" : ""}`, v2m, false)
        : `<tr><td colspan="7" class="dim">未勾选「叠加 V2 风控」→ 只显示引擎口径;勾选后重跑可出现风控后行</td></tr>`}
      ${bm ? cmpRow(`benchmark:${esc(bmSym)} · 买入持有`, "0 成本 · 对照,不参与拟合判定", bm, false) : ""}
      </tbody></table>
      <p class="dim" style="margin:0">PF / 日胜率按交易日口径(与资金曲线同源);风控前 vs 风控后差异 = 生产 DD阶梯×IC 暴露的贡献;benchmark 为同窗口市场对照。⚠ 风控后累计/Sharpe 高于风控前,是暴露<b>择时降仓</b>(跌得越深降得越低、模型转强再恢复)躲掉 -51% 级深回撤保住复利所致,非放大收益(暴露 0.07–1.0 无杠杆);3406% 为模拟口径,假设暴露每日零摩擦精确缩放,真实调仓有滑点/手续费会低于此值。</p></div>`;
    html += `<div class="grid two">
      <div class="card"><h3>年度分解</h3>
        <table class="grid-tbl"><thead><tr><th>年</th><th>天数</th><th>Sharpe</th><th>累计</th><th>MDD</th></tr></thead><tbody>${
        (rep.yearly || []).map(y => `<tr><td>${y.year}</td><td>${y.n_days}</td><td>${fmt(y.sharpe, 2)}</td><td>${fmtPct(y.cum, 0)}</td><td>${fmtPct(y.mdd)}</td></tr>`).join("") || `<tr><td colspan="5" class="dim">—</td></tr>`
      }</tbody></table>
      ${hasV2 && (v2m.yearly || []).length ? `<h4 class="dim" style="margin:12px 0 4px">风控后年度(V2)</h4><table class="grid-tbl"><thead><tr><th>年</th><th>天数</th><th>Sharpe</th><th>累计</th><th>MDD</th></tr></thead><tbody>${
        v2m.yearly.map(y => `<tr><td>${y.year}</td><td>${y.n_days}</td><td>${fmt(y.sharpe, 2)}</td><td>${fmtPct(y.cum, 0)}</td><td>${fmtPct(y.mdd)}</td></tr>`).join("")}</tbody></table>` : ""}
      </div>
      <div class="card"><h3>引擎与交易详情</h3><table class="kv"><tbody>${detailPairs.map(kvRow).join("")}</tbody></table></div></div>`;
    html += `<div class="card"><h3>运行参数</h3><table class="kv"><tbody>
      ${Object.entries(rep.params || {}).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}
    </tbody></table></div>`;
    html += `<div class="card"><h3>资金曲线(日收益复利)</h3><canvas id="btEquity"></canvas></div>`;
    box.innerHTML = html;
    if (rep.equity && rep.equity.length) {
      const ds = [{ label: "净值(引擎口径)", data: rep.equity.map(p => p.eq), borderColor: "#4ade80", backgroundColor: "rgba(74,222,128,0.07)", fill: true, pointRadius: 0, borderWidth: 1.5 }];
      if (rep.equity_v2 && rep.equity_v2.length) {
        ds.push({ label: "净值(×V2 暴露)", data: rep.equity_v2.map(p => p.eq), borderColor: "#fbbf24", pointRadius: 0, borderWidth: 1.2 });
      }
      if (rep.equity_bench && rep.equity_bench.length && bmSym) {
        ds.push({ label: `对照 ${esc(bmSym)}`, data: rep.equity_bench.map(p => p.eq), borderColor: "#94a3b8", borderDash: [5, 4], pointRadius: 0, borderWidth: 1.2 });
      }
      chart("btEquity", { type: "line", data: { labels: rep.equity.map(p => p.date), datasets: ds },
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
          plugins: { legend: { labels: CHART_STYLE } },
          scales: { x: { grid: CHART_STYLE.grid, ticks: { color: "#8a94a8", maxTicksLimit: 10 } }, y: { grid: CHART_STYLE.grid, ticks: CHART_STYLE.ticks } } } });
    }
  } catch (_) {}
}


/* ── 02 回测报告导出(MD / PDF / PNG) ──────────────────────────────── */
function exportBtReport(kind) {
  if (!BT_REPORT) { toast("请先运行一次回测生成报告", false); return; }
  if (kind === "md") return exportBtMarkdown(BT_REPORT);
  if (kind === "pdf") return exportBtPdf(BT_REPORT);
  if (kind === "png") return exportBtPng(BT_REPORT);
}

function downloadBlob(name, blob) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 5000);
}

function pdfSave(doc, name) {
  doc.save(name);  // 经 jsPDF FileSaver 触发浏览器保存
}

function stampNow() {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

function btMetricsPairs(rep) {
  const m = rep.metrics || {};
  const v2m = rep.metrics_v2 || {};
  const prd = rep.period || {};
  const a = [
    ["Sharpe", fmt(m.sharpe, 2)], ["Sortino", fmt(m.sortino, 2)],
    ["累计收益", fmtPct(m.cum, 0)], ["区间", `${prd.start || "—"} → ${prd.end || "—"} (${prd.n_days ?? "—"} 天)`],
    ["最大回撤", fmtPct(m.mdd)], ["2022 段回撤", fmtPct(m.mdd_2022)],
    ["Calmar", fmt(m.calmar, 2)], ["恢复因子", fmt(m.recovery_factor, 2)],
    ["盈亏比 PF", fmt(m.profit_factor, 2)], ["组合胜率", fmtP(m.win_rate, 0)],
    ["交易数", esc(m.trade_n ?? "—")], ["交易胜率", fmtP(m.trade_win_rate, 0)],
    ["未平仓", esc(m.trade_open ?? "—")], ["换手/年", isBad(m.turnover_yr) ? "—" : fmt(m.turnover_yr, 1) + "x"],
    ["平均持仓", isBad(m.avg_held) ? "—" : fmt(m.avg_held, 1) + " 只"],
    ["止损 / 止盈", `${esc(m.stops ?? "—")} / ${esc(m.tp_hits ?? "—")} 次`],
    ["重平衡", `${esc(m.rebal ?? "—")} 次`],
  ];
  if (v2m.sharpe != null) {
    a.push(["V2 风控后 Sharpe", fmt(v2m.sharpe, 2)]);
    a.push(["V2 MDD", fmtPct(v2m.mdd)]);
    a.push(["V2 累计", fmtPct(v2m.cum, 0)]);
    a.push(["V2 平均暴露", isBad(rep.v2 && rep.v2.mean_exposure) ? "—" : fmtP(rep.v2.mean_exposure, 0)]);
  }
  const bb = rep.benchmark || null;
  if (bb && bb.sharpe != null) {
    const tag = `benchmark:${String(bb.symbol || "").toUpperCase()}`;
    a.push([tag + " Sharpe", fmt(bb.sharpe, 2)]);
    a.push([tag + " 累计", fmtPct(bb.cum, 0)]);
    a.push([tag + " MDD", fmtPct(bb.mdd)]);
  }
  return a;
}

const mdCell = (v) => String(v == null ? "" : v).replace(/\|/g, "\\|").replace(/\n/g, " ").trim();

function exportBtMarkdown(rep) {
  const pairs = btMetricsPairs(rep);
  const yearly = rep.yearly || [];
  const params = Object.entries(rep.params || {});
  const L = [];
  L.push("# 回测报告 — deepltrading", "");
  L.push(`- 导出时间: ${stampNow()}`);
  if (rep.period) L.push(`- 回测区间: ${rep.period.start || "—"} → ${rep.period.end || "—"} · ${rep.period.n_days ?? "—"} 天`);
  L.push("");
  L.push("## 绩效指标", "", "| 指标 | 数值 |", "|---|---|");
  for (const [k, v] of pairs) L.push(`| ${mdCell(k)} | ${mdCell(v)} |`);
  L.push("");
  L.push("## 年度分解", "", "| 年 | 天数 | Sharpe | 累计 | MDD |", "|---|---|---|---|---|");
  if (yearly.length) {
    for (const y of yearly) L.push(`| ${y.year} | ${y.n_days ?? "—"} | ${fmt(y.sharpe, 2)} | ${fmtPct(y.cum, 0)} | ${fmtPct(y.mdd)} |`);
  } else L.push("| — | — | — | — | — |");
  L.push("");
  if (params.length) {
    L.push("## 运行参数", "", "| 参数 | 值 |", "|---|---|");
    for (const [k, v] of params) L.push(`| ${mdCell(k)} | ${mdCell(v)} |`);
    L.push("");
  }
  const v2m = rep.metrics_v2 || {};
  if (v2m.sharpe != null && rep.v2) {
    L.push("> V2 风控: DD 阶梯 × 60D IC(生产口径)。平均暴露 " + fmtP(rep.v2.mean_exposure, 0)
      + (rep.v2.ic_fallback ? "(IC fallback)" : "") + "。", "");
  }
  L.push("---", "");
  L.push("> 资金曲线见 PDF / PNG 导出或控制台回测页。引擎输出: output/web_backtest_report.json");
  const name = `backtest_report_${(rep.period && rep.period.end) || "latest"}.md`;
  downloadBlob(name, new Blob([L.join("\n")], { type: "text/markdown;charset=utf-8" }));
  toast(`已导出 Markdown: ${name}`);
}

function exportBtPdf(rep) {
  if (!window.jspdf || typeof window.jspdf.jsPDF !== "function") { toast("PDF 库未加载(需访问 CDN),请检查网络后重试", false); return; }
  const eqEl = document.getElementById("btEquity");
  if (!eqEl) { toast("尚未生成资金曲线图,无法导出 PDF", false); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const M = 44;
  let y = 56;
  const hdr = () => {
    if (y > doc.internal.pageSize.getHeight() - 80) { doc.addPage(); y = 56; }
  };
  doc.setFontSize(18).setTextColor(20, 30, 50).text("回测报告 — deepltrading", M, y); y += 22;
  doc.setFontSize(10).setTextColor(110, 120, 140).text(`导出时间 ${stampNow()} · 区间 ${rep.period ? rep.period.start + " → " + rep.period.end + " (" + rep.period.n_days + " 天)" : "—"}`, M, y); y += 26;

  doc.setFontSize(13).setTextColor(20, 30, 50).text("1) 绩效指标", M, y); y += 6;
  const pairs = btMetricsPairs(rep).map(([k, v]) => [k, v]);
  doc.autoTable({ startY: y, head: [["指标", "数值"]], body: pairs, theme: "grid",
    styles: { fontSize: 9, cellPadding: 3 }, headStyles: { fillColor: [30, 41, 59], textColor: 255 },
    columnStyles: { 0: { cellWidth: 200 }, 1: { cellWidth: 300 } }, margin: { left: M, right: M } });
  y = doc.lastAutoTable.finalY + 24; hdr();

  const yearly = rep.yearly || [];
  doc.setFontSize(13).setTextColor(20, 30, 50).text("2) 年度分解", M, y); y += 6;
  doc.autoTable({ startY: y, head: [["年", "天数", "Sharpe", "累计", "MDD"]],
    body: yearly.length ? yearly.map(r => [r.year, r.n_days ?? "—", fmt(r.sharpe, 2), fmtPct(r.cum, 0), fmtPct(r.mdd)]) : [["—", "—", "—", "—", "—"]],
    theme: "striped", styles: { fontSize: 9, cellPadding: 3 }, headStyles: { fillColor: [30, 41, 59], textColor: 255 },
    margin: { left: M, right: M } });
  y = doc.lastAutoTable.finalY + 24; hdr();

  const params = Object.entries(rep.params || {});
  if (params.length) {
    doc.setFontSize(13).setTextColor(20, 30, 50).text("3) 运行参数", M, y); y += 6;
    doc.autoTable({ startY: y, head: [["参数", "值"]], body: params.map(([k, v]) => [k, String(v)]),
      theme: "grid", styles: { fontSize: 8.5, cellPadding: 3 }, headStyles: { fillColor: [30, 41, 59], textColor: 255 },
      columnStyles: { 0: { cellWidth: 150 }, 1: { cellWidth: 350 } }, margin: { left: M, right: M } });
    y = doc.lastAutoTable.finalY + 24; hdr();
  }

  doc.setFontSize(13).setTextColor(20, 30, 50).text("4) 资金曲线", M, y); y += 8;
  hdr();
  const imgData = eqEl.toDataURL("image/png");
  const iw = W - M * 2;
  const ih = Math.min((iw * eqEl.height) / Math.max(1, eqEl.width), 430);
  if (y + ih > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); y = 56; }
  doc.addImage(imgData, "PNG", M, y, iw, ih); y += ih + 20;
  doc.setFontSize(8).setTextColor(140, 150, 165).text("deepltrading · 回测报告 · 导出 " + stampNow(), M, y);
  const name = `backtest_report_${(rep.period && rep.period.end) || "latest"}.pdf`;
  pdfSave(doc, name);
  toast(`已导出 PDF: ${name}`);
}

function exportBtPng(rep) {
  const eqEl = document.getElementById("btEquity");
  if (!eqEl) { toast("尚未生成资金曲线图,无法导出 PNG", false); return; }
  const img = new Image();
  img.onload = () => { drawBtPng(rep, img); };
  img.onerror = () => toast("资金曲线图像导出失败", false);
  img.src = eqEl.toDataURL("image/png");
}

function drawBtPng(rep, eqImg) {
  const P = 52, W = 1600, content = W - P * 2;
  const metrics = btMetricsPairs(rep);
  const params = Object.entries(rep.params || {});
  const yearly = rep.yearly || [];
  const mRows = Math.ceil(metrics.length / 2);
  const pRows = Math.max(0, Math.ceil(params.length / 2));
  const asc = eqImg.width ? eqImg.height / eqImg.width : 0.5;
  const imgH = Math.min(Math.round(content * asc), 620);
  let H = P * 2 + 120 + mRows * 54 + 40 + pRows * 46 + 40 + (yearly.length ? 40 + (yearly.length + 1) * 30 : 40) + 40 + imgH + 70;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = Math.max(H, 800);
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#0b1220"; ctx.fillRect(0, 0, cv.width, cv.height);

  const txt = (x, y, s, size, color, weight = "normal") => {
    ctx.font = `${weight} ${size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.fillStyle = color; ctx.fillText(String(s), x, y);
  };
  const fit = (s, maxW, size) => {
    ctx.font = `normal ${size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    let t = String(s); while (t.length > 2 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
    return t.length < String(s).length ? t + "…" : t;
  };
  const sec = (title) => { txt(P, y, title, 20, "#c7d2fe", "bold"); y += 30; };

  let y = P + 10;
  txt(P, y + 40, "回测报告 — deepltrading", 34, "#f1f5f9", "bold"); y += 76;
  txt(P, y + 12, `导出时间 ${stampNow()} · 区间 ${rep.period ? rep.period.start + " → " + rep.period.end + " · " + rep.period.n_days + " 天" : "—"}`, 14, "#7d8aa0"); y += 56;

  sec("绩效指标");
  const colX = [P, P + content / 2];
  for (let i = 0; i < metrics.length; i++) {
    const col = i % 2, row = Math.floor(i / 2);
    const x = colX[col];
    txt(x, y + row * 54, fit(metrics[i][0] + ":", 240, 16), 16, "#8fa0b5");
    txt(x + 250, y + row * 54, fit(metrics[i][1], 330, 17), 17, "#e2e8f0", "bold");
  }
  y += mRows * 54 + 44;

  if (yearly.length) {
    sec("年度分解");
    const cols = [P, P + 150, P + 250, P + 350, P + 460];
    const heads = ["年", "天数", "Sharpe", "累计", "MDD"];
    ctx.fillStyle = "rgba(148,163,184,0.10)"; ctx.fillRect(P, y - 20, content, 30);
    for (let c = 0; c < heads.length; c++) txt(cols[c], y, heads[c], 15, "#c7d2fe", "bold");
    y += 10;
    for (const row of yearly) {
      y += 30;
      const vals = [String(row.year), String(row.n_days ?? "—"), fmt(row.sharpe, 2), fmtPct(row.cum, 0), fmtPct(row.mdd)];
      for (let c = 0; c < vals.length; c++) txt(cols[c], y, vals[c], 15, "#dbe3ee");
    }
    y += 52;
  }

  if (params.length) {
    sec("运行参数");
    for (let i = 0; i < params.length; i++) {
      const col = i % 2, row = Math.floor(i / 2);
      const x = colX[col];
      txt(x, y + row * 46, fit(params[i][0] + ":", 200, 14), 14, "#8fa0b5");
      txt(x + 210, y + row * 46, fit(String(params[i][1]), 380, 14), 14, "#dbe3ee");
    }
    y += pRows * 46 + 40;
  }

  sec("资金曲线");
  const iw = content, ih = imgH;
  ctx.drawImage(eqImg, P, y + 8, iw, ih);
  y += ih + 44;
  txt(P, y, "deepltrading · 控制台导出 · " + stampNow(), 12, "#5b6b82");
  downloadBlob(`backtest_report_${(rep.period && rep.period.end) || "latest"}.png`,
    new Blob([cv.toDataURL("image/png")], { type: "image/png" }));
  toast("已导出 PNG 报告图");
}

function renderSweep(rep) {
  const box = document.getElementById("btResult");
  if (!box) return;
  const rows = rep.rows || [];
  let html = `<div class="card"><h3>参数体检(topK / DD 敏感性 · 全窗口 + 近期窗口)</h3>
    <table class="grid-tbl"><thead><tr><th>配置</th><th>全窗 Sharpe</th><th>全窗累计</th><th>全窗 MDD</th><th>全窗胜率</th><th>PF</th>
    <th>近期 Sharpe</th><th>近期累计</th><th>近期 MDD</th></tr></thead><tbody>`;
  for (const r of rows) {
    html += `<tr><td><b>${esc(r.variant)}</b></td>
      <td>${fmt(r.full.sharpe, 2)}</td><td>${fmtPct(r.full.cum, 0)}</td><td>${fmtPct(r.full.mdd)}</td>
      <td>${fmtP(r.full.win_rate, 0)}</td><td>${fmt(r.full.pf, 2)}</td>
      <td>${fmt(r.recent.sharpe, 2)}</td><td>${fmtPct(r.recent.cum, 0)}</td><td>${fmtPct(r.recent.mdd)}</td></tr>`;
  }
  html += `</tbody></table><p class="dim">近期窗口 = 2025-11-01 之后(样本外延伸段)。非冻结实验口径。</p></div>`;
  box.innerHTML = html;
}

async function startBacktest() {
  try {
    const r = await api("/api/backtest/start", { method: "POST", body: JSON.stringify({
      k: parseInt($("#btK").value, 10) || 30,
      atr_mult: $("#btAtr").value || null,
      dd_thresh: $("#btDd").value || null,
      vt_target: $("#btVt").value || null,
      rank_exit: $("#btRank").value || null,
      v2: $("#btV2").checked,
      v2_recover: ($("#btV2Recover") ? $("#btV2Recover").value : "prod") || "prod",
      since: $("#btSince").value || "",
      benchmark: ($("#btBench").value || "").trim(),
    }) });
    toast(`回测已启动 Top${r.k}`);
    renderBacktest();
  } catch (e) { toast(e.message, false); }
}
async function runSweep() {
  try {
    const r = await api("/api/backtest/sweep", { method: "POST", body: JSON.stringify({
      k: parseInt($("#btK").value, 10) || 30,
      sweep_k: $("#btSweepK").value, sweep_dd: $("#btSweepDd").value }) });
    toast("参数体检已启动");
    renderBacktest();
  } catch (e) { toast(e.message, false); }
}
async function stopBacktest() {
  try { const r = await api("/api/backtest/stop", { method: "POST" }); toast(r.ok ? "已停止回测" : "无运行中任务"); renderBacktest(); }
  catch (e) { toast(e.message, false); }
}

function validateSection(vst) {
  const f6 = (vst && vst.fold6) || {};
  const fst = f6.status || {};
  const oos = (vst && vst.oos) || {};
  const busy = fst.active ? `<div class="busy-bar"><i class="spin"></i> 折6 验证运行中(训练新模型,约 3-15 分钟)</div>` : "";
  let html = `<div class="card"><h3>模型验证 · 6折样本外检验 / OOS 冻结</h3>
    ${busy}
    <div class="grid two">
      <div>
        <p class="dim"><b>OOS 冻结面板</b>: ${oos.available ? `${esc(oos.date_min)} → ${esc(oos.date_max)} · ${fmtMoney(oos.rows)} 行 · ${oos.symbols} 只(更新 ${esc(oos.mtime)})` : esc(oos.message || "缺失")}</p>
        <p class="dim">${esc(oos.note || "")}</p>
      </div>
      <div class="form-grid inline">
        <label>特征集 <select id="f6Feat">
          <option value="swing">swing · 33特征(生产)</option>
          <option value="base">base · 26特征</option></select></label>
        <label class="chk"><input id="f6Extend" type="checkbox"> 延伸至面板末日(--extend)</label>
      </div>
    </div>
    <div class="btn-row">
      <button class="btn primary" onclick="startFold6()">运行折6验证</button>
      <button class="btn danger" onclick="stopValidate()">停止</button>
    </div>
    <p class="dim">折6 = 从未参与训练的数据上验证冠军策略(训练至折6起点−1年,样本外独立评估)。验证目标:确认 Sharpe/IC 不是 5 折拟合。</p>
    ${logConsole("f6Log")}
  </div>
  <div class="card"><h3>已有折6 结果</h3>
    <table class="grid-tbl"><thead><tr><th>特征集</th><th>测试区间</th><th>天数</th><th>ens60 IC</th><th>IC t</th><th>Top50 Sharpe</th><th>Top50 MDD</th><th>超额收益</th><th>运行时间</th></tr></thead><tbody>`;
  const rows = f6.results || [];
  if (!rows.length) html += `<tr><td colspan="9" class="dim">暂无结果,点击「运行折6验证」生成。</td></tr>`;
  for (const r of rows) {
    html += `<tr><td><b>${esc(r.feat_set)}</b></td>
      <td>${esc((r.test_range || []).join(" → "))}</td>
      <td>${esc(r.n_days ?? "—")}</td>
      <td>${fmt(r.ens60_ic, 4)}</td><td>${fmt(r.ens60_ic_t, 1)}</td>
      <td>${fmt(r.top50_sharpe, 2)}</td><td>${fmtPct(r.top50_mdd)}</td>
      <td>${fmtPct(r.excess_cum, 0)}</td><td class="dim">${esc(r.mtime || "—")}</td></tr>`;
  }
  html += `</tbody></table></div>`;
  return html;
}

async function startFold6() {
  try {
    const r = await api("/api/validate/fold6", { method: "POST", body: JSON.stringify({
      feat_set: $("#f6Feat").value, extend: $("#f6Extend").checked }) });
    toast(`折6 验证已启动: ${r.feat_label} → ${r.out_file}`);
    renderTrain();
  } catch (e) { toast(e.message, false); }
}
async function stopValidate() {
  try {
    const r = await api("/api/validate/stop", { method: "POST" });
    toast(r.ok ? `已停止: ${r.stopped.join(", ")}` : "无运行中验证任务");
    renderPage2();
  } catch (e) { toast(e.message, false); }
}

function rollingSection(vst) {
  const rl = (vst && vst.rolling) || {};
  const rst = rl.status || {};
  const busy = rst.active ? `<div class="busy-bar"><i class="spin"></i> 9起点滚动复核运行中(每项 9 起点 × 2 窗口)</div>` : "";
  return `<div class="card"><h3>9起点滚动复核(rolling_validate)<span class="tag">待审 ${esc(rl.pending ?? 0)} 项</span></h3>
    ${busy}
    <div class="btn-row">
      <button class="btn primary" onclick="startRolling9()">复核待审队列(--auto)</button>
      <button class="btn danger" onclick="stopValidate()">停止</button>
    </div>
    <p class="dim">每周自动:新拟合增强入待审队列,9 个滚动起点(base_cut ±20d)复核「全窗口 vs 样本外」,跑赢过半才放行进竞技场。</p>
    ${logConsole("rollingLog")}
  </div>`;
}

async function startRolling9() {
  try {
    const r = await api("/api/validate/rolling9", { method: "POST" });
    toast(r.ok ? (r.warn ? "已启动(⚠ 待审队列为空)" : "9起点复核已启动") : "启动失败");
    renderBacktest();
  } catch (e) { toast(e.message, false); }
}

function renderRollingMatrix(vst) {
  const rl = (vst && vst.rolling) || {};
  const mx = rl.matrix || {};
  const box = document.getElementById("rollingMatrix");
  if (!box || !mx.available || !mx.rows || !mx.rows.length) return;
  const enhs = mx.enhs || [];
  let html = `<div class="card"><h3>9起点滚动矩阵(本地 rolling_review.csv · ${esc(mx.mtime || "—")})</h3>
    <div class="table-scroll"><table class="grid-tbl"><thead><tr><th>起点</th>${enhs.map(e => `<th>${esc(e)}</th>`).join("")}</tr></thead><tbody>`;
  for (const r of mx.rows) {
    html += `<tr><td><b>${esc(r.start)}</b></td>${enhs.map(e => {
      const v = r[e];
      const cls = v == null ? "dim" : (v > 2 ? "green" : (v < 1 ? "red" : "amber"));
      return `<td class="${cls}">${v == null ? "—" : fmt(v, 2)}</td>`;
    }).join("")}</tr>`;
  }
  html += `</tbody></table></div>
    <p class="dim">每行 = 一个滚动起点(数据驱动基准起点 ±20 天,9 起点)上该增强的样本外 Sharpe;列内横向可看该增强是否在多数起点稳健(跑赢 base 才放行)。</p></div>`;
  box.innerHTML = html;
}

function paramHealthSection(vst) {
  const ph = (vst && vst.param_health) || {};
  const pv = (vst && vst.production_validation) || {};
  let html = "";
  if (ph.available && ph.groups && ph.groups.length) {
    html += `<div class="card"><h3>参数双窗口体检(param_health.json · ${esc(ph.mtime || "—")} · 折6起点 ${esc(ph.oos_window || "—")})</h3>`;
    for (const g of ph.groups) {
      const driftCls = String(g.drift || "").startsWith("✅") ? "green" : "amber";
      html += `<h4 style="margin:10px 0 4px">${esc(g.label)} <span class="${driftCls}">${esc(g.drift || "")}</span></h4>
        <div class="table-scroll"><table class="grid-tbl"><thead><tr><th>值</th><th>全窗 Sharpe</th><th>全窗 MDD</th><th>折6 Sharpe</th><th>折6 MDD</th><th>ratio</th><th>判定</th></tr></thead><tbody>`;
      for (const r of g.rows) {
        const vCls = r.fitted ? "red" : "green";
        html += `<tr><td><b>${esc(r.value)}</b></td><td>${fmt(r.full_sharpe, 2)}</td><td>${fmtPct(parseFloat(r.full_mdd) / 100)}</td>
          <td>${fmt(r.oos_sharpe, 2)}</td><td>${fmtPct(parseFloat(r.oos_mdd) / 100)}</td>
          <td>${fmt(r.ratio, 2)}</td><td class="${vCls}">${esc(r.verdict || "")}</td></tr>`;
      }
      html += `</tbody></table></div>`;
    }
    html += `<p class="dim">全窗口 vs 折6样本外双窗口体检;⚠ 漂移 = 最优点随窗口移动(参考 AGENTS.md 防过拟合铁律)。</p></div>`;
  }
  if (pv.available && pv.total != null) {
    const ok = pv.passed === pv.total;
    html += `<div class="card"><h3>生产全项检验(production_validation.json · ${esc(pv.passed)}/${esc(pv.total)} 通过)</h3>
      <table class="grid-tbl"><thead><tr><th>检查项</th><th>结果</th><th>说明</th></tr></thead><tbody>`;
    for (const [name, passed, note] of (pv.checks || [])) {
      html += `<tr><td>${esc(name)}</td><td class="${passed ? "green" : "red"}">${passed ? "✅" : "❌"}</td><td class="dim">${esc(note || "")}</td></tr>`;
    }
    html += `</tbody></table></div>`;
  }
  return html;
}

function renderRollingTable(vst) {
  const rl = (vst && vst.rolling) || {};
  const box = document.getElementById("rollingResult");
  if (!box) return;
  const entries = rl.log || [];
  if (!entries.length) { box.innerHTML = `<div class="card"><p class="dim">暂无滚动复核记录。</p></div>`; return; }
  let html = `<div class="card"><h3>最近复核记录(${entries.length} 条)</h3>
    <table class="grid-tbl"><thead><tr><th>增强/参数</th><th>日期</th><th>跑赢</th><th>平均ΔSharpe</th><th>ΔIC</th><th>判定</th></tr></thead><tbody>`;
  for (const e of entries) {
    const verdictCls = String(e.verdict || "").includes("⚠") ? "amber" : "green";
    html += `<tr><td><b>${esc(e.label)}</b></td><td>${esc(e.date)}</td><td>${esc(e.wins)}/${esc(e.n)}</td>
      <td>${fmt(e.mean_delta, 2)}</td><td>${e.mean_delta_ic != null ? fmt(e.mean_delta_ic, 4) : "—"}</td>
      <td class="${verdictCls}">${esc(e.verdict || "—")}</td></tr>`;
  }
  html += `</tbody></table></div>`;
  box.innerHTML = html;
}

/* ── 03 实时信号 ──────────────────────────────────────────────────── */
const SORT = { key: null, asc: true };
const SIG_ROWS = {};  // symbol -> 最新信号行(供点击弹行情图)
let BT_REPORT = null;  // 最近一次普通回测报告(供导出用)

async function renderSignals() {
  pollDrop("sg");
  const el = pageEl("signals");
  el.innerHTML = `<div class="loading">加载信号…</div>`;
  let st, latest, cfg;
  try { [st, latest, cfg] = await Promise.all([api("/api/signals/status"), api("/api/signals/latest"), api("/api/config")]); }
  catch (e) { el.innerHTML = `<div class="err-box">加载失败: ${esc(e.message)}</div>`; return; }
  const s = (cfg && cfg.settings) || {};

  const active = st.status.active;
  let html = `<div class="card"><h3>信号生成(后台任务)</h3>
    ${busySection(st.status)}
    <div class="form-grid inline">
      <label>Top 候选 <input id="sgTop" type="number" value="20" min="5" max="200"></label>
      <label>威科夫过滤 <select id="sgPhase"><option value="default">默认(按配置)</option>
        <option value="on">强制开启</option><option value="off">强制关闭</option></select></label>
      <label class="chk"><input id="sgRefresh" type="checkbox"> 先联网刷新行情(--refresh)</label>
      <label class="chk"><input id="sgLev" type="checkbox"> 剔除杠杆/加密 ETF</label>
    </div>
    <div class="btn-row">
      <button class="btn primary" onclick="runSignals()">生成信号(signals.py)</button>
      <button class="btn" onclick="runWatch()">完整每日链(watch.py)</button>
      <button class="btn danger" onclick="stopSignals()">停止</button>
    </div>
    ${logConsole("sgLog")}
  </div>`;

  if (latest.available) {
    html += `<div class="card"><h3>最新信号 ${esc(latest.date)} <span class="tag">${esc(latest.file)}</span>
      <span class="dim">(${esc(latest.n_rows)} 只 · 点击表头排序)</span></h3>
      <div class="table-scroll" id="sgTable"></div></div>`;
    if (latest.plan_rows && latest.plan_rows.length) {
      html += `<div class="card"><h3>交易计划 ${esc(latest.plan_file || "")}</h3>
        <div class="table-scroll" id="sgPlan"></div></div>`;
    }
  } else {
    html += `<div class="card warn"><p>尚无信号文件,点击「生成信号」开始(或先跑 watch.py 完整链)。</p></div>`;
  }
  html += `<div id="sgExtra"></div>`;
  el.innerHTML = html;
  document.getElementById("sgTop").value = s.sg_top || 20;
  document.getElementById("sgPhase").value = s.sg_phase || "default";
  document.getElementById("sgRefresh").checked = !!s.sg_refresh;
  document.getElementById("sgLev").checked = !!s.sg_lev;

  Object.keys(SIG_ROWS).forEach(k => delete SIG_ROWS[k]);
  const allRows = latest.rows || [];
  for (const r of allRows) SIG_ROWS[r.symbol] = r;
  const sigCap = parseInt(s.sg_cap, 10) || 300;   // 单页最多渲染行数,避免上千行撑爆页面;完整名单保留在 CSV
  const viewRows = allRows.length > sigCap ? allRows.slice(0, sigCap) : allRows;
  if (latest.available) renderSignalsTable("sgTable", viewRows, allRows.length);
  wireSignalRows();
  if (latest.plan_rows && latest.plan_rows.length) renderTable("sgPlan", latest.plan_rows);
  loadSignalsExtra();

  pollLog("sgLog", "/api/signals/status", false);
  if (active) {
    pollSet("sg", async () => {
      try {
        const r = await api("/api/signals/status");
        const lc = document.getElementById("sgLog");
        if (lc) { lc.textContent = r.log_tail.join("\n"); lc.scrollTop = lc.scrollHeight; }
        if (!r.status.active) renderSignals();
      } catch (_) {}
    }, 2000);
  } else {
    pollSet("hdr", pollHeader, 4000);
  }
}

/* 信号/交易计划展示列(csv 列 → 中文表头); 顺序即显示顺序。
   name 列限宽省略(title 显示全名); 未在此清单的原始列(资金流/形态/爆量等)
   不进宽表 —— 保留在 CSV 原文件与点击符号弹出的 K 线详情里。 */
const SIG_DISP = [
  ["symbol", "代码"], ["name", "名称"], ["asset_type", "类型"],
  ["research_rank", "研排名"], ["trade_rank", "交排名"], ["top10_today", "Top10"],
  ["close", "现价"], ["pred_20", "预测20日"], ["pred_40", "预测40日"],
  ["pred_60", "预测60日"], ["composite", "综合分"], ["p_high_60", "高点60日"],
  ["p_low_60", "低点60日"],
  ["high_hit_rate", "高点兑现率", "60日峰值兑现率 = 已成熟归档日中 fwd_max_60 ≥ p_high_60 的比例(括号为已成熟天数);预测高点自 2026-08-14 起入档, 需 60 交易日成熟, 约 2026-11 起陆续有样本"],
  ["entry", "入场"], ["target", "目标价"],
  ["stop", "止损价"], ["rr", "盈亏比"], ["phase", "阶段"],
  ["signal_lifecycle", "周期"], ["execution_status", "执行"],
  ["is_acc", "加仓"], ["risk_flags", "风险"],
];
const _RATE_K = new Set(["pred_20", "pred_40", "pred_60", "p_high_20", "p_high_40",
  "p_high_60", "p_low_60", "atr_pct", "stop_rebound_pct", "cal_exp_ret_60"]);
const _PRICE_K = new Set(["close", "entry", "target", "stop", "swing_low", "swing_high"]);
function fmtCell(k, v) {
  if (v == null) return "—";
  const s = String(v);
  if (s === "" || /^(nan|null|unknown)$/i.test(s)) return "—";
  if (s === "true" || s === "false") return s === "true" ? "✓" : "—";
  const n = Number(v);
  if (!isNaN(n) && s.trim() !== "") {
    if (_RATE_K.has(k)) return fmtPct(n, 1);
    if (_PRICE_K.has(k) || k === "rr") return fmt(n, 2);
    return fmt(n, 3);
  }
  return s;
}
function renderTable(containerId, rows, sortKey = "composite", total) {
  const el = document.getElementById(containerId);
  if (!el || !rows.length) return;
  const cols = SIG_DISP.filter(([k]) => k in rows[0]).map(([k]) => k);
  const shown = SIG_DISP.filter(([k]) => cols.includes(k));
  const cmp = (a, b, k) => {
    const va = a[k], vb = b[k];
    const na = Number(va), nb = Number(vb);
    if (!isNaN(na) && !isNaN(nb) && va !== "" && va != null && vb !== "" && vb != null) return na - nb;
    return String(va ?? "").localeCompare(String(vb ?? ""));
  };
  const body = (data) => data.map(r => `<tr>${cols.map(k => {
    const v = r[k];
    if (k === "symbol") return `<td class="sym"><b>${esc(v)}</b></td>`;
    if (k === "name") return `<td class="ell" title="${esc(v)}">${esc(v)}</td>`;
    if (k === "high_hit_rate") {
      const n = r.high_hit_n || 0;
      if (v == null || Number.isNaN(Number(v)))
        return `<td><span class="dim" title="暂无已成熟归档日">—(0)</span></td>`;
      return `<td title="已成熟 ${n} 个归档日">${fmtPct(v, 0)} <span class="dim">(${n})</span></td>`;
    }
    return `<td>${esc(fmtCell(k, v))}</td>`;
  }).join("")}</tr>`).join("");
  const data = rows.slice().sort((a, b) => cmp(a, b, sortKey)).reverse();
  const head = shown.map(([k, zh, tip]) => `<th data-k="${esc(k)}" title="${esc(tip || k)}">${esc(zh)}</th>`).join("");
  const shownNote = (total && rows.length < total)
    ? `<p class="dim tbl-note">仅展示前 ${rows.length}/${total} 只(整表渲染会卡死页面);完整 ${total} 只请直接看 CSV 文件, 或缩小排序范围后导出。点击代码行弹 K 线;表头点击排序(仅当前页内)。</p>`
    : `<p class="dim tbl-note">仅显示核心列;资金流/形态/爆量等原始字段保留在 CSV 原文件, 点击代码行弹出 K 线含全部指标。</p>`;
  el.innerHTML = `<table class="grid-tbl sortable sig-tbl"><thead><tr>${head}</tr></thead><tbody>${body(data)}</tbody></table>` + shownNote;
  el.querySelectorAll("th").forEach(th => th.addEventListener("click", () => {
    const k = th.dataset.k;
    SORT.key = k; SORT.asc = !SORT.asc;
    const sorted = rows.slice().sort((a, b) => cmp(a, b, k));
    if (!SORT.asc) sorted.reverse();
    el.querySelector("tbody").innerHTML = body(sorted);
  }));
}

function renderSignalsTable(containerId, rows, total) {
  renderTable(containerId, rows, "composite", total);
}

async function loadSignalsExtra() {
  try {
    const [hold, ev] = await Promise.all([api("/api/signals/holdings"), api("/api/signals/archive-eval")]);
    let html = `<div class="grid two">`;
    html += `<div class="card"><h3>持仓与提醒 (${esc(hold.alerts_date || "—")})</h3>`;
    if (hold.holdings && hold.holdings.length) {
      window.HOLD_ROWS = {};
      const hN = (v) => (v == null || v === "" || Number.isNaN(Number(v))) ? null : Number(v);
      hold.holdings.forEach(r => { window.HOLD_ROWS[String(r.symbol).trim()] = { entry: hN(r.entry_price), target: hN(r.target), stop: hN(r.stop), name: "持仓 · 真实入场" }; });
      html += `<p class="dim">点击持仓行 → 弹出该股 K 线:黄色虚线 = 真实入场成本线,绿/红虚线 = 提醒中的目标/止损。</p>`;
      html += `<table class="grid-tbl hold-tbl" id="sgHoldings"><thead><tr><th>代码</th><th>入场日</th><th>入场价</th><th>数量</th><th>现价</th><th>盈亏</th></tr></thead><tbody>${
        hold.holdings.map(r => `<tr title="点击查看行情"><td><b>${esc(r.symbol)}</b></td><td>${esc(r.entry_date)}</td><td>${fmt(r.entry_price, 2)}</td><td>${esc(r.qty)}</td><td>${fmt(r.close, 2)}</td><td>${fmtPct(r.pnl_pct)}</td></tr>`).join("")}</tbody></table>`;
    } else html += `<p class="dim">data/holdings.csv 为空</p>`;
    if (hold.alerts && hold.alerts.length) {
      html += `<table class="grid-tbl"><thead><tr><th>代码</th><th>状态</th><th>提醒</th><th>现价</th><th>目标</th><th>止损</th><th>盈亏</th></tr></thead><tbody>${
        hold.alerts.map(r => `<tr><td><b>${esc(r.symbol)}</b></td><td>${esc(r.status)}</td><td>${esc(r.alert)}</td><td>${fmt(r.close, 2)}</td><td>${fmt(r.target, 2)}</td><td>${fmt(r.stop, 2)}</td><td>${fmtPct(r.pnl_pct)}</td></tr>`).join("")}</tbody></table>`;
    }
    html += `</div>`;
    html += `<div class="card"><h3>信号回顾/存档评估</h3><pre class="prebox">${esc(ev.available ? ev.text.slice(-3000) : "暂无 signal_archive_eval.md(先跑 watch.py 或 signal_archive --eval)")}</pre></div>`;
    html += `</div>`;
    if (hold.instructions) {
      html += `<div class="card"><h3>最新交易指令 ${esc(hold.instructions_file || "")}</h3><pre class="prebox">${esc(hold.instructions.slice(-6000))}</pre></div>`;
    }
    const extra = document.getElementById("sgExtra");
    if (extra) extra.innerHTML = html;
    const htb = document.getElementById("sgHoldings");
    if (htb && !htb.dataset.wired) {
      htb.dataset.wired = "1";
      htb.addEventListener("click", (ev) => {
        const tr = ev.target.closest("tr");
        if (!tr) return;
        const sym = (tr.querySelector("td")?.textContent || "").trim();
        const row = window.HOLD_ROWS && window.HOLD_ROWS[sym];
        if (row) openSymbolChart(sym, row);
      });
    }
  } catch (_) {}
}

async function runSignals() {
  try {
    const r = await api("/api/signals/run", { method: "POST", body: JSON.stringify({
      top: parseInt($("#sgTop").value, 10) || 20, refresh: $("#sgRefresh").checked,
      phase_filter: $("#sgPhase").value, exclude_lev: $("#sgLev").checked }) });
    toast("信号生成已启动" + ($("#sgRefresh").checked ? "(--refresh 联网刷新)" : ""));
    renderSignals();
  } catch (e) { toast(e.message, false); }
}
async function runWatch() {
  if (!confirm("运行完整每日看盘链 watch.py(刷新→信号→存档→持仓提醒→冠军状态→推送)?耗时较长。")) return;
  try {
    const r = await api("/api/signals/run-watch", { method: "POST", body: JSON.stringify({
      top: parseInt($("#sgTop").value, 10) || 20, refresh: $("#sgRefresh").checked }) });
    toast("watch.py 已启动");
    renderSignals();
  } catch (e) { toast(e.message, false); }
}
async function stopSignals() {
  try { const r = await api("/api/signals/stop", { method: "POST" }); toast(r.ok ? "已停止信号任务" : "无运行中任务"); renderSignals(); }
  catch (e) { toast(e.message, false); }
}

/* ── 04 模拟实盘 ──────────────────────────────────────────────────── */
/* 模拟账户指标: 按 equity_points 净值曲线计算(区别于总览卡片的 V2 生产净值口径) */
function paperMetrics(points) {
  if (!points || points.length < 2) return null;
  const eqs = points.map(p => Number(p.equity)).filter(v => Number.isFinite(v) && v > 0);
  if (eqs.length < 2) return null;
  const rets = [];
  for (let i = 1; i < eqs.length; i++) rets.push(eqs[i] / eqs[i - 1] - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rets.length - 1));
  const sharpe = sd > 0 ? (mean / sd) * Math.sqrt(252) : 0;
  let peak = -Infinity, maxDd = 0;
  for (const v of eqs) { peak = Math.max(peak, v); maxDd = Math.max(maxDd, 1 - v / peak); }
  const last = eqs[eqs.length - 1];
  const firstPt = points.find(p => Number(p.equity) > 0);
  const lastPt = points[points.length - 1];
  return { sharpe, maxDd, curDd: last / peak - 1, last,
    firstDate: firstPt ? firstPt.date : "—", lastDate: lastPt ? lastPt.date : "—" };
}

async function renderPaper() {
  const el = pageEl("paper");
  el.innerHTML = `<div class="loading">加载模拟账户…</div>`;
  let st, cfg, ov;
  try { [st, cfg, ov] = await Promise.all([
      api("/api/paper/status"), api("/api/config"),
      api("/api/overview").catch(() => null),
    ]); }
  catch (e) { el.innerHTML = `<div class="err-box">加载失败: ${esc(e.message)}</div>`; return; }
  const s = (cfg && cfg.settings) || {};

  const tiles = [
    tile("账户净值", "$" + fmtMoney(st.equity), st.initialized ? `初始 $${fmtMoney(st.starting_balance)}` : "未初始化", st.initialized ? "green" : "amber"),
    tile("现金", "$" + fmtMoney(st.cash), st.initialized ? `最后结算 ${esc(st.last_settle || "—")}` : "", ""),
    tile("持仓市值", "$" + fmtMoney(st.positions_value), `${esc(st.n_positions)} 个持仓`, ""),
    tile("已实现盈亏", st.real_account && st.real_account.available ? "$" + fmtMoney(st.real_account.total) : "—",
      st.real_account && st.real_account.available ? `data/sales.csv · ${st.real_account.n} 笔 · 胜率 ${st.real_account.win_rate != null ? fmtP(st.real_account.win_rate, 0) : "—"}` : (st.real_account && st.real_account.message) || "",
      st.real_account && st.real_account.available ? (st.real_account.total >= 0 ? "green" : "red") : ""),
  ];

  // 指标卡: 组合类按模拟账户净值曲线计算, 模型类(IC/信号)与仓位无关复用总览同源数据
  const pm = paperMetrics(st.equity_points || []);
  // 累计倍数 = 当前净值/初始资金(账户口径); 曲线首点可能是 backfill 建仓后点,
  // 用它当「起点 1 元」会低估/高估真实累计(如 backfill 首点 > 初始资金)。
  const mult = (st.starting_balance > 0 && st.equity) ? st.equity / st.starting_balance : null;
  const ovData = ov || {};
  const mv = ovData.model_validity || {};
  const sig = ovData.latest_signal || {};
  const pmWin = pm ? `${pm.firstDate} → ${pm.lastDate}` : "";
  const posPct = st.equity ? st.positions_value / st.equity : 0;
  const mTiles = [
    tile("账户净值(模拟)", mult != null ? fmt(mult, 2) : "—",
      mult != null ? `${pm ? pm.lastDate : st.last_settle || "—"} · 起点 1 元 → 当前 ${fmt(mult, 2)} 元` : (st.initialized ? "净值历史不足(需至少 2 个结算点)" : "未初始化"),
      mult != null ? (mult >= 1 ? "green" : "red") : "amber"),
    tile("回撤(当前)", pm ? fmtPct(pm.curDd) : "—",
      pm ? `${pm.lastDate} · 距历史最高点回落 · 当日仓位 ${fmtP(posPct, 0)}` : "",
      pm ? (pm.curDd < -0.08 ? "red" : (pm.curDd < -0.03 ? "amber" : "green")) : ""),
    tile("当前仓位(模拟)", fmtP(posPct, 0),
      st.initialized ? `现金 $${fmtMoney(st.cash)} · ${st.n_positions} 个持仓 · 按信号调仓` : "未初始化", "amber"),
    tile("模型 IC(60日)", fmt(mv.ic, 4),
      `预测与未来60日收益的相关性,越接近1越准 · t=${fmt(mv.t_nw, 1)} · ${mv.date || "—"}`, mv.ok ? "green" : "red"),
    tile("OOS IC(样本外)", fmt(mv.oos_ic, 4),
      mv.oos_ok ? "样本外预测力 · 显著通过 ✅" : "样本外预测力未通过 ⚠", mv.oos_ok ? "green" : "red"),
    tile("Sharpe(全期)", pm ? fmt(pm.sharpe, 2) : "—",
      pm ? `收益风险比(越高越好) · ${esc(pmWin)} · 模拟净值口径` : "净值历史不足",
      pm ? (pm.sharpe >= 1 ? "green" : "amber") : ""),
    tile("最大回撤", pm ? fmtPct(pm.maxDd) : "—",
      pm ? `历史最坏: 从最高点最多跌 ${fmtPct(Math.abs(pm.maxDd))} · ${esc(pmWin)}` : "",
      pm ? (pm.maxDd < -0.08 ? "amber" : "green") : ""),
    tile("累计收益(模拟)", mult != null ? fmtPct(mult - 1, 0) : "—",
      mult != null ? `${esc(pmWin)} 区间总涨幅(已含滑点与手续费 · 初始资金 ${fmtMoney(st.starting_balance)} 起)` : "净值历史不足",
      mult != null ? (mult >= 1 ? "green" : "red") : ""),
    tile("最新信号", sig.date || "—",
      sig.rows ? `${sig.rows} 只候选` : "尚未生成", sig.date ? "green" : "amber"),
  ];

  let html = `<div class="grid tiles">${tiles.join("")}</div>
  <div class="grid tiles">${mTiles.join("")}</div>
  <div class="card"><h3>账户操作(纸上交易 · 不连券商)</h3>
    <div class="form-grid inline">
      <label>初始资金 <input id="ppInit" type="number" value="${fmtMoney(s.paper_starting_balance ?? st.starting_balance)}" step="1000"></label>
      <label>调仓 Top-N <input id="ppTop" type="number" value="${s.paper_top_n || 30}" min="1" max="100"></label>
      <label>滑点 % <input id="ppSlip" type="number" value="${s.paper_slippage_pct ?? 0.01}" step="0.01"></label>
      <label>手续费 % <input id="ppComm" type="number" value="${s.paper_commission_pct ?? 0.02}" step="0.01"></label>
    </div>
    <div class="btn-row">
      <button class="btn primary" onclick="paperInit()">初始化账户</button>
      <button class="btn" onclick="paperImportHoldings()">同步真实持仓(holdings.csv)</button>
      <button class="btn" onclick="paperRebalance()">按最新信号调仓</button>
      <button class="btn" onclick="paperSettle()">结算(标记市值)</button>
      <button class="btn danger" onclick="paperReset()">重置</button>
    </div>
    <p class="dim">「同步真实持仓」把 data/holdings.csv(symbol/entry_date/entry_price/qty)导入模拟账户: 现金 = 初始资金 − Σ(数量×入场价),立即按最新收盘结算一次。之后可手动/按信号调仓。</p>
    <p class="dim">调仓 = 卖出不在最新信号 Top-N 名单的持仓,再按现金等权买入名单内未持有者(最新面板收盘价 ± 滑点,双向手续费)。</p>
  </div>
  <div class="card"><h3>资金曲线${(() => { const bf = (st.equity_points || []).filter(p => p.backfill); return bf.length ? ` <span class="dim" style="font-weight:normal">· 含回溯重建 ${esc(bf[0].date)} → ${esc(bf[bf.length-1].date)}(按入场日回放买入 + 面板收盘 mark-to-market, 现金按入场日回放扣减)</span>` : ""; })()}</h3><canvas id="ppEquity"></canvas></div>
  <div class="grid two">
    <div class="card"><h3>持仓</h3><div id="ppPos"></div></div>
    <div class="card"><h3>成交流水(最近 50 笔)</h3><div id="ppTrades"></div></div>
  </div>
  <div class="card"><h3>券商卖出台账(data/sales.csv · src/sales_book.py 记账)</h3><div id="ppRealLedger"></div></div>`;

  el.innerHTML = html;

  const eq = st.equity_points || [];
  if (eq.length > 1) {
    const dates = eq.map(p => p.date);
    const eqData = eq.map(p => p.equity);
    const sales = ((st.real_account && st.real_account.rows) || []).slice()
      .sort((a, b) => a.sell_date < b.sell_date ? -1 : 1);
    // 累计已实现盈亏(券商台账): 按卖出日累计, 卖出后保持(阶梯线), 与净值共用时间轴
    let cum = 0, ri = 0;
    const realCum = dates.map((d, i) => {
      // 入金起点(origin)不代表任何持仓/卖出, 累计盈亏从第一个真实结算点开始
      if (eq[i] && eq[i].origin) return Math.round(cum * 100) / 100;
      while (ri < sales.length && sales[ri].sell_date <= d) { cum += (sales[ri].realized_pnl || 0); ri++; }
      return Math.round(cum * 100) / 100;
    });
    // 卖出日晚于净值末日时补点(净值线留空)
    while (ri < sales.length) { dates.push(sales[ri].sell_date); eqData.push(null); cum += (sales[ri].realized_pnl || 0); realCum.push(Math.round(cum * 100) / 100); ri++; }
    const datasets = [{ label: "账户净值", data: eqData, borderColor: "#4ade80", backgroundColor: "rgba(74,222,128,0.07)", fill: true, pointRadius: 0, borderWidth: 1.5 }];
    const scales = { x: { grid: CHART_STYLE.grid, ticks: { color: "#8a94a8", maxTicksLimit: 10 } }, y: { grid: CHART_STYLE.grid, ticks: CHART_STYLE.ticks } };
    if (sales.length) {
      datasets.push({ label: "累计已实现盈亏($)", data: realCum, borderColor: "#fbbf24", backgroundColor: "rgba(251,191,36,0.06)", fill: false, pointRadius: 0, borderWidth: 1.5, stepped: true, yAxisID: "y1" });
      scales.y1 = { position: "right", grid: { drawOnChartArea: false }, ticks: { color: "#fbbf24" } };
    }
    chart("ppEquity", {
      type: "line",
      data: { labels: dates, datasets },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: CHART_STYLE } },
        scales },
    });
  }
  const posEl = document.getElementById("ppPos");
  if (st.positions && st.positions.length) {
    posEl.innerHTML = `<table class="grid-tbl"><thead><tr><th>代码</th><th>数量</th><th>入场价</th><th>现价</th><th>盈亏%</th><th></th></tr></thead><tbody>${
      st.positions.map(p => `<tr><td><b>${esc(p.symbol)}</b></td><td>${esc(p.qty)}</td><td>${fmt(p.entry_price, 2)}</td><td>${fmt(p.last_price, 2)}</td><td>${fmtPct(p.pnl_pct)}</td>
      <td><button class="btn small" onclick="paperSell('${esc(p.symbol)}')">卖出</button></td></tr>`).join("")}</tbody></table>`;
  } else posEl.innerHTML = `<p class="dim">无持仓</p>`;

  const trEl = document.getElementById("ppTrades");
  if (st.trades && st.trades.length) {
    trEl.innerHTML = `<table class="grid-tbl"><thead><tr><th>日期</th><th>代码</th><th>方向</th><th>数量</th><th>价格</th><th>盈亏</th><th>原因</th></tr></thead><tbody>${
      st.trades.slice().reverse().map(t => `<tr><td>${esc(t.date)}</td><td><b>${esc(t.symbol)}</b></td><td>${t.side === "buy" ? "买" : "卖"}</td><td>${esc(t.qty)}</td><td>${fmt(t.price, 2)}</td><td>${t.side === "sell" ? fmtMoney(t.pnl) : "—"}</td><td>${esc(t.reason)}</td></tr>`).join("")}</tbody></table>`;
  } else trEl.innerHTML = `<p class="dim">暂无成交</p>`;

  const rlEl = document.getElementById("ppRealLedger");
  if (st.real_account && st.real_account.available && st.real_account.rows && st.real_account.rows.length) {
    rlEl.innerHTML = `<table class="grid-tbl"><thead><tr><th>卖出日</th><th>代码</th><th>卖出价</th><th>数量</th><th>入场日</th><th>入场价</th><th>盈亏$</th><th>盈亏%</th><th>备注</th></tr></thead><tbody>${
      st.real_account.rows.map(r => `<tr><td>${esc(r.sell_date)}</td><td><b>${esc(r.symbol)}</b></td><td>${fmt(r.sell_price, 2)}</td><td>${esc(r.qty)}</td><td>${esc(r.entry_date)}</td><td>${fmt(r.entry_price, 2)}</td><td>${r.realized_pnl >= 0 ? "+" : ""}${fmtMoney(r.realized_pnl)}</td><td>${r.realized_pct != null ? fmtPct(r.realized_pct) : "—"}</td><td>${esc(r.note)}</td></tr>`).join("")}</tbody></table>`;
  } else {
    rlEl.innerHTML = `<p class="dim">${esc((st.real_account && st.real_account.message) || "暂无卖出记录")}</p>`;
  }
  pollSet("hdr", pollHeader, 4000);
}

async function paperInit() {
  try {
    const r = await api("/api/paper/init", { method: "POST", body: JSON.stringify({ starting_balance: parseFloat($("#ppInit").value) || 100000 }) });
    toast(`账户已初始化 $${fmtMoney(r.state.cash)}`); renderPaper();
  } catch (e) { toast(e.message, false); }
}
async function paperImportHoldings() {
  if (!confirm("从 data/holdings.csv 导入真实持仓到模拟账户?\n\n导入前账户必须为空(无持仓)。")) return;
  try {
    const r = await api("/api/paper/import-holdings", { method: "POST", body: JSON.stringify({ starting_balance: parseFloat($("#ppInit").value) || 100000 }) });
    let msg = `已导入 ${r.n_positions} 个持仓,净值 $${fmtMoney(r.equity)} (${esc(r.date)})`;
    if (r.shortfall > 0) msg += ` ⚠ 初始资金不足,现金已归 0(缺口 $${fmtMoney(r.shortfall)})`;
    toast(msg);
    renderPaper();
  } catch (e) { toast(e.message, false); }
}
async function paperRebalance() {
  try {
    const r = await api("/api/paper/rebalance", { method: "POST", body: JSON.stringify({
      top_n: parseInt($("#ppTop").value, 10) || 30,
      slippage_pct: parseFloat($("#ppSlip").value) || 0, commission_pct: parseFloat($("#ppComm").value) || 0 }) });
    toast(`调仓完成: 买入 ${r.bought} 只,净值 $${fmtMoney(r.equity)} (${esc(r.date)})`);
    renderPaper();
  } catch (e) { toast(e.message, false); }
}
async function paperSettle() {
  try { const r = await api("/api/paper/settle", { method: "POST" }); toast(`已结算: 净值 $${fmtMoney(r.equity)}`); renderPaper(); }
  catch (e) { toast(e.message, false); }
}
async function paperSell(sym) {
  const qty = prompt(`卖出 ${sym} 数量(留空=全部):`);
  if (qty === null) return;
  try {
    const r = await api("/api/paper/sell", { method: "POST", body: JSON.stringify({ symbol: sym, qty: qty === "" ? null : parseInt(qty, 10) }) });
    toast(`已卖出 ${sym} ${r.qty} 股,盈亏 $${fmtMoney(r.pnl)}`); renderPaper();
  } catch (e) { toast(e.message, false); }
}
async function paperReset() {
  if (!confirm("重置模拟账户(清空持仓/流水/净值)?此操作不可恢复。")) return;
  try { await api("/api/paper/reset", { method: "POST" }); toast("已重置"); renderPaper(); }
  catch (e) { toast(e.message, false); }
}

/* 停止当前活跃任务(日志栏通用按钮) */
async function stopActive() {
  const tries = [["/api/train/stop", "训练"], ["/api/backtest/stop", "回测"], ["/api/backtest/panorama/stop", "全景OOS"], ["/api/validate/stop", "验证"], ["/api/signals/stop", "信号"], ["/api/evolve/stop", "自进化"], ["/api/research/stop", "一键研究"], ["/api/pipeline/stop", "流水线复核"]];
  for (const [url, name] of tries) {
    try {
      const r = await api(url, { method: "POST" });
      if (r.ok) { toast(`已停止${name}任务`); renderPage2(); return; }
    } catch (_) {}
  }
  toast("无运行中任务", false);
}
function renderPage2() {
  const activeStep = document.querySelector(".step.active");
  if (activeStep) showPage(activeStep.dataset.page);
}

/* ── 05 模型自进化 ────────────────────────────────────────────────── */
async function renderEvolve() {
  pollDrop("ev");
  const el = pageEl("evolve");
  el.innerHTML = `<div class="loading">加载自进化状态…</div>`;
  let ov, st;
  try { [ov, st] = await Promise.all([api("/api/evolve/overview"), api("/api/evolve/status")]); }
  catch (e) { el.innerHTML = `<div class="err-box">加载失败: ${esc(e.message)}</div>`; return; }

  const active = st.status.active;
  const decay = ov.decay || {};
  const diag = ov.diagnosis || {};
  const death = ov.model_death || {};
  const mv = ov.model_validity || {};
  const ch = ov.champion_history || {};
  const rs = ov.retrain_state || {};
  const qrm = ov.quality_regime || {};
  const man = ov.deploy_manifest || {};
  const phes = ov.param_health_summary || {};
  const pvs = ov.production_validation_summary || {};
  const tq = ov.trade_quality || {};
  const tf = ov.tile_freshness || {};

  const healthCls = (h) => h === "healthy" ? "green" : (h === "adverse" ? "red" : "amber");
  // 四灯数据新鲜度守卫: 每灯标注自身输入末日; 落后 ≥2 交易日 → 显示「数据滞后」
  // 而非真实判定(原判定保留在副行)。tf.tiles = [{key,cn,source,end,lag,stale}]。
  const tfm = (key) => ((tf.tiles || []).find(t => t.key === key) || {});
  const guarded = (key, label, value, sub, cls) => {
    const t = tfm(key);
    const endTag = t.end ? `末日 ${esc(t.end)}` : "";
    if (t.stale) {
      return tile(label, "⚠ 数据滞后",
        `${endTag} · 落后 ${t.lag} 交易日 · 原判定: ${value}${sub ? `(${sub})` : ""}`,
        "red");
    }
    return tile(label, value, [sub, endTag].filter(Boolean).join(" · "), cls);
  };
  const tiles = [
    guarded("decay", "滚动 60D IC", fmt(decay.roll_ic, 4), `长期均值 ${fmt(decay.long_mean, 4)}`, decay.roll_ic > 0.05 ? "green" : "amber"),
    guarded("decay", "衰减联动暴露封顶", fmtP(decay.exposure_override, 0), decay.exposure_override < 1 ? "⚠ 已降仓" : "未触发", decay.exposure_override < 1 ? "amber" : "green"),
    tile("模型健康", esc(diag.model_health || "—"), `执行 ${esc(diag.execution_health || "—")} · 市场 ${esc(diag.regime_health || "—")}`, healthCls(diag.model_health)),
    guarded("death", "死亡测试健康分", fmt(death.health, 0),
      `${esc(death.level || "—")}${death.date ? ` · 标签成熟日 ${esc(death.date)}` : ""}`, death.health >= 70 ? "green" : "red"),
    tile("重训样本新增", fmtMoney(rs.added_since_baseline != null ? rs.added_since_baseline : rs.n_realized),
      `阈值 ${fmtMoney(ov.retrain_threshold)} · 基线 ${esc(rs.baseline_at || "—")}${rs.current_total != null ? `(已走完 ${fmtMoney(rs.current_total)})` : ""}`,
      (rs.added_since_baseline != null ? rs.added_since_baseline : rs.n_realized) >= ov.retrain_threshold ? "amber" : "green"),
    tile("竞技场新冠军(候选)", esc(ch.champion || "—"),
      [ch.date ? esc(ch.date) : "", ch.score != null ? `综合分 ${fmt(ch.score, 3)}` : "",
       ch.streak != null && ch.req_streak ? `连冠 ${ch.streak}/${ch.req_streak} 周` : "",
       ch.streak_ok === false ? "⚠ 生产未切换" : ""].filter(Boolean).join(" · "),
      ch.streak_ok ? "green" : "amber"),
    tile("回滚快照", ov.rollback ? `${esc(ov.rollback.snapshotted_at || "—")}` : "无", ov.rollback ? `${esc(ov.rollback.n_files)} 个文件` : "", ""),
    tile("参数体检(双窗口)", phes.n_groups ? `${phes.n_groups - phes.n_drift}/${phes.n_groups} 组稳定` : "—",
      phes.n_drift ? `⚠ 漂移: ${esc((phes.drift || []).join("、"))}` : (phes.n_groups ? "无漂移" : "缺 param_health.json"),
      phes.n_drift ? "amber" : "green"),
    tile("生产全项检验", pvs.total ? `${pvs.passed}/${pvs.total} 通过` : "—",
      pvs.ok ? "✅ 全部通过(15 项计分卡)" : `❌ 失败: ${esc((pvs.failed || []).join("、")) || "未通过"}`,
      pvs.ok ? "green" : "red"),
    guarded("style", "选股风格橙灯", qrm.orange ? "🔴 亮起" : "正常",
      qrm.orange ? `动量偏差 ${fmtP(qrm.mom_bias_pp_4w / 100, 1)} · 行业排名 ${fmt(qrm.ind_rank_4w, 2)}` : `as_of ${esc(qrm.as_of || "—")}`, qrm.orange ? "red" : "green"),
    guarded("quality", "选股质量 PF", fmt(tq.pf, 2),
      `胜率 ${fmtP(tq.win_rate, 0)} (n=${tq.n || "—"})${tq.degraded ? " · 🔴 degraded" : ""}`, tq.degraded ? "red" : "green"),
  ];

  const staleN = (tf.tiles || []).filter(t => t.stale).length;
  let html = (tf.reference
    ? `<p class="dim">🔎 四灯数据新鲜度: 参考最新交易日 <b>${esc(tf.reference)}</b> · ${staleN ? `<b class="red">${staleN} 灯数据滞后</b>(末日见各灯, 落后 ≥2 交易日判滞后)` : "四灯数据均为最新"}</p>`
    : "") + `<div class="grid tiles">${tiles.join("")}</div>`;

  // 调度器
  const runBtns = ["daily", "midday", "weekly"].map(t => {
    const spec = ov.tasks[t];
    return `<button class="btn" onclick="runEvolve('${t}')">${esc(spec.label)}</button>`;
  }).join(" ");
  html += `<div class="card"><h3>自进化调度器(self_evolve.py)<span class="tag">cron/launchd 已安装时自动运行</span></h3>
    ${busySection(st.status)}
    <div class="btn-row">${runBtns}
      <button class="btn" onclick="runEvolve('report')">周报推送</button>
    </div>
    <p class="dim">每日 = 盘后信号+推送 · 盘中快报 = 轻量刷新+推送 · 周末 = 重建数据集→重训检查→竞技场→研究→冠军报告(数小时)。</p>
    ${logConsole("evLog")}
  </div>`;

  // 重训
  html += `<div class="card"><h3>模型重训(retrain.py)<span class="tag warn-tag">会替换生产模型(自进化许可路径)</span></h3>
    <div class="btn-row">
      <button class="btn" onclick="runEvolve('retrain_dry')">检查重训状态(不动作)</button>
      <button class="btn" onclick="runEvolve('retrain')">标准重训(按 IC 状态)</button>
      <button class="btn danger" onclick="runEvolve('retrain_force')">强制重训</button>
    </div>
    <p class="dim">流程: 检查 IC → 退化或强制时训练 MLP+LGB → OOS 验证 → 通过才替换 models/ → shadow_live 确认。冻结规则(FROZEN_CHAMPION_V1)默认 2027-01-01 前不重训,标准重训只在自进化链判定退化时执行。</p>
  </div>`;

  // 竞技场
  let arenaRows = ov.arena_results || [];
  html += `<div class="grid two">`;
  html += `<div class="card"><h3>模型竞技场(最近一轮)</h3>
    ${ch.date ? `<p class="dim"><b>${esc(ch.date)} 判定:</b> 新冠军 <b>${esc(ch.champion)}</b> 双窗口达标${ch.pass_dual ? " ✅" : " ⚠"}
      ${ch.streak != null && ch.req_streak ? ` · 连冠 ${ch.streak}/${ch.req_streak} 周` : ""}
      ${ch.low_overlap ? ` · 与生产重叠 ${fmtP(ch.overlap, 0)} < 60% → 高换手,要求 +2 周` : ""}
      ${ch.rc_approved === false ? ` · rc_approved ✗(风控增益 ${fmt(ch.rc_gain_recent, 2)}/${fmt(ch.rc_gain_long, 2)})` : ""}
      → <b>生产保持 ens,未切换</b>(需 ${ch.req_streak || 3} 周连冠才允许部署替换)。</p>` : ""}
    <div class="btn-row">
      <button class="btn" onclick="runEvolve('arena')">跑竞技场(--registry, 数小时)</button>
      <button class="btn" onclick="runEvolve('research_refresh')">刷新研究面板链(→竞技场+IC表, 数小时)</button>
    </div>
    <p class="dim">刷新链: catboost_oos(--check-fresh, 5 折复检) → tri_fold6_kit(折6 tri/cat 延展至最新) → 竞技场对决 → ic_report 重出 IC 表。注: 研究 vintage 5 折测试窗固定止于 2026-06-01,刷新后 model_family_oos 末日仍约 05-29;延展到最新的是 tri_panel 折6 段与竞技场/IC 表。</p>
    ${arenaRows.length ? `<div class="table-scroll"><table class="grid-tbl"><thead><tr><th>模型</th><th>IC近</th><th>IC长</th><th>Sharpe近</th><th>Sharpe长</th><th>综合分</th><th>通过</th></tr></thead><tbody>${
      arenaRows.slice().sort((a, b) => (b.score || -9) - (a.score || -9)).map(r => `<tr><td><b>${esc(r.model)}</b></td><td>${fmt(r.ic_recent, 4)}</td><td>${fmt(r.ic_long, 4)}</td><td>${fmt(r.sharpe_recent, 2)}</td><td>${fmt(r.sharpe_long, 2)}</td><td>${fmt(r.score, 3)}</td><td>${r.pass ? "✅" : "—"}</td></tr>`).join("")}</tbody></table></div>` : `<p class="dim">暂无竞技场结果(每周 --weekly 自动跑)</p>`}
  </div>`;

  // 排队候选 + 部署
  const cands = ov.arena_candidates || [];
  html += `<div class="card"><h3>排队复核的候选特征集(竞技场注册表)</h3>
    ${cands.length ? `<div class="table-scroll"><table class="grid-tbl"><thead><tr><th>特征</th><th>入队时间</th><th>第一道闸门</th></tr></thead><tbody>${
      cands.map(c => `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.queued_at || "—")}</td><td>${esc(c.gate1 || "—")}</td></tr>`).join("")}</tbody></table></div>` : `<p class="dim">注册表为空(新因子需先通过 9 起点复核才能入队)</p>`}
  </div>`;
  html += `</div>`;

  // tri/cat 双窗口有效性(tri_model_validity.py) — 与 ens_60 逐项对照
  const tcv = ov.tri_cat_validity || {};
  const tcvRows = (key) => {
    const blk = tcv[key];
    if (!blk || !blk.full || !blk.full.model) return "";
    const m = blk.full.model, e = blk.full.ens || {};
    const d = blk.full.dm_vs_ens || {};
    const cal = (c) => c ? "[" + c.join(", ") + "]" : "—";
    const yr = (b) => b ? Object.entries(b).map(([y, v]) => `${y} ${fmt(v, 4)}`).join(" · ") : "—";
    const hl = (h) => (h == null) ? "—" : (h >= 40 ? "≥40d" : `${fmt(h, 0)}d`);
    const dmTxt = (dd) => {
      if (!dd || dd.dm == null) return "—";
      const win = dd.dm < 0 && dd.p < 0.05, lose = dd.dm > 0 && dd.p < 0.05;
      if (win) return `DM ${fmt(dd.dm, 2)} · p ${fmt(dd.p, 3)} · ${key} 占优 ${fmtP(dd.days_a_better, 0)}天 — ${key}_60 显著更优 ✅`;
      if (lose) return `DM ${fmt(dd.dm, 2)} · p ${fmt(dd.p, 3)} · ens 占优 ${fmtP(1 - dd.days_a_better, 0)}天 — ens_60 显著更优 ⚠`;
      return `DM ${fmt(dd.dm, 2)} · p ${fmt(dd.p, 3)} · ${key} 占优 ${fmtP(dd.days_a_better, 0)}天 — 无显著差异`;
    };
    const rows = [
      ["日度 IC", fmt(m.ic, 4), fmt(e.ic, 4), `Δ ${fmt((m.ic || 0) - (e.ic || 0), 4)}`],
      ["t_NW · 经验p", `${fmt(m.t_nw, 1)} · ${fmt(m.emp_p, 3)}`, `${fmt(e.t_nw, 1)} · ${fmt(e.emp_p, 3)}`, ""],
      ["IC>0 天数占比", fmtP(m.pct_pos_days, 0), fmtP(e.pct_pos_days, 0), ""],
      ["十分位单调 Spearman", fmt(m.spearman, 3), fmt(e.spearman, 3), m.spearman >= 0.7 ? "✅" : "⚠"],
      ["五分位命中率", cal(m.cal_hitrates), cal(e.cal_hitrates), m.monotone ? "单调 ✅" : "⚠"],
      ["滚动60日IC>0占比", fmtP(m.roll_pos, 0), fmtP(e.roll_pos, 0), ""],
      ["10日兑现IC · 半衰期", `${fmt(m.short10_ic, 4)} · ${hl(m.half_life)}`, `${fmt(e.short10_ic, 4)} · ${hl(e.half_life)}`, ""],
      ["非重叠窗IC", fmt(m.non_overlap_ic, 4), fmt(e.non_overlap_ic, 4), ""],
      ["分年IC", yr(m.by_year), yr(e.by_year), ""],
      ["DM vs 简单因子", `${m.dm_win}/${m.dm_all} 胜`, `${e.dm_win}/${e.dm_all} 胜`, ""],
      ["风格中性 残差IC · t", `${fmt(m.style_neutral_si?.ic, 4)} · ${fmt(m.style_neutral_si?.t_nw, 1)}`, `${fmt(e.style_neutral_si?.ic, 4)} · ${fmt(e.style_neutral_si?.t_nw, 1)}`, ""],
      ["全窗判定", m.ok ? "✅ 全绿" : "⚠ 存在退化项", e.ok ? "✅ 全绿" : "⚠ 存在退化项", ""],
    ];
    const f6 = blk.fold6 || {}, pr = f6.promoted || {}, wip = f6.wip_sig || {};
    const f6line = pr.status === "active"
      ? `折6: ✅ 已升格判色(成熟日 ${f6.mature_days}) · ${key}_60 ${fmt(f6.model_mean, 4)} vs ens ${fmt(f6.ens_mean, 4)} · ${key} 占优 ${fmtP(f6.model_better_days, 0)}天`
      : `折6: ⏳ WIP 观察中(成熟日 ${f6.mature_days}/${pr.min_days},再 ${pr.needed_days} 天自动转正式四组检验) · ${key}_60 ${fmt(f6.model_mean, 4)} vs ens ${fmt(f6.ens_mean, 4)} · ${key} 占优 ${fmtP(f6.model_better_days, 0)}天 · WIP t_NW ${fmt(wip.t_nw, 1)}(小样本不判色)`;
    return `<div class="card"><h4>${key}_60 vs ens_60 <span class="tag">${esc(blk.updated || "—")} 更新</span></h4>
      <div class="table-scroll"><table class="grid-tbl"><thead><tr><th>检验项(全窗 1212 天)</th><th>${key}_60</th><th>ens_60</th><th>Δ / 说明</th></tr></thead><tbody>${
        rows.map(r => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td><td>${esc(r[3]) || "—"}</td></tr>`).join("")
      }</tbody></table></div>
      <p class="dim">${esc(dmTxt(d))}</p>
      <p class="dim">${esc(f6line)}</p>
    </div>`;
  };
  const tcvKeys = Object.keys(tcv);
  if (tcvKeys.length) {
    html += `<div class="card"><h3>tri/cat 双窗口有效性检验(tri_model_validity.py)<span class="tag warn-tag">与 ens_60 逐项对照</span></h3>
      <div class="btn-row"><button class="btn" onclick="runEvolve('tri_cat_validity')">重新跑检验(2-5 分钟)</button></div>
      <p class="dim">全窗 = 研究 walk-forward(2021-08-02 → 2026-05-29);折6 段 = cat 冻结新训 + 生产 mlp/lgb 合成(tri 逐日秩平均)。函数与门槛全部复用 model_validity.py 同一套(IC/单调/calibration/时间稳定/衰减/DM/风格中性)。</p>
      <div class="grid two">${tcvKeys.map(tcvRows).join("")}</div>
    </div>`;
  }

  // 角色竞技场(高/低/时点)+ 标签冗余度地图(正交训练 Phase 0/1)
  const ras = ov.role_arenas || {};
  const roleCn = { high: "止盈", low: "止损", timing: "时点" };
  const lo = ov.label_orthogonality || {};
  const roleKeys = Object.keys(ras);
  if (roleKeys.length || lo.available) {
    const orthBtns = ["arena_high", "arena_low", "arena_timing", "label_orth"].map(t => {
      const spec = ov.tasks[t] || {};
      return `<button class="btn" onclick="runEvolve('${t}')">${esc(spec.label || t)}</button>`;
    }).join(" ");
    html += `<div class="card"><h3>角色竞技场 + 标签正交训练(Phase 0/1)<span class="tag warn-tag">四标签族各设擂台 · 不自动写生产</span></h3>
      <div class="btn-row">${orthBtns}</div>
      <p class="dim">每个角色擂台都含 🏭现役行 = 实盘专用模型(models/high|low|time_model.pt)按同协议打分,挑战者(新复核特征变体)须正面胜过它;此外双窗口 + 打乱 null 基线 + 首6月冷启动护栏。复核通过的特征按 label 进对应角色队列,再以 train_high/low/time/final --add-cols 重训该标签集(「挖到新特征 → 训练标签集」)。</p>
      <div class="grid two">`;
    for (const rk of roleKeys) {
      const ra = ras[rk] || {};
      if (!ra.available) {
        html += `<div class="card"><h4>${roleCn[rk] || rk} 角色竞技场</h4><p class="dim">尚未运行(点上方按钮跑 arena_${rk})</p></div>`;
        continue;
      }
      const c = ra.champion || {};
      const rws = (ra.rows || []).slice(-8).reverse();
      html += `<div class="card"><h4>${roleCn[rk] || rk} 角色双窗口竞技场</h4>
        <p class="dim">${c.date ? `冠军 <b>${esc(c.champion)}</b> · 双窗口达标 ${c.pass_dual ? "✅" : "⚠"} · 连冠 ${c.streak} 周 · 现役 ${esc(c.incumbent || "—")} · score ${fmt(c.score, 2)}` : "尚未跑出冠军"}</p>
        <div class="table-scroll"><table class="grid-tbl"><thead><tr><th>候选</th><th>窗口</th><th>判分IC</th><th>null</th><th>首6月</th><th>天数</th></tr></thead><tbody>${
          rws.map(x => `<tr><td><b>${esc(x.name)}</b>${x.is_prod ? ' <span class="tag ok-tag">🏭现役</span>' : ''}</td><td>${x.win === "recent" ? "近" : "长"}</td><td>${fmt(x.val_ic, 4)}</td><td>${fmt(x.null_ic, 4)}</td><td>${fmt(x.first_ic, 4)}</td><td>${fmt(x.ic_days, 0)}</td></tr>`).join("") || `<tr><td colspan="6" class="dim">空</td></tr>`
        }</tbody></table></div>
      </div>`;
    }
    if (lo.available) {
      const icR = (lo.ic || []);
      const resid = lo.resid_ic_vs_ret60 || {};
      html += `<div class="card"><h4>标签冗余度地图(Phase 0)</h4>
        <p class="dim">同特征同架构五任务 OOS · 残差 IC = 控制选股 ens 后的增量。残差 IC < 0.01 → 冗余,正交训练前剔除该头。${esc(lo.freeze_cut || "")} · ${esc(lo.updated || "")} 更新</p>
        <div class="table-scroll"><table class="grid-tbl"><thead><tr><th>任务</th><th>标签</th><th>OOS IC</th><th>残差IC(控ens)</th><th>解读</th></tr></thead><tbody>${
          icR.map(x => {
            const rd = resid[x.task] || {};
            let ver = "—";
            if (x.task === "ret60") ver = "基准";
            else if (rd.resid_ic == null) ver = "—";
            else if (rd.resid_ic < 0.01) ver = "⚠ 冗余";
            else ver = "✅ 有增量";
            return `<tr><td><b>${esc(x.task)}</b></td><td>${esc(x.label)}</td><td>${fmt(x.ic_mean, 4)}</td><td>${fmt(rd.resid_ic, 4)}</td><td>${ver}</td></tr>`;
          }).join("") || `<tr><td colspan="5" class="dim">空</td></tr>`
        }</tbody></table></div>
      </div>`;
    }
    html += `</div></div>`;
  }

  // 健康监控 + 部署
  html += `<div class="grid two">`;
  let alerts = (diag.alerts || []).map(a => `<li>⚠ ${esc(a)}</li>`).join("");
  html += `<div class="card"><h3>健康监控</h3>
    <table class="kv"><tbody>
      <tr><td>诊断时间</td><td>${esc(diag.timestamp || "—")}</td></tr>
      <tr><td>特征漂移 PSI</td><td>${fmt(diag.feature_drift, 3)}</td></tr>
      <tr><td>周检 IC</td><td>${fmt(mv.ic, 4)} / OOS ${fmt(mv.oos_ic, 4)} (${esc(mv.date || "—")})</td></tr>
      <tr><td>衰减告警</td><td>${(mv.slowdowns || []).length ? `${mv.slowdowns.length} 次减速事件` : "无"}</td></tr>
      <tr><td>死亡测试灯</td><td>${esc(JSON.stringify(death.lights || {}))}</td></tr>${(ov.panel_freshness && ov.panel_freshness.panels || []).map(pp => {
        let tag;
        if (pp.mode === "fixed") tag = `固定窗口(设计) ${esc(pp.last)}`;
        else if (pp.mode === "frozen") tag = `冻结存档 ${esc(pp.last)}`;
        else if (pp.behind == null || pp.behind <= 0) tag = `✅ ${esc(pp.last)}`;
        else tag = `⚠ 落后 ${pp.behind} 交易日(${esc(pp.last)})`;
        return `<tr><td>面板 ${esc(pp.name)}</td><td>${tag}</td></tr>`;
      }).join("")}
    </tbody></table>
    ${alerts ? `<ul class="note-list">${alerts}</ul>` : `<p class="dim">无告警</p>`}
    ${diag.recommended_action ? `<p class="dim">建议: ${esc(diag.recommended_action)}</p>` : ""}
  </div>`;
  html += `<div class="card"><h3>部署与回滚</h3>
    <table class="kv"><tbody>
      <tr><td>回滚快照</td><td>${ov.rollback ? `${esc(ov.rollback.snapshotted_at)} (${esc(ov.rollback.n_files)} 文件)` : "无"}</td></tr>
      <tr><td>日报站点部署</td><td>${man.ok ? `✅ ${esc(man.local || "")}` : "未部署/不可用"}</td></tr>
    </tbody></table>
    <div class="btn-row">
      <button class="btn" onclick="runEvolve('deploy')">部署日报站点</button>
      <button class="btn" onclick="runEvolve('report')">周报推送</button>
    </div>
  </div>`;
  html += `</div>`;

  el.innerHTML = html;
  pollLog("evLog", "/api/evolve/status", false);
  if (active) {
    pollSet("ev", async () => {
      try {
        const r = await api("/api/evolve/status");
        const lc = document.getElementById("evLog");
        if (lc) { lc.textContent = r.log_tail.join("\n"); lc.scrollTop = lc.scrollHeight; }
        if (!r.status.active) renderEvolve();
      } catch (_) {}
    }, 2500);
  } else {
    pollSet("hdr", pollHeader, 4000);
  }
}

async function runEvolve(task) {
  const labels = { daily: "每日自进化", midday: "盘中快报", weekly: "周末自进化(数小时)",
    retrain: "标准重训", retrain_force: "强制重训", retrain_dry: "状态检查",
    arena: "模型竞技场(选股,数小时)", tri_cat_validity: "tri/cat 有效性检验",
    arena_high: "止盈角色竞技场", arena_low: "止损角色竞技场",
    arena_timing: "时点角色竞技场", label_orth: "标签冗余度地图",
    research_refresh: "刷新研究面板链(数小时)", report: "周报推送", deploy: "部署日报站点" };
  if (task === "weekly" && !confirm("周末自进化链耗时长(重建数据集+竞技场等,可能数小时)。确认启动?")) return;
  if (task === "arena" && !confirm("模型竞技场(选股)需要训练多个模型,可能运行数小时。确认启动?")) return;
  if (task.startsWith("arena_") && !confirm("角色竞技场需为该标签族训练双窗口模型(约 10-40 分钟)。确认启动?")) return;
  if (task === "label_orth" && !confirm("标签冗余度地图要训练 5 个 OOS 模型(约 10-30 分钟)。确认启动?")) return;
  if ((task === "retrain" || task === "retrain_force") && !confirm("重训验证通过后会用新模型替换生产 models/。确认继续?")) return;
  if (task === "research_refresh" && !confirm("刷新研究面板链: catboost_oos 5折复检 → tri_fold6_kit 折6延展 → 竞技场对决(数小时) → 重出 IC 表。竞技场会替换新冠军结果,确认启动?")) return;
  try {
    const r = await api("/api/evolve/run", { method: "POST", body: JSON.stringify({ task }) });
    toast(`已启动: ${r.label}`);
    renderEvolve();
  } catch (e) { toast(e.message, false); }
}

/* ── 启动 ─────────────────────────────────────────────────────────── */
/* ── 01 批量训练对比(多组合) ───────────────────────────────────────── */
const BT_FEATS = [{ k: "base", t: "base · 26" }, { k: "swing", t: "swing · 33 ★" }, { k: "knife", t: "knife · 32" }, { k: "ar", t: "ar · 27" }];
const BT_MODELS = ["main", "mlp", "high", "low", "lgb_hl"];

function batchTrainCard(s, mt) {
  const mem = (s.batch_matrix || []).map(x => x[0] + "|" + x[1]);
  let h = `<div class="card"><h3>批量训练对比(一次勾选多个 模型×特征,逐项排队训练)<span class="tag warn-tag">输出实验目录</span></h3>
    <table class="grid-tbl bt-matrix"><thead><tr><th>模型类型</th>${BT_FEATS.map(f => `<th>${f.t}</th>`).join("")}</tr></thead><tbody>`;
  for (const k of BT_MODELS) {
    const sp = mt[k];
    if (!sp || !sp.feat) continue;
    const allow = sp.feat === true ? BT_FEATS.map(f => f.k) : ["base", "swing"];
    h += `<tr><td><b title="${esc(sp.label)}">${esc(k)}</b></td>`;
    for (const f of BT_FEATS) {
      if (!allow.includes(f.k)) { h += `<td class="dim" style="text-align:center">—</td>`; continue; }
      h += `<td style="text-align:center"><label class="chk"><input type="checkbox" class="btCell" value="${k}|${f.k}" ${mem.includes(k + "|" + f.k) ? "checked" : ""}></label></td>`;
    }
    h += `</tr>`;
  }
  h += `</tbody></table>
    <p class="dim">★=生产冠军特征集(swing·33)。逐项顺序训练(与单跑同一任务槽),每项输出 models_experiment/batch_&lt;ts&gt;/NN_&lt;model&gt;_&lt;feat&gt;/;完成后按折6样本外指标自动排序对比。</p>
    <div class="form-grid inline">
      <label>Epochs <input id="batchEpochs" type="number" value="${s.batch_epochs || 40}" min="1" max="200"></label>
      <label>留出测试集(月) <input id="batchHoldout" type="number" min="0" max="36" value="${s.batch_holdout || 0}" title="每项把窗口末尾 N 个月作为真测试集(训练不可见),跑完后按留出集指标对比排序。0=不启用。"></label>
      <label class="chk"><input id="batchRebuild" type="checkbox" ${s.batch_rebuild ? "checked" : ""}> 先重建数据集(吸收最新行情,慢)</label>
    </div>
    <div class="btn-row">
      <button class="btn primary" onclick="startBatch()">开始批量训练</button>
      <button class="btn danger" onclick="stopBatch()">停止批量</button>
    </div>
    <div id="batchBox"><p class="dim">读取批量状态…</p></div>
  </div>`;
  return h;
}

async function startBatch() {
  const cells = [...document.querySelectorAll(".btCell:checked")].map(c => c.value);
  if (!cells.length) { toast("请至少勾选一个 模型×特征集 组合", false); return; }
  const epochs = parseInt($("#batchEpochs").value, 10) || 40;
  const hol = parseInt($("#batchHoldout").value, 10) || 0;
  try {
    const r = await api("/api/train/batch/start", { method: "POST", body: JSON.stringify({
      items: cells.map(c => { const [a, b] = c.split("|"); return { model_type: a, feat_set: b }; }),
      epochs, rebuild_dataset: $("#batchRebuild").checked, holdout_months: hol }) });
    toast(`批量训练已启动: ${r.n} 个组合 · ${r.tag}${hol ? ` · 留出测试 ${hol} 个月` : ""}`);
    renderTrain();
  } catch (e) { toast(e.message, false); }
}
async function stopBatch() {
  try { const r = await api("/api/train/batch/stop", { method: "POST" }); toast(r.ok ? "已请求停止批量训练" : "无运行中任务"); renderTrain(); }
  catch (e) { toast(e.message, false); }
}

function batchRowState(r) {
  if (r.state === "done") return `<span class="tag ok-tag">✅ rc0</span>`;
  if (r.state === "failed") return `<span class="tag err-tag">✗ rc${r.rc}</span>`;
  if (r.state === "running") return `<span class="tag busy-tag"><i class="spin"></i> 训练中</span>`;
  return `<span class="tag">排队</span>`;
}

function batchJobsTable(bts, mt) {
  if (!bts.dir) return `<p class="dim">尚未运行过批量训练。勾选上方矩阵组合 → 「开始批量训练」;每项完成后自动进入下方对比表(折6 列为同特征集盘上独立折6结果,非本批产物直接回测)。</p>`;
  const oos = bts.oos || {};
  const rmap = {}; (bts.results || []).forEach(r => { rmap[r.idx] = r; });
  const rows = (bts.items || []).map(it => Object.assign({}, it, rmap[it.idx] || { state: "pending" }));
  const done = rows.filter(r => r.state === "done");
  const rest = rows.filter(r => r.state !== "done").sort((a, b) => a.idx - b.idx);
  const hoOf = r => (r.holdout && r.holdout.horizons && r.holdout.horizons["60"] && r.holdout.horizons["60"].sharpe != null) ? r.holdout.horizons["60"] : null;
  const sharpeOf = r => (hoOf(r) && hoOf(r).sharpe != null) ? hoOf(r).sharpe
    : (r.state === "done" && r.model_type !== "lgb_hl" && r.model_type !== "high" && r.model_type !== "low" && oos[r.feat_set] && oos[r.feat_set].top50_sharpe != null) ? oos[r.feat_set].top50_sharpe : null;
  done.sort((a, b) => (sharpeOf(b) ?? -9) - (sharpeOf(a) ?? -9));
  const order = rest.concat(done);
  const span = (bts.manager && bts.manager.job && bts.manager.job.label) ? esc(bts.manager.job.label) : "";
  const hasHo = done.some(r => hoOf(r));
  let h = `<div class="busy-bar-lite">批量目录: ${esc(bts.dir)}${bts.created_at ? " · 创建于 " + esc(bts.created_at) : ""}${span ? " · " + span : ""}</div>
    <table class="grid-tbl"><thead><tr><th>#</th><th>状态</th><th>模型×特征</th><th>耗时</th><th>训练样本</th><th>特征数</th><th>训练区间</th><th>留出测试 IC(60d)</th><th>留出测试 Sharpe</th><th>折6 OOS Sharpe</th><th>折6 MDD</th><th>折6 ens60 IC</th></tr></thead><tbody>`;
  for (const r of order) {
    const c = r.config || {};
    const sp = mt[r.model_type] || {};
    const sharpe = sharpeOf(r);
    const ho = hoOf(r);
    const f6 = (r.model_type === "main" || r.model_type === "mlp") ? (oos[r.feat_set] || null) : null;
    h += `<tr><td>${r.idx}</td><td>${batchRowState(r)}</td>
      <td><b title="${esc(sp.label || r.model_type)}">${esc(r.model_type)}</b> × ${esc(r.feat_set)}</td>
      <td>${isBad(r.duration_s) ? "—" : fmt(r.duration_s, 0) + "s"}</td>
      <td>${isBad(c.n_train_samples) ? "—" : fmtMoney(c.n_train_samples)}</td>
      <td>${esc(c.n_features ?? "—")}</td>
      <td>${esc(String(c.date_min || "—").slice(0, 10))} → ${esc(String(c.date_max || "—").slice(0, 10))}</td>
      <td>${ho ? `<b class="${ho.ic >= 0.05 ? "pos" : ""}">${fmt(ho.ic, 4)}</b><span class="dim"> (t ${fmt(ho.ic_t, 1)})</span>` : "—"}</td>
      <td>${ho ? `<b class="${ho.sharpe >= 1 ? "pos" : ""}">${fmt(ho.sharpe, 2)}</b>` : "—"}</td>
      <td><b class="${sharpe != null && !ho && sharpe >= 1 ? "pos" : ""}">${sharpe != null ? fmt(sharpe, 2) : (f6 ? "—" : "·")}</b></td>
      <td>${f6 ? fmtPct(f6.top50_mdd) : "·"}</td>
      <td>${f6 ? fmt(f6.ens60_ic, 4) : "·"}</td></tr>`;
  }
  h += `</tbody></table>`;
  const stuck = rows.filter(r => r.state === "running" && !bts.batch_active).length;
  if (stuck) {
    h += `<p class="dim">⚠ 上一批被停止/中断:${stuck} 项停在「训练中」(未写入结束状态)。继续在下方勾选新组合开新批即可;残留目录可手动删除。</p>`;
  }
  if (done.length) {
    h += `<p class="dim">${hasHo ? "排序键 = 留出测试集 Sharpe(窗口末尾 N 月,训练不可见,ens_60 逐日 Top30 标签均值序列年化 √252;IC=逐日秩相关均值与 t)。" : "排序键 = 折6样本外 Sharpe(output/fold6_&lt;feat&gt;_result.json,同特征集同架构独立折6,main/mlp 才可比;high/low/lgb_hl 目标不同不排此轴)。"}完成 ${done.length}/${rows.length}。留出集 Sharpe 是信号代理(60d 前向标签),非真实回测;真实绩效需部署后走回测页引擎。</p>`;
  } else if (bts.batch_active) {
    h += `<p class="dim">首项训练进行中…(每项完成后自动加入表内并实时刷新;日志见上方「运行日志」)。</p>`;
  } else {
    h += `<p class="dim">上一批已结束:${done.length}/${rows.length} 成功;可再勾选新组合开新批。</p>`;
  }
  return h;
}

function renderBatchBox(bts, mt) {
  const box = document.getElementById("batchBox");
  if (!box) return;
  box.innerHTML = batchJobsTable(bts, mt);
}

/* ── 06 候选特征流水线 ─────────────────────────────────────────────── */
async function renderPipeline() {
  pollDrop("pipe");
  const el = pageEl("pipeline");
  el.innerHTML = `<div class="loading">加载候选特征流水线…</div>`;
  let st;
  try { st = await api("/api/pipeline/status"); }
  catch (e) { el.innerHTML = `<div class="err-box">加载失败: ${esc(e.message)}</div>`; return; }
  const stages = st.stages || {};
  const m = stages.mined || {}; const reg = stages.registry || {};
  const aq = stages.arena_queue || {}; const ar = stages.arena_models || {};
  const gap = st.gap || {};
  const active = st.job.active;

  const gRow = (label, n, warn) => `<tr><td>${label}</td><td><b class="${n > 0 && warn ? "neg" : ""}">${n}</b></td><td class="dim">${warn ? "⚠ 缺口:未自动进入下一阶段" : "已衔接"}</td></tr>`;
  let html = `<div class="card"><h3>全链路缺口诊断(数据文件即事实来源)</h3>
    <table class="grid-tbl"><thead><tr><th>环节</th><th>数量</th><th>状态</th></tr></thead><tbody>
      ${gRow("① 自动挖掘达标候选(auto_mined_candidates.json)", gap.n_mined, false)}
      ${gRow("② 未登记进复核表(feature_candidates.json)", gap.n_unregistered_gap, gap.n_unregistered_gap > 0)}
      ${gRow("③ 登记待复核(9起点)", gap.n_pending_review, gap.n_pending_review > 0)}
      ${gRow("④ 复核通过但未入竞技场队列(arena_candidate_sets.json)", gap.n_passed_not_queued, gap.n_passed_not_queued > 0)}
    </tbody></table>
    <p class="dim">已知缺口:自动挖掘产物不会自动进入 9 起点复核登记表(两表分离,无桥)——由下方「一键转登记」补齐;复核消费完队列后,新通过候选需触发竞技场(--registry)排队。</p></div>`;

  const pipe = [
    { t: "自动挖掘", sub: "auto_feature_mining", cnt: `${gap.n_mined || 0} 候选`, mtime: m.mtime },
    { t: "9起点复核", sub: "feature_candidates.json", cnt: `${(reg.rows || []).length} 登记`, mtime: reg.mtime },
    { t: "竞技场排队", sub: "arena_candidate_sets.json", cnt: `${(aq.sets || []).length} 套`, mtime: aq.mtime },
    { t: "竞技场对决", sub: "model_arena.csv", cnt: `${(ar.rows || []).length} 模型`, mtime: ar.mtime },
  ];
  html += `<div class="card"><h3>流水线四阶段</h3><div class="pipe">`;
  pipe.forEach((s2, i) => {
    html += `<div class="pipe-stage"><div class="pipe-num">0${i + 1}</div><b>${esc(s2.t)}</b>
      <div class="dim">${esc(s2.cnt)}</div><div class="dim">${esc(s2.sub)} · ${esc(s2.mtime || "缺文件")}</div></div>`;
    if (i < 3) html += `<div class="pipe-arrow">→</div>`;
  });
  html += `</div>
    ${busySection(st.job)}
    <div class="form-grid inline">
      <label>转登记 IC 门槛 <input id="pipeMinIc" type="number" step="0.005" value="0.03" min="0"></label>
      <label>一次上限 <input id="pipeLimit" type="number" value="100" min="1"></label>
    </div>
    <div class="btn-row">
      <button class="btn primary" onclick="pipeBridge()">一键转登记(自动挖掘 → 复核表)</button>
      <button class="btn" onclick="pipeReview()">9起点复核(消费待审队列)</button>
      <button class="btn danger" onclick="stopPipeline()">停止</button>
    </div>
    ${logConsole("pipeLog")}
  </div>`;

  html += `<div class="card"><h3>① 自动挖掘产物(按 60D IC 降序,前 30)</h3>`;
  if (m.available && m.rows && m.rows.length) {
    html += `<div class="table-scroll"><table class="grid-tbl"><thead><tr><th>特征名</th><th>IC(60d)</th><th>样本</th><th>发现时间</th><th>状态</th></tr></thead><tbody>`;
    for (const r of m.rows.slice(0, 30)) {
      html += `<tr><td><b>${esc(r.name)}</b></td><td>${fmt(r.ic_60d, 4)}</td><td>${isBad(r.n_samples) ? "—" : fmtMoney(r.n_samples)}</td><td>${esc(r.discovered_at || "—")}</td><td>${esc(r.status || "—")}</td></tr>`;
    }
    html += `</tbody></table></div>`;
  } else html += `<p class="warn">${esc(m.message || "暂无自动挖掘结果")}</p>`;
  html += `<p class="dim">运行:自进化页「周末自进化」含挖掘步骤,或命令行 python src/auto_feature_mining.py(研究池;达标 = IC ≥ 0.03 且非单列重复)。</p></div>`;

  const dist = reg.status_dist || {};
  html += `<div class="card"><h3>② 9起点复核登记表(feature_candidates.json)</h3>
    ${reg.available ? `<p class="dim">状态分布:${Object.entries(dist).map(([k, v]) => `${esc(k)} ${v}`).join(" · ") || "空"}</p>` : ""}
    <div class="table-scroll"><table class="grid-tbl"><thead><tr><th>特征</th><th>表达式</th><th>状态</th><th>入队</th><th>来源</th><th>快检IC</th></tr></thead><tbody>`;
  if (reg.available && reg.rows && reg.rows.length) {
    for (const r of reg.rows.slice(0, 25)) {
      const st2 = r.status || "待复核";
      const cls = st2 === "通过" ? "ok-tag" : (st2 === "待复核" ? "warn-tag" : "");
      html += `<tr><td><b>${esc(r.name)}</b></td><td class="dim">${esc(r.expr || "")}</td><td><span class="tag ${cls}">${esc(st2)}</span></td><td>${esc(r.queued_at || "—")}</td><td>${esc(r.source || "—")}</td><td>${fmt(r.quick_ic_60d, 4)}</td></tr>`;
    }
    html += `</tbody></table></div><p class="dim">复核由 src/feature_rolling_review.py --candidates 消费待审队列(9 个滚动起点 × 双窗口,通过才推竞技场)。</p>`;
  } else html += `<p class="warn">${esc(reg.message || "登记表为空")}</p>`;
  html += `</div>`;

  html += `<div class="card"><h3>③ 竞技场排队候选(arena_candidate_sets.json)</h3>`;
  if (aq.available && aq.sets && aq.sets.length) {
    html += `<div class="table-scroll"><table class="grid-tbl"><thead><tr><th>候选集</th><th>特征</th></tr></thead><tbody>`;
    for (const setv of aq.sets.slice(0, 15)) {
      html += `<tr><td><b>${esc(setv.name || setv.label || "?")}</b></td><td class="dim">${esc((setv.features || []).join(", "))}</td></tr>`;
    }
    html += `</tbody></table></div><p class="dim">队列非空时,自进化页「模型竞技场(--registry)」把队首并入新一轮对决。</p>`;
  } else html += `<p class="warn">${esc(aq.message || "竞技场队列为空(需先有候选通过复核)")}</p>`;
  html += `</div>`;

  html += `<div class="card"><h3>④ 最近一轮竞技场结果(model_arena.csv)</h3>`;
  if (ar.available && ar.rows && ar.rows.length) {
    const sorted = ar.rows.slice().sort((a, b) => (b.score ?? -9) - (a.score ?? -9));
    html += `<div class="table-scroll"><table class="grid-tbl"><thead><tr><th>模型</th><th>IC近</th><th>IC长</th><th>Sharpe近</th><th>Sharpe长</th><th>综合分</th><th>通过</th></tr></thead><tbody>`;
    for (const r of sorted.slice(0, 15)) {
      html += `<tr><td><b>${esc(r.model)}</b></td><td>${fmt(r.ic_recent, 4)}</td><td>${fmt(r.ic_long, 4)}</td><td>${fmt(r.sharpe_recent, 2)}</td><td>${fmt(r.sharpe_long, 2)}</td><td>${fmt(r.score, 3)}</td><td>${r.pass ? "✅" : "—"}</td></tr>`;
    }
    html += `</tbody></table></div><p class="dim">通过(✅)仅进入候选集成实验;生产替换仍受 FROZEN_CHAMPION_V1 冻结与部署回滚约束。</p>`;
  } else html += `<p class="warn">${esc(ar.message || "暂无竞技场结果")}</p>`;
  html += `</div>`;

  el.innerHTML = html;
  pollLog("pipeLog", "/api/pipeline/status", false);
  if (active) {
    pollSet("pipe", async () => {
      try {
        const r = await api("/api/pipeline/status");
        const lc = document.getElementById("pipeLog");
        if (lc) { lc.textContent = (r.log_tail || []).join("\n"); lc.scrollTop = lc.scrollHeight; }
        if (!r.job.active) renderPipeline();
      } catch (_) {}
    }, 2500);
  } else {
    pollSet("hdr", pollHeader, 4000);
  }
}

async function pipeBridge() {
  const minIc = parseFloat($("#pipeMinIc").value || "0.03");
  const limit = parseInt($("#pipeLimit").value, 10) || 100;
  if (!confirm(`把自动挖掘池中 IC ≥ ${minIc} 的候选翻译成 9 起点复核登记表行(去重,最多 ${limit} 条)?`)) return;
  try {
    const r = await api("/api/pipeline/bridge", { method: "POST", body: JSON.stringify({ min_ic: minIc, limit }) });
    toast(r.added ? r.message : (r.message || "无可转登记"), r.added > 0);
    renderPipeline();
  } catch (e) { toast(e.message, false); }
}
async function pipeReview() {
  try { const r = await api("/api/pipeline/review", { method: "POST" }); toast("9起点复核已启动(逐条消费待审队列)"); renderPipeline(); }
  catch (e) { toast(e.message, false); }
}
async function stopPipeline() {
  try { const r = await api("/api/pipeline/stop", { method: "POST" }); toast(r.ok ? "已停止流水线复核" : "无运行中任务"); renderPipeline(); }
  catch (e) { toast(e.message, false); }
}


/* ── 03 个股行情弹窗(点击信号行) ───────────────────────────────────── */
function wireSignalRows() {
  const tb = document.querySelector("#sgTable tbody");
  if (!tb || tb.dataset.wired) return;
  tb.dataset.wired = "1";
  tb.addEventListener("click", (ev) => {
    const tr = ev.target.closest("tr");
    if (!tr) return;
    const sym = (tr.querySelector("td")?.textContent || "").trim();
    const row = SIG_ROWS[sym];
    if (row) openSymbolChart(sym, row);
  });
}

async function openSymbolChart(symbol, row) {
  const ov = document.getElementById("pxModal");
  if (!ov) return;
  const num = (v) => (v == null || v === "" || Number.isNaN(Number(v))) ? null : Number(v);
  ov.hidden = false;
  ov.style.display = "flex";
  document.getElementById("pxTitle").textContent = `${symbol} · 价格走势`;
  document.getElementById("pxSub").textContent = row ? `${row.name || ""}${row.asset_type ? " · " + row.asset_type : ""}` : "";
  document.getElementById("pxMeta").textContent = "";
  document.getElementById("pxBody").innerHTML = `<div class="loading">加载 ${esc(symbol)} 行情…</div>`;
  if (charts.pxChart) { charts.pxChart.destroy(); delete charts.pxChart; }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  let px;
  // 价格/K线/成交量/预测轨迹统一取最近 3 个月(months=3),不再展示一整年
  try { px = await api(`/api/signals/price?symbol=${encodeURIComponent(symbol)}&months=3`, { signal: ctrl.signal }); }
  catch (e) {
    clearTimeout(timer);
    const msg = (e && e.name === "AbortError")
      ? "请求超时(12s)——后端 run_web.py 可能已停止,请重启后重试"
      : String((e && e.message) || e);
    document.getElementById("pxBody").innerHTML =
      `<div class="err-box"><p>行情加载失败: ${esc(msg)}</p>
       <div class="btn-row"><button class="btn" onclick="openSymbolChart('${esc(symbol)}', window.SIG_ROWS && window.SIG_ROWS['${esc(symbol)}'])">重试</button>
       <button class="btn" onclick="closePxModal()">关闭</button></div></div>`;
    return;
  }
  clearTimeout(timer);
  if (!px.available) {
    const r0 = row || {};
    document.getElementById("pxBody").innerHTML = `<div class="card warn"><p>${esc(px.message || "无行情")}</p>
      <p class="dim">该信号行仍给出计划参考:入场 ${esc(r0.entry ?? "—")} · 目标 ${esc(r0.target ?? "—")} · 止损 ${esc(r0.stop ?? "—")}(符号不在逐日 panel 中,可能是新股/退市/杠杆加密池,需刷新行情后重试)。</p>
      <div class="btn-row"><button class="btn" onclick="closePxModal()">关闭</button></div></div>`;
    return;
  }
  const entry = num(row && row.entry) ?? num(row && row.close) ?? px.last_close;
  const target = num(row && row.target);
  const stop = num(row && row.stop);
  const labels = px.dates || [];
  const trail = px.pred_trail || [];
  const closes = px.closes || [];  // 共享: 主图 pred 折算 + 页脚 pred 真实价
  const dayAt = (i) => new Date(labels[i] + "T00:00:00");
  const hasCandles = (() => {
    try { return !!(window.Chart && Chart.registry && Chart.registry.getController("candlestick")); }
    catch (_) { return false; }
  })();
  if (charts.pxVol) { charts.pxVol.destroy(); delete charts.pxVol; }
  if (charts.pxPred) { charts.pxPred.destroy(); delete charts.pxPred; }

  if (hasCandles) {
    // chartjs-chart-financial@0.2.1 三大约束(实测,不是猜):
    //  1) 原始项必须带 .o/.h/.l/.c 字段;
    //  2) x 必须是数值时间戳(ms,Date 对象会让柱宽/间距算法算错 → 蜡烛叠成一片);
    //  3) x 轴不要显式指定 type,让插件默认 timeseries 生效。
    try {
      const elDefs = Chart.defaults.elements.candlestick;
      if (elDefs) {
        elDefs.backgroundColors = { up: "#ef4444", down: "#22c55e", unchanged: "#8a94a8" };
        elDefs.borderColors = { up: "#ef4444", down: "#22c55e", unchanged: "#8a94a8" };
      }
    } catch (_) {}
    const tms = (i) => Date.parse(labels[i] + "T00:00:00");
    const bars = [];
    for (let i = 0; i < labels.length; i++) {
      const o = px.opens && px.opens[i], h = px.highs && px.highs[i];
      const l = px.lows && px.lows[i], c = px.closes && px.closes[i];
      if (o == null || h == null || l == null || c == null) continue;
      bars.push({ x: tms(i), o, h, l, c });
    }
    const lvlD = (label, val, color, dash) => (val == null || !labels.length) ? null
      : { type: "line", label, data: labels.map((_, i) => ({ x: tms(i), y: val })),
          borderColor: color, borderDash: dash, pointRadius: 0, borderWidth: 1.3, fill: false, spanGaps: true };
    const extra = [lvlD("入场", entry, "#fbbf24", [9, 5]),
                   lvlD("目标", target, "#4ade80", [3, 3]),
                   lvlD("止损", stop, "#f87171", [5, 3])].filter(Boolean);
    const vols = px.volumes || [];
    document.getElementById("pxBody").innerHTML =
      `<div class="px-pane" style="height:400px"><canvas id="pxChart"></canvas></div>
       <div class="px-pane" style="height:140px;margin-top:6px"><canvas id="pxVol"></canvas></div>`;
    const pxX = { time: { unit: "month" }, grid: CHART_STYLE.grid,
                  ticks: { color: "#8a94a8", maxTicksLimit: 8 } };  // 不写 type → 用插件默认 timeseries

    // ── 成交量柱:原生 canvas 绘制。柱中心 = 蜡烛 x 轴同一把尺(getPixelForValue),
    //    柱宽 = 该日槽宽(相邻日中点的像素差)→ 第 k 根柱与第 k 根蜡烛严格同像素。
    //    volPlugin 在蜡烛每次布局(afterLayout,含 resize/update/字体回流)后自动重绘 → 永不错位。
    const volSync = { draw: null };
    const drawVol = () => {
      const cv = document.getElementById("pxVol");
      const cMain = Chart.getChart("pxChart");
      if (!cv || !cMain || !cMain.scales || !cMain.scales.x) return;
      const sx = cMain.scales.x;
      const dpr = window.devicePixelRatio || 1;
      const cssW = cv.clientWidth || (cv.parentElement && cv.parentElement.clientWidth) || 0;
      const cssH = cv.clientHeight || (cv.parentElement && cv.parentElement.clientHeight) || 0;
      if (!cssW || !cssH) return;
      cv.width = Math.round(cssW * dpr);
      cv.height = Math.round(cssH * dpr);
      const ctx = cv.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      const vmax = vols.length ? Math.max.apply(null, vols.map(v => Number(v) || 0)) : 0;
      if (!vmax) return;
      const nice = vmax * 1.15;
      const base = cssH - 4;
      const x0 = Math.max(0, sx.chartArea ? sx.chartArea.left : 0);
      const x1 = sx.chartArea ? sx.chartArea.right : cssW;
      const xs = [];
      for (let i = 0; i < labels.length; i++) {
        const ts = tms(i);
        if (ts == null || labels[i] == null) continue;
        xs.push({ i, ts, px: sx.getPixelForValue(ts) });
      }
      ctx.font = "11px ui-monospace, Menlo, monospace";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      const mkTxt = (v) => (v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? (v / 1e3).toFixed(0) + "K" : String(Math.round(v)));
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.fillStyle = "#8a94a8";
      for (const f of [0.5, 1]) {
        const yy = base - base * f;
        ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x1, yy); ctx.stroke();
        ctx.fillText(mkTxt(vmax * f), x1 - 4, yy);
      }
      for (let k = 0; k < xs.length; k++) {
        const { i, ts, px: xc } = xs[k];
        if (xc < x0 || xc > x1) continue;
        const xa = (k === 0) ? xc - (xs.length > 1 ? (xs[1].px - xc) / 2 : 0) : (xs[k - 1].px + xc) / 2;
        const xb = (k === xs.length - 1) ? xc + (xs.length > 1 ? (xc - xs[k - 1].px) / 2 : 0) : (xs[k + 1].px + xc) / 2;
        const w = Math.max(1, (xb - xa) * 0.62);
        const v = Number(vols[i]) || 0;
        const h = Math.max(0.5, base * (v / nice));
        const up = i > 0 && closes[i - 1] != null && closes[i] != null && closes[i] >= closes[i - 1];
        ctx.fillStyle = up ? "rgba(34,197,94,0.8)" : "rgba(239,68,68,0.8)";
        ctx.fillRect(Math.round(xc - w / 2), base - h, Math.round(w), h);
      }
    };
    volSync.draw = drawVol;
    const volPlugin = { id: "pxVolSync", afterLayout() { if (volSync.draw) { try { volSync.draw(); } catch (_) {} } } };

    // ── pred 右边框标注: 只标最近一个归档日, 显示该日隐含百分比。
    //    折线仍是真实价格(主轴), 右侧小字是"该预测相对当日收盘的隐含涨幅"。
    const predEdgePlugin = {
      id: "pxPredEdge",
      afterDatasetsDraw(chart) {
        const area = chart.chartArea;
        const yAxis = chart.scales && chart.scales.y;
        if (!area || !yAxis) return;
        const meta = {
          "预测20日高点": ["p_high_20", "#22d3ee"],
          "预测40日高点": ["p_high_40", "#a78bfa"],
          "预测60日高点": ["p_high_60", "#fb923c"],
        };
        const ctx = chart.ctx;
        ctx.font = "11px -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif";
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";
        for (const ds of chart.data.datasets) {
          const info = meta[ds.label];
          if (!info || !ds.data || !ds.data.length || ds.hidden) continue;
          const last = ds.data[ds.data.length - 1];
          if (last == null || last.pct == null || last.y == null) continue;
          const ypx = yAxis.getPixelForValue(last.y);
          const sign = Number(last.pct) >= 0 ? "+" : "";
          const txt = `${info[0]} ${sign}${fmtP(last.pct, 1)}`;
          ctx.strokeStyle = info[1];
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(area.right - 6, ypx);
          ctx.lineTo(area.right - 2, ypx);
          ctx.stroke();
          ctx.fillStyle = info[1];
          ctx.fillText(txt, area.right + 3, ypx);
        }
      },
    };

    // ── p_high_20/40/60 逐日归档:折算成真实价格叠加到主图(不另开 % 轴)。
    //    口径:预测 H 日高点涨幅 p → 当日收盘 ×(1+p)= 模型当日给出的 H 日内峰值目标价。
    //    (fwd_high 标签 = 未来 H 日最高价, 非到期日收盘; pred_* 为到期收盘口径, 不再画。)
    const predLine = (label, key, color) => {
      const data = [];
      for (const t of trail) {
        if (t[key] == null) continue;
        const li = labels.indexOf(t.date);
        if (li < 0) continue;
        const base = closes[li];
        if (base == null) continue;
        const pct = Number(t[key]);
        data.push({ x: tms(li), y: base * (1 + pct), pct });
      }
      return data.length ? { type: "line", label, data, borderColor: color, borderWidth: 1.3,
        pointRadius: 1.8, pointHoverRadius: 3.5, pointBorderColor: color, pointBackgroundColor: color,
        fill: false, spanGaps: false } : null;
    };
    const predDs = [predLine("预测20日高点", "p_high_20", "#22d3ee"),
                    predLine("预测40日高点", "p_high_40", "#a78bfa"),
                    predLine("预测60日高点", "p_high_60", "#fb923c")].filter(Boolean);
    const mkIdx = (trail.length && labels.indexOf(trail[0].date) >= 0) ? labels.indexOf(trail[0].date) : -1;

    chart("pxChart", {
      type: "candlestick",
      plugins: [volPlugin, predEdgePlugin],
      data: { datasets: [
        { label: `${symbol} K线`, data: bars, spanGaps: true },
        ...extra,
        // 预测起点:整幅竖向虚线(纯日期参考,不是价格水平线 → 不会被误读成入场点)
        ...(mkIdx >= 0 ? [{ __mk: 1, type: "line", label: "预测起点(归档首日)", data: [],
                            borderColor: "#fbbf24", borderDash: [7, 5], borderWidth: 1.3, pointRadius: 0, fill: false }] : []),
        ...predDs,
      ] },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        // 右边留白给 pred 百分比标注(右侧无 y 轴, 空间本来就空)
        layout: { padding: { right: 96 } },
        plugins: {
          legend: { labels: CHART_STYLE },
          tooltip: { ...TT_FONT, callbacks: {
            label: (ctx) => {
              const r = ctx.raw;
              if (r && r.o != null) return ` 开 ${fmt(r.o, 2)} · 高 ${fmt(r.h, 2)} · 低 ${fmt(r.l, 2)} · 收 ${fmt(r.c, 2)}`;
              if (ctx.dataset && ctx.dataset.__mk) return " 预测归档首日(竖线=日期参考,非价格)";
              if (ctx.parsed && ctx.parsed.y != null && ctx.raw && ctx.raw.pct != null)
                return ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y, 2)} (隐含 ${fmtP(ctx.raw.pct, 0)})`;
              return ` ${ctx.dataset ? ctx.dataset.label : ""}: ${ctx.parsed ? fmt(ctx.parsed.y, 2) : ""}`;
            } } },
        },
        scales: { x: { ...pxX, ticks: { ...pxX.ticks, display: false } },
                  y: { grid: CHART_STYLE.grid, ticks: CHART_STYLE.ticks } },
      },
    });
    if (mkIdx >= 0) {
      requestAnimationFrame(() => { try {
        const cMain = Chart.getChart("pxChart");
        if (cMain && cMain.scales && cMain.scales.y) {
          const ys = cMain.scales.y, mk = (cMain.data.datasets || []).find(d => d.__mk);
          if (mk && ys.min != null && ys.max != null) {
            mk.data = [{ x: tms(mkIdx), y: ys.min }, { x: tms(mkIdx), y: ys.max }];
            cMain.update("none");
          }
        }
      } catch (_) {} });
    }
  } else {
    // CDN 缺失降级: 收盘线 + 参考线(原逻辑)
    const ds = [];
    ds.push({ label: "收盘", data: px.closes, borderColor: "#60a5fa", backgroundColor: "rgba(96,165,250,0.08)", fill: true, pointRadius: 0, borderWidth: 1.6, spanGaps: true });
    const lvl = (label, val, color, dash) => {
      if (val == null || !labels.length) return;
      ds.push({ label, data: labels.map(() => val), borderColor: color, borderDash: dash, pointRadius: 0, borderWidth: 1.3, fill: false });
    };
    if (entry != null) lvl("入场", entry, "#fbbf24", [9, 5]);
    if (target != null) lvl("目标", target, "#4ade80", [3, 3]);
    if (stop != null) lvl("止损", stop, "#f87171", [5, 3]);
    document.getElementById("pxBody").innerHTML = `<canvas id="pxChart" style="width:100%;height:420px"></canvas>`;
    chart("pxChart", {
      type: "line",
      data: { labels, datasets: ds },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { labels: CHART_STYLE },
          tooltip: { ...TT_FONT, callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y, 2)}` } },
        },
        scales: {
          x: { grid: CHART_STYLE.grid, ticks: { color: "#8a94a8", maxTicksLimit: 10 } },
          y: { grid: CHART_STYLE.grid, ticks: CHART_STYLE.ticks },
        },
      },
    });
  }
  const pctOf = (v) => (v == null || entry == null) ? "—" : fmtPct((v - entry) / entry);
  // pred 一律折算成真实价格(当日收盘 ×(1+预测收益)), % 只作括号补充说明
  const closeFor = (t) => { const li = labels.indexOf(t.date); return li >= 0 ? closes[li] : null; };
  const px60 = (t) => { const c = closeFor(t); const p = t.p_high_60 ?? t.pred_60; return (c != null && p != null) ? c * (1 + Number(p)) : null; };
  const lastC = Number(px.last_close) || null;
  const parts = [];
  parts.push(`入场 ${fmt(entry, 2)}`);
  if (target != null) parts.push(`目标 ${fmt(target, 2)} (${pctOf(target)})`);
  if (stop != null) parts.push(`止损 ${fmt(stop, 2)} (${pctOf(stop)})`);
  if (row) {
    if (row.composite != null) parts.push(`composite ${fmt(row.composite, 2)}`);
    const rowHigh = row.p_high_60 != null ? row.p_high_60 : row.pred_60;
    if (rowHigh != null && lastC != null)
      parts.push(`高点60日价 ${fmt(lastC * (1 + Number(rowHigh)), 2)} (隐含 ${Number(rowHigh) >= 0 ? "+" : ""}${fmtP(rowHigh, 0)})`);
    else if (rowHigh != null) parts.push(`高点60日 ${Number(rowHigh) >= 0 ? "+" : ""}${fmtP(rowHigh, 0)}`);
    if (row.p_low_60 != null) parts.push(`低点预测 ${fmtP(row.p_low_60, 0)}`);
    if (row.execution_status) parts.push(`执行:${row.execution_status}`);
    if (row.rr != null) parts.push(`盈亏比 ${fmt(row.rr, 2)}`);
  }
  if (trail.length) {
    const first = trail[0], last = trail[trail.length - 1];
    const fpx = px60(first), lpx = px60(last);
    const fp = first.p_high_60 ?? first.pred_60, lp = last.p_high_60 ?? last.pred_60;
    if (fpx != null && lpx != null)
      parts.push(`高点轨迹 ${first.date}→${last.date} 高点60 ${fmt(fpx, 2)}→${fmt(lpx, 2)} (隐含 ${fmtP(fp, 0)}→${fmtP(lp, 0)})`);
    else parts.push(`高点轨迹 ${first.date}→${last.date} 高点60 ${fmtP(fp, 0)}→${fmtP(lp, 0)}`);
    // 兑现按峰值口径: 已实现 H 日峰值涨幅(fwd_max_60)≥ 预测高点涨幅(p_high_60)
    const maturedPeak = trail.filter(t => t.fwd_max_60 != null && t.p_high_60 != null);
    if (maturedPeak.length) {
      parts.push(`60日高点兑现 ${maturedPeak.filter(t => t.fwd_max_60 >= t.p_high_60).length}/${maturedPeak.length}`);
    } else {
      const matured = trail.filter(t => t.realized_60 != null && t.pred_60 != null);
      if (matured.length) parts.push(`60日兑现(收盘口径) ${matured.filter(t => t.realized_60 >= t.pred_60).length}/${matured.length}`);
      else parts.push(`60日窗口未成熟(归档仅${trail.length}天,已实现线为空)`);
    }
  }
  document.getElementById("pxMeta").textContent =
    `${px.symbol} · ${px.n_days} 个交易日 · 行情至 ${px.asof} · 最新收盘 ${fmt(px.last_close, 2)}\n` + parts.join("  |  ")
    + "\n" + ((row && String(row.name || "").indexOf("持仓") >= 0)
      ? "琥珀虚线 = 实际持仓成本(持仓行);目标/止损 = 当前提醒价;金色竖线 = 预测归档首日(日期参考,非入场)。"
      : "琥珀虚线 = 信号建议入场价(非实际持仓成本);金色竖线 = 预测归档首日(日期参考,非入场)。")
    + "\npred 线 = 模型逐日给出的 H 日高点目标价(当日收盘×(1+p_high_H)),对应 fwd_high 标签,非到期日收盘价。";
}

function closePxModal() {
  const ov = document.getElementById("pxModal");
  if (ov) { ov.hidden = true; ov.style.display = "none"; }
  if (charts.pxChart) { charts.pxChart.destroy(); delete charts.pxChart; }
  if (charts.pxVol) { charts.pxVol.destroy(); delete charts.pxVol; }
  if (charts.pxPred) { charts.pxPred.destroy(); delete charts.pxPred; }
  if (charts.__volCleanup) { try { charts.__volCleanup(); } catch (_) {} delete charts.__volCleanup; }
}

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
    <table class="grid-tbl"><thead><tr><th>文件</th><th>更新时间</th><th>错误</th><th>最新错误时间</th><th>错误预览</th><th></th></tr></thead><tbody>`;
  for (const r of rows) {
    const e0 = (r.errors && r.errors[0]) || {};
    h += `<tr><td><b>${esc(r.file)}</b></td><td>${esc(r.mtime)}</td>
      <td>${logsBadge(r.err_count)}</td>
      <td>${esc(r.last_err_ts || "—")}</td>
      <td class="dim" style="max-width:520px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${esc(e0.text || "")}</td>
      <td><button class="btn small" onclick="logsOpen('${esc(r.file)}', ${e0.n || 0})">定位</button></td></tr>`;
  }
  h += `</tbody></table>`;
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
  let h = `<table class="grid-tbl"><thead><tr><th>文件</th><th>大小</th><th>行数(估)</th><th>更新时间</th><th></th></tr></thead><tbody>`;
  for (const r of lst.rows) {
    h += `<tr><td><b>${esc(r.file)}</b></td><td>${r.size_kb} KB</td><td>${fmtMoney(r.lines_est)}</td><td>${esc(r.mtime)}</td>
      <td><button class="btn small" onclick="logsOpen('${esc(r.file)}')">查看</button></td></tr>`;
  }
  h += `</tbody></table>`;
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

document.querySelectorAll(".step").forEach(s => s.addEventListener("click", () => showPage(s.dataset.page)));
let bootPage = "overview";
try { bootPage = localStorage.getItem("dl_web_page") || "overview"; } catch (_) {}
// 所有顶层 const 已就绪, 再启动后端连接(渲染后端/token 框 + 远端自动探测)
Backend.init();
showPage(bootPage);

(function wirePxModal() {
  const ov = document.getElementById("pxModal");
  if (!ov) return;
  ov.addEventListener("click", (ev) => { if (ev.target === ov) closePxModal(); });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !ov.hidden) closePxModal();
  });
})();