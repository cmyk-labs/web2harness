import { BrandMark } from "./BrandMark";

export function FatalMessage({ message }: { message: string }) {
  return (
    <main className="fatal-message">
      <BrandMark />
      <h1>Web2Harness</h1>
      <p>{message}</p>
    </main>
  );
}
