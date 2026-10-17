import { rejectContextWindowEdits } from "../launcher/shared/context-budgets.cjs";

export function rejectContextWindowOptions(fast?: string, standard?: string): void {
  if (fast !== undefined || standard !== undefined) rejectContextWindowEdits({ fast, standard });
}
