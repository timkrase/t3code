import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  threadRuntimeIsActive,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  EnvironmentLauncher,
  LaunchedEnvironment,
  ScopedProjectRef,
} from "@t3tools/contracts";

import {
  deriveLogicalProjectKeyFromSettings,
  type ProjectGroupingSettings,
} from "../logicalProject";
import type { Project } from "../types";

export type StopCandidateThread = Pick<
  EnvironmentThreadShell,
  "environmentId" | "settledOverride" | "archivedAt" | "runtime"
>;

/**
 * Launched environments to stop: their launcher has a stop command, they are
 * not stopped or busy with a stop, wake, or send, and every thread on them is
 * settled or archived with nothing running.
 */
export function launchedEnvironmentsToStop(input: {
  readonly launched: ReadonlyArray<LaunchedEnvironment>;
  readonly launchers: ReadonlyArray<EnvironmentLauncher>;
  readonly threads: ReadonlyArray<StopCandidateThread>;
  readonly busy: ReadonlySet<string>;
}): ReadonlyArray<EnvironmentId> {
  const threadsByEnvironment = new Map<string, StopCandidateThread[]>();
  for (const thread of input.threads) {
    const list = threadsByEnvironment.get(thread.environmentId);
    if (list) list.push(thread);
    else threadsByEnvironment.set(thread.environmentId, [thread]);
  }
  return input.launched
    .filter((entry) => {
      if (entry.stopped === true || input.busy.has(entry.environmentId)) return false;
      const launcher = input.launchers.find((candidate) => candidate.id === entry.launcherId);
      if (launcher?.stopCommand === undefined) return false;
      const threads = threadsByEnvironment.get(entry.environmentId) ?? [];
      return (
        threads.length > 0 &&
        threads.every(
          (thread) =>
            (thread.settledOverride === "settled" || thread.archivedAt !== null) &&
            !threadRuntimeIsActive(thread.runtime),
        )
      );
    })
    .map((entry) => entry.environmentId as EnvironmentId);
}

/**
 * The project a new thread in `projectRef`'s project starts in. A launched
 * machine belongs to the thread it was started for, so a new thread from one
 * of its projects starts in the same repository's project on the primary
 * environment, when there is one. "Run on" launches another machine.
 */
export function resolveNewThreadProjectRef(input: {
  readonly projectRef: ScopedProjectRef;
  readonly projects: ReadonlyArray<Project>;
  readonly launched: ReadonlyArray<LaunchedEnvironment>;
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly groupingSettings: ProjectGroupingSettings;
}): ScopedProjectRef {
  const { projectRef, primaryEnvironmentId } = input;
  if (
    primaryEnvironmentId === null ||
    !input.launched.some((entry) => entry.environmentId === projectRef.environmentId)
  ) {
    return projectRef;
  }
  const source = input.projects.find(
    (project) =>
      project.environmentId === projectRef.environmentId && project.id === projectRef.projectId,
  );
  if (source === undefined) return projectRef;
  const key = deriveLogicalProjectKeyFromSettings(source, input.groupingSettings);
  const local = input.projects.find(
    (project) =>
      project.environmentId === primaryEnvironmentId &&
      deriveLogicalProjectKeyFromSettings(project, input.groupingSettings) === key,
  );
  return local === undefined ? projectRef : scopeProjectRef(local.environmentId, local.id);
}
