export function createRealtimeRefreshScheduler(refresh: () => void | Promise<unknown>, delayMs = 250) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  return {
    schedule() {
      if (disposed || timer) return;
      timer = setTimeout(() => {
        timer = null;
        if (!disposed) void refresh();
      }, delayMs);
    },
    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
