import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, EnvironmentLauncher, LaunchedEnvironment } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { environmentCatalog } from "../connection/catalog";
import { getClientSettings, persistClientSettingsUpdate } from "../hooks/useSettings";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentSummaries } from "./presentation";
import { environmentServerConfigsAtom } from "./server";
import { waitForAtomValue } from "./waitForAtomValue";

const CONNECT_TIMEOUT_MS = 60_000;

/**
 * Why a composer cannot send right now because its machine is being started
 * or woken, e.g. "Waking boat sandbox". Keyed by draft id or thread key and
 * kept outside any view, so the sidebar and a reopened composer show it
 * while the send runs in the background.
 */
export const composerSendHoldAtom = Atom.family((_key: string) =>
  Atom.make<string | null>(null).pipe(Atom.keepAlive),
);

export type LaunchedEnvironmentActivity = "stopping" | "waking";

/** Stop and wake commands in flight, by environment. */
export const launchedEnvironmentActivityAtom = Atom.make<
  ReadonlyMap<EnvironmentId, LaunchedEnvironmentActivity>
>(new Map()).pipe(Atom.keepAlive);

/** Sends that woke a machine and have not finished, so it is not stopped under them. */
export const launchedEnvironmentSendCountsAtom = Atom.make<ReadonlyMap<EnvironmentId, number>>(
  new Map(),
).pipe(Atom.keepAlive);

export function findLaunchedEnvironment(
  environmentId: EnvironmentId,
): { launched: LaunchedEnvironment; launcher: EnvironmentLauncher | null } | null {
  const settings = getClientSettings();
  const launched = settings.launchedEnvironments.find(
    (entry) => entry.environmentId === environmentId,
  );
  if (launched === undefined) return null;
  return {
    launched,
    launcher:
      settings.environmentLaunchers.find((entry) => entry.id === launched.launcherId) ?? null,
  };
}

/** Runs a launcher's destroy, stop, or wake command for the machine it printed as `sshHost`. */
export async function runLauncherCommand(
  command: string,
  sshHost: string,
  environmentId: EnvironmentId | null,
): Promise<void> {
  const bridge = window.desktopBridge;
  if (bridge?.runEnvironmentLauncherCommand === undefined) {
    throw new Error("Launched environments need the T3 Code desktop app.");
  }
  await bridge.runEnvironmentLauncherCommand({
    command,
    cwd: null,
    env: {
      T3CODE_SSH_HOST: sshHost,
      ...(environmentId === null ? {} : { T3CODE_ENVIRONMENT_ID: environmentId }),
    },
  });
}

function setActivity(environmentId: EnvironmentId, activity: LaunchedEnvironmentActivity | null) {
  appAtomRegistry.update(launchedEnvironmentActivityAtom, (current) => {
    const next = new Map(current);
    if (activity === null) next.delete(environmentId);
    else next.set(environmentId, activity);
    return next;
  });
}

function markStopped(environmentId: EnvironmentId, stopped: boolean): Promise<void> {
  return persistClientSettingsUpdate((current) => ({
    ...current,
    launchedEnvironments: current.launchedEnvironments.map((entry) =>
      entry.environmentId !== environmentId
        ? entry
        : stopped
          ? { ...entry, stopped: true }
          : {
              environmentId: entry.environmentId,
              launcherId: entry.launcherId,
              sshHost: entry.sshHost,
            },
    ),
  })).then(() => undefined);
}

async function setEnvironmentEnabled(environmentId: EnvironmentId, enabled: boolean) {
  const result = await runAtomCommand(
    appAtomRegistry,
    environmentCatalog.setEnabled,
    { environmentId, enabled },
    { reportFailure: false },
  );
  if (result._tag === "Failure") {
    throw new Error(`Could not switch the environment ${enabled ? "on" : "off"}.`);
  }
}

// One stop or wake per environment at a time. A wake asked for while a stop
// runs waits for it, and concurrent wakes share one run.
const operations = new Map<
  EnvironmentId,
  { readonly activity: LaunchedEnvironmentActivity; readonly done: Promise<void> }
>();

function runExclusive(
  environmentId: EnvironmentId,
  activity: LaunchedEnvironmentActivity,
  run: () => Promise<void>,
): Promise<void> {
  const current = operations.get(environmentId);
  if (current?.activity === activity) return current.done;
  const done = (current?.done ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      setActivity(environmentId, activity);
      try {
        await run();
      } finally {
        setActivity(environmentId, null);
        if (operations.get(environmentId)?.done === done) operations.delete(environmentId);
      }
    });
  operations.set(environmentId, { activity, done });
  return done;
}

/**
 * Runs the launcher's stop command and marks the machine stopped. Its threads
 * stay listed so sending to one can wake it; reconnect attempts fail fast
 * meanwhile, since a launcher's ssh host refuses a stopped machine. `switchOff`
 * also switches the environment off, which hides it like any switched-off one.
 */
export function stopLaunchedEnvironment(
  environmentId: EnvironmentId,
  options: { readonly switchOff?: boolean } = {},
): Promise<void> {
  return runExclusive(environmentId, "stopping", async () => {
    const found = findLaunchedEnvironment(environmentId);
    const stopCommand = found?.launcher?.stopCommand;
    if (!found || stopCommand === undefined) return;
    if (found.launched.stopped !== true) {
      await runLauncherCommand(stopCommand, found.launched.sshHost, environmentId);
      await markStopped(environmentId, true);
    }
    if (options.switchOff === true) await setEnvironmentEnabled(environmentId, false);
  });
}

/**
 * Runs the launcher's wake command, switches the environment back on, and
 * resolves once it is connected and its server config has arrived.
 */
export function wakeLaunchedEnvironment(environmentId: EnvironmentId): Promise<void> {
  return runExclusive(environmentId, "waking", async () => {
    const found = findLaunchedEnvironment(environmentId);
    const wakeCommand = found?.launcher?.wakeCommand;
    if (!found || wakeCommand === undefined) {
      throw new Error("This environment has no wake command.");
    }
    await runLauncherCommand(wakeCommand, found.launched.sshHost, environmentId);
    await markStopped(environmentId, false);
    const entry = appAtomRegistry
      .get(environmentCatalog.catalogValueAtom)
      .entries.get(environmentId);
    if (entry?.enabled === false) {
      await setEnvironmentEnabled(environmentId, true);
    } else {
      // Still switched on but backing off after the machine went away.
      await runAtomCommand(appAtomRegistry, environmentCatalog.retryNow, environmentId, {
        reportFailure: false,
      });
    }
    const ready =
      (await waitForAtomValue({
        registry: appAtomRegistry,
        atom: environmentSummaries.connectedEnvironmentIdsAtom,
        predicate: (ids) => ids.includes(environmentId),
        timeoutMs: CONNECT_TIMEOUT_MS,
      })) &&
      (await waitForAtomValue({
        registry: appAtomRegistry,
        atom: environmentServerConfigsAtom,
        predicate: (configs) => configs.has(environmentId),
        timeoutMs: CONNECT_TIMEOUT_MS,
      }));
    if (!ready) throw new Error("The machine woke but T3 Code could not connect to it.");
  });
}

/** Keeps a woken machine from being stopped until the send that woke it ends. */
export function holdLaunchedEnvironmentAwake(environmentId: EnvironmentId): () => void {
  const adjust = (delta: number) =>
    appAtomRegistry.update(launchedEnvironmentSendCountsAtom, (current) => {
      const next = new Map(current);
      const count = (next.get(environmentId) ?? 0) + delta;
      if (count > 0) next.set(environmentId, count);
      else next.delete(environmentId);
      return next;
    });
  adjust(1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    adjust(-1);
  };
}
