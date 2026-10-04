import { copyFor, localizeRuntimeMessage } from "../../i18n";
import type { DoctorReport, Language } from "../../types";

export function Report({
  report,
  language,
}: {
  report: DoctorReport;
  language: Language;
}) {
  const copy = copyFor(language);
  return (
    <div className="panel" style={{ marginTop: 16 }} role="status">
      {report.checks.map((check, i) => (
        <div className="row doctor-check" key={`${check.id}-${i}`}>
          <div>
            <h3>{check.id}</h3>
            <p>
              {check.status === "ok"
                ? localizeRuntimeMessage(
                    copy,
                    check.message,
                    check.id,
                    language,
                  )
                : check.message}
            </p>
            {check.detail && <code>{check.detail}</code>}
          </div>
          <span
            className={`status-${check.status === "ok" ? "success" : check.status === "error" ? "error" : "neutral"}`}
          >
            {check.status === "ok" ? copy.complete : copy.needsAttention}
          </span>
        </div>
      ))}
    </div>
  );
}
