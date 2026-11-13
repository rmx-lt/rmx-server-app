import { describe, expect, test } from "bun:test";
import { wsUrl } from "@/data/api/paths";
import { expectPong, PendingRequests, RpcError } from "@/data/api/rpc";

describe("PendingRequests", () => {
  test("resolves the matching request with its data", async () => {
    const pending = new PendingRequests();
    const { requestId, promise } = pending.start();
    expect(pending.settle({ request_id: "other", result: { status: "ok", data: { kind: "pong" } } })).toBe(false);
    pending.settle({ request_id: requestId, result: { status: "ok", data: { kind: "pong" } } });
    const data = await promise;
    expect(() => expectPong(data)).not.toThrow();
    expect(pending.size).toBe(0);
  });

  test("rejects with the server's error code", async () => {
    const pending = new PendingRequests();
    const { requestId, promise } = pending.start();
    pending.settle({
      request_id: requestId,
      result: { status: "error", error: { code: "bad_request", message: "invalid request" } },
    });
    const err = await promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RpcError);
    expect((err as RpcError).code).toBe("bad_request");
  });

  test("times out and fails all on disconnect", async () => {
    const pending = new PendingRequests(10);
    const timedOut = pending.start().promise.catch((e: RpcError) => e.code);
    expect(await timedOut).toBe("timeout");

    const other = new PendingRequests();
    const dropped = other.start().promise.catch((e: RpcError) => e.code);
    other.failAll("closed");
    expect(await dropped).toBe("disconnected");
  });
});

describe("addresses", () => {
  test("WebSocket URL follows the page scheme", () => {
    expect(wsUrl({ protocol: "https:", host: "api.rmx.lt" })).toBe("wss://api.rmx.lt/app/ws");
    expect(wsUrl({ protocol: "http:", host: "localhost:3000" })).toBe("ws://localhost:3000/app/ws");
  });
});
