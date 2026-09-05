/* deepltrading Web 控制台 — 后端连接模块(GitHub Pages 静态页 + 本机后端)。
   单一职责: 决定 API 地址与 token、渲染页头连接框、提供 init() 启动钩子。
   完全自包含(自带 _esc), 不引用 app.js 的任何顶层声明——声明顺序类 bug 结构上不可能。
   加载顺序: 本文件必须在 app.js 之前加载(index.html 保证)。
   暴露给 app.js 的全局: API_BASE / API_TOKEN / tryFetchToken / Backend.init()。 */
"use strict";

/* 后端地址优先级: URL ?apiBase= 参数 > localStorage 记忆 > 同源留空(本机直连)。
   从 GitHub Pages 打开时配置为 http://127.0.0.1:8766 即可真实操作。 */
const API_BASE = (() => {
  try {
    const q = new URLSearchParams(location.search).get("apiBase");
    if (q) localStorage.setItem("dl_apiBase", q.trim());
  } catch (_) {}
  try { return (localStorage.getItem("dl_apiBase") || "").trim().replace(/\/+$/, ""); } catch (_) { return ""; }
})();

/* API token 鉴权(2026-09-06): 除 /api/auth/* 外所有接口都要 Bearer token。
   localStorage 按 origin 隔离——本机页自动获取; 公网页(GitHub Pages)拿不到,
   需手动把本机页显示的 token 粘贴到页头。 */
let API_TOKEN = (() => { try { return localStorage.getItem("dl_apiToken") || ""; } catch (_) { return ""; } })();

const _esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const _IS_LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(location.origin);
/* 唯一被信任的公网来源: 用户自己的 GitHub Pages 域名(服务端同源校验, 见 web/app.py) */
const _PAGES_ORIGIN = "https://shanelau2.github.io";

async function tryFetchToken() {
  if (!_IS_LOCAL && location.origin !== _PAGES_ORIGIN) return null;
  try {
    const r = await fetch(API_BASE + "/api/auth/token", { cache: "no-store" });
    if (!r.ok) return null;
    const j = await r.json();
    if (j && j.token && /^[A-Za-z0-9_\-]+$/.test(j.token)) {
      API_TOKEN = j.token;
      try { localStorage.setItem("dl_apiToken", j.token); } catch (_) {}
    }
    return (j && j.token) || null;
  } catch (_) { return null; }
}

async function probeBackend(base) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 2000);
  try {
    const r = await fetch(base + "/api/signals/status", { signal: ctl.signal, cache: "no-store" });
    return r.ok || r.status === 401;   // 401 = 后端在线但缺 token, 也算可达
  } catch (_) { return false; } finally { clearTimeout(t); }
}

function renderApiBaseBox() {
  const box = document.getElementById("apiBaseBox");
  if (!box) return;
  const btnSt = "font-size:11px;padding:2px 8px;margin-left:4px;cursor:pointer;border-radius:6px;border:1px solid #3a4152;background:#1c2233;color:#cbd5e1";
  const inpSt = "width:150px;font-size:11px;padding:2px 6px;border:1px solid #3a4152;border-radius:6px;background:#141824;color:#cbd5e1";
  const backendRow = (_IS_LOCAL && !API_BASE)
    ? `<span>本机直连 ✓</span>`
    : `<input id="apiBaseIn" type="text" placeholder="http://127.0.0.1:8766" value="${_esc(API_BASE)}" style="${inpSt}">`
      + `<button id="apiBaseBtn" style="${btnSt}">连接</button>`
      + `<span id="apiBaseSt" style="font-size:11px;margin-left:4px">…检测中</span>`;
  box.innerHTML = `<div>${backendRow}</div>`
    + `<div style="margin-top:4px"><input id="tokenIn" type="password" placeholder="${API_TOKEN ? "已配置, 留空则不变" : "API token"}" style="${inpSt}">`
    + `<button id="tokenSave" style="${btnSt}">保存</button>`
    + (_IS_LOCAL || location.origin === _PAGES_ORIGIN ? `<button id="tokenFetch" title="从后端获取当前 token 填入" style="${btnSt}">本机获取</button>` : "")
    + `<span id="tokenSt" style="font-size:11px;margin-left:4px">${API_TOKEN ? "✓ token 已配置" : "✗ 未配置"}</span></div>`;
  const apiBtn = document.getElementById("apiBaseBtn");
  if (apiBtn) {
    const st = document.getElementById("apiBaseSt");
    probeBackend(API_BASE || "http://127.0.0.1:8766").then(ok => {
      if (!st) return;
      st.textContent = ok ? "✓ 已连接"
        : (_IS_LOCAL ? "✗ 不可达" : "✗ 不可达(Chrome 若弹「允许访问本地网络」请点允许)");
    });
    apiBtn.addEventListener("click", () => {
      const v = document.getElementById("apiBaseIn").value.trim().replace(/\/+$/, "");
      try { localStorage.setItem("dl_apiBase", v); } catch (_) {}
      location.reload();
    });
  }
  document.getElementById("tokenSave").addEventListener("click", () => {
    let v = document.getElementById("tokenIn").value.trim();
    if (!v) return;
    // 容忍粘贴 curl 响应({"token":"…"})或 “Bearer …” 等包装: 提取 token 主体;
    // 服务端 token 恒为 43 位 [A-Za-z0-9_-], 提取不到即输入本身有问题。
    const m = v.match(/[A-Za-z0-9_\-]{16,}/);
    v = m ? m[0] : "";
    if (!v) {
      const tst = document.getElementById("tokenSt");
      if (tst) tst.textContent = "✗ token 无效(只能含字母/数字/-/_, 或粘贴本机获取/curl 的完整输出)";
      return;
    }
    API_TOKEN = v;
    try { localStorage.setItem("dl_apiToken", v); } catch (_) {}
    const tst = document.getElementById("tokenSt");
    if (tst) tst.textContent = "✓ 已保存, 重载中…";
    location.reload();
  });
  const tf = document.getElementById("tokenFetch");
  if (tf) tf.addEventListener("click", async () => {
    const tst = document.getElementById("tokenSt");
    if (tst) tst.textContent = "获取中…";
    const tok = await tryFetchToken();
    if (tok) {
      document.getElementById("tokenIn").value = tok;
      if (tst) tst.textContent = "✓ 已填入, 点「保存」生效";
    } else if (tst) tst.textContent = "✗ 获取失败(仅本机页面可获取)";
  });
}

/* 远端页面(GitHub Pages)自动探测本机后端: 命中即持久化并重载, 每会话一次。
   这是整个模块唯一的启动钩子——app.js 在所有顶层声明就绪后调用 Backend.init()。 */
async function initBackend() {
  renderApiBaseBox();
  if (API_BASE) return;
  if (_IS_LOCAL) return;
  try { if (sessionStorage.getItem("dl_probed")) return; sessionStorage.setItem("dl_probed", "1"); } catch (_) { return; }
  const ok = await probeBackend("http://127.0.0.1:8766");
  if (ok) {
    try { localStorage.setItem("dl_apiBase", "http://127.0.0.1:8766"); } catch (_) {}
    location.reload();
  }
}

const Backend = { init: initBackend };