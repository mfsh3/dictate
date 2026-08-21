import { describe, expect, it } from "vitest";
import { appendTranscript, nextProcessable } from "./queue";
import type { Segment } from "./types";

function segment(sequence: number, status: Segment["status"]): Segment {
  return { id: String(sequence), sequence, dictateId: "dictate", status, blob: new Blob(["x"], { type: "audio/webm" }), mime: "audio/webm", profile: "de-general", durationMs: 1000 };
}

describe("ordered audio queue", () => {
  it("never skips an earlier failed segment", () => {
    expect(nextProcessable([segment(0, "done"), segment(1, "failed"), segment(2, "queued")])?.sequence).toBe(1);
  });
  it("appends rollover transcripts without joining words", () => {
    expect(appendTranscript("Erster Teil", "zweiter Teil.")).toBe("Erster Teil zweiter Teil.");
    expect(appendTranscript("Erster Teil\n", "Zweiter Teil.")).toBe("Erster Teil\nZweiter Teil.");
  });
});
