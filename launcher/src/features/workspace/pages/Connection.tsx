import { type ReactNode } from "react";
import { Button } from "../../../components/Buttons";
import { localizeRuntimeMessage } from "../../../i18n";
import { PageIntro, Row, Section, Segment, Toggle } from "../controls";
import { Feedback } from "../Feedback";
import { interactionName, modeName } from "../labels";
import { Report } from "../Report";
import type { WorkspaceProps } from "../types";
import { useConnectionSetup } from "../useConnectionSetup";

export function Connection(p: WorkspaceProps) {
  const { status, operation } = p;
  const {
    api,
    snapshot,
    browser,
    updateState,
    refresh,
    activateBrowser,
    language,
    t,
    copy,
    draft,
    interaction,
    setDirty,
    working,
    notice,
    setNotice,
    dismissNotice,
    tunnel,
    setTunnel,
    runtimeKey,
    setRuntimeKey,
    replace,
    setReplace,
    report,
    setReport,
    failure,
    setFailure,
    busy,
    manual,
    saved,
    currentMode,
    pending,
    applied,
    needsCatalogRefresh,
    models,
    run,
    discard,
    chooseMode,
    chooseInteraction,
    apply,
    verify,
    credentialsValid,
    canApply,
  } = useConnectionSetup(p);
  const errorFor = (step: string) =>
    failure?.step === step ? (
      <div className="note warn" role="alert">
        {failure.message}
      </div>
    ) : null;
  const step = (
    number: number,
    title: string,
    description: string,
    done: boolean | undefined,
    children: ReactNode,
    stateLabel?: string,
  ) => (
    <div className={`connection-step${done ? " is-complete" : ""}`}>
      <span
        className={`step-index${done ? " status-success" : ""}`}
        aria-hidden="true"
      >
        {done ? "✓" : number}
      </span>
      <div className="step-main">
        <div className="step-heading">
          <h3>{title}</h3>
          <span className={done ? "status-success" : "muted"}>
            {stateLabel ??
              (done ? t("已完成", "Complete") : t("待完成", "Pending"))}
          </span>
        </div>
        <p>{description}</p>
        <div className="step-action">{children}</div>
      </div>
    </div>
  );
  const browserSteps = (
    <>
      {step(
        1,
        t("登录 ChatGPT", "Sign in to ChatGPT"),
        manual
          ? t(
              "在浏览器中手动登录。账号状态由你确认，应用不自动检测。",
              "Sign in manually in the browser. You confirm the account status; the app does not inspect it.",
            )
          : browser?.authenticated
            ? t(
                "已登录独立浏览器会话。",
                "Signed in to the separate browser session.",
              )
            : t(
                "在独立浏览器中登录你的 ChatGPT 账号。",
                "Sign in to your ChatGPT account in the separate browser.",
              ),
        !manual && browser?.authenticated === true,
        <>
          <Button
            disabled={busy}
            onClick={() =>
              void run("login", async () => {
                await activateBrowser(true);
              })
            }
          >
            {t("打开浏览器", "Open browser")}
          </Button>
          {errorFor("login")}
        </>,
        manual ? t("手动管理", "Managed manually") : undefined,
      )}
      {step(
        2,
        manual
          ? t("确认网页操作方式", "Review browser interaction")
          : t("检查浏览器连接", "Check browser connection"),
        manual
          ? t(
              "提示词发送和确认由你完成。配置应用后可以检查本地运行环境。",
              "You send and confirm prompts. Local runtime checks become available after applying configuration.",
            )
          : snapshot.state.browserInteractionMode === "manual"
            ? t(
                "应用自动交互后再运行浏览器检查；选择选项不会提前启用自动化。",
                "Run browser checks after applying automatic interaction. Selecting this option does not start automation.",
              )
            : snapshot.smokePassed
              ? t(
                  "当前会话已通过连接检查。",
                  "The current session passed the connection check.",
                )
              : t(
                  "运行浏览器检查，验证当前会话是否可用。",
                  "Run a browser check to verify that this session is available.",
                ),
        !manual && snapshot.smokePassed,
        manual ? (
          <span className="muted">
            {t("无需自动检测", "No automated inspection")}
          </span>
        ) : (
          <>
            <Button
              disabled={
                busy ||
                !browser?.authenticated ||
                snapshot.state.browserInteractionMode === "manual"
              }
              onClick={() =>
                void run("browser", async () => {
                  await activateBrowser();
                  await api.smokeTest();
                  updateState((await api.snapshot()).state);
                })
              }
            >
              {snapshot.smokePassed
                ? t("重新检查", "Check again")
                : t("检查连接", "Check connection")}
            </Button>
            {errorFor("browser")}
          </>
        ),
        manual ? t("由你操作", "User operated") : undefined,
      )}
    </>
  );
  const applyControls = (
    <div className="connection-apply">
      <div>
        <strong>
          {t("将使用", "Will use")}: {modeName(draft, t)} ·{" "}
          {interactionName(interaction, t)}
        </strong>
        {!canApply && !busy && (
          <p>
            {draft === "mcp-bridge"
              ? !credentialsValid
                ? t(
                    "请填写有效的 Tunnel ID 和 API key。",
                    "Enter a valid Tunnel ID and API key.",
                  )
                : t(
                    "请先准备 Codex 模型目录并在 Codex 中刷新。",
                    "Prepare the Codex model catalog and refresh it in Codex first.",
                  )
              : t(
                  "请先登录 ChatGPT 并完成浏览器连接检查。",
                  "Sign in to ChatGPT and complete the browser check first.",
                )}
          </p>
        )}
      </div>
      <div className="actions">
        {pending && (
          <Button disabled={busy} onClick={discard}>
            {t("放弃更改", "Discard changes")}
          </Button>
        )}
        <Button primary disabled={!canApply} onClick={() => void apply()}>
          {working ? copy.running : t("应用配置", "Apply configuration")}
        </Button>
      </div>
    </div>
  );
  const catalogDescription = snapshot.state.codexCatalogVerified
    ? t("Codex 已读取 Web 模型目录。", "Codex has read the Web model catalog.")
    : snapshot.state.coreSetupComplete
      ? t(
          "配置已写入，等待 Codex 读取模型目录。读取成功后这里会更新。",
          "Configuration is saved. Waiting for Codex to read the model catalog; this status updates after a successful request.",
        )
      : t(
          "先应用配置，再在 Codex 中刷新模型目录。",
          "Apply configuration, then refresh the model catalog in Codex.",
        );
  return (
    <>
      <PageIntro
        title={t("连接与模型", "Connection & Models")}
        subtitle={t(
          "选择工具模式，配置连接，然后在 Codex 中使用 Web 模型。",
          "Choose a tool mode, configure the connection, then use Web models in Codex.",
        )}
      />
      <div className="connection-active">
        <span>{t("当前生效", "Active configuration")}</span>
        <strong>
          {modeName(currentMode, t)}
          {status?.configured &&
            ` · ${interactionName(snapshot.state.browserInteractionMode, t)}`}
        </strong>
      </div>
      <Section title={t("工具模式", "Tool mode")} />
      <div
        className="mode-list"
        role="radiogroup"
        aria-label={t("工具模式", "Tool mode")}
        onKeyDown={(event) => {
          if (
            busy ||
            !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
              event.key,
            )
          )
            return;
          event.preventDefault();
          const next = draft === "mcp-bridge" ? "native-tools" : "mcp-bridge";
          chooseMode(next);
          event.currentTarget
            .querySelectorAll<HTMLButtonElement>('[role="radio"]')
            [next === "mcp-bridge" ? 1 : 0].focus();
        }}
      >
        {(["native-tools", "mcp-bridge"] as const).map((mode) => (
          <button
            type="button"
            className={`mode${draft === mode ? " selected" : ""}`}
            role="radio"
            aria-checked={draft === mode}
            tabIndex={draft === mode ? 0 : -1}
            disabled={busy}
            key={mode}
            onClick={() => chooseMode(mode)}
          >
            <strong>
              <span className="radio" aria-hidden="true" />
              {modeName(mode, t)}
              {mode === "native-tools" && (
                <span className="badge">{t("推荐", "Recommended")}</span>
              )}
            </strong>
            <p>
              {mode === "native-tools"
                ? t(
                    "由 Codex 执行本地工具，无需配置 MCP 连接器。",
                    "Codex runs local tools. No MCP connector setup required.",
                  )
                : t(
                    "通过 MCP 连接本地工具，需要配置隧道和连接器。",
                    "Connect local tools through MCP. Requires a tunnel and connector.",
                  )}
            </p>
          </button>
        ))}
      </div>
      <div className="interaction-setting row">
        <div>
          <h3>{t("网页交互方式", "Browser interaction")}</h3>
          <p>
            {draft === "native-tools"
              ? t(
                  "原生工具使用自动交互。手动交互可在 MCP 桥接模式下使用。",
                  "Native Tools uses automatic interaction. Manual interaction is available with MCP Bridge.",
                )
              : manual
                ? t(
                    "你负责浏览器中的发送与确认，应用不自动检查账号状态。",
                    "You send and confirm in the browser. The app does not inspect your account automatically.",
                  )
                : t(
                    "应用自动操作独立浏览器会话。",
                    "The app operates the separate browser session automatically.",
                  )}
          </p>
        </div>
        {draft === "mcp-bridge" ? (
          <Segment
            label={t("网页交互方式", "Browser interaction")}
            value={interaction}
            onChange={chooseInteraction}
            disabled={busy}
            options={[
              { value: "automatic", label: t("自动", "Automatic") },
              { value: "manual", label: t("手动", "Manual") },
            ]}
          />
        ) : (
          <strong>{t("自动", "Automatic")}</strong>
        )}
      </div>
      {pending && (
        <div className="pending-configuration note" role="status">
          <strong>
            {t("待应用", "Pending")}: {modeName(draft, t)} ·{" "}
            {interactionName(interaction, t)}
          </strong>
          <p>
            {t("当前仍使用", "Still active")}: {modeName(currentMode, t)}
            {status?.configured &&
              ` · ${interactionName(snapshot.state.browserInteractionMode, t)}`}
            {replace && ` · ${t("凭据尚未更换", "Credentials unchanged")}`}
          </p>
        </div>
      )}
      {busy && (
        <div className="note" role="status">
          {operation?.status === "running"
            ? localizeRuntimeMessage(
                copy,
                operation.message,
                undefined,
                language,
              )
            : t(
                "操作进行中，暂时不能更改模式或连接。",
                "An operation is in progress. Mode and connection changes are paused.",
              )}
        </div>
      )}
      {draft === "native-tools" ? (
        <section className="connection-section">
          <Section title={t("连接配置", "Connection setup")} />
          <div className="panel">
            {browserSteps}
            {step(
              3,
              t("应用配置", "Apply configuration"),
              t(
                "应用成功后，所选配置才会生效。",
                "The selected configuration takes effect only after a successful apply.",
              ),
              applied,
              <>
                {applyControls}
                {errorFor("apply")}
              </>,
            )}
            {step(
              4,
              t("在 Codex 刷新模型目录", "Refresh the model catalog in Codex"),
              catalogDescription,
              applied && snapshot.state.codexCatalogVerified,
              null,
            )}
          </div>
        </section>
      ) : (
        <>
          <section className="connection-section">
            <Section title={t("一、准备环境", "1. Prepare the environment")} />
            <div className="panel">
              {browserSteps}
              {!manual &&
                step(
                  3,
                  t("准备 Codex 模型目录", "Prepare the Codex model catalog"),
                  snapshot.state.browserInteractionMode === "manual"
                    ? t(
                        "切换到自动交互并应用后，在 Codex 刷新模型目录。",
                        "After applying automatic interaction, refresh the model catalog in Codex.",
                      )
                    : catalogDescription,
                  snapshot.state.codexCatalogVerified,
                  <>
                    {!snapshot.state.coreSetupComplete &&
                      snapshot.state.browserInteractionMode === "automatic" && (
                        <Button
                          disabled={
                            busy ||
                            !browser?.authenticated ||
                            !snapshot.smokePassed
                          }
                          onClick={() =>
                            void run("catalog", async () => {
                              await api.setupCore();
                              updateState((await api.snapshot()).state);
                            })
                          }
                        >
                          {t("准备模型目录", "Prepare model catalog")}
                        </Button>
                      )}
                    {errorFor("catalog")}
                  </>,
                )}
            </div>
          </section>
          <section className="connection-section connection-credentials">
            <Section
              title={t(
                "二、连接凭据与应用",
                "2. Credentials and configuration",
              )}
            />
            <p>
              {t(
                "自动和手动交互分别保存连接配置。API key 需要 Tunnels Read + Use 权限。",
                "Automatic and manual interaction save separate connection profiles. The API key requires Tunnels Read + Use permissions.",
              )}
            </p>
            {saved && !replace ? (
              <div className="row">
                <div>
                  <h3>{t("连接凭据已保存", "Connection credentials saved")}</h3>
                  <p>
                    {t(
                      "应用时复用此交互方式的凭据。密钥不会回显。",
                      "Apply reuses credentials for this interaction mode. The key is not displayed.",
                    )}
                  </p>
                </div>
                <Button
                  disabled={busy}
                  onClick={() => {
                    setReplace(true);
                    setDirty(true);
                    setReport(null);
                  }}
                >
                  {t("更换凭据", "Replace credentials")}
                </Button>
              </div>
            ) : (
              <div className="fields">
                <label>
                  {snapshot.profile === "development"
                    ? "DEV Tunnel ID"
                    : "Tunnel ID"}
                  <input
                    value={tunnel}
                    disabled={busy}
                    onChange={(event) => {
                      setTunnel(event.target.value.trim());
                      setDirty(true);
                    }}
                    placeholder="tunnel_…"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <label>
                  API key
                  <input
                    type="password"
                    value={runtimeKey}
                    disabled={busy}
                    onChange={(event) => {
                      setRuntimeKey(event.target.value);
                      setDirty(true);
                    }}
                    placeholder="sk-…"
                    autoComplete="off"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    maxLength={16384}
                  />
                </label>
              </div>
            )}
            <details className="setup-help">
              <summary>
                {t("查看凭据配置教程", "View credential setup guide")}
              </summary>
              <div className="actions">
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run("credentials", async () => {
                      await api.openExternal(snapshot.urls.tunnels);
                    })
                  }
                >
                  {copy.openTunnels}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run("credentials", async () => {
                      await api.openExternal(snapshot.urls.keys);
                    })
                  }
                >
                  {copy.openKeys}
                </Button>
              </div>
              <video
                controls
                preload="none"
                src={
                  new URL(
                    "../../../../../assets/demos/mcp-create-tunnel.mp4",
                    import.meta.url,
                  ).href
                }
                aria-label={copy.mcpStepOne}
              />
            </details>
            {snapshot.profile === "development" && (
              <p>{copy.devConnectorIsolationNotice}</p>
            )}
            {errorFor("credentials")}
            {applyControls}
            {errorFor("apply")}
          </section>
          <section className="connection-section connection-check">
            <Section title={t("三、绑定与检查", "3. Bind and check")} />
            <div className="panel">
              <Row
                title={t("ChatGPT 连接器", "ChatGPT connector")}
                description={snapshot.connectorNames[interaction]}
              >
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run("connector", async () => {
                      await api.openExternal(snapshot.urls.connectors);
                    })
                  }
                >
                  {t("打开连接器设置", "Open connector settings")}
                </Button>
              </Row>
            </div>
            <p>
              {!applied || pending
                ? t(
                    "先应用配置，再将对应隧道绑定到上方连接器，最后完成检查。",
                    "Apply configuration first, bind its tunnel to the connector above, then complete the checks.",
                  )
                : manual
                  ? t(
                      "请在网页确认连接器绑定到对应隧道。本地检查通过仅代表本地环境可用，不验证远端绑定。",
                      "Confirm in the browser that the connector uses the matching tunnel. A successful local check does not verify the remote binding.",
                    )
                  : t(
                      "将对应隧道绑定到上方连接器，然后验证绑定。",
                      "Bind the matching tunnel to the connector above, then verify the binding.",
                    )}
            </p>
            <details className="setup-help">
              <summary>
                {t("查看连接器绑定教程", "View connector binding guide")}
              </summary>
              <video
                controls
                preload="none"
                src={
                  new URL(
                    "../../../../../assets/demos/mcp-connect-connector.mp4",
                    import.meta.url,
                  ).href
                }
                aria-label={copy.mcpStepThree}
              />
            </details>
            {errorFor("connector")}
            <div className="row">
              <div>
                <h3>
                  {manual
                    ? t("本地运行环境", "Local runtime")
                    : t("连接器绑定", "Connector binding")}
                </h3>
                <p>
                  {applied && !pending && snapshot.state.mcpSetupComplete
                    ? manual
                      ? t(
                          "本地检查通过；远端绑定需人工确认。",
                          "Local checks passed; confirm the remote binding manually.",
                        )
                      : t("已验证连接器绑定。", "Connector binding verified.")
                    : t("待检查", "Not checked")}
                </p>
              </div>
              <Button
                disabled={busy || !applied || pending}
                onClick={() => void verify()}
              >
                {manual
                  ? t("检查本地运行环境", "Check local runtime")
                  : t("验证连接器绑定", "Verify connector binding")}
              </Button>
            </div>
            {errorFor("verify")}
            {report && <Report report={report} language={language} />}
          </section>
        </>
      )}
      {notice && (
        <Feedback
          key={notice.id}
          notice={notice}
          dismiss={dismissNotice}
          t={t}
        />
      )}
      <details className="model-list" id="models">
        <summary>
          {t("Web 模型", "Web models")}{" "}
          <span className="badge">{models.length}</span>
          {needsCatalogRefresh && (
            <span className="model-catalog-status">
              {t("待刷新目录", "Catalog refresh pending")}
            </span>
          )}
        </summary>
        <div className="model-list-actions">
          <Button disabled={busy} onClick={() => void run("models", refresh)}>
            {t("刷新", "Refresh")}
          </Button>
        </div>
        <p className="model-list-description">
          {t(
            "按当前账号能力显示，在 Codex 中选择模型。能力变化后，请重新检查连接并应用配置。",
            "Available for the current account. Select a model in Codex. Recheck and apply configuration after capabilities change.",
          )}
        </p>
        {needsCatalogRefresh && (
          <p className="model-catalog-notice" role="status">
            {snapshot.profile === "development"
              ? copy.devRestartCodex
              : copy.restartCodex}
          </p>
        )}
        {errorFor("models")}
        <div className="panel">
          {models.length ? (
            models.map((model) => (
              <div className="model" key={model.id}>
                <div>
                  <strong>{model.name}</strong>
                  <p>
                    {t("思考强度：", "Reasoning: ")}
                    {model.efforts} · {t("默认：", "Default: ")}
                    {model.defaultEffort}
                  </p>
                  <code>{model.id}</code>
                </div>
                <Button
                  label={`${t("复制模型 ID", "Copy model ID")} ${model.name}`}
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(model.id)
                      .then(() =>
                        setNotice(t("模型 ID 已复制", "Model ID copied")),
                      )
                      .catch((error) =>
                        setFailure({ step: "models", message: String(error) }),
                      )
                  }
                >
                  {t("复制", "Copy")}
                </Button>
              </div>
            ))
          ) : (
            <div className="row">
              <p>
                {t(
                  "暂无已读取的 Web 模型。应用配置并在 Codex 刷新模型目录后，再刷新此列表。",
                  "No Web models have been read yet. Apply configuration and refresh the catalog in Codex, then refresh this list.",
                )}
              </p>
            </div>
          )}
        </div>
      </details>
      {snapshot.state.browserInteractionMode === "manual" && (
        <div className="panel">
          <Row
            title={t("手动 Pro 模型", "Manual Pro model")}
            description={`${copy.zeroRiskProProfileBody} ${copy.zeroRiskProProfileInfo}`}
          >
            <Toggle
              label={t("手动 Pro 模型", "Manual Pro model")}
              value={snapshot.state.zeroRiskProEnabled}
              disabled={busy || !snapshot.state.coreSetupComplete}
              onChange={(enabled) =>
                void run("pro", async () => {
                  updateState(await api.setZeroRiskPro(enabled));
                })
              }
            />
          </Row>
          {errorFor("pro")}
        </div>
      )}
      <p className="connection-footnote">
        {t(
          "Codex 原有模型与 Web 模型分开使用。额度取决于实际选择的模型和对应账号。",
          "Codex models and Web models are separate choices. Usage depends on the selected model and account.",
        )}
      </p>
    </>
  );
}
