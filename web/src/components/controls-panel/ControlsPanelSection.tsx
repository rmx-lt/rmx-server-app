import { useControlsPanelStore } from "@/components/controls-panel/controlsPanelStore";
import ControlsPanelSectionTitle from "@/components/controls-panel/ControlsPanelSectionTitle";
import type { ControlsPanelSectionId } from "@/components/controls-panel/controlsPanelTypes";

interface ControlsPanelSectionProps {
  sectionId: ControlsPanelSectionId;
  title: string;
  children: React.ReactNode;
}

export default function ControlsPanelSection({
  sectionId,
  title,
  children,
}: ControlsPanelSectionProps) {
  const isExpanded = useControlsPanelStore(
    (state) => state.expandedSections[sectionId] ?? true,
  );

  return (
    <div className={`flex flex-col${isExpanded ? " pb-2" : ""}`}>
      <ControlsPanelSectionTitle sectionId={sectionId} title={title} />

      {isExpanded && <div className="flex flex-col pl-1">{children}</div>}
    </div>
  );
}
