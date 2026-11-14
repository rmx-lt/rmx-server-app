import { useSaveStatusStore } from "@/model/saveStatusStore";
import type { SaveStatus } from "@/model/saveStatusStore";

const CONFIG: Record<SaveStatus, { dot: string; text: string; tooltip: string; label: string }> = {
    nothing_to_save: {
        dot: "bg-gray-400",
        text: "text-gray-500 hover:bg-gray-200",
        tooltip: "Nothing to save",
        label: "Nothing to save",
    },
    saved: {
        dot: "bg-green-500",
        text: "text-gray-600 hover:bg-gray-200",
        tooltip: "Saved",
        label: "Saved",
    },
    unsaved: {
        dot: "bg-amber-500",
        text: "bg-amber-100 text-amber-800 hover:bg-amber-200",
        tooltip: "Unsaved changes. Click here to save",
        label: "Unsaved changes",
    },
};

export default function SaveStateButton() {
    const { status, save } = useSaveStatusStore();
    const { dot, text, tooltip, label } = CONFIG[status];

    function handleClick() {
        if (status === "unsaved") {
            save().catch(console.error);
        }
    }

    return (
        <button
            type="button"
            title={tooltip}
            onClick={handleClick}
            className={`flex items-center gap-1 h-5 px-1.5 rounded text-xs cursor-pointer select-none transition-colors ${text}`}
        >
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
            {label}
        </button>
    );
}
