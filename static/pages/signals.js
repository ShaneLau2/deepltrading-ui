/* 03 实时信号页 — 选股表/交易计划 + 个股行情弹窗。 */
"use strict";

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
      html += `<div class="table-scroll"><table class="grid-tbl hold-tbl" id="sgHoldings"><thead><tr><th>代码</th><th>入场日</th><th>入场价</th><th>数量</th><th>现价</th><th>盈亏</th></tr></thead><tbody>${
        hold.holdings.map(r => `<tr title="点击查看行情"><td><b>${esc(r.symbol)}</b></td><td>${esc(r.entry_date)}</td><td>${fmt(r.entry_price, 2)}</td><td>${esc(r.qty)}</td><td>${fmt(r.close, 2)}</td><td>${fmtPct(r.pnl_pct)}</td></tr>`).join("")}</tbody></table></div>`;
    } else html += `<p class="dim">data/holdings.csv 为空</p>`;
    if (hold.alerts && hold.alerts.length) {
      html += `<div class="table-scroll"><table class="grid-tbl"><thead><tr><th>代码</th><th>状态</th><th>提醒</th><th>现价</th><th>目标</th><th>止损</th><th>盈亏</th></tr></thead><tbody>${
        hold.alerts.map(r => `<tr><td><b>${esc(r.symbol)}</b></td><td>${esc(r.status)}</td><td>${esc(r.alert)}</td><td>${fmt(r.close, 2)}</td><td>${fmt(r.target, 2)}</td><td>${fmt(r.stop, 2)}</td><td>${fmtPct(r.pnl_pct)}</td></tr>`).join("")}</tbody></table></div>`;
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

