import { expect, test } from "bun:test";
import { planRelease } from "../scripts/plan-release";

test("release planner refuses published stable replacement even on a forced tag", () => {
  for (const forced of [false, true]) {
    expect(() => planRelease({ id: 1, draft: false, prerelease: false }, forced, "v1.0.0")).toThrow("new version");
  }
});
test("release planner requires an explicit forced update for published previews", () => {
  const preview = { id: 2, draft: false, prerelease: true };
  expect(() => planRelease(preview, false, "v1.0.0")).toThrow("forced preview");
  expect(planRelease(preview, true, "v1.0.0")).toEqual({ replace: true, prerelease: true, previousId: 2 });
});
test("release planner preserves a final-version draft's preview status", () => {
  expect(planRelease({ id: 3, draft: true, prerelease: true }, false, "v1.0.0").prerelease).toBe(true);
});
test("release planner derives new release status only when no release exists", () => {
  expect(planRelease(null, false, "v1.0.0")).toEqual({ replace: false, prerelease: false, previousId: 0 });
  expect(planRelease(null, false, "v1.0.0-rc.1").prerelease).toBe(true);
});
test("release planner rejects immutable publications", () => {
  expect(() => planRelease({ id: 4, draft: false, prerelease: true, immutable: true }, true, "v1.0.0")).toThrow("immutable");
});
