import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRealtimeRefreshScheduler } from "./realtime-refresh";

describe("realtime refresh scheduler", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("coalesces bursts from SSE reconnects and online recovery", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const scheduler = createRealtimeRefreshScheduler(refresh, 200);

    scheduler.schedule();
    scheduler.schedule();
    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(199);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(1);

    scheduler.dispose();
    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(300);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
