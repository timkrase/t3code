import { RemoteEnvironmentAuthTimeoutError } from "@t3tools/client-runtime/rpc";
import { AuthOrchestrationOperateScope, type AuthSessionState } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { sessionHasScope } from "./sessionScope";

const session: AuthSessionState = {
  authenticated: true,
  auth: {
    policy: "desktop-managed-local",
    bootstrapMethods: ["desktop-bootstrap"],
    sessionMethods: ["browser-session-cookie"],
    sessionCookieName: "t3_session",
  },
  permissions: [AuthOrchestrationOperateScope],
};
const granted = AsyncResult.success(session);

const failedRefresh = (error: unknown) =>
  AsyncResult.failure(Cause.fail(error), { previousSuccess: Option.some(granted) });

describe("sessionHasScope", () => {
  it("keeps the last grant when a refresh only timed out", () => {
    const timedOut = failedRefresh(
      new RemoteEnvironmentAuthTimeoutError("http://host/api/auth/session", 6_000),
    );
    expect(sessionHasScope(timedOut, AuthOrchestrationOperateScope)).toBe(true);
  });

  it("denies when a refresh failed for any other reason", () => {
    const rejected = failedRefresh(new Error("credential revoked"));
    expect(sessionHasScope(rejected, AuthOrchestrationOperateScope)).toBe(false);
  });

  it("follows the current grant otherwise", () => {
    expect(sessionHasScope(granted, AuthOrchestrationOperateScope)).toBe(true);
    expect(sessionHasScope(AsyncResult.initial(), AuthOrchestrationOperateScope)).toBe(false);
  });
});
