import { useControlsPanelStore } from "@/components/controls-panel/controlsPanelStore";
import type { ControlsPanelSectionTitleProps } from "@/components/controls-panel/controlsPanelTypes";

export default function ControlsPanelSectionTitle({
  sectionId,
  title,
}: ControlsPanelSectionTitleProps) {
  const isExpanded = useControlsPanelStore(
    (state) => state.expandedSections[sectionId] ?? true,
  );
  const toggleSection = useControlsPanelStore((state) => state.toggleSection);

  return (
    <button
      type="button"
      title={title}
      onClick={() => toggleSection(sectionId)}
      className="w-full min-w-0 flex items-center gap-2 px-1 py-2 rounded text-base font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-200 active:bg-gray-300 cursor-pointer select-none"
    >
      <span className="material-symbols-outlined w-5 h-5 flex items-center justify-center shrink-0">
        {isExpanded ? "expand_less" : "expand_more"}
      </span>
      <span className="min-w-0 truncate">{title}</span>
    </button>
  );
}
