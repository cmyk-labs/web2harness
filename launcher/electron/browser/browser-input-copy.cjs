const copy = {
  en: {
    navigation: "This browser page is view-only while reserved for automation",
    zoom: "Browser zoom is locked while automatic task pages are open",
    close: "This browser page is in use. Stop the task explicitly before closing it.",
    tools: "Codex is still executing tools. Stop the task in Codex before releasing this page.",
    stopping: "This browser task is already stopping",
    operation: "Finish or stop automatic tasks, including pending tool results, before using this operation",
    account: "Close retained automatic conversation tabs before changing the shared browser account",
    changed: "The selected page or automatic task changed. Try again on the current page.",
    title: "Exit view-only mode on this page?",
    message: "Manual interaction can interrupt the task or change its results.",
    detail: "This only unlocks the selected page; it does not stop Codex. Other pages stay protected. You can restore view-only mode at any time. Protection resumes at the next automatic round. Global browser zoom remains locked.",
    allow: "Exit view-only",
    cancel: "Keep view-only",
  },
  "zh-CN": {
    navigation: "此页面正在供自动任务使用，仅供查看。",
    zoom: "自动任务页面仍然打开，暂时不能调整浏览器缩放。",
    close: "此页面仍被任务占用，请明确停止任务后再关闭。",
    tools: "Codex 仍在执行工具，请先在 Codex 中停止任务，再释放此页面。",
    stopping: "此网页任务正在停止，请等待完成。",
    operation: "请先完成或停止自动任务（包括等待工具结果的任务），再进行此操作。",
    account: "请先关闭保留的自动会话标签，再更改共享浏览器账户。",
    changed: "所选页面或自动任务已变化，请在当前页面重新操作。",
    title: "取消当前页面的只读状态？",
    message: "人工操作可能打断任务或改变执行结果。",
    detail: "这只会解除当前页面的保护，不会停止 Codex；其他页面仍受保护。你可以随时恢复只读，新一轮自动执行开始时也会重新启用保护。全局浏览器缩放仍保持锁定。",
    allow: "取消只读",
    cancel: "保持只读",
  },
};

function browserInputCopy(language) { return copy[language] || copy.en; }

module.exports = { browserInputCopy };
