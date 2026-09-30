/* 袖袋权重流转页(trace) — 只读视图, 无任何写操作。 */
"use strict";

/* ── 袖袋 trace ──────────────────────────────────────────────────── */
/* ⚠ 类名全部照抄 style.css 既有词汇(grid-tbl / grid tiles / kv / dim /
     warn / pos / neg), 不自创 —— 自创的类不会有样式, 页面会看起来"能用"
     其实全是默认字体, 这种"半坏"比报错更难发现。 */

async function renderSleeves() {
  const el = pageEl("sleeves");
  el.innerHTML = `<div class="loading">加载袖袋权重流转…</div>`;
  let d;
  try { d = await api("/api/sleeve/trace"); }
  catch (e) { el.innerHTML = `<div class="err-box">加载失败: ${esc(e.message)}</div>`; return; }

  if (!d || !d.available) {
    el.innerHTML = `<h2>袖袋权重流转</h2>
      <div class="warn">${esc((d && d.reason) || "暂无数据")}</div>
      <p class="dim">本页面只读, 不触发换仓、不修改台账。数据来自盘后链
      <code>src/sleeves.py --run</code> 落下的
      <code>output/sleeve_weights_&lt;date&gt;.csv</code> 快照。</p>`;
    return;
  }

  const c = d.config || {};
  const nSl = Number(c.n_sleeve) || 0;
  const inState = Number(c.n_sleeves_in_state) || 0;
  // ⚠ ramp 爬坡期是**设计内**状态(每 20 交易日建一个袋), 但用户看到
  //   「只 20 只持仓」极易误读成选股不足 ⇒ 必须显式说明。
  const ramping = c.seed_mode === "ramp" && inState < nSl;
  const snapN = (d.snapshots || []).length;

  const h = [];
  h.push(`<h2>袖袋权重流转 <span class="dim">只读</span></h2>`);
  h.push(`<div class="grid tiles">
    ${tile("持仓只数", String(d.n_holdings), `最新快照 ${esc(d.latest)}`)}
    ${tile("Σ 权重", fmtPct(d.total_weight, 2),
           ramping ? `爬坡期设计内(应 ≈ 暴露/${nSl})` : "满配", ramping ? "warn" : "")}
    ${tile("跨袋重复", String(d.multi_sleeve || 0),
           "≥2 个袋同时持有(1x→2x/3x)", d.multi_sleeve ? "" : "dim")}
    ${tile("最大单票", fmtPct(d.max_weight, 2), "单只权重上限")}
    ${tile("权重快照", String(snapN),
           snapN < 2 ? "仅 1 天, 无对比基线" : `基线 ${esc(d.prev)}`,
           snapN < 2 ? "warn" : "")}
    ${tile("换入 / 换出", `${(d.entering || []).length} / ${(d.exiting || []).length}`,
           d.comparable ? `vs ${esc(d.prev)}` : "需 ≥2 份快照", d.comparable ? "" : "warn")}
  </div>`);

  h.push(`<div class="card">
    <div class="console-head">架构参数 <span class="dim">${esc(c.updated || "")} 更新</span></div>
    <div class="kv"><span>袋数</span><b>${nSl}</b>
      <span>每袋只数</span><b>${esc(c.k)}</b>
      <span>持有期</span><b>${esc(c.horizon)} 交易日</b>
      <span>换仓间隔</span><b>${esc(c.cadence)} 交易日</b>
      <span>播种模式</span><b>${esc(c.seed_mode || "—")}</b>
      <span>已建仓袋数</span><b>${inState} / ${nSl}</b></div>
    ${ramping ? `<div class="warn" style="margin-top:8px">爬坡期: 仅 ${inState} /
      ${nSl} 个袋已建仓, 持仓与 Σ权重小于满配属<b>设计内</b>
      (每 20 交易日建一个袋, 40 交易日满配), 不是选股不足。</div>` : ""}
  </div>`);

  // trace 的核心: 跨快照的权重变化
  if (d.comparable && (d.weight_changes || []).length) {
    h.push(`<div class="card">
      <div class="console-head">权重变化 <span class="dim">${esc(d.prev)} → ${esc(d.latest)}</span></div>
      <div class="table-scroll"><table class="grid-tbl">
        <thead><tr><th>标的</th><th>前</th><th>后</th><th>Δ</th></tr></thead>
        <tbody>${d.weight_changes.map(w => `<tr>
          <td class="sym">${esc(w.symbol)}</td>
          <td class="dim">${fmtPct(w.prev_weight, 2)}</td>
          <td>${fmtPct(w.cur_weight, 2)}</td>
          <td class="${w.delta > 0 ? "pos" : "neg"}">${w.delta > 0 ? "+" : ""}${fmtPct(w.delta, 2)}</td>
        </tr>`).join("")}</tbody></table></div>
    </div>`);
  } else {
    h.push(`<div class="card"><div class="console-head">权重变化</div>
      <p class="dim" style="margin:6px 0 0">${d.comparable
        ? "两次快照之间权重无变化"
        : "只有一份快照, 无法比较 —— 日链再落一份即可看到进出与加权变化"}</p></div>`);
  }

  // 逐袋槽位(到期日决定下次换仓)
  const bs = d.by_sleeve || {};
  const keys = Object.keys(bs);
  if (keys.length) {
    h.push(`<div class="card">
      <div class="console-head">逐袋槽位 <span class="dim">到期日 = 下次换仓日</span></div>
      <div class="table-scroll"><table class="grid-tbl">
        <thead><tr><th>袋</th><th>槽位</th><th>标的</th><th>建仓</th><th>到期</th></tr></thead>
        <tbody>${keys.map(sid => bs[sid].map((r, i) => `<tr>
          <td>${i === 0 ? "袋 " + esc(sid) : ""}</td>
          <td class="dim">${r.slot_rank}</td>
          <td class="sym">${esc(r.symbol)}</td>
          <td class="dim">${esc(r.held_since)}</td>
          <td>${esc(r.expires_on)}</td></tr>`).join("")).join("")}
        </tbody></table></div></div>`);
  }

  // 聚合持仓
  const hold = d.holdings || [];
  h.push(`<div class="card">
    <div class="console-head">聚合持仓 <span class="dim">${hold.length} 只 ·
      单只权重 = 槽位数 × 暴露/(袋数 × 每袋数)</span></div>
    <div class="table-scroll"><table class="grid-tbl">
      <thead><tr><th>标的</th><th>袋数</th><th>槽位</th><th>权重</th>
        <th>建仓</th><th>到期</th></tr></thead>
      <tbody>${hold.map(r => `<tr>
        <td class="sym">${esc(r.symbol)}</td>
        <td>${esc(r.sleeves_holding)}</td>
        <td class="dim">${esc(r.slots)}</td>
        <td>${fmtPct(r.weight, 2)}</td>
        <td class="dim">${esc(r.held_since)}</td>
        <td class="dim">${esc(r.expires_on)}</td></tr>`).join("")}
      </tbody></table></div></div>`);

  h.push(`<p class="dim">只读页: 不写台账、不触发换仓。快照由盘后链每日追加,
    历史会自然变长。</p>`);
  el.innerHTML = h.join("");
}

