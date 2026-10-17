// This isolated, local-only document receives physical input instead of the task webpage.
const copy = {
  en: {
    protected: ["Browser interaction blocked", "Pages stay protected even when no task is running."],
    "sign-in": ["Sign-in page · interaction blocked", "Enable interaction to complete sign-in on this page."],
    manual: ["Manual page · interaction blocked", "Enable interaction to paste and submit your message."],
    "failed-answer": ["Answer not verified or delivered", "This failed page is temporarily kept for review. Use Copy answer in the toolbar to save its unverified visible text. It will close within 10 minutes, or earlier if space is needed."],
    running: ["Automatic task · view only", "Codex is working. Manual input can interrupt the task or change its results."],
    "waiting-tools": ["Waiting for tool results · view only", "Codex is still working. Browser input stays blocked between rounds."],
    stopping: ["Stopping · view only", "Browser input stays blocked until this page is released. Other tasks continue to run."],
    retained: ["Retained conversation · view only", "This page is reserved for continuation and stays protected after the task finishes."],
    checking: ["Checking browser · view only", "An automatic check is using this page. Protection stays enabled after the check."],
  },
  "zh-CN": {
    protected: ["浏览器已禁止操作", "无任务时也保持保护，页面仅供查看。"],
    "sign-in": ["登录页面已禁止操作", "请恢复当前页面的操作后完成登录。"],
    manual: ["手动页面已禁止操作", "请恢复当前页面的操作后粘贴并提交消息。"],
    "failed-answer": ["回答未验证、未交付", "失败页面暂时保留供查看。可点击工具栏“复制回答”保存未经验证的可见文本。最多保留10分钟，空间不足时可能提前回收。"],
    running: ["自动执行中，仅供查看", "Codex 正在执行任务，人工操作可能打断任务或改变结果。"],
    "waiting-tools": ["等待工具结果，仅供查看", "Codex 仍在执行任务，轮次之间继续保持保护。"],
    stopping: ["正在停止，仅供查看", "页面释放前继续禁止操作，其他任务不受影响。"],
    retained: ["会话已保留，仅供查看", "此页面留待后续任务继续使用，任务结束后仍保持保护。"],
    checking: ["正在检查浏览器，仅供查看", "自动检查正在使用此页面，检查完成后继续保持保护。"],
  },
};
window.setInputNotice = ({ reason, language }) => {
  document.documentElement.lang = language;
  const localized = copy[language] || copy.en;
  const [title, message] = localized[reason] || localized.running;
  document.getElementById("title").textContent = title;
  document.getElementById("message").textContent = message + (reason === "failed-answer" ? "" : language === "zh-CN"
    ? " 如需解除保护，可点击工具栏中的“恢复操作”。"
    : " To unlock this page, choose Enable interaction in the toolbar.");
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
