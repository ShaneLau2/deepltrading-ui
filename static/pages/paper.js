/* 04 模拟实盘页 — 纸上交易/成交流水/实盘台账。 */
"use strict";

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
      <label>初始资金 <input id="ppInit" type="number" value="${s.paper_starting_balance ?? st.starting_balance}" step="1000"></label>
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
    rlEl.innerHTML = `<div class="table-scroll"><table class="grid-tbl"><thead><tr><th>卖出日</th><th>代码</th><th>卖出价</th><th>数量</th><th>入场日</th><th>入场价</th><th>盈亏$</th><th>盈亏%</th><th>备注</th></tr></thead><tbody>${
      st.real_account.rows.map(r => `<tr><td>${esc(r.sell_date)}</td><td><b>${esc(r.symbol)}</b></td><td>${fmt(r.sell_price, 2)}</td><td>${esc(r.qty)}</td><td>${esc(r.entry_date)}</td><td>${fmt(r.entry_price, 2)}</td><td>${r.realized_pnl >= 0 ? "+" : ""}${fmtMoney(r.realized_pnl)}</td><td>${r.realized_pct != null ? fmtPct(r.realized_pct) : "—"}</td><td>${esc(r.note)}</td></tr>`).join("")}</tbody></table></div>`;
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
