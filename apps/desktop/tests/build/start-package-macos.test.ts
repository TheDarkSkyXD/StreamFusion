import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseArguments, verifyPackage } from "../../scripts/verify-start-package-macos.mjs";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

// Guards: a wrong-host invocation emits failed evidence instead of reporting an unexecuted package proof as passed.
// Guards: rerunning a verifier cannot overwrite earlier evidence or remove files it does not own.
// Guards: ambiguous package/architecture arguments cannot select an unintended package to launch.
describe("macOS package verification", () => {
  it("writes an atomic failed report before attempting launch on the wrong host", async () => {
    const evidence = await mkdtemp(path.join(tmpdir(), "streamfusion-macos-report-test-"));
    temporaryDirectories.push(evidence);
    const existingSignalListeners = process.listenerCount("SIGTERM");
    const result = await verifyPackage({
      app: path.join(evidence, "never-launched.app"),
      arch: process.arch === "arm64" ? "x64" : "arm64",
      evidence,
    });

    expect(result.passed).toBe(false);
    expect(result.checks.preconditions).toEqual({
      status: "failed",
      error: expect.stringMatching(/native macOS runner|Runner architecture must match/),
    });
    expect(result.checks.launch).toEqual({ status: "not_run" });
    expect(result.checks.cleanup).toEqual({ status: "passed" });
    expect(JSON.parse(await readFile(path.join(evidence, "report.json"), "utf8"))).toEqual(result);
    expect(await readdir(evidence)).toEqual(["report.json"]);
    expect(process.listenerCount("SIGTERM")).toBe(existingSignalListeners);

    const originalReport = await readFile(path.join(evidence, "report.json"), "utf8");
    await expect(verifyPackage({ app: "another.app", arch: "arm64", evidence })).rejects.toThrow(
      "Evidence directory must be empty"
    );
    expect(await readFile(path.join(evidence, "report.json"), "utf8")).toBe(originalReport);
  });

  it("rejects an occupied evidence directory without touching its contents", async () => {
    const evidence = await mkdtemp(path.join(tmpdir(), "streamfusion-macos-occupied-test-"));
    temporaryDirectories.push(evidence);
    await writeFile(path.join(evidence, "existing-proof.txt"), "Keep this proof");

    await expect(verifyPackage({ app: "candidate.app", arch: "x64", evidence })).rejects.toThrow(
      "Evidence directory must be empty"
    );
    expect(await readFile(path.join(evidence, "existing-proof.txt"), "utf8")).toBe(
      "Keep this proof"
    );
    expect(await readdir(evidence)).toEqual(["existing-proof.txt"]);
  });

  it("requires explicit unambiguous package, architecture and evidence paths", () => {
    const args = ["--app", "candidate.app", "--arch", "arm64", "--evidence", "proof"];
    expect(parseArguments(args)).toEqual({
      app: path.resolve("candidate.app"),
      arch: "arm64",
      evidence: path.resolve("proof"),
    });
    expect(() => parseArguments([...args, "--app", "other.app"])).toThrow(
      "Duplicate option: --app"
    );
    expect(() => parseArguments(["--app", "candidate.app", "--evidence", "proof"])).toThrow(
      "Architecture must be x64 or arm64"
    );
    expect(() => parseArguments(["--app", "--arch", "arm64"])).toThrow("Missing value: --app");
    expect(() => parseArguments([...args, "--disable-security", "true"])).toThrow(
      "Unknown option: --disable-security"
    );
  });
});
