import ToolBarButton from "@/components/tool-bar/ToolBarButton";
import { useCppDebugStore } from "@/features/coverage-planning/stores/cppDebugStore";
import { startDebugSession } from "@/features/coverage-planning/data/debugService";

export default function DebugCppButton() {
    const isDebugMode = useCppDebugStore((s) => s.isDebugMode);

    async function handleClick() {
        if (isDebugMode) return;
        await startDebugSession();
    }

    return (
        <ToolBarButton
            title="Debug coverage path planning"
            icon="bug_report"
            isActive={isDebugMode}
            onClick={() => { void handleClick(); }}
        />
    );
}
