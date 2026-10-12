import { type EnvironmentId, PROJECT_PAGES_FILE_PATH, type ThreadId } from "@t3tools/contracts";
import { ExternalLinkIcon, GlobeIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useOpenLink } from "~/browser/useOpenLink";
import { readLocalApi } from "~/localApi";
import { cn } from "~/lib/utils";
import { useProjectFileQuery } from "../files/projectFilesQueryState";
import { CollapsibleSectionHeader, SectionHeaderStatus } from "../ui/collapsible-section-header";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import {
  groupProjectPages,
  parseProjectPagesFile,
  projectPageAddress,
} from "./ThreadDetailsPages.logic";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LABEL_CLASS,
  THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS,
} from "./threadDetailsPanelStyles";

// The stack that writes the file may still be starting; re-read it while the
// panel is open.
const PAGES_REFRESH_MS = 15_000;

/**
 * The pages the thread's checkout serves, read from its `.t3/pages.json`.
 * Renders nothing when the checkout has no such file.
 */
export function ThreadDetailsPages(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly cwd: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const query = useProjectFileQuery(props.environmentId, props.cwd, PROJECT_PAGES_FILE_PATH);
  const { refresh } = query;
  useEffect(() => {
    const interval = setInterval(refresh, PAGES_REFRESH_MS);
    return () => clearInterval(interval);
  }, [refresh]);
  const contents = query.data && !query.data.truncated ? query.data.contents : null;
  const file = useMemo(
    () => (contents === null ? null : parseProjectPagesFile(contents)),
    [contents],
  );
  const openLink = useOpenLink({ environmentId: props.environmentId, threadId: props.threadId });

  if (file === null || (file.pages.length === 0 && file.status === undefined)) return null;
  const groups = groupProjectPages(file.pages);
  const status =
    file.status === "starting" ? "Starting" : file.status === "failed" ? "Failed" : null;

  return (
    <div>
      <CollapsibleSectionHeader
        variant="panel"
        expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        accessory={status ? <SectionHeaderStatus>{status}</SectionHeaderStatus> : null}
      >
        Pages
        {!expanded && file.pages.length > 0 && ` (${file.pages.length})`}
      </CollapsibleSectionHeader>
      {expanded ? (
        <div className="flex flex-col">
          {status && file.detail ? (
            <p className="px-2.5 py-1 text-xs text-muted-foreground">{file.detail}</p>
          ) : null}
          {groups.map((group) => (
            <div key={group.name ?? ""} className="flex flex-col">
              {group.name && groups.length > 1 ? (
                <p className="px-2.5 pt-1.5 pb-0.5 text-2xs font-medium text-muted-foreground uppercase">
                  {group.name}
                </p>
              ) : null}
              {group.pages.map((page) => (
                <div key={page.url} className={THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS}>
                  <ThreadDetailsControl
                    type="button"
                    variant="ghost"
                    size="sm"
                    part="primary"
                    onClick={(event) => void openLink(page.url, { event })}
                  >
                    <GlobeIcon className={THREAD_DETAILS_PANEL_ICON_CLASS} aria-hidden />
                    <span
                      className={cn("flex-1 truncate text-left", THREAD_DETAILS_PANEL_LABEL_CLASS)}
                    >
                      {page.name}
                    </span>
                    <span className="truncate font-mono text-2xs text-muted-foreground">
                      {projectPageAddress(page.url)}
                    </span>
                  </ThreadDetailsControl>
                  <ThreadDetailsControl
                    type="button"
                    variant="ghost"
                    size="sm"
                    part="secondary"
                    aria-label={`Open ${page.name} in the system browser`}
                    title="Open in the system browser"
                    onClick={() => void readLocalApi()?.shell.openExternal(page.url)}
                  >
                    <ExternalLinkIcon className={THREAD_DETAILS_PANEL_ICON_CLASS} aria-hidden />
                  </ThreadDetailsControl>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
