import {
  EnvironmentLauncherOutputSchema,
  type DesktopEnvironmentLauncherRunInput,
  type EnvironmentLauncherOutput,
} from "@t3tools/contracts";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as NodeOS from "node:os";

// Creating a sandbox can include pulling images and booting a stack.
const LAUNCHER_TIMEOUT = Duration.minutes(20);
const STDERR_TAIL_LINES = 20;

export class EnvironmentLauncherError extends Data.TaggedError("EnvironmentLauncherError")<{
  readonly message: string;
}> {}

const decodeOutput = Schema.decodeUnknownOption(
  Schema.fromJsonString(EnvironmentLauncherOutputSchema),
);

/**
 * Reads the launcher's result from its last non-empty stdout line, so the
 * command may log progress on stdout before it.
 */
export function parseEnvironmentLauncherOutput(stdout: string): EnvironmentLauncherOutput | null {
  const lastLine = stdout
    .split("\n")
    .map((line) => line.trim())
    .findLast((line) => line.length > 0);
  return lastLine === undefined ? null : Option.getOrNull(decodeOutput(lastLine));
}

function tail(text: string): string {
  return text.trim().split("\n").slice(-STDERR_TAIL_LINES).join("\n");
}

/**
 * Runs a launcher command through the user's login shell, so tools installed
 * by shell profiles (cloud CLIs, version managers) are on PATH.
 */
export const runEnvironmentLauncherCommand = Effect.fn("desktop.environmentLauncher.run")(
  function* (input: DesktopEnvironmentLauncherRunInput) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const platform = yield* HostProcess.Platform;
    const hostEnv = yield* HostProcess.Environment;
    const [file, args] =
      platform === "win32"
        ? ["cmd.exe", ["/d", "/s", "/c", input.command]]
        : [hostEnv.SHELL || "/bin/sh", ["-l", "-c", input.command]];
    const command = ChildProcess.make(file, args, {
      cwd: input.cwd ?? NodeOS.homedir(),
      env: input.env,
      extendEnv: true,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      killSignal: "SIGTERM",
      forceKillAfter: Duration.seconds(5),
    });

    const result = yield* Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* spawner.spawn(command);
        const [stdout, stderr, exitCode] = yield* Effect.all(
          [
            Stream.mkString(Stream.decodeText(handle.stdout)),
            Stream.mkString(Stream.decodeText(handle.stderr)),
            handle.exitCode,
          ],
          { concurrency: "unbounded" },
        );
        return { stdout, stderr, exitCode: Number(exitCode) };
      }),
    ).pipe(
      Effect.timeoutOption(LAUNCHER_TIMEOUT),
      Effect.mapError(
        (cause) =>
          new EnvironmentLauncherError({ message: `Could not run the command: ${cause.message}` }),
      ),
    );
    if (Option.isNone(result)) {
      return yield* new EnvironmentLauncherError({
        message: `The command did not finish within ${Duration.format(LAUNCHER_TIMEOUT)}.`,
      });
    }
    const { stdout, stderr, exitCode } = result.value;
    if (exitCode !== 0) {
      const detail = tail(stderr) || tail(stdout);
      return yield* new EnvironmentLauncherError({
        message: `The command exited with code ${exitCode}.${detail ? `\n${detail}` : ""}`,
      });
    }
    return stdout;
  },
);
