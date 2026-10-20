import { expect, test } from "bun:test";
import { ChatGptPendingObservation } from "../../../../src/adapters/chatgpt-web/browser/pending-observation";
import { ChatGptBrowserObservationTimeoutError } from "../../../../src/adapters/chatgpt-web/browser/turn-observation";

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

test("polling a slow renderer leaves one read outstanding and exposes its eventual result", async () => {
  const observation = new ChatGptPendingObservation<string>(120_000);
  let resolve!: (value: string) => void;
  let reads = 0;
  const read = () => { reads++; return new Promise<string>(done => { resolve = done; }); };
  expect(observation.poll(read, 0)).toEqual({ state: "pending" });
  await flush();
  for (let time = 250; time <= 60_000; time += 250) expect(observation.poll(read, time).state).toBe("pending");
  expect(reads).toBe(1);
  resolve("complete snapshot");
  await flush();
  expect(observation.poll(read, 61_000)).toEqual({ state: "ready", value: "complete snapshot" });
  expect(reads).toBe(1);
});

test("timeout never launches a second read; a replacement observer cannot consume the old result", async () => {
  const observation = new ChatGptPendingObservation<string>(100);
  let resolve!: (value: string) => void;
  let reads = 0;
  const read = () => { reads++; return new Promise<string>(done => { resolve = done; }); };
  observation.poll(read, 0);
  await flush();
  expect(() => observation.poll(read, 100)).toThrow(ChatGptBrowserObservationTimeoutError);
  expect(() => observation.poll(read, 200)).toThrow(ChatGptBrowserObservationTimeoutError);
  expect(reads).toBe(1);
  const replacement = new ChatGptPendingObservation<string>();
  replacement.poll(async () => "new owned page", 300);
  resolve("obsolete page");
  await flush();
  expect(replacement.poll(read, 301)).toEqual({ state: "ready", value: "new owned page" });
});

test("observer failures are surfaced once with their original identity", async () => {
  const observation = new ChatGptPendingObservation<string>();
  const failure = new TypeError("renderer read failed");
  observation.poll(() => { throw failure; });
  await flush();
  expect(() => observation.poll(async () => "unused")).toThrow(failure);
  observation.poll(async () => "recovered");
  await flush();
  expect(observation.poll(async () => "unused")).toEqual({ state: "ready", value: "recovered" });
});
