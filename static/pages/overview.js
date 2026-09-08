/* 00 总览页 — 健康卡/年化增长/净值曲线/验证快照。 */
"use strict";

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
  <div class="card"><h3>13 变体统一净值对比(同协议 · prod_full = 现役全量重训对照)</h3>
    <canvas id="ovVariants" style="height:340px"></canvas>
    <p class="dim">12 挑战者 + <b class="warn">prod_full 现役对照(白线)</b>全部同协议统一净值(Top30 + Hybrid B + VT15 + DD8 · 20bps · 起点归一)。数据源 output/mlp_variant_nav.json(mlp_variant_comparison.py)。集成行含 cat / ens_cat / ens_trio(tri);现役实盘见过评估窗,原样判分虚高,prod_full 以 cut 为界全量重训,是「打败现役了吗」的诚实基准。</p>
  </div>
  <div class="card"><h3>周报图表(共用模块 · 与部署周报同源数据)</h3>
    <div id="ovWeekly"></div>
    <p class="dim">与 weekly.html 同一图表模块(web/static/weekly_charts.js)同一数据源: 净值 / 风控增益 / 规则覆盖 / 选股质量 / IC 金丝雀 / V2 三口径回撤。悬停看数值、图例可开关。</p>
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
  }
  if (data.cut_divergence_alert) {
    const c = data.cut_divergence_alert;
    const rk = Object.entries(c.rolling_rank || {}).map(([t, v]) => `${esc(t)}#${esc(v)}`).join(" · ");
    html += `<div class="card warn"><h3>⚠⚠ cut 口径分歧 · 暂缓切换</h3>
      <p><b>${esc(c.fixed_champion)}</b> 在滚动口径排名靠后(${esc(rk || "—")})于 ${esc(c.triggered_at)} ——
      冠军可能依赖老化评估窗,本轮判定暂缓;详见 output/arena_cut_stability.json。</p></div>`;
  }
  {
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
        // 打败现役判定(2026-09-08): 与自进化页同源(prod_full 全量重训基准)
        const beatTag = c.beat_incumbent === true
          ? `<span class="tag ok-tag">✅ 冠军打败现役</span>`
          : (c.beat_incumbent === false
            ? `<span class="tag err-tag">❌ 冠军未打败现役</span>`
            : `<span class="tag">— 无现役对照</span>`);
        extra = `<div class="dim" style="margin-top:4px">通过名单: ${esc(c.passed_models.join(", "))}<br>${beatTag}${c.beat_txt ? ` <span class="dim">${esc(c.beat_txt)}</span>` : ""}</div>`;
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
  // 13 变体统一净值曲线(对比脚本产物, 起点归一; prod_full 白线置顶 = 现役诚实基准)
  const vn = data.variant_nav;
  if (vn && vn.available && Array.isArray(vn.dates) && vn.dates.length) {
    const vnav = vn.navs || {};
    const VCOL = ["#38bdf8", "#f472b6", "#a3e635", "#fb923c", "#c084fc", "#facc15",
                  "#2dd4bf", "#94a3b8", "#f87171", "#60a5fa", "#fbbf24", "#34d399", "#ffffff"];
    const names = Object.keys(vnav);
    const ds = names.map((k, i) => {
      const arr = vnav[k];
      if (!Array.isArray(arr) || !arr.length) return null;
      const base = arr[0] || 1;
      const isProd = k === "prod_full";
      return { label: k, data: arr.map(v => (v == null ? null : v / base)),
        borderColor: VCOL[i % VCOL.length], borderWidth: isProd ? 2.6 : 1.3,
        pointRadius: 0, fill: false, tension: 0.1 };
    }).filter(Boolean);
    // prod_full 排最后绘制(压在其他线之上, 现役对照一眼可辨)
    ds.sort((a, b) => ((a.label === "prod_full") ? 1 : 0) - ((b.label === "prod_full") ? 1 : 0));
    if (ds.length) {
      chart("ovVariants", { type: "line", data: { labels: vn.dates, datasets: ds },
        options: { responsive: true, maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: { legend: { labels: { ...CHART_STYLE, boxWidth: 9, font: { size: 9.5 } } } },
          scales: {
            x: { grid: CHART_STYLE.grid, ticks: { color: "#8a94a8", maxTicksLimit: 10 } },
            y: { grid: CHART_STYLE.grid, ticks: CHART_STYLE.ticks } } } });
    }
  }
  // 周报图表(共用模块): 与部署周报同一渲染模块/数据源, dark 主题由后端注入
  if (data.weekly_charts && data.weekly_charts.charts && data.weekly_charts.charts.length) {
    if (window.WCH) window.WCH.renderInto("ovWeekly", data.weekly_charts);
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

