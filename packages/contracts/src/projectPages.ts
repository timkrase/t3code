import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Workspace-relative path of the pages a checkout serves, such as a dev
 * stack's frontends and APIs. The tool that starts the stack writes it, so
 * keep it out of version control. The thread details panel lists the pages.
 */
export const PROJECT_PAGES_FILE_PATH = ".t3/pages.json";

export const ProjectPage = Schema.Struct({
  /** Shown in the list, e.g. "AI frontend". */
  name: TrimmedNonEmptyString,
  /** As reachable on the machine that serves it, e.g. http://localhost:13850. */
  url: TrimmedNonEmptyString,
  /** Part of the project it belongs to; pages are grouped by it. */
  group: Schema.optionalKey(TrimmedNonEmptyString),
});
export type ProjectPage = typeof ProjectPage.Type;

export const ProjectPagesFile = Schema.Struct({
  /** Whether the pages answer yet; omitted means they do. */
  status: Schema.optionalKey(Schema.Literals(["starting", "running", "failed"])),
  /** Shown with a starting or failed status, e.g. where the output is. */
  detail: Schema.optionalKey(Schema.String),
  pages: Schema.Array(ProjectPage),
});
export type ProjectPagesFile = typeof ProjectPagesFile.Type;
