import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";

export function Button({
  children,
  onClick,
  disabled = false,
  primary = false,
  label,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      className={`btn ${primary ? "primary" : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
    >
      {children}
    </button>
  );
}

export function PrimaryButton({
  children,
  disabled = false,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="button-primary"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  disabled = false,
  icon,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  icon?: IconName;
  onClick: () => void;
}) {
  return (
    <button
      className="button-secondary"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {icon ? <Icon name={icon} /> : null}
      <span>{children}</span>
    </button>
  );
}

export function IconButton({
  expanded,
  controls,
  disabled = false,
  icon,
  label,
  onClick,
}: {
  expanded?: boolean;
  controls?: string;
  disabled?: boolean;
  icon: IconName;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      aria-expanded={expanded}
      aria-controls={controls}
      className="icon-button"
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      <Icon name={icon} />
    </button>
  );
}
