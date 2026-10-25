import { describe, expect, it, vi } from "vitest";
import { createTrafficMonitor } from "../../../shared/security-traffic";

describe("security traffic classification", () => {
  it("keeps a routine 265-path scan quiet, including recovery", async () => {
    let now = 0;
    const send = vi.fn(async () => true);
    const monitor = createTrafficMonitor({ source: "web", send, now: () => now });
    for (let i = 0; i < 265; i++) monitor.observe(404);
    for (let i = 0; i < 5; i++) monitor.observe(200);
    await monitor.drain();
    now = 180_000; monitor.tick(); await monitor.drain();
    expect(send).not.toHaveBeenCalled();
  });

  it.each([429, 500, 503])("still alerts at 100 responses with status %i", async (status) => {
    const send = vi.fn(async () => true);
    const monitor = createTrafficMonitor({ source: "web", send });
    for (let i = 0; i < 99; i++) monitor.observe(status);
    await monitor.drain(); expect(send).not.toHaveBeenCalled();
    monitor.observe(status); await monitor.drain();
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toMatchObject({ rejected: 100, notFound: 0, rateLimited: status === 429 ? 100 : 0, serverErrors: status >= 500 ? 100 : 0 });
  });

  it("alerts at 500 missing paths, with separate counters", async () => {
    const send = vi.fn(async () => true);
    const monitor = createTrafficMonitor({ source: "web", send });
    for (let i = 0; i < 499; i++) monitor.observe(404);
    await monitor.drain(); expect(send).not.toHaveBeenCalled();
    monitor.observe(404); await monitor.drain();
    expect(send.mock.calls[0]?.[0]).toMatchObject({ requests: 500, rejected: 500, notFound: 500, rateLimited: 0, serverErrors: 0 });
  });

  it("does not mix scan noise into, or hide, the actionable rejection budget", async () => {
    const send = vi.fn(async () => true);
    const monitor = createTrafficMonitor({ source: "backend", send });
    for (let i = 0; i < 265; i++) monitor.observe(404);
    for (let i = 0; i < 50; i++) monitor.observe(429);
    for (let i = 0; i < 49; i++) monitor.observe(503);
    await monitor.drain(); expect(send).not.toHaveBeenCalled();
    monitor.observe(503); await monitor.drain();
    expect(send.mock.calls[0]?.[0]).toMatchObject({ requests: 365, rejected: 365, notFound: 265, rateLimited: 50, serverErrors: 50 });
  });

  it("preserves the auth combined rejection threshold and volume threshold", async () => {
    const send = vi.fn(async () => true);
    const monitor = createTrafficMonitor({ source: "backend", send, threshold: 20, rejectionThreshold: 10, includeNotFoundInRejections: true });
    for (let i = 0; i < 5; i++) monitor.observe(404);
    for (let i = 0; i < 5; i++) monitor.observe(429);
    await monitor.drain();
    expect(send.mock.calls[0]?.[0]).toMatchObject({ requests: 10, rejected: 10 });
    const volumeSend = vi.fn(async () => true);
    const volume = createTrafficMonitor({ source: "backend", send: volumeSend, threshold: 20, rejectionThreshold: 10, includeNotFoundInRejections: true });
    for (let i = 0; i < 20; i++) volume.observe(200);
    await volume.drain(); expect(volumeSend).toHaveBeenCalledOnce();
  });

  it("preserves the 600 total request threshold", async () => {
    const send = vi.fn(async () => true);
    const monitor = createTrafficMonitor({ source: "backend", send });
    for (let i = 0; i < 599; i++) monitor.observe(200);
    await monitor.drain(); expect(send).not.toHaveBeenCalled();
    monitor.observe(200); await monitor.drain(); expect(send).toHaveBeenCalledOnce();
  });

  it("resets counters per window and sends an accurate quiet recovery", async () => {
    let now = 0;
    const send = vi.fn(async () => true);
    const monitor = createTrafficMonitor({ source: "backend", send, now: () => now });
    for (let i = 0; i < 499; i++) monitor.observe(404);
    now = 60_000; monitor.observe(404); await monitor.drain();
    expect(send).not.toHaveBeenCalled();
    for (let i = 0; i < 100; i++) monitor.observe(503);
    await monitor.drain();
    expect(send.mock.calls[0]?.[0]).toMatchObject({ notFound: 1, serverErrors: 100 });
    now = 180_000; monitor.tick(); await monitor.drain();
    expect(send.mock.calls[1]?.[0]).toMatchObject({ kind: "recovery", requests: 0, rejected: 0, notFound: 0, serverErrors: 0 });
  });
});
