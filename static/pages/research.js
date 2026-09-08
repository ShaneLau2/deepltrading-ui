/* 01 研究流水线 — 一键研究 + 训练/回测/自进化/特征流水线子区(研究页展开渲染)。 */
"use strict";

/* ── 01 研究流水线(一键研究 + 训练/回测/自进化/特征 子区) ────────── */
const RS_ZONES = [
  ["train", "模型训练", "多管线训练 · 批量对比"],
  ["backtest", "策略回测", "资金曲线 · 绩效评估(含全景 OOS / 滚动复核)"],
  ["evolve", "模型自进化", "调度 · 重训 · 竞技场"],
  ["pipeline", "候选特征流水线", "挖掘 → 复核 → 竞技场"],
];
const RS_STEPS_QUICK = [["check", "模型自检"], ["feature", "特征筛查"], ["evolve", "自我进化"], ["bt", "回测"], ["suggest", "新方向建议"]];
const RS_STEPS_FULL = [["check", "模型自检"], ["rebuild", "数据集重建"], ["mine", "特征挖掘"], ["feature", "特征复核"], ["phase0", "标签冗余度"], ["arena", "竞技场"], ["retrain", "重训"], ["console", "控制台刷新"], ["fold6", "6折样本外"], ["rolling_review", "9起点复核"], ["bt", "回测"], ["suggest", "新方向建议"]];

async function renderResearch() {
  pollDrop("rs");
  const el = pageEl("research");
  el.innerHTML = `<div class="loading">加载研究流水线…</div>`;
  let st;
  try { st = await api("/api/research/status"); } catch (_) { st = { job: {}, state: {} }; }
  el.innerHTML = researchShell(st);
  loadResearchReport();
  fillRsLog(st.state || {});
  const active = !!(st.job && st.job.active);
  if (active) {
    pollSet("rs", async () => {
      try {
        const r = await api("/api/research/status");
        const stepsEl = document.querySelector(".rs-steps");
        if (stepsEl) stepsEl.innerHTML = rsStepsHtml(r.state || {});
        fillRsLog(r.state || {});
        const box = document.getElementById("rsReport");
        if (box) renderResearchReport(box, r.state || {});
        if (!(r.job && r.job.active)) { renderResearch(); }
      } catch (_) {}
    }, 2500);
  } else {
    pollSet("hdr", pollHeader, 4000);
  }
}

function fillStatusLog(containerId, url, pick) {
  api(url).then(r => {
    const lc = document.getElementById(containerId);
    if (lc) { lc.textContent = (pick(r) || []).join("\n"); lc.scrollTop = lc.scrollHeight; }
  }).catch(() => {});
}

function fillRsLog(state) {
  const lc = document.getElementById("rsLog");
  if (lc) { lc.textContent = ((state || {}).log_tail || []).join("\n"); lc.scrollTop = lc.scrollHeight; }
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
  const stepsTag = mode === "full" ? "自检 → 挖掘 → 复核 → 竞技场 → 重训 → 控制台刷新 → 6折样本外 → 9起点复核 → 回测 → 新方向" : "自检 → 特征 → 进化 → 回测 → 新方向";
  const hint = mode === "full"
    ? "顺序: ①模型自检(健康/死亡/衰减/参数体检) ②特征挖掘(auto_feature_mining 交互候选) ③特征全量复核(9 起点 + 打乱对照 + AGENTS 登记) ④标签冗余度地图(Phase 0, 正交训练前置) ⑤竞技场(model_arena 选股 + 止盈/止损/时点三角色,双窗口对决) ⑥重训(选股 IC 退化才重训;角色读竞技场胜出候选,护栏通过才切换) ⑦控制台刷新(重训后重建 ic_report + 13 变体对比,供训练页/生产家族 IC 列) ⑧回测(Top30 · V2 · SPY 对照) ⑨聚合新方向建议。总耗时数小时,建议周末跑;日志实时滚动,各子环节完整详情在下方分区。"
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
  // 互斥守卫(2026-09-08): 仅「本 zone 被用户打开」时才关闭他区。
  // 若不守卫, 互斥关闭他区会触发他区 toggle(open=false)再次进入本函数,
  // 循环互关造成「连点两个分区双双关闭」(Chrome toggle 语义级联, 已最小复现)。
  const me = document.querySelector(`.rs-zone[data-zone="${name}"]`);
  if (!me || !me.open) return;
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
  let st, cfg, vst, bts, evs;
  try { [st, cfg, vst, bts, evs] = await Promise.all([api("/api/train/status"), api("/api/config"), api("/api/validate/status"), api("/api/train/batch/status"), api("/api/evolve/status").catch(() => ({}))]); }
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

  // 快捷报告卡(2026-09-08): 盘中/盘后/周报一键生成, 展示自进化任务运行状态
  const evAct = (evs && evs.status && evs.status.active)
    ? `<span class="tag warn-tag">运行中: ${esc((evs.status.job && evs.status.job.label) || "自进化任务")}</span>`
    : `<span class="tag ok-tag">空闲</span>`;
  let html = `<div class="card"><h3>快捷报告<span class="tag">一键生成</span> ${evAct}</h3>
    <div class="btn-row">
      <button class="btn" onclick="runEvolve('midday','train')">盘中快报</button>
      <button class="btn" onclick="runEvolve('daily','train')">盘后快报</button>
      <button class="btn" onclick="runEvolve('report','train')">周报</button>
    </div>
    <p class="dim">盘中 = self_evolve --midday(轻量刷新+推送, 美东 11:30) · 盘后 = self_evolve --daily(收盘+30 分钟正式信号+推送) · 周报 = champion_report --push(冠军周报生成+推送)。自进化任务与信号任务互斥; 详细日志/进度在「模型自进化」分区。</p></div>
  <div class="grid two">
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
      ${(prod.ic_stale && prod.ic_stale.stale) ? `<p class="dim red">⚠ 家族 IC 列已过期: ic_report.csv(${esc(prod.ic_stale.mtime || "—")})早于 ${esc(prod.ic_stale.stale_src || "生产模型")}更新(${esc(prod.ic_stale.stale_since || "—")}) — 重训后需重跑 ic_report(全量链控制台刷新阶段会自动重建)。</p>` : ""}
      ${(prod.ic_eff && prod.ic_eff.available && prod.ic_eff.stale) ? `<p class="dim red">⚠ IC→PnL 效率状态已过期: 截至 ${esc(prod.ic_eff.as_of_week || "—")}(${esc(prod.ic_eff.generated_at || "—")}),早于 ${esc(prod.ic_eff.stale_src || "生产模型")}更新(${esc(prod.ic_eff.stale_since || "—")}) — 重训后未刷新,结论基于旧模型(全量链控制台刷新阶段会自动重跑)。</p>` : ""}
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
  // 陈旧度标注: 产物比数据集/生产模型旧 → 模型更新后未重建, 数字已过期
  const staleTag = (avail, stale, since) => (!avail || !stale) ? ""
    : ` <span class="tag danger-tag" title="产物比 ${esc(since || "数据集/生产模型")} 旧 — 重训后未重建, 数字已过期">⚠ 已过期</span>`;
  html += `<div class="card"><h3>全模型 IC 一览(ic_report.csv · ${esc(ict.mtime || "—")})${staleTag(ict.available, ict.stale, ict.stale_src)}</h3>`;
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

  // 13 变体统一对比(mlp_variant_comparison.json, 12 挑战者 + prod_full 现役对照)
  html += `<div class="card"><h3>13 变体统一对比(mlp_variant_comparison · ${esc(cmp.mtime || "—")})${staleTag(cmp.available, cmp.stale, cmp.stale_since)}</h3>`;
  if (cmp.available && cmp.rows && cmp.rows.length) {
    html += `<table class="grid-tbl"><thead><tr><th>模型</th><th>Sharpe</th><th>MaxDD</th><th>CAGR</th><th>Calmar</th><th>胜率</th><th>PF</th><th>交易数</th></tr></thead><tbody>`;
    for (const r of cmp.rows) {
      html += `<tr><td><b>${esc(r.model)}</b></td><td>${fmt(r.sharpe, 3)}</td><td>${fmt(r.max_dd_pct, 1)}%</td>
        <td>${fmt(r.cagr_pct, 1)}%</td><td>${fmt(r.calmar, 2)}</td><td>${fmt(r.win_rate, 1)}%</td>
        <td>${fmt(r.pf, 2)}</td><td>${esc(r.trades ?? "—")}</td></tr>`;
    }
    html += `</tbody></table><p class="dim">统一净值口径: Top30 + Hybrid B + VT15 + DD8(hold_management_unified)。</p>`;
  } else {
    html += `<p class="warn">${esc(cmp.message || "尚未运行对比任务(选「13 变体统一对比」训练类型)")}</p>`;
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
    compare: "13 变体对比: 7 个 MLP 变体 + LGB predict 模式 + cat(与竞技场同协议) + ens/ens_cat/ens_trio(tri) 集成 + prod_full(现役全量重训对照, 与竞技场同协议),统一净值(Top30+HybridB+VT15+DD8)对比,结果写入 output/mlp_variant_comparison.json。",
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
  // rolling/pano 子控制台同样预填历史日志(任务结束后仍可见)
  fillStatusLog("rollingLog", "/api/validate/status", r => (r.rolling && r.rolling.log_tail) || []);
  fillStatusLog("panoLog", "/api/backtest/panorama/status", r => r.log_tail || []);
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
      <button class="btn" onclick="runCheckGates()">闸门自检</button>
    </div>
    <p class="dim">每日 = 盘后信号+推送 · 盘中快报 = 轻量刷新+推送 · 周末 = 重建数据集→重训检查→竞技场→研究→冠军报告(数小时)。</p>
    <div class="console-wrap" id="evGatesWrap"${_lastGatesOut ? "" : " hidden"}><div class="console-head">闸门自检输出(--check-gates · 只读)</div>
      <pre class="console" id="evGates" style="max-height:340px">${_lastGatesOut ? esc(_lastGatesOut) : ""}</pre></div>
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
      arenaRows.slice().sort((a, b) => (b.score || -9) - (a.score || -9)).map(r => `<tr><td><b>${esc(r.model)}</b>${r.is_prod ? ' <span class="tag ok-tag">🏭现役对照</span>' : ''}</td><td>${fmt(r.ic_recent, 4)}</td><td>${fmt(r.ic_long, 4)}</td><td>${fmt(r.sharpe_recent, 2)}</td><td>${fmt(r.sharpe_long, 2)}</td><td>${fmt(r.score, 3)}</td><td>${r.pass ? "✅" : "—"}</td></tr>`).join("")}</tbody></table>
      <p class="dim">🏭现役对照(prod_full) = 生产 swing 特征集 + MLP/LGB 集成、用 cut 前全量数据重训、同 te 评估 —— 不参与冠军竞争; 冠军须双窗口 IC 均超它才算「打败现役」。</p></div>` : `<p class="dim">暂无竞技场结果(每周 --weekly 自动跑)</p>`}
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
      // 数据对称性 gap(2026-09-08): 现役原样行见过 te 窗数据 → 判分虚高;
      // prod_sym 同协议重训行是诚实基准。gap = 原样 − 对称(正 = 虚高幅度)。
      const g = ra.symmetry_gap || {};
      const gapLine = (g.gap_recent != null)
        ? `<p class="dim">⚖ 对称性: 现役原样 vs 同协议重训(prod_sym) IC 差 = 近窗 <b class="${g.gap_recent > 0.05 ? "red" : ""}">${fmt(g.gap_recent, 4)}</b> · 长窗 <b class="${g.gap_long > 0.05 ? "red" : ""}">${fmt(g.gap_long, 4)}</b>${g.exceeded ? ` <span class="tag danger-tag">超阈值 0.05,原样行不可作判定基准</span>` : ' <span class="tag ok-tag">对称</span>'}(正 = 现役虚高)</p>`
        : "";
      html += `<div class="card"><h4>${roleCn[rk] || rk} 角色双窗口竞技场</h4>
        ${gapLine}
        <p class="dim">${c.date ? `冠军 <b>${esc(c.champion)}</b> · 双窗口达标 ${c.pass_dual ? "✅" : "⚠"} · 连冠 ${c.streak} 周 · 现役 ${esc(c.incumbent || "—")} · score ${fmt(c.score, 2)}` : "尚未跑出冠军"}</p>`
        + `<div class="table-scroll"><table class="grid-tbl"><thead><tr><th>候选</th><th>窗口</th><th>判分IC</th><th>null</th><th>首6月</th><th>天数</th></tr></thead><tbody>${
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

/* 闸门自检: 只读调用 --check-gates, 输出 FROZEN 闸门状态 + 角色候选新鲜度 */
/* 输出存模块级缓存: 自进化页轮询(无任务时每 2.5s)会 renderEvolve 重建 DOM, 清空输出框; 重建时用缓存恢复 */
let _lastGatesOut = null;
async function runCheckGates() {
  const box = document.getElementById("evGates");
  const wrap = document.getElementById("evGatesWrap");
  if (!box) return;
  try {
    const r = await api("/api/evolve/check-gates");
    _lastGatesOut = r.text || "(无输出)";
    box.textContent = _lastGatesOut;
    if (wrap) wrap.hidden = false;
    toast(`闸门自检完成(rc=${r.rc}: ${r.rc === 0 ? "可重训" : "重训会被跳过"})`);
  } catch (e) { toast("闸门自检失败: " + e.message, false); }
}

async function runEvolve(task, reload) {
  // reload="train" 时启动后原地刷新训练页(快捷报告卡); 默认刷新自进化页
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
    if (reload === "train") renderTrain();
    else renderEvolve();
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
