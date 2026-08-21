import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("PWA shell", () => {
  it("uses the secure same-origin app entrypoint", () => {
    const manifest = JSON.parse(readFileSync(resolve("public/manifest.webmanifest"), "utf8"));
    expect(manifest).toMatchObject({ start_url: "/", scope: "/", display: "standalone" });
    expect(manifest.icons).toHaveLength(2);
  });

  it("never handles API calls or non-GET requests in the cache", () => {
    const worker = readFileSync(resolve("public/sw.js"), "utf8");
    expect(worker).toContain('request.method !== "GET"');
    expect(worker).toContain('url.pathname.startsWith("/api/")');
    expect(worker.match(/SHELL\s*=\s*\[([^\]]+)/)?.[1]).not.toContain("/api/");
  });

  it("serves the manifest with an installable MIME type", () => {
    const nginx = readFileSync(resolve("nginx.conf"), "utf8");
    expect(nginx).toContain("location = /manifest.webmanifest");
    expect(nginx).toContain("default_type application/manifest+json");
  });
});
