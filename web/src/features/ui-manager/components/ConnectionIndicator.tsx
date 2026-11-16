import Tooltip from "@/components/tooltip/Tooltip";
import { useConnectionStore } from "@/model/connectionStore";

/** The server connection: live while the WebSocket is open, offline otherwise. */
export default function ConnectionIndicator() {
    const live = useConnectionStore((s) => s.live);
    return (
        <Tooltip label={live ? "Connected to the server" : "No connection to the server"}>
            <span role="status" tabIndex={0} className="flex items-center gap-1.5 rounded px-1.5 text-xs text-muted">
                <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${live ? "bg-ok" : "bg-warn"}`} />
                Server: {live ? "live" : "offline"}
            </span>
        </Tooltip>
    );
}
