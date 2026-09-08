/* 启动引导 — 必须最后加载: 步骤导航接线 + 恢复上次页面 + 后端连接 + 弹窗接线。 */
"use strict";

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
