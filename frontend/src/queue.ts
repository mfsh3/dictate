import type { Segment } from "./types";

export function nextProcessable(queue: Segment[]) {
  return queue.find((item) => item.status !== "done");
}

export function appendTranscript(current: string, addition: string) {
  if (!current) return addition;
  return `${current}${/\s$/.test(current) ? "" : " "}${addition}`;
}
