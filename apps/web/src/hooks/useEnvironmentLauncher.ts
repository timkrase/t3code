import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, EnvironmentLauncher, ScopedProjectRef } from "@t3tools/contracts";
import { useCallback } from "react";

import { environmentCatalog } from "../connection/catalog";
import { connectSshEnvironment as connectSshEnvironmentAtom } from "../connection/onboarding";
import { findProjectByPath } from "../lib/projectPaths";
import { newProjectId } from "../lib/utils";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { readProjects, waitForProject } from "../state/entities";
import { usePrimaryEnvironmentId } from "../state/environments";
import { findLaunchedEnvironment, runLauncherCommand } from "../state/launchedEnvironments";
import { environmentSummaries } from "../state/presentation";
import { projectEnvironment } from "../state/projects";
import { environmentServerConfigsAtom } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { waitForAtomValue } from "../state/waitForAtomValue";
import { persistClientSettingsUpdate } from "./useSettings";

const CONNECT_TIMEOUT_MS = 60_000;
const PROJECT_TIMEOUT_MS = 30_000;

function failureMessage(result: Parameters<typeof squashAtomCommandFailure>[0], fallback: string) {
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : fallback;
}

/** The variables a launcher command sees, so one script can serve many projects. */
function launcherEnv(
  project: Pick<EnvironmentProject, "title" | "workspaceRoot">,
  extra: Record<string, string> = {},
) {
  return {
    T3CODE_PROJECT_TITLE: project.title,
    T3CODE_PROJECT_ROOT: project.workspaceRoot,
    ...extra,
  };
}

async function forgetLaunchedEnvironment(environmentId: EnvironmentId): Promise<void> {
  await persistClientSettingsUpdate((current) => ({
    ...current,
    launchedEnvironments: current.launchedEnvironments.filter(
      (entry) => entry.environmentId !== environmentId,
    ),
  }));
}

/**
 * Creates a machine with a launcher, connects to it over SSH, and adds the
 * launcher's checkout as a project there. Resolves to that project once the
 * environment's server config has arrived. When a step after creating the
 * machine fails, the machine is destroyed and its environment removed before
 * the error is rethrown.
 */
export function useLaunchEnvironment() {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const connectSsh = useAtomCommand(connectSshEnvironmentAtom, { reportFailure: false });
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const removeEnvironment = useAtomCommand(environmentCatalog.remove, { reportFailure: false });

  return useCallback(
    async (
      launcher: EnvironmentLauncher,
      source: EnvironmentProject,
    ): Promise<ScopedProjectRef> => {
      const bridge = window.desktopBridge;
      if (bridge?.launchEnvironment === undefined) {
        throw new Error("Launching environments needs the T3 Code desktop app.");
      }
      const launched = await bridge.launchEnvironment({
        command: launcher.command,
        // Run from the local checkout when there is one, so repo scripts resolve.
        cwd: source.environmentId === primaryEnvironmentId ? source.workspaceRoot : null,
        env: launcherEnv(source),
      });

      // Set once an SSH environment is saved, so a failure can remove it again.
      let savedEnvironmentId: EnvironmentId | null = null;
      try {
        const connected = await connectSsh({
          target: launched.target,
          label: launched.label ?? launched.target.alias,
        });
        if (connected._tag === "Failure") {
          throw new Error(
            isAtomCommandInterrupted(connected)
              ? "Connecting to the new environment was cancelled."
              : failureMessage(connected, "Could not connect to the new environment."),
          );
        }
        const environmentId = connected.value;
        savedEnvironmentId = environmentId;
        await persistClientSettingsUpdate((current) => ({
          ...current,
          launchedEnvironments: [
            ...current.launchedEnvironments.filter(
              (entry) => entry.environmentId !== environmentId,
            ),
            { environmentId, launcherId: launcher.id, sshHost: launched.target.alias },
          ],
        }));

        const isConnected = await waitForAtomValue({
          registry: appAtomRegistry,
          atom: environmentSummaries.connectedEnvironmentIdsAtom,
          predicate: (ids) => ids.includes(environmentId),
          timeoutMs: CONNECT_TIMEOUT_MS,
        });
        // Sending validates the model against the new machine's providers.
        const hasServerConfig =
          isConnected &&
          (await waitForAtomValue({
            registry: appAtomRegistry,
            atom: environmentServerConfigsAtom,
            predicate: (configs) => configs.has(environmentId),
            timeoutMs: CONNECT_TIMEOUT_MS,
          }));
        if (!hasServerConfig) {
          throw new Error("The new environment did not finish connecting.");
        }

        const existing = findProjectByPath(
          readProjects().filter((project) => project.environmentId === environmentId),
          launched.projectPath,
        );
        if (existing) return scopeProjectRef(environmentId, existing.id);

        const projectId = newProjectId();
        const created = await createProject({
          environmentId,
          input: {
            projectId,
            title: source.title,
            workspaceRoot: launched.projectPath,
            createWorkspaceRootIfMissing: false,
            defaultModelSelection: null,
          },
        });
        if (created._tag === "Failure") {
          throw new Error(
            failureMessage(created, "Could not add the project to the new environment."),
          );
        }
        const projectRef = scopeProjectRef(environmentId, projectId);
        await waitForProject(projectRef, PROJECT_TIMEOUT_MS);
        return projectRef;
      } catch (error) {
        // The machine exists but is unusable here, so do not leave it running.
        const destroyCommand = launcher.destroyCommand;
        const destroyError = await (destroyCommand === undefined
          ? Promise.resolve()
          : runLauncherCommand(destroyCommand, launched.target.alias, savedEnvironmentId)
        ).then(
          () => null,
          (cause: unknown) => (cause instanceof Error ? cause.message : "An error occurred."),
        );
        if (savedEnvironmentId !== null) {
          await removeEnvironment(savedEnvironmentId);
          await forgetLaunchedEnvironment(savedEnvironmentId);
        }
        if (destroyError === null) throw error;
        const message = error instanceof Error ? error.message : "Could not start the machine.";
        throw new Error(`${message} Destroying the machine also failed: ${destroyError}`, {
          cause: error,
        });
      }
    },
    [connectSsh, createProject, primaryEnvironmentId, removeEnvironment],
  );
}

/** Runs the launcher's destroy command for an environment it created, then forgets it. */
export async function destroyLaunchedEnvironment(environmentId: EnvironmentId): Promise<void> {
  const found = findLaunchedEnvironment(environmentId);
  if (found === null) return;
  const destroyCommand = found.launcher?.destroyCommand;
  if (destroyCommand !== undefined) {
    await runLauncherCommand(destroyCommand, found.launched.sshHost, environmentId);
  }
  await forgetLaunchedEnvironment(environmentId);
}
