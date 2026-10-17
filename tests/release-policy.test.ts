import { expect, test } from "bun:test";
import { planRelease } from "../scripts/plan-release";
import { readFileSync } from "node:fs";

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

test("manual candidate builds have no path to release publication or write permissions", () => {
  const workflow = Bun.YAML.parse(readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8")) as any;
  expect(workflow.on).toHaveProperty("workflow_dispatch");
  expect(workflow.permissions).toEqual({ contents: "read" });
  expect(workflow.jobs.publish.if).toBe("github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')");
  expect(workflow.jobs.publish.needs).toBe("candidate");
  expect(workflow.jobs.publish.permissions).toEqual({ contents: "write" });
  for (const [name, job] of Object.entries<any>(workflow.jobs)) {
    if (name === "publish") continue;
    expect(job.permissions?.contents ?? workflow.permissions.contents).toBe("read");
    for (const step of job.steps) expect(step.run ?? "").not.toMatch(/gh (?:release|api).*|git push/);
  }
  const steps = workflow.jobs.publish.steps;
  const validation = steps.findIndex((step: any) => step.name === "Verify candidate assets before publication");
  const mutation = steps.findIndex((step: any) => step.run?.includes("gh release delete"));
  expect(validation).toBeGreaterThan(-1);
  expect(steps[validation].run).toContain("sha256sum --check checksums.txt");
  expect(mutation).toBeGreaterThan(validation);
  expect(JSON.stringify(workflow)).not.toMatch(/acceptance-evidence|\.github\/acceptance/);
});

test("candidate artifacts are assembled and checksummed before either handoff or publication", () => {
  const workflow = Bun.YAML.parse(readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8")) as any;
  const job = workflow.jobs.candidate;
  expect(job.needs).toBe("build");
  const steps = job.steps;
  const inventory = steps.findIndex((step: any) => step.run?.includes("check-release-assets.ts"));
  const checksum = steps.findIndex((step: any) => step.name === "Create checksums");
  const upload = steps.findIndex((step: any) => step.with?.name === "candidate-assets");
  expect(inventory).toBeGreaterThan(-1);
  expect(checksum).toBeGreaterThan(inventory);
  expect(upload).toBeGreaterThan(checksum);
  expect(steps.find((step: any) => step.with?.name === "candidate-source").with.path).toBe("candidate-source.json");
  expect(workflow.jobs.publish.steps.find((step: any) => step.uses?.startsWith("actions/download-artifact")).with.name).toBe("candidate-assets");
});

test("download links update only after stable publication and only on the default branch", () => {
  const workflow = Bun.YAML.parse(readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8")) as any;
  const steps = workflow.jobs.publish.steps;
  const published = steps.findIndex((step: any) => step.run?.includes("--draft=false"));
  const checkout = steps.findIndex((step: any) => step.name === "Check out default branch for download links");
  const update = steps.findIndex((step: any) => step.name === "Update latest stable download buttons");
  expect(checkout).toBeGreaterThan(published);
  expect(update).toBeGreaterThan(checkout);
  expect(steps[checkout].if).toBe("steps.publication.outputs.prerelease == 'false'");
  expect(steps[update].if).toBe(steps[checkout].if);
  expect(steps[checkout].with.ref).toBe("${{ github.event.repository.default_branch }}");
  expect(steps[checkout].with.path).toBe(steps[update]["working-directory"]);
  expect(steps[update].run).toContain("git add -- README.md README.zh-CN.md");
  expect(steps[update].run).not.toMatch(/--force|git push[^\n]*--tags/);
});
