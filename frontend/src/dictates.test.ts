import { describe, expect, it } from "vitest";
import { clampFontSize, orderDictates } from "./dictates";
import { isPipControl } from "./PipControls";
import type { Dictate } from "./types";

function dictate(id: string, createdAt: string, text = id): Dictate {
  return { id, title: id, text, createdAt, updatedAt: createdAt };
}

describe("dictate navigation", () => {
  it("orders old to new and replaces the current history snapshot", () => {
    const ordered = orderDictates([dictate("new", "2026-08-21T00:00:00.000Z"), dictate("old", "2026-08-19T00:00:00.000Z")], dictate("new", "2026-08-21T00:00:00.000Z", "edited"));
    expect(ordered.map((item) => item.id)).toEqual(["old", "new"]);
    expect(ordered[1]?.text).toBe("edited");
  });

  it("keeps a blank current draft as the latest item", () => {
    const ordered = orderDictates([dictate("old", "2026-08-19T00:00:00.000Z")], dictate("draft", "2026-08-21T00:00:00.000Z", ""));
    expect(ordered.map((item) => item.id)).toEqual(["old", "draft"]);
  });
});

describe("editor controls", () => {
  it("clamps the persisted font size", () => {
    expect(clampFontSize(11)).toBe(13); expect(clampFontSize(27)).toBe(25); expect(clampFontSize(19)).toBe(19);
  });

  it("treats PiP text fields and buttons as controls", () => {
    expect(isPipControl(document.createElement("textarea"))).toBe(true);
    expect(isPipControl(document.createElement("button"))).toBe(true);
    expect(isPipControl(document.createElement("div"))).toBe(false);
  });
});
