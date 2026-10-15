import { createContext, useContext, useLayoutEffect, useRef, type RefObject } from "react";
import { Button } from "../../components/Buttons";

export interface PageNavigationGuard {
  dirty: boolean;
  canSave: boolean;
  busy: boolean;
  save(): Promise<boolean>;
  discard(): void;
}
export interface NavigationGuardRef extends RefObject<PageNavigationGuard | null> { notify?: () => void }
export const PageNavigationContext = createContext<NavigationGuardRef | null>(null);
export function usePageNavigationGuard(guard: PageNavigationGuard) {
  const current = useContext(PageNavigationContext);
  useLayoutEffect(() => {
    if (!current) return;
    const previous = current.current;
    current.current = guard;
    if (previous?.dirty !== guard.dirty || previous?.canSave !== guard.canSave || previous?.busy !== guard.busy) current.notify?.();
  });
  useLayoutEffect(() => () => { if (current) current.current = null; }, [current]);
}

export function UnsavedChangesDialog({ language, busy, canSave, onSave, onDiscard, onContinue }: {
  language: string; busy: boolean; canSave: boolean;
  onSave(): void; onDiscard(): void; onContinue(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { dialog.current?.close(); previous?.focus(); };
  }, []);
  const t = (zh: string, en: string) => language === "zh-CN" ? zh : en;
  return <dialog ref={dialog} className="unsaved-dialog workspace-ui" aria-labelledby="unsaved-title"
    onCancel={event => { event.preventDefault(); if (!busy) onContinue(); }}>
    <h2 id="unsaved-title">{t("有未保存的修改", "Unsaved changes")}</h2>
    <p>{t("离开前保存运行参数，或放弃这次修改。", "Save the runtime parameters before leaving, or discard these changes.")}</p>
    <div className="queue-actions">
      <Button primary disabled={busy || !canSave} onClick={onSave}>{busy ? t("保存中…", "Saving…") : t("保存并离开", "Save and leave")}</Button>
      <Button disabled={busy} onClick={onDiscard}>{t("放弃修改", "Discard changes")}</Button>
      <Button disabled={busy} onClick={onContinue}>{t("继续编辑", "Keep editing")}</Button>
    </div>
  </dialog>;
}
