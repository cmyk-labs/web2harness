import { useEffect, useState } from "react";
import type { Translate } from "./types";
import type { FeedbackNotice } from "./useFeedback";

export function Feedback({
  notice,
  dismiss,
  t,
}: {
  notice: FeedbackNotice;
  dismiss: (id: number) => void;
  t: Translate;
}) {
  const [fading, setFading] = useState(false);
  useEffect(() => {
    const fade = window.setTimeout(() => setFading(true), 3000);
    const remove = window.setTimeout(() => dismiss(notice.id), 3200);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(remove);
    };
  }, [notice.id, dismiss]);
  return (
    <div
      className={`feedback${fading ? " is-leaving" : ""}`}
      role="status"
      aria-live="polite"
    >
      <span className="status-dot status-success" aria-hidden="true" />
      <span>{notice.text}</span>
      <button
        type="button"
        aria-label={t("关闭提示", "Dismiss notification")}
        onClick={() => dismiss(notice.id)}
      >
        ×
      </button>
    </div>
  );
}
