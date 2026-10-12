import type { EnvironmentLauncher, LaunchedEnvironment } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { launchedEnvironmentsToStop, type StopCandidateThread } from "./launchedEnvironments.logic";

const launchers: ReadonlyArray<EnvironmentLauncher> = [
  { id: "boat", label: "boat sandbox", command: "create", stopCommand: "stop" },
  { id: "plain", label: "plain", command: "create" },
];
const launched: ReadonlyArray<LaunchedEnvironment> = [
  { environmentId: "env-a", launcherId: "boat", sshHost: "hz-a" },
];

function thread(overrides: Partial<StopCandidateThread> = {}): StopCandidateThread {
  return {
    environmentId: "env-a" as StopCandidateThread["environmentId"],
    settledOverride: "settled",
    archivedAt: null,
    runtime: null,
    ...overrides,
  };
}

function toStop(input: {
  threads: ReadonlyArray<StopCandidateThread>;
  launched?: ReadonlyArray<LaunchedEnvironment>;
  busy?: ReadonlySet<string>;
}) {
  return launchedEnvironmentsToStop({
    launched: input.launched ?? launched,
    launchers,
    threads: input.threads,
    busy: input.busy ?? new Set(),
  });
}

describe("launchedEnvironmentsToStop", () => {
  it("stops a machine once every thread on it is settled or archived", () => {
    expect(
      toStop({
        threads: [thread(), thread({ settledOverride: null, archivedAt: "2026-10-12T00:00:00Z" })],
      }),
    ).toEqual(["env-a"]);
  });

  it("keeps a machine with an active thread running", () => {
    expect(toStop({ threads: [thread(), thread({ settledOverride: "active" })] })).toEqual([]);
    expect(toStop({ threads: [thread({ settledOverride: null })] })).toEqual([]);
  });

  it("keeps a machine with nothing on it, since its first thread may still be sending", () => {
    expect(toStop({ threads: [] })).toEqual([]);
  });

  it("does not stop a machine that is stopped, busy, or has no stop command", () => {
    expect(toStop({ threads: [thread()], launched: [{ ...launched[0]!, stopped: true }] })).toEqual(
      [],
    );
    expect(toStop({ threads: [thread()], busy: new Set(["env-a"]) })).toEqual([]);
    expect(
      toStop({ threads: [thread()], launched: [{ ...launched[0]!, launcherId: "plain" }] }),
    ).toEqual([]);
  });
});
