export function StateDot({
  state,
}: {
  state: "idle" | "ready" | "busy" | "error";
}) {
  return <i aria-hidden="true" className={`state-dot is-${state}`} />;
}
