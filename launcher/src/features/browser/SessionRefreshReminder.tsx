import { motion } from "motion/react";
import { Icon } from "../../components/icons";
import { PANEL_TRANSITION } from "../../components/motion";
import type { Copy } from "../../i18n";

export function SessionRefreshReminder({
  busy,
  copy,
  onDismiss,
  onLogout,
}: {
  busy: boolean;
  copy: Copy;
  onDismiss: () => void;
  onLogout: () => void;
}) {
  return (
    <motion.aside
      animate={{ opacity: 1, y: 0 }}
      aria-live="polite"
      className="session-refresh-reminder"
      exit={{ opacity: 0, y: -8 }}
      initial={{ opacity: 0, y: -8 }}
      transition={PANEL_TRANSITION}
    >
      <span className="session-refresh-reminder-icon">
        <Icon name="alert" />
      </span>
      <div className="session-refresh-reminder-copy">
        <strong>{copy.sessionReminderTitle}</strong>
        <p>{copy.sessionReminderBody}</p>
      </div>
      <div className="session-refresh-reminder-actions">
        <button
          className="text-button"
          disabled={busy}
          onClick={onDismiss}
          type="button"
        >
          {copy.dismiss}
        </button>
        <button
          className="button-primary"
          disabled={busy}
          onClick={onLogout}
          type="button"
        >
          {copy.logOut}
        </button>
      </div>
    </motion.aside>
  );
}
