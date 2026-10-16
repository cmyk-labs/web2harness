// This isolated, local-only document receives physical input instead of the task webpage.
const copy = {
  en: {
    "failed-answer": ["Answer not verified or delivered", "This failed page is temporarily kept for review. Use Copy answer in the toolbar to save its unverified visible text. It will close within 10 minutes, or earlier if space is needed."],
    running: ["Automatic task · view only", "Mouse and keyboard input is blocked to avoid interrupting the task. To intervene, stop the task in Codex first."],
    "waiting-tools": ["Waiting for tool results · view only", "Codex is still working. Browser input stays blocked between rounds. To intervene, stop the task in Codex first."],
    stopping: ["Stopping · view only", "Browser input stays blocked until this page is released. Other tasks continue to run."],
    retained: ["Retained conversation · view only", "This page is reserved for continuation. Close this tab or return to the home tab to use the browser."],
    checking: ["Checking browser · view only", "An automatic check is using this page. Browser input will resume when the check finishes."],
  },
  "zh-CN": {
    "failed-answer": ["回答未验证、未交付", "失败页面暂时保留供查看。可点击工具栏“复制回答”保存未经验证的可见文本。最多保留10分钟，空间不足时可能提前回收。"],
    running: ["自动执行中，仅供查看", "为避免打断任务，已暂时禁用鼠标和键盘操作。如需人工操作，请先在 Codex 中停止任务。"],
    "waiting-tools": ["等待工具结果，仅供查看", "Codex 仍在执行任务，轮次之间继续保持只读。如需人工操作，请先在 Codex 中停止任务。"],
    stopping: ["正在停止，仅供查看", "页面释放前继续禁止操作，其他任务不受影响。"],
    retained: ["会话已保留，仅供查看", "此页面留待后续任务继续使用。需要操作浏览器时，请关闭此标签或返回首页标签。"],
    checking: ["正在检查浏览器，仅供查看", "自动检查正在使用此页面，检查完成后恢复操作。"],
  },
};
window.setInputNotice = ({ reason, language }) => {
  document.documentElement.lang = language;
  const localized = copy[language] || copy.en;
  const [title, message] = localized[reason] || localized.running;
  document.getElementById("title").textContent = title;
  document.getElementById("message").textContent = message + (reason === "failed-answer" ? "" : language === "zh-CN"
    ? " 如需解除保护，可点击工具栏中的“取消只读”。"
    : " To unlock this page, choose Exit view-only in the toolbar.");
};
let timer;
window.flashInputNotice = () => {
  const notice = document.getElementById("notice");
  notice.classList.add("attempted");
  clearTimeout(timer);
  timer = setTimeout(() => notice.classList.remove("attempted"), 1800);
};
for (const name of ["pointerdown", "keydown", "wheel", "touchstart", "contextmenu", "dragover", "drop", "beforeinput"]) {
  addEventListener(name, event => {
    event.preventDefault();
    window.flashInputNotice();
  }, { passive: false, capture: true });
}
