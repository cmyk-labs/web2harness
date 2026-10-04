/** Shared saved-chat identity and display contract. Titles never grant ownership. */
function savedChatId(url) {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== "https://chatgpt.com" || parsed.searchParams.has("temporary-chat")) return undefined;
    return /(?:^|\/)c\/([a-zA-Z0-9-]{1,128})\/?$/.exec(parsed.pathname)?.[1];
  } catch { return undefined; }
}

function validSavedChatTask(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && /^[a-f0-9]{64}$/.test(value.taskKey)
    && typeof value.taskName === "string" && value.taskName.length > 0 && value.taskName.length <= 160
    && !/[\u0000-\u001f\u007f]/.test(value.taskName)
    && ["dialogue", "compaction"].includes(value.kind);
}

function savedChatTitle(createdAt, taskName, kind, index) {
  const date = new Date(createdAt);
  if (!Number.isFinite(date.getTime()) || !Number.isSafeInteger(index) || index < 1
    || !["dialogue", "compaction"].includes(kind)) throw new Error("Invalid saved chat title metadata");
  const pad = value => String(value).padStart(2, "0");
  const time = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return `${time} · ${taskName} · ${kind === "compaction" ? "压缩" : "对话"}-${pad(index)}`;
}

module.exports = { savedChatId, validSavedChatTask, savedChatTitle };
