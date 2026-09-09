/* 周报 / 总览页共用的 Chart.js 渲染模块(2026-09-08)。
 *
 * 数据契约: chartsData = { charts: [ { id, height, caption, type,
 *   data: {labels, datasets}, options } ] } —— 与 src/weekly_charts.py
 * 的 build_data() 输出一致(theme 由构建侧按页面配色注入 options)。
 *
 * 两端的接入方式:
 *   - 周报 weekly.html: 部署时把本文件源码内联 + 注入 WEEKLY_CHARTS_DATA
 *     → WCH.renderAll(...)(数据内嵌, 手机离线可看);
 *   - 控制台总览页: <script src="static/weekly_charts.js"> + 后端给
 *     /api/overview 的 weekly_charts 字段 → WCH.renderInto("ovWeekly", ...)
 *     (动态创建 canvas, 两端同一渲染逻辑)。
 */
"use strict";
window.WCH = (function () {
  const charts = {};

  function render(c) {
    if (!c || !c.id || !window.Chart) return;
    const el = document.getElementById(c.id);
    if (!el) return;
    if (charts[c.id]) { try { charts[c.id].destroy(); } catch (_) {} }
    charts[c.id] = new Chart(el, {
      type: c.type || "line",
      data: c.data || { labels: [], datasets: [] },
      // 性能(2026-09-09): 关动画, 与 app.js chart() 同策略(周报图 3000+ 点 × 多图)
      options: Object.assign({}, c.options || {}, { animation: false }),
    });
  }

  /* 固定高度内层盒子(canvas 100% 填满)≈ 不依赖 canvas 自身撑高容器:
   * responsive + maintainAspectRatio:false 的 Chart.js 会读父容器高度再写回
   * canvas——若 canvas 直接撑 auto 高度的外层, 容器随 canvas 长高形成正反馈,
   * 图表会不断拉高(2026-09-08 周报图一直变大 bug)。包一层定高盒子即可切断回路。 */
  function makeChart(c) {
    const wrap = document.createElement("div");
    wrap.className = "wchart";
    wrap.style.cssText = "margin:12px 0;";
    const h = (c && c.height) || 260;
    wrap.innerHTML =
      '<div class="wbox" style="position:relative;height:' + h + 'px">' +
      '<canvas id="' + c.id + '" style="display:block;width:100%;height:100%"></canvas></div>' +
      (c.caption ? '<div class="wcap" style="color:#8a94a8;font-size:12px;margin-top:4px">' + c.caption + "</div>" : "");
    return wrap;
  }

  function renderAll(chartsData) {
    const list = (chartsData && chartsData.charts) || [];
    list.forEach(render);
    return list.length;
  }

  /* 动态创建 canvas + 渲染到容器(控制台总览页嵌入周报图用)。 */
  function renderInto(containerId, chartsData) {
    const box = document.getElementById(containerId);
    if (!box) return 0;
    box.innerHTML = "";
    const list = (chartsData && chartsData.charts) || [];
    list.forEach(function (c) { box.appendChild(makeChart(c)); render(c); });
    return list.length;
  }

  return { render: render, makeChart: makeChart, renderAll: renderAll, renderInto: renderInto };
})();