import { type ProjectPage, ProjectPagesFile } from "@t3tools/contracts";
import { fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

const decodeProjectPagesFile = Schema.decodeExit(fromLenientJson(ProjectPagesFile));

/** The decoded pages file, with pages that are not http(s) URLs dropped; null when malformed. */
export function parseProjectPagesFile(contents: string): ProjectPagesFile | null {
  const decoded = decodeProjectPagesFile(contents);
  if (!Exit.isSuccess(decoded)) return null;
  return {
    ...decoded.value,
    pages: decoded.value.pages.filter(
      (page) => /^https?:\/\//i.test(page.url) && URL.canParse(page.url),
    ),
  };
}

export interface ProjectPageGroup {
  readonly name: string | null;
  readonly pages: ReadonlyArray<ProjectPage>;
}

/** Pages grouped by project part, in the order the file lists them. */
export function groupProjectPages(
  pages: ReadonlyArray<ProjectPage>,
): ReadonlyArray<ProjectPageGroup> {
  const groups = new Map<string | null, ProjectPage[]>();
  for (const page of pages) {
    const key = page.group ?? null;
    const group = groups.get(key);
    if (group) group.push(page);
    else groups.set(key, [page]);
  }
  return [...groups].map(([name, grouped]) => ({ name, pages: grouped }));
}

/** "localhost:13850/api/health": the part of the URL that tells pages apart. */
export function projectPageAddress(url: string): string {
  const parsed = new URL(url);
  const path = `${parsed.pathname}${parsed.search}`;
  return `${parsed.host}${path === "/" ? "" : path}`;
}
