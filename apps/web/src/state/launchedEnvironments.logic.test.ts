import {
  EnvironmentId,
  ProjectId,
  type EnvironmentLauncher,
  type LaunchedEnvironment,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { Project } from "../types";
import {
  launchedEnvironmentsToStop,
  resolveNewThreadProjectRef,
  type StopCandidateThread,
} from "./launchedEnvironments.logic";

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

describe("resolveNewThreadProjectRef", () => {
  const primary = EnvironmentId.make("env-primary");
  const sandbox = EnvironmentId.make("env-a");
  const otherRemote = EnvironmentId.make("env-other");
  const repositoryIdentity = {
    canonicalKey: "github.com/example/app",
    locator: {
      source: "git-remote" as const,
      remoteName: "origin",
      remoteUrl: "https://github.com/example/app.git",
    },
  };
  const groupingSettings = {
    sidebarProjectGroupingMode: "repository" as const,
    sidebarProjectGroupingOverrides: {},
  };
  function project(environmentId: EnvironmentId, overrides: Partial<Project> = {}): Project {
    return {
      id: ProjectId.make(`project-${environmentId}`),
      environmentId,
      title: "app",
      workspaceRoot: `/${environmentId}/app`,
      repositoryIdentity,
      defaultModelSelection: null,
      createdAt: "2026-10-12T00:00:00.000Z",
      updatedAt: "2026-10-12T00:00:00.000Z",
      scripts: [],
      ...overrides,
    };
  }
  const local = project(primary);
  const ref = (target: Project) => ({ environmentId: target.environmentId, projectId: target.id });
  function resolve(target: Project, projects: ReadonlyArray<Project>) {
    return resolveNewThreadProjectRef({
      projectRef: ref(target),
      projects,
      launched,
      primaryEnvironmentId: primary,
      groupingSettings,
    });
  }

  it("starts a new thread from a launched machine's project in the same repository here", () => {
    const onSandbox = project(sandbox);
    expect(resolve(onSandbox, [local, onSandbox])).toEqual(ref(local));
  });

  it("stays on the launched machine when this machine has no checkout of the repository", () => {
    const onSandbox = project(sandbox, { repositoryIdentity: null });
    expect(resolve(onSandbox, [local, onSandbox])).toEqual(ref(onSandbox));
  });

  it("keeps projects on machines that were not launched", () => {
    const onRemote = project(otherRemote);
    expect(resolve(onRemote, [local, onRemote])).toEqual(ref(onRemote));
  });
});
