import { motion } from "motion/react";
import type { Copy } from "../i18n";
import { StateDot } from "./StateDot";
import { PANEL_TRANSITION } from "./motion";

export function ErrorToast({
  copy,
  message,
  onDismiss,
}: {
  copy: Copy;
  message: string;
  onDismiss: () => void;
}) {
  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="error-toast"
      exit={{ opacity: 0, y: 8 }}
      initial={{ opacity: 0, y: 8 }}
      transition={PANEL_TRANSITION}
    >
      <StateDot state="error" />
      <span>
        <strong>{copy.error}</strong>
        <p>{message}</p>
      </span>
      <button onClick={onDismiss} type="button">
        {copy.dismiss}
      </button>
    </motion.div>
  );
}
