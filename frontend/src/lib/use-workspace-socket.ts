"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

/** Subscribes to a workspace's live-update room (same pattern every workspace page already used
 * individually before this was extracted: connect, subscribe, listen, unsubscribe+disconnect on
 * unmount) and dispatches named events to the handlers given.
 *
 * `handlers` is read through a ref, not a dependency -- the socket connects once per
 * `workspaceId` and always calls whatever the latest render's handlers were, so callers don't need
 * to memoize the handlers object themselves (a fresh object literal on every render is fine). The
 * set of event names must stay the same across the component's lifetime; only the workspace this
 * hook is called for is expected to change. */
export function useWorkspaceSocket(
  workspaceId: string,
  handlers: Record<string, (payload: unknown) => void>,
): boolean {
  const [connected, setConnected] = useState(false);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const socket: Socket = io({ path: "/ws", addTrailingSlash: false, transports: ["websocket"] });
    socket.on("connect", () =>
      socket.emit("subscribe", { workspaceId }, (ack?: { ok: boolean }) => setConnected(!!ack?.ok)),
    );
    socket.on("disconnect", () => setConnected(false));
    for (const event of Object.keys(handlersRef.current)) {
      socket.on(event, (payload: unknown) => handlersRef.current[event]?.(payload));
    }
    return () => {
      socket.emit("unsubscribe", { workspaceId });
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  return connected;
}
