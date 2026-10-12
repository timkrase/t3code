import {
  threadRuntimeIsActive,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, EnvironmentLauncher, LaunchedEnvironment } from "@t3tools/contracts";

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
