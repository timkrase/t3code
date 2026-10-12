import { describe, expect, it } from "vite-plus/test";

import {
  groupProjectPages,
  parseProjectPagesFile,
  projectPageAddress,
} from "./ThreadDetailsPages.logic";

describe("parseProjectPagesFile", () => {
  it("keeps http pages and drops other URLs", () => {
    const file = parseProjectPagesFile(
      JSON.stringify({
        status: "running",
        pages: [
          { name: "AI frontend", url: "http://localhost:13850", group: "ai" },
          { name: "Postgres", url: "postgres://localhost:16246", group: "data" },
        ],
      }),
    );
    expect(file?.status).toBe("running");
    expect(file?.pages.map((page) => page.name)).toEqual(["AI frontend"]);
  });

  it("treats a malformed file as absent", () => {
    expect(parseProjectPagesFile("{ pages: ")).toBeNull();
    expect(parseProjectPagesFile(JSON.stringify({ pages: [{ url: "http://x" }] }))).toBeNull();
  });
});

describe("groupProjectPages", () => {
  it("groups by project part in file order", () => {
    const groups = groupProjectPages([
      { name: "AI frontend", url: "http://localhost:1", group: "ai" },
      { name: "Symfony API", url: "http://localhost:2", group: "api" },
      { name: "AI backend", url: "http://localhost:3", group: "ai" },
      { name: "Docs", url: "http://localhost:4" },
    ]);
    expect(groups.map((group) => [group.name, group.pages.map((page) => page.name)])).toEqual([
      ["ai", ["AI frontend", "AI backend"]],
      ["api", ["Symfony API"]],
      [null, ["Docs"]],
    ]);
  });
});

describe("projectPageAddress", () => {
  it("shows host and path, without a bare slash", () => {
    expect(projectPageAddress("http://localhost:13850/")).toBe("localhost:13850");
    expect(projectPageAddress("http://localhost:18302/api/health")).toBe(
      "localhost:18302/api/health",
    );
  });
});
