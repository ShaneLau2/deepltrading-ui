/* 02 实验流水线 — qlib 训练窗口对标: 挖因子 → 选数据集 → 模型竞技 → 回测 → 评分 → 再优化。
   与 01 标准重训流水线的分工: 本页 = 可勾选子集 + 参数扫描 + run record 留档判优的
   **只读对照实验**(refine = retrain --dry-run, 全链不写生产模型); 写生产的正式链在 01。
   阶段目录/命令全部由后端 STAGES 注册表驱动(/api/lab/stages),本文件不硬编码命令。 */
"use strict";

const LAB_STATUS = { runs: [] };
const LAB_DIFF = { a: null, b: null };   // 对比选中的两条 run_id(实验历史勾选)

async function renderLab() {
  pollDrop("lab");
  const el = pageEl("lab");
  el.innerHTML = `<div class="loading">加载实验流水线…</div>`;
  let cat = { stages: [], default_chain: [] };
  let st = { active: false };
  let runs = [];
  try { cat = await api("/api/lab/stages"); } catch (_) {}
  try { st = await api("/api/lab/status"); } catch (_) {}
  try { runs = ((await api("/api/lab/runs")).runs) || []; } catch (_) {}
  LAB_STATUS.runs = runs;
  el.innerHTML = labShell(cat, st, runs);
  labFillLog(st);
  labFillProgress(st);
  labFillDiff();
  if (st.active) {
    pollSet("lab", async () => {
      try {
        const r = await api("/api/lab/status");
        labFillLog(r);
        labFillProgress(r);
        if (!r.active) {
          pollDrop("lab");
          toast(r.run && r.run.status === "finished" ? "✅ 实验流水线完成" : "实验流水线结束(" +
                ((r.run && r.run.status) || "未知") + ")", !!(r.run && r.run.status === "finished"));
          renderLab();
        }
      } catch (_) {}
    }, 2500);
  } else {
    pollSet("hdr", pollHeader, 4000);
  }
}

function labShell(cat, st, runs) {
  const chain = (cat.default_chain && cat.default_chain.length)
    ? cat.default_chain : (cat.stages || []).map(s => s.id);
  const stageRows = (cat.stages || []).map(s => {
    const checked = chain.includes(s.id) ? "checked" : "";
    const params = (s.params || []).map(p => labParamCtl(s.id, p)).join(" ");
    return `<div class="lab-stage">
      <label class="chk"><input type="checkbox" class="lab-stage-cb" value="${esc(s.id)}" ${checked}>
        <b>${esc(s.label)}</b></label>
      <span class="dim">${esc(s.hint)}</span>
      ${params ? `<div class="lab-params">${params}</div>` : ""}
    </div>`;
  }).join("");
  const run = st.run || null;
  const lastScored = runs.find(r => (r.metrics && Object.keys(r.metrics).length)) || null;
  const lastMetrics = (lastScored || {}).metrics || {};
  // 最近一次参数扫描父 run(带 sweep 摘要)——子 run(parent 字段)不重复展示
  const lastSweep = runs.find(r => r.sweep && !r.parent) || null;
  const sweepOpts = (cat.stages || []).flatMap(s =>
    (s.params || []).map(p =>
      `<option value="${esc(s.id)}|${esc(p.key)}|${esc(p.type)}">${esc(p.label || p.key)}(${esc(s.label)})</option>`)).join("");
  return `
  <div class="card"><h3>实验流水线(训练窗口)<span class="tag">对标 qlib workflow</span><span class="tag">只读生产 · 不写模型</span></h3>
    <p class="dim">定位 = 对照实验: 勾选子集跑小实验, run record 留档 + 参数扫描判优; 挖因子/竞技阶段会写公共登记表与冠军台账(与 01/周链同源), 但**全链不写模型权重** —— 再优化仅 retrain --dry-run, 重训/写盘走「01 标准重训流水线」(runbook 17 步)。</p>
    ${busySection(st.active ? { active: true, job: (st.status && st.status.job) || {} } : null)}
    <div class="lab-stages">${stageRows}</div>
    <div class="btn-row">
      <button class="btn primary" onclick="labStart()">🚀 运行勾选阶段</button>
      <button class="btn" onclick="labPreset('full')">全链</button>
      <button class="btn" onclick="labPreset('quick')">快速(回测+评分)</button>
      <button class="btn danger" onclick="labStop()">停止</button>
    </div>
    <div id="labProgress"></div>
    ${logConsole("labLog")}
  </div>
  <div class="card"><h3>评分(最近一次含 metrics 的实验)${labFreshTag(lastScored)}</h3>
    <div class="lab-metrics">${labMetricTiles(lastMetrics)}</div>
    <p class="dim">评分 = 回测报告(裸/V2 Sharpe·MDD)+ 模型竞技场冠军 + 滚动 IC(实时口径,滞后约 60 交易日)
      三源 collect,由评分阶段写入实验记录;各源缺源时如实标注在记录 note。</p>
  </div>
  <div class="card"><h3>参数扫描<span class="tag">一组参数多值择优 · SCORED_KEYS 胜场法</span></h3>
    <div class="lab-sweep-ctl">
      <label class="dim">参数 <select id="labSweepParam">${sweepOpts || `<option value="">无可扫参数</option>`}</select></label>
      <label class="dim">取值(逗号分隔) <input id="labSweepValues" type="text" placeholder="如 20,30,40" style="width:150px"></label>
      <button class="btn primary" onclick="labSweepStart()">🔍 扫描</button>
      <span class="dim">2–8 组 · 子链自动 = 参数阶段 + 回测 + 评分(与手工流水线同源)</span>
    </div>
    <div id="labSweepResult">${lastSweep ? labSweepHtml(lastSweep) : `<p class="dim">暂无扫描记录。</p>`}</div>
  </div>
  <div class="card"><h3>实验历史<span class="tag">${runs.length} 条</span></h3>
    <div id="labDiff"></div>
    ${labRunsTable(runs)}</div>`;
}

async function labSweepStart() {
  const sel = document.getElementById("labSweepParam");
  const val = document.getElementById("labSweepValues");
  if (!sel || !sel.value) { toast("没有可扫描的参数", false); return; }
  const param = sel.value.split("|")[1];
  if (!String(val && val.value || "").trim()) { toast("填取值, 如 20,30,40", false); return; }
  try {
    const r = await api("/api/lab/sweep", { method: "POST",
      body: JSON.stringify({ param, values: val.value }) });
    toast(`扫描已启动: ${r.param} = ${r.values.join(", ")}(${r.n_children} 组 / ${r.n_steps} 步)`);
    renderLab();
  } catch (e) { toast(e.message, false); }
}

function labSweepHtml(rec) {
  // 兼容两种入参: 整条 run record(param/rows 在 .sweep 里)或直接给 summary
  const sw = rec && rec.sweep && rec.sweep.param ? rec.sweep : rec;
  if (!sw || !sw.param) return `<p class="dim">暂无扫描记录。</p>`;
  const rows = (sw.rows || []).map(r => {
    const m = r.metrics || {};
    const best = r.run_id === sw.best_run_id ? " lab-diff-a" : "";
    const cells = ["bt_sharpe", "bt_v2_sharpe", "roll_ic"].map(k =>
      `<td>${m[k] != null ? fmt(m[k], 4) : "—"}</td>`).join("");
    const stCls = r.status === "finished" ? "tag" : (r.status === "running" ? "tag warn-tag" : "tag danger-tag");
    return `<tr class="${best.trim()}"><td><b>${esc(String(r.value))}</b></td>${cells}
      <td>${r.wins}</td><td><span class="${stCls}">${esc(r.status || "—")}</span></td></tr>`;
  }).join("");
  const applied = sw.best_value == null ? ""
    : `<button class="btn" onclick="labSweepApply('${esc(String(sw.param))}', '${esc(String(sw.best_value))}')">⬆ 把最优值填回参数控件</button>`;
  return `<div class="lab-metrics">
      ${tile("判优", esc(sw.verdict || ""), `口径: SCORED_KEYS 胜场法(与对比视图同源)· 参数 ${esc(sw.param)}`)}
      ${tile("最优值", sw.best_value == null ? "—" : esc(String(sw.best_value)), "胜场 = 每对逐指标赢的次数")}
      ${tile("组数", String((sw.rows || []).length), `已出分 ${sw.n_scored != null ? sw.n_scored : (sw.rows || []).length} 组`)}
    </div>
    <div class="table-scroll"><table class="grid-tbl"><thead><tr><th>${esc(sw.param)}</th>
      <th>Sharpe(裸)</th><th>Sharpe(V2)</th><th>滚动IC</th><th>胜场</th><th>状态</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="6" class="dim">无子 run</td></tr>`}</tbody></table></div>
    <div class="btn-row">${applied}</div>`;
}

function labSweepApply(param, value) {
  const id = `labP_backtest_${param}`;
  const el = document.getElementById(id) ||
    [...document.querySelectorAll("[id^='labP_']")].find(x => x.id.endsWith(`_${param}`));
  if (!el) { toast(`找不到参数控件 ${param}`, false); return; }
  if (el.type === "checkbox") el.checked = String(value) === "true";
  else el.value = value;
  toast(`已把 ${param}=${value} 填回参数控件(下次运行生效)`);
}

function labParamCtl(sid, p) {
  const id = `labP_${sid}_${p.key}`;
  if (p.type === "select") {
    const opts = (p.options || []).map(o =>
      `<option value="${esc(o)}" ${o === p.default ? "selected" : ""}>${esc(o)}</option>`).join("");
    return `<label class="dim" style="font-size:12px">${esc(p.label || p.key)}
      <select id="${id}">${opts}</select></label>`;
  }
  if (p.type === "bool") {
    return `<label class="chk dim" style="font-size:12px"><input type="checkbox" id="${id}"
      ${p.default ? "checked" : ""}> ${esc(p.label || p.key)}</label>`;
  }
  if (p.type === "int") {
    return `<label class="dim" style="font-size:12px">${esc(p.label || p.key)}
      <input type="number" id="${id}" value="${Number(p.default) || 0}" style="width:80px"></label>`;
  }
  return `<label class="dim" style="font-size:12px">${esc(p.label || p.key)}
    <input type="text" id="${id}" value="${esc(p.default || "")}" style="width:110px"></label>`;
}

function labCollectParams() {
  const params = {};
  document.querySelectorAll("[id^='labP_']").forEach(el => {
    const key = el.id.split("_", 3)[2];
    params[key] = el.type === "checkbox" ? el.checked
      : (el.type === "number" ? (parseInt(el.value, 10) || 0) : el.value);
  });
  return params;
}

function labCheckedStages() {
  return [...document.querySelectorAll(".lab-stage-cb")].filter(b => b.checked).map(b => b.value);
}

function labPreset(mode) {
  const chain = mode === "full"
    ? ["mine", "dataset", "arena", "backtest", "score", "refine"]
    : ["backtest", "score"];
  document.querySelectorAll(".lab-stage-cb").forEach(b => { b.checked = chain.includes(b.value); });
}

async function labStart() {
  const stages = labCheckedStages();
  if (!stages.length) { toast("至少勾选一个阶段", false); return; }
  try {
    const r = await api("/api/lab/start", { method: "POST",
      body: JSON.stringify({ stages, params: labCollectParams() }) });
    toast(`已启动 ${r.stages.length} 阶段 / ${r.n_steps} 步`);
    renderLab();
  } catch (e) { toast(e.message, false); }
}

async function labStop() {
  try {
    const r = await api("/api/lab/stop", { method: "POST" });
    toast(r.ok ? "已停止实验流水线" : "无运行中任务");
    renderLab();
  } catch (e) { toast(e.message, false); }
}

function labFillLog(st) {
  const lc = document.getElementById("labLog");
  if (!lc) return;
  lc.textContent = ((st && st.log_tail) || []).join("\n");
  lc.scrollTop = lc.scrollHeight;
}

function labFillProgress(st) {
  const box = document.getElementById("labProgress");
  if (!box) return;
  const run = (st && st.run) || null;
  if (!run) { box.innerHTML = `<p class="dim">无运行中的实验(历史见下方「实验历史」表)。</p>`; return; }
  const steps = run.steps || [];
  const cur = st.active ? (st.step || 0) : steps.length;
  const curStage = st.current_stage;
  const chips = steps.map((s, i) => {
    const cls = !st.active ? (run.status === "finished" ? "done" : "")
      : (i + 1 < cur ? "done" : (i + 1 === cur ? "active" : ""));
    const icon = cls === "done" ? "✓" : (cls === "active" ? "…" : "○");
    return `<div class="rs-step ${cls}"><i>${icon}</i><span>${esc((s.cmd || "").split("/").pop().slice(0, 46))}</span></div>`;
  }).join("");
  const statusCls = run.status === "finished" ? "tag" : (run.status === "running" ? "tag warn-tag" :
    (run.status === "pending" ? "tag" : "tag danger-tag"));
  box.innerHTML = `<div class="rs-steps" style="flex-wrap:wrap">${chips}</div>
    <p class="dim">当前记录 <b>${esc(run.id)}</b> · 状态 <span class="${statusCls}">${esc(run.status)}</span>
    ${curStage ? ` · 阶段 ${esc(curStage)}(${cur}/${steps.length})` : ""}</p>`;
}

// 评分保鲜门禁(展示层): 最近一条含 metrics 的 run 距今 > score_stale_days(8 天,
// 周链每周六刷新一次)⇒ ⚠ 陈旧提示重跑;保鲜则标 ✓。判定本身在后端
// lab_recorder.score_freshness(纯函数),这里只负责渲染,两处评分卡共用本函数。
function labFreshTag(r) {
  if (!r || !r.metrics || !Object.keys(r.metrics).length) return "";
  const age = (r.score_age_days == null) ? null : esc(String(r.score_age_days));
  if (r.score_stale) return `<span class="tag warn-tag" title="周链 lab_worker weekly 每周刷新一次,
    超过 ${r.score_stale_days} 天没有新评分 = 周更可能失败或未跑">⚠ 评分陈旧(${age ?? "?"} 天前)</span>`;
  return `<span class="tag ok-tag">✓ 评分保鲜${age != null ? ` · ${age} 天前` : ""}</span>`;
}

function labMetricTiles(m) {
  if (!m || !Object.keys(m).length) return `<p class="dim">暂无评分(跑一次含评分阶段的流水线)。</p>`;
  const rows = [
    ["回测 Sharpe(裸)", m.bt_sharpe], ["回测 Sharpe(V2)", m.bt_v2_sharpe],
    ["回测 MDD", m.bt_mdd], ["回测 MDD(V2)", m.bt_v2_mdd],
    ["滚动 IC", m.roll_ic], ["IC 截止", m.roll_ic_as_of],
    ["竞技场冠军", m.arena_top], ["现役 IC(近期)", m.arena_prod_ic_recent],
  ].filter(([, v]) => v !== undefined && v !== null);
  return rows.map(([k, v]) => tile(k,
    typeof v === "number" ? fmt(v, 3) : esc(String(v)),
    k === "滚动 IC" && m.roll_ic_source ? `源: ${esc(m.roll_ic_source)}` : "")).join("");
}

function labRunsTable(runs) {
  if (!runs.length) return `<p class="dim">暂无实验记录。</p>`;
  const picked = [LAB_DIFF.a, LAB_DIFF.b].filter(Boolean);
  const rows = runs.map(r => {
    const m = r.metrics || {};
    const stCls = r.status === "finished" ? "tag" : (r.status === "running" ? "tag warn-tag" :
      (r.status === "failed" || r.status === "stopped" ? "tag danger-tag" : "tag"));
    const on = picked.includes(r.id) ? "checked" : "";
    const kind = r.parent ? `<span class="tag" title="父 run ${esc(r.parent)}">子</span> ` : "";
    const swTag = r.sweep && r.sweep.param ? `<span class="tag">扫描 ${esc(r.sweep.param)}</span> ` : "";
    return `<tr><td><input type="checkbox" class="lab-cmp" data-id="${esc(r.id)}" ${on}
      onchange="labToggleDiff(this.dataset.id)" title="勾选两条进行对比"></td>
      <td class="mono" title="${esc(r.id)}">${esc((r.created_at || "").slice(5, 19))}</td>
      <td>${swTag}${kind}${esc((r.stages || []).join(" → "))}</td>
      <td><span class="${stCls}">${esc(r.status)}</span></td>
      <td>${m.bt_sharpe != null ? fmt(m.bt_sharpe, 3) : "—"}</td>
      <td>${m.bt_v2_sharpe != null ? fmt(m.bt_v2_sharpe, 3) : "—"}</td>
      <td>${m.roll_ic != null ? fmt(m.roll_ic, 4) : "—"}</td>
      <td class="dim">${esc(r.note || "")}</td></tr>`;
  }).join("");
  return `<div class="table-scroll"><table class="grid-tbl"><thead><tr><th>对比</th><th>时间</th><th>阶段</th><th>状态</th>
    <th>Sharpe</th><th>Sharpe(V2)</th><th>滚动IC</th><th>备注</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

// ── 实验对比(两次 run 并排 diff + 判优, 判优口径唯一事实源 =后端 lab_diff.SCORED_KEYS)──
function labToggleDiff(id) {
  const sel = [LAB_DIFF.a, LAB_DIFF.b].filter(Boolean);
  const i = sel.indexOf(id);
  if (i >= 0) sel.splice(i, 1);
  else { sel.push(id); if (sel.length > 2) sel.shift(); }   // 超过 2 条淘汰最早选中
  LAB_DIFF.a = sel[0] || null;
  LAB_DIFF.b = sel[1] || null;
  document.querySelectorAll(".lab-cmp").forEach(cb => {
    cb.checked = LAB_DIFF.a === cb.dataset.id || LAB_DIFF.b === cb.dataset.id;
  });
  labFillDiff();
}

function labClearDiff() {
  LAB_DIFF.a = LAB_DIFF.b = null;
  document.querySelectorAll(".lab-cmp").forEach(cb => { cb.checked = false; });
  labFillDiff();
}

async function labFillDiff() {
  const box = document.getElementById("labDiff");
  if (!box) return;
  const { a, b } = LAB_DIFF;
  if (!a || !b) {
    box.innerHTML = `<p class="dim">在下表勾选两条实验 → 并排对比指标/参数/阶段并自动判优。</p>`;
    return;
  }
  box.innerHTML = `<p class="dim">对比中…</p>`;
  try {
    const d = await api(`/api/lab/diff?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
    box.innerHTML = labDiffHtml(d);
  } catch (e) { box.innerHTML = `<p class="dim">对比失败: ${esc(e.message || String(e))}</p>`; }
}

function labDiffHtml(d) {
  const ta = (d.a && d.a.created_at || "").slice(5, 16);
  const tb = (d.b && d.b.created_at || "").slice(5, 16);
  const fv = v => v === undefined || v === null ? "—"
    : (typeof v === "number" ? fmt(v, 4) : esc(String(v)));
  const mrows = (d.metrics || []).map(r => {
    const w = r.better === "a" ? "A" : (r.better === "b" ? "B" : (r.better === "tie" ? "平" : "—"));
    const cls = r.better === "a" || r.better === "b" ? ` class="${r.better === "a" ? "lab-diff-a" : "lab-diff-b"}"` : "";
    return `<tr${cls}><td>${esc(r.key)}</td><td>${fv(r.a)}</td><td>${fv(r.b)}</td>
      <td>${r.delta == null ? "—" : (r.delta > 0 ? "+" : "") + fmt(r.delta, 4)}</td><td>${w}</td></tr>`;
  }).join("");
  const changed = (d.params || []).filter(p => p.changed);
  const sameN = (d.params || []).length - changed.length;
  const prows = changed.map(p =>
    `<tr><td>${esc(p.key)}</td><td>${fv(p.a)}</td><td>${fv(p.b)}</td></tr>`).join("");
  const stg = d.stages || {};
  const stgLine = stg.same
    ? `<p class="dim">阶段相同: ${esc((stg.a || []).join(" → "))}</p>`
    : `<p class="dim">阶段 A: ${esc((stg.a || []).join(" → "))}<br>阶段 B: ${esc((stg.b || []).join(" → "))}</p>`;
  return `
    <div class="lab-metrics">
      ${tile("判优", esc(d.verdict || ""), "口径: SCORED_KEYS 数值大者胜(MDD 存负值同向)")}
      ${tile("A · " + esc(ta), esc(((d.a && d.a.id) || "").slice(-8)), esc(((d.a && d.a.stages) || []).join("→")))}
      ${tile("B · " + esc(tb), esc(((d.b && d.b.id) || "").slice(-8)), esc(((d.b && d.b.stages) || []).join("→")))}
      ${tile("参数", changed.length + " 处不同", "相同 " + sameN + " 项")}
    </div>
    <div class="table-scroll"><table class="grid-tbl"><thead><tr><th>指标</th><th>A · ${esc(ta)}</th><th>B · ${esc(tb)}</th><th>Δ(A−B)</th><th>优</th></tr></thead>
      <tbody>${mrows || `<tr><td colspan="5" class="dim">无可比指标</td></tr>`}</tbody></table></div>
    ${changed.length ? `<div class="table-scroll"><table class="grid-tbl"><thead><tr><th>参数(仅不同)</th><th>A</th><th>B</th></tr></thead>
      <tbody>${prows}</tbody></table></div>` : `<p class="dim">参数全部相同。</p>`}
    ${stgLine}
    <button class="btn" onclick="labClearDiff()">清空对比</button>`;
}
