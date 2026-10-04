import type {
  BrowserInteractionMode,
  Language,
  WorkspaceStatus,
} from "../../types";
import type { Translate, WorkspacePage } from "./types";

export const translate =
  (language: Language): Translate =>
  (zh, en) =>
    language === "zh-CN" ? zh : en;

export const pageName = (page: WorkspacePage, t: Translate) =>
  ({
    overview: t("概览", "Overview"),
    browser: t("浏览器", "Browser"),
    "runtime-controls": t("运行控制", "Runtime controls"),
    connection: t("连接与模型", "Connection & Models"),
    diagnostics: t("用量与诊断", "Usage & Diagnostics"),
    preferences: t("偏好设置", "Preferences"),
    about: t("关于", "About"),
  })[page];

export const modeName = (mode: WorkspaceStatus["mode"], t: Translate) =>
  mode === "mcp-bridge"
    ? t("MCP 桥接", "MCP Bridge")
    : mode === "native-tools"
      ? t("原生工具", "Native Tools")
      : mode === "browser-only"
        ? t("仅浏览器", "Browser only")
        : t("尚未配置", "Not configured");

export const interactionName = (mode: BrowserInteractionMode, t: Translate) =>
  mode === "manual" ? t("手动交互", "Manual") : t("自动交互", "Automatic");
