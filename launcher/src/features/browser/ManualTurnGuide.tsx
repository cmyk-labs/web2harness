import { useEffect, useState } from "react";
import { PrimaryButton, SecondaryButton } from "../../components/Buttons";
import type { Copy } from "../../i18n";
import type { BrowserState } from "../../types";

export function ManualTurnGuide({
  copy,
  onCancel,
  onCopy,
  onSent,
  tab,
}: {
  copy: Copy;
  onCancel: () => void;
  onCopy: () => void;
  onSent: () => void;
  tab: BrowserState["tabs"][number];
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (tab.manualState !== "awaiting-user" || !tab.manualDeadlineAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [tab.manualDeadlineAt, tab.manualState]);
  const deadline = tab.manualDeadlineAt
    ? Date.parse(tab.manualDeadlineAt)
    : Number.NaN;
  const seconds = Number.isFinite(deadline)
    ? Math.max(0, Math.ceil((deadline - now) / 1_000))
    : 0;
  const waiting = tab.manualState === "awaiting-user";
  const status = waiting
    ? `${seconds} ${copy.manualPromptSeconds}`
    : tab.manualState === "sent"
      ? copy.manualPromptSent
      : tab.manualState === "running"
        ? copy.manualPromptRunning
        : tab.manualState === "completed"
          ? copy.complete
          : copy.failed;
  return (
    <div className={`manual-turn-guide${waiting ? " is-waiting" : ""}`}>
      <div>
        <strong>
          {waiting ? copy.manualPromptTitle : copy.manualPromptWaiting}
        </strong>
        {waiting ? <p>{copy.manualPromptInstruction}</p> : null}
      </div>
      <span className="manual-turn-status">{status}</span>
      <div className="manual-turn-actions">
        <SecondaryButton onClick={onCancel}>
          {copy.manualPromptCancel}
        </SecondaryButton>
        <SecondaryButton disabled={!tab.canCopyPrompt} onClick={onCopy}>
          {copy.manualPromptCopy}
        </SecondaryButton>
        <PrimaryButton disabled={!tab.canConfirmSent} onClick={onSent}>
          {copy.manualPromptSent}
        </PrimaryButton>
      </div>
    </div>
  );
}
