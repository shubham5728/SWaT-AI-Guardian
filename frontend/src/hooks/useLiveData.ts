import { useEffect, useMemo } from "react";
import { createTransport, type Transport } from "@/services";
import { useDashboardStore } from "@/store/useDashboardStore";
import type { ClientCommand } from "@/types";

/**
 * Owns the transport lifecycle: instantiates it once, pipes inbound messages and
 * status into the store, and returns a typed `send` for control commands.
 * Mount this once near the top of the tree (App).
 */
export function useLiveData(): { send: (cmd: ClientCommand) => void } {
  const transport: Transport = useMemo(() => createTransport(), []);
  const applyServerMessage = useDashboardStore((s) => s.applyServerMessage);
  const setTransportStatus = useDashboardStore((s) => s.setTransportStatus);

  useEffect(() => {
    const offMsg = transport.onMessage(applyServerMessage);
    const offStatus = transport.onStatus(setTransportStatus);
    transport.connect();
    return () => {
      offMsg();
      offStatus();
      transport.disconnect();
    };
  }, [transport, applyServerMessage, setTransportStatus]);

  return useMemo(
    () => ({ send: (cmd: ClientCommand) => transport.send(cmd) }),
    [transport],
  );
}
