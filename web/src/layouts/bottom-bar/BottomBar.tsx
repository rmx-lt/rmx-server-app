import ConnectionIndicator from "@/features/ui-manager/components/ConnectionIndicator";

/** Thin bar across the bottom of every page; holds the server status and nothing else yet. */
export default function BottomBar() {
    return (
        <footer className="flex h-7 shrink-0 items-center border-t border-line bg-surface px-2">
            <ConnectionIndicator />
        </footer>
    );
}
