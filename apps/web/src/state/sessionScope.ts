import { RemoteEnvironmentAuthTimeoutError } from "@t3tools/client-runtime/rpc";
import {
  type AuthEnvironmentScope,
  type AuthSessionState,
  sessionGrantsScope,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";

/**
 * A refresh that failed denies, since the credential may be revoked. One that
 * only timed out keeps the last grant: a host that pauses for a few seconds,
 * such as a cloud sandbox taking a snapshot, has not taken anything away, and
 * the server still checks every command.
 */
export function sessionHasScope(
  result: AsyncResult.AsyncResult<AuthSessionState, unknown>,
  scope: AuthEnvironmentScope,
): boolean {
  const session = Option.getOrNull(AsyncResult.value(result));
  if (session === null || !sessionGrantsScope(session, scope)) return false;
  if (result._tag !== "Failure") return true;
  const error = Cause.squash(result.cause);
  return error instanceof RemoteEnvironmentAuthTimeoutError;
}
