import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRecorder } from "./useRecorder";

const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");

afterEach(() => {
  vi.restoreAllMocks();
  if (originalMediaDevices) Object.defineProperty(navigator, "mediaDevices", originalMediaDevices);
  else Reflect.deleteProperty(navigator, "mediaDevices");
});

function useMockMediaDevices(getUserMedia: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia }
  });
}

describe("microphone preparation", () => {
  it("requests access once, closes the probe stream and marks the microphone ready", async () => {
    const stop = vi.fn();
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop }] } as unknown as MediaStream));
    useMockMediaDevices(getUserMedia);
    const onError = vi.fn();
    const { result } = renderHook(() => useRecorder(vi.fn(), onError, false));

    let ready = false;
    await act(async () => { ready = await result.current.prepare(); });

    expect(ready).toBe(true);
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    expect(stop).toHaveBeenCalledOnce();
    expect(result.current.microphoneState).toBe("ready");
    expect(onError).not.toHaveBeenCalled();
  });

  it("keeps onboarding open and reports a denied permission", async () => {
    useMockMediaDevices(vi.fn(async () => { throw new DOMException("Permission denied", "NotAllowedError"); }));
    const onError = vi.fn();
    const { result } = renderHook(() => useRecorder(vi.fn(), onError, false));

    let ready = true;
    await act(async () => { ready = await result.current.prepare(); });

    expect(ready).toBe(false);
    expect(result.current.microphoneState).toBe("error");
    expect(onError).toHaveBeenCalledWith("Permission denied");
  });
});
