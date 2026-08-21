import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { Dashboard } from "./Dashboard";
import type { DashboardData } from "./types";

vi.mock("./api", () => ({ api: { dashboard: vi.fn() } }));

function data(days: 7 | 30 | 365): DashboardData {
  return {
    days, bucket: days === 365 ? "month" : "day", costTrackingSince: "2026-08-21T00:00:00.000Z",
    summary: { dictates: 3, audioSeconds: 120, audioCost: .009, lunaCost: .001, totalCost: .01 },
    points: [{ period: days === 365 ? "2026-08" : "2026-08-21", dictates: 3, audioSeconds: 120, audioCost: .009, lunaCost: .001, totalCost: .01 }]
  };
}

afterEach(() => vi.clearAllMocks());

describe("Dashboard", () => {
  it("loads the default range and switches to seven days", async () => {
    vi.mocked(api.dashboard).mockImplementation(async (days) => data(days));
    render(<Dashboard />);
    expect(await screen.findByText("Gespeicherte Diktate")).toBeTruthy();
    expect(api.dashboard).toHaveBeenCalledWith(30);
    fireEvent.click(screen.getByRole("button", { name: "7 Tage" }));
    await waitFor(() => expect(api.dashboard).toHaveBeenCalledWith(7));
  });
});
