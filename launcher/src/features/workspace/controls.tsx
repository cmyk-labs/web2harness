import type { ReactNode } from "react";

export function PageIntro({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="surface-header">
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </div>
  );
}

export function Section({
  title,
  meta,
  id,
}: {
  title: string;
  meta?: ReactNode;
  id?: string;
}) {
  return (
    <div className="sectionhead" id={id}>
      <h2>{title}</h2>
      {meta}
    </div>
  );
}

export function Segment<T extends string | boolean>({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  options: { value: T; label: string; accessibleLabel?: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className="segment"
      role="radiogroup"
      aria-label={label}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight"].includes(event.key) || disabled)
          return;
        event.preventDefault();
        const current = options.findIndex((option) => option.value === value);
        const next =
          (current + (event.key === "ArrowLeft" ? -1 : 1) + options.length) %
          options.length;
        (event.currentTarget.children[next] as HTMLButtonElement).focus();
        onChange(options[next].value);
      }}
    >
      {options.map((option) => (
        <button
          type="button"
          role="radio"
          aria-label={option.accessibleLabel}
          title={option.accessibleLabel}
          tabIndex={option.value === value ? 0 : -1}
          aria-checked={option.value === value}
          key={String(option.value)}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Row({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="row">
      <div>
        <h3>{title}</h3>
        {description && <p>{description}</p>}
      </div>
      {children}
    </div>
  );
}

export function Toggle({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      className="toggle"
      role="switch"
      aria-label={label}
      aria-checked={value}
      disabled={disabled}
      onClick={() => onChange(!value)}
    />
  );
}
