import { useConnectionStore } from "@/model/connectionStore";

/** The only state shown about saving: whether the server connection is live. */
export default function ConnectionIndicator() {
    const live = useConnectionStore((s) => s.live);
    return (
        <span
            role="status"
            title={live ? "Connected to the server; changes are saved by themselves" : "Not connected; changes are sent when the server is back"}
            className="flex select-none items-center gap-1.5 px-1.5 text-xs text-muted"
        >
            <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${live ? "bg-ok" : "bg-warn"}`} />
            {live ? "Live" : "Offline"}
        </span>
    );
}
