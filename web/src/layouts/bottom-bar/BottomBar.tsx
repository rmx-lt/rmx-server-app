import CanvasScaleBar from "@/features/canvas-editing/components/scale-bar/CanvasScaleBar";
import ConnectionIndicator from "@/features/ui-manager/components/ConnectionIndicator";
import { usePageStore } from "@/model/pageStore";

/** Thin bar across the bottom of every page; holds the server status and, on the workbench, the map scale. */
export default function BottomBar() {
    const onWorkbench = usePageStore((s) => s.page === "workbench");
    return (
        <footer className="flex h-7 shrink-0 items-center border-t border-line bg-surface px-2">
            <ConnectionIndicator />
            {onWorkbench && <CanvasScaleBar />}
        </footer>
    );
}
