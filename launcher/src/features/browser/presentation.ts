import type { Copy } from "../../i18n";
import type { BrowserState } from "../../types";

export function browserTabTitleFromTitle(
  value: string | undefined,
  copy: Copy,
): string {
  const title = value?.trim();
  if (
    !title ||
    title === "about:blank" ||
    title.includes("web2harness-browser-host")
  )
    return copy.temporaryChat;
  return title.replace(/\s*[|–-]\s*ChatGPT\s*$/i, "") || copy.temporaryChat;
}

export function browserTabTone(
  status: BrowserState["tabs"][number]["status"],
): "idle" | "ready" | "busy" | "error" {
  if (status === "error" || status === "aborted") return "error";
  if (status === "loading" || status === "running" || status === "testing")
    return "busy";
  if (status === "ready") return "ready";
  return "idle";
}

export function formatBrowserAddress(
  url: string | undefined,
  copy: Copy,
): string {
  if (!url || url.startsWith("about:blank")) return copy.browserAddress;
  try {
    const parsed = new URL(url);
    if (
      parsed.hostname === "chatgpt.com" &&
      parsed.searchParams.get("temporary-chat") === "true"
    ) {
      return `chatgpt.com  /  ${copy.temporaryChat}`;
    }
    return `${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return copy.browserAddress;
  }
}
