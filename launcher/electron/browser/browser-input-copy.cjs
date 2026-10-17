const copy = {
  en: {
    navigation: "This browser page is view-only. Choose Enable interaction to use it.",
    zoom: "Browser zoom is locked. Enable interaction first; automatic task pages must also be closed.",
    close: "This browser page is in use. Stop the task explicitly before closing it.",
    tools: "Codex is still executing tools. Stop the task in Codex before releasing this page.",
    stopping: "This browser task is already stopping",
    operation: "Finish or stop automatic tasks, including pending tool results, before using this operation",
    account: "Close retained automatic conversation tabs before changing the shared browser account",
    changed: "The selected page or automatic task changed. Try again on the current page.",
    title: "Enable interaction on this page?",
    message: "Manual interaction can interrupt the task or change its results.",
    detail: "This only unlocks the selected page; it does not stop Codex. Other pages stay protected. Choose Block interaction to lock it again. New pages, restarting the app and the next automatic round restore protection. Browser zoom stays locked while automatic pages are open.",
    allow: "Enable interaction",
    cancel: "Keep blocked",
  },
  "zh-CN": {
    navigation: "此页面仅供查看。请点击“恢复操作”后再操作。",
    zoom: "浏览器缩放已锁定。请先恢复操作；自动任务页面仍打开时不能调整缩放。",
    close: "此页面仍被任务占用，请明确停止任务后再关闭。",
    tools: "Codex 仍在执行工具，请先在 Codex 中停止任务，再释放此页面。",
    stopping: "此网页任务正在停止，请等待完成。",
    operation: "请先完成或停止自动任务（包括等待工具结果的任务），再进行此操作。",
    account: "请先关闭保留的自动会话标签，再更改共享浏览器账户。",
    changed: "所选页面或自动任务已变化，请在当前页面重新操作。",
    title: "恢复当前页面的操作？",
    message: "人工操作可能打断任务或改变执行结果。",
    detail: "这只会解除当前页面的保护，不会停止 Codex；其他页面仍受保护。点击“禁止操作”可重新保护。新页面、重启应用及新一轮自动执行都会恢复保护。自动任务页面仍打开时，浏览器缩放保持锁定。",
    allow: "恢复操作",
    cancel: "保持禁止",
  },
};

function browserInputCopy(language) { return copy[language] || copy.en; }

module.exports = { browserInputCopy };
