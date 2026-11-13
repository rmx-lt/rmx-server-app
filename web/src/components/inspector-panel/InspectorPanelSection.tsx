import InspectorPanelSectionTitle from "@/components/inspector-panel/InspectorPanelSectionTitle";

interface InspectorPanelSectionProps {
  title: string;
  children: React.ReactNode;
}

export default function InspectorPanelSection({
  title,
  children,
}: InspectorPanelSectionProps) {
  return (
    <div>
      <InspectorPanelSectionTitle title={title} />
      <div>{children}</div>
    </div>
  );
}
