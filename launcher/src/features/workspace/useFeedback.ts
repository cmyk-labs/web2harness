import { useCallback, useRef, useState } from "react";

export type FeedbackNotice = { text: string; id: number };

export function useFeedback() {
  const [notice, setNotice] = useState<FeedbackNotice | null>(null);
  const sequence = useRef(0);
  const show = useCallback(
    (text: string) => setNotice(text ? { text, id: ++sequence.current } : null),
    [],
  );
  const dismiss = useCallback(
    (id: number) =>
      setNotice((current) => (current?.id === id ? null : current)),
    [],
  );
  return [notice, show, dismiss] as const;
}
