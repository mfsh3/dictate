import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { lockProgress, MobileRecordControl } from "./MobileRecordControl";

afterEach(cleanup);
beforeAll(() => { if (!("PointerEvent" in window)) Object.defineProperty(window, "PointerEvent", { value: MouseEvent }); });

function props(overrides: Partial<React.ComponentProps<typeof MobileRecordControl>> = {}) {
  return {
    recording: false, disabled: false, level: 0, queueCount: 0, needsOnboarding: false,
    onPrepare: vi.fn(async () => true), onPrepared: vi.fn(), onStart: vi.fn(), onStop: vi.fn(), ...overrides
  };
}

describe("mobile recording gesture", () => {
  it("starts on hold and stops when released before the lock distance", () => {
    const input = props(); render(<MobileRecordControl {...input} />);
    const button = screen.getByRole("button", { name: "Für Aufnahme gedrückt halten" });
    fireEvent.pointerDown(button, { pointerId: 1, clientY: 200 }); fireEvent.pointerUp(button, { pointerId: 1, clientY: 180 });
    expect(input.onStart).toHaveBeenCalledOnce(); expect(input.onStop).toHaveBeenCalledOnce();
  });

  it("keeps recording after sliding up far enough", () => {
    const input = props(); render(<MobileRecordControl {...input} />);
    const button = screen.getByRole("button", { name: "Für Aufnahme gedrückt halten" });
    fireEvent.pointerDown(button, { pointerId: 2, clientY: 220 }); fireEvent.pointerMove(button, { pointerId: 2, clientY: 140 }); fireEvent.pointerUp(button, { pointerId: 2, clientY: 140 });
    expect(input.onStart).toHaveBeenCalledOnce(); expect(input.onStop).not.toHaveBeenCalled(); expect(screen.getByText("Verriegelt")).toBeTruthy();
  });

  it("stops an already locked or externally started recording on tap", () => {
    const input = props({ recording: true }); render(<MobileRecordControl {...input} />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Aufnahme läuft" }), { pointerId: 3, clientY: 200 });
    expect(input.onStop).toHaveBeenCalledOnce();
  });

  it("clamps lock progress", () => {
    expect(lockProgress(200, 210)).toBe(0); expect(lockProgress(200, 164)).toBe(.5); expect(lockProgress(200, 100)).toBe(1);
  });
});

describe("mobile microphone onboarding", () => {
  it("prepares the microphone before dismissing the one-time explanation", async () => {
    const input = props({ needsOnboarding: true }); render(<MobileRecordControl {...input} />);
    fireEvent.click(screen.getByRole("button", { name: "Mikrofon aktivieren" }));
    await waitFor(() => expect(input.onPrepare).toHaveBeenCalledOnce());
    expect(input.onPrepared).toHaveBeenCalledOnce();
  });
});
