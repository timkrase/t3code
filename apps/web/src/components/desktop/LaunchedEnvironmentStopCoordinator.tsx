import { useAtomValue } from "@effect/atom-react";
import { useEffect, useMemo } from "react";

import { useClientSettings } from "../../hooks/useSettings";
import { useThreadShells } from "../../state/entities";
import {
  launchedEnvironmentActivityAtom,
  launchedEnvironmentSendCountsAtom,
  stopLaunchedEnvironment,
} from "../../state/launchedEnvironments";
import { launchedEnvironmentsToStop } from "../../state/launchedEnvironments.logic";
import { stackedThreadToast, toastManager } from "../ui/toast";

/**
 * Desktop only. Stops a launched machine, such as a cloud sandbox, once every
 * thread on it is settled, so it stops costing money. Sending to one of its
 * threads wakes it again.
 */
export function LaunchedEnvironmentStopCoordinator() {
  const { launchedEnvironments, environmentLaunchers } = useClientSettings();
  const watched = launchedEnvironments.length > 0;
  const threads = useThreadShells(watched);
  const activity = useAtomValue(launchedEnvironmentActivityAtom);
  const sendCounts = useAtomValue(launchedEnvironmentSendCountsAtom);
  const toStop = useMemo(
    () =>
      watched
        ? launchedEnvironmentsToStop({
            launched: launchedEnvironments,
            launchers: environmentLaunchers,
            threads,
            busy: new Set([...activity.keys(), ...sendCounts.keys()]),
          })
        : [],
    [activity, environmentLaunchers, launchedEnvironments, sendCounts, threads, watched],
  );

  useEffect(() => {
    for (const environmentId of toStop) {
      stopLaunchedEnvironment(environmentId).catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not stop a settled machine",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      });
    }
  }, [toStop]);
  return null;
}
