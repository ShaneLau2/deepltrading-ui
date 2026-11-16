/* deepltrading Web 控制台 — 前端逻辑(核心 + 共享工具)。
   页面模块按 总览/研究/信号/模拟实盘/日志 拆在 static/pages/, 由 index.html 依次加载
   (经典脚本, 函数即全局; 顶层 const/let 共享全局词法环境, 保持原 app.js 语义)。
   启动引导在 static/pages/boot.js(必须最后加载)。 */
"use strict";

/* deepltrading Web 控制台 — 前端逻辑 */
"use strict";

const $ = (s) => document.querySelector(s);

/* ── 请求超时 ─────────────────────────────────────────────────────────
   后端 sync 端点跑在线程池, /api/overview 等重组件冷缓存可达 15-40s。
   不超时的话 fetch 永不落定 → 页面卡在「加载…」无限转圈, 无任何提示。
   统一加 AbortController 超时(默认 45s, opts.timeout 可覆盖),
   超时抛可读错误, 由页面渲染器显示失败提示 + 重试按钮。 */
const API_TIMEOUT_MS = 45000;
async function fetchWithTimeout(url, opts = {}, timeoutMs) {
  const ms = opts.timeout != null ? opts.timeout : (timeoutMs || API_TIMEOUT_MS);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
  } catch (e) {
    if (ctrl.signal.aborted) {
      const err = new Error("请求超时(" + Math.round(ms / 1000) + "s): " + url.replace(API_BASE, ""));
      err.timeout = true;
      err.name = "TimeoutError";
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// 容器重定向: 研究流水线页把 train/backtest/evolve/pipeline 子区渲染到页内折叠容器
// (一级导航隐藏后, 原 renderX 通过 pageEl(name) 取容器, 重定向到研究页内的子容器)
const PAGE_TARGET = {};
const pageEl = (id) => document.getElementById(PAGE_TARGET[id] || ("page-" + id));

/* 后端连接(API 地址 / token / 页头连接框)在 backend.js——必须于本文件之前加载,
   此处经 Backend.init() 启动, 见文件末尾 boot 处。 */

/* ── 工具 ─────────────────────────────────────────────────────────── */
async function api(path, opts = {}) {
  const headers = Object.assign({}, opts.headers || {});
  // Content-Type 只对带 body 的请求设, GET 带上多余且部分代理会告警
  if (opts.body != null) headers["Content-Type"] = "application/json";
  if (API_TOKEN && /^[A-Za-z0-9_\-]+$/.test(API_TOKEN)) headers["Authorization"] = "Bearer " + API_TOKEN;
  let res = await fetchWithTimeout(API_BASE + path, Object.assign({}, opts, { headers }));
  if (res.status === 401 && !opts._authed) {
    // 本机页面: 401 时自动取 token 重试一次; 公网页取不到, 走下方报错提示
    const tok = await tryFetchToken();
    if (tok) {
      headers["Authorization"] = "Bearer " + tok;
      res = await fetchWithTimeout(API_BASE + path, Object.assign({}, opts, { headers }));
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

/* 失败提示框: 统一带「重试」按钮 —— 不重试就永远只有错误文字。
   重试调用 renderPage2(), 它按当前 .step.active 重新渲染当前页, 无需手动导航。 */
function errBox(msg, sub) {
  return `<div class="err-box">
    <div style="font-size:30px;line-height:1;margin-bottom:10px">⚠</div>
    <div>加载失败: ${esc(msg)}</div>
    ${sub ? `<div class="dim" style="margin-top:8px;font-size:12px;line-height:1.6">${esc(sub)}</div>` : ""}
    <button class="btn" style="margin-top:16px" onclick="renderPage2()">↻ 重试</button>
  </div>`;
}

/* 加载中提示框: 重组件冷缓存可达 15-45s。静默转圈用户会以为挂了,
   所以逐秒报耗时, 超过 15s 明确提示「后端冷计算中, 可重试」。 */
function loadingBox(text, { slowMs = 15000, note = "后端冷缓存计算中(净值/归因需重读全量面板), 可点下方重试。" } = {}) {
  return `<div class="loading" data-load-text="${esc(text)}" data-slow-ms="${slowMs}" data-note="${esc(note)}">
    ${esc(text)} <span class="dim load-elapsed"></span>
  </div>`;
}
// 加载计时器与 POLLS 分离: 切页的 clearPolls() 不会清掉它, 否则「已等 N 秒
// + 重试」提示会在用户还没看到之前被下一次 showPage() 抹掉。
let loadTimer = null;
function clearLoadTimer() {
  if (loadTimer) { clearInterval(loadTimer); loadTimer = null; }
  document.querySelectorAll(".loading[data-load-text]").forEach(e => { e.__slow = 0; e.__t0 = null; });
}
// showPage() 末尾调用: 给页面上所有 loading 框装一个共享计时器
function startLoadTimers() {
  clearLoadTimer();
  loadTimer = setInterval(() => {
    const els = document.querySelectorAll(".loading[data-load-text]");
    if (!els.length) { clearLoadTimer(); return; }
    els.forEach(el => {
      if (el.__t0 == null) el.__t0 = Date.now();
      const s = Math.round((Date.now() - el.__t0) / 1000);
      let span = el.querySelector(".load-elapsed");
      if (!span) {
        span = document.createElement("span");
        span.className = "dim load-elapsed";
        el.appendChild(span);
      }
      span.textContent = `· 已等 ${s}s`;
      const slowMs = Number(el.dataset.slowMs || 0);
      if (slowMs && !el.__slow && Date.now() - el.__t0 >= slowMs) {
        el.__slow = 1;
        const d = document.createElement("div");
        d.className = "dim";
        d.style.cssText = "margin-top:10px;font-size:12px;line-height:1.6";
        d.innerHTML = `⏳ ${esc(el.dataset.note || "")} <button class="btn small" style="margin-left:8px" onclick="renderPage2()">↻ 重试</button>`;
        el.appendChild(d);
      }
    });
  }, 1000);
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
  // 性能(2026-09-09): 12 图表 × 1000ms 默认动画 × 2.3 万数据点 → Chrome 渲染进程
  // CPU ~100%、滚动卡顿。统一关动画 + 禁用 hover 交互的昂贵重绘, 保滚动流畅。
  config.options = Object.assign({}, config.options, {
    animation: false,
    responsive: true,
    maintainAspectRatio: config.options && config.options.maintainAspectRatio !== undefined ? config.options.maintainAspectRatio : false,
    normalized: true,  // 数据去重序列化(大序列省内存)
  });
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
  clearLoadTimer();
  closePxModal();
  try { localStorage.setItem("dl_web_page", name); } catch (_) {}
  document.querySelectorAll(".step").forEach(s => s.classList.toggle("active", s.dataset.page === name));
  document.querySelectorAll(".page").forEach(s => s.classList.toggle("active", s.dataset.page === name));
  const renderers = { overview: renderOverview, research: renderResearch, lab: renderLab, signals: renderSignals, paper: renderPaper, sleeves: renderSleeves, logs: renderLogs, train: renderTrain, backtest: renderBacktest, evolve: renderEvolve, pipeline: renderPipeline };
  renderers[name]();
  // 渲染器是 async, 这里同步启动计时器 —— 首个 loading 框此刻已在 DOM 中
  startLoadTimers();
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
      api("/api/lab/status").then(r => r.status),
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
  const fill = async () => {
    try {
      const r = await api(url);
      const el = document.getElementById(containerId);
      if (!el) return;
      const lines = r.lines || r.log_tail || [];
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      el.textContent = lines.join("\n");
      if (nearBottom) el.scrollTop = el.scrollHeight;
    } catch (_) {}
  };
  fill();  // 页面加载即预填历史日志(含任务结束后); active 时再持续轮询
  if (active) pollSet("log-" + containerId, fill, 2000);
}

function busySection(job) {
  if (!job || !job.active) return "";
  const label = job.job ? job.job.label : "";
  return `<div class="busy-bar"><i class="spin"></i> 后台任务运行中: ${esc(label)}
    <button class="btn danger" onclick="stopActive()">停止</button></div>`;
}


/* 重新渲染当前页(任务停止等异步回调后刷新显示) */
function renderPage2() {
  const activeStep = document.querySelector(".step.active");
  if (activeStep) showPage(activeStep.dataset.page);
}
