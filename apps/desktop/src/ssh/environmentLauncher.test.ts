import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as HostProcess from "@t3tools/shared/HostProcess";

import {
  parseEnvironmentLauncherOutput,
  runEnvironmentLauncherCommand,
} from "./environmentLauncher.ts";

describe("parseEnvironmentLauncherOutput", () => {
  it("reads the last non-empty line after progress output", () => {
    const output = parseEnvironmentLauncherOutput(
      [
        "creating sandbox bx_123...",
        '{"label":"hz-feat","ssh":{"host":"hz-feat","port":2222},"projectPath":"/home/user/app"}',
        "",
      ].join("\n"),
    );
    assert.deepStrictEqual(output, {
      label: "hz-feat",
      ssh: { host: "hz-feat", port: 2222 },
      projectPath: "/home/user/app",
    });
  });

  it("rejects output whose last line is not a launcher result", () => {
    assert.isNull(parseEnvironmentLauncherOutput('{"ssh":{"host":"x"}}\ndone\n'));
    assert.isNull(parseEnvironmentLauncherOutput('{"ssh":{"host":"x"}}'));
    assert.isNull(parseEnvironmentLauncherOutput(""));
  });
});

describe("runEnvironmentLauncherCommand", () => {
  it.effect("passes launcher variables and returns stdout", () =>
    Effect.gen(function* () {
      const stdout = yield* runEnvironmentLauncherCommand({
        command: 'printf "%s" "$T3CODE_PROJECT_TITLE"',
        cwd: null,
        env: { T3CODE_PROJECT_TITLE: "app" },
      });
      assert.strictEqual(stdout, "app");
    }).pipe(
      Effect.provideService(HostProcess.Platform, "linux"),
      Effect.provideService(HostProcess.Environment, { SHELL: "/bin/sh" }),
      Effect.provide(NodeServices.layer),
    ),
  );

  it.effect("fails with the stderr tail when the command exits non-zero", () =>
    Effect.gen(function* () {
      const error = yield* runEnvironmentLauncherCommand({
        command: "echo 'boat: quota exceeded' >&2; exit 3",
        cwd: null,
        env: {},
      }).pipe(Effect.flip);
      assert.include(error.message, "exited with code 3");
      assert.include(error.message, "boat: quota exceeded");
    }).pipe(
      Effect.provideService(HostProcess.Platform, "linux"),
      Effect.provideService(HostProcess.Environment, { SHELL: "/bin/sh" }),
      Effect.provide(NodeServices.layer),
    ),
  );
});
