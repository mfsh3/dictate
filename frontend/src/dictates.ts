import type { Dictate } from "./types";

export function orderDictates(history: Dictate[], current: Dictate) {
  return [...history.filter((item) => item.id !== current.id), current]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export function clampFontSize(value: number, min = 13, max = 25) {
  return Math.max(min, Math.min(max, value));
}
