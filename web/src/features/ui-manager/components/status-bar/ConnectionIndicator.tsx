import { useConnectionStore } from "@/model/connectionStore";

/** The only state shown about saving: whether the server connection is live. */
export default function ConnectionIndicator() {
    const live = useConnectionStore((s) => s.live);
    return (
        <span className="flex items-center gap-1 h-5 px-1.5 text-xs text-muted select-none">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${live ? "bg-ok" : "bg-line-strong"}`} />
            {live ? "Live" : "Offline"}
        </span>
    );
}
