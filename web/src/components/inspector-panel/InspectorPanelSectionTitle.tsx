interface InspectorPanelSectionTitleProps {
  title: string;
}

export default function InspectorPanelSectionTitle({
  title,
}: InspectorPanelSectionTitleProps) {
  return (
    <h3 className="w-full px-5 pt-4 pb-1 text-xs font-medium text-faint">{title}</h3>
  );
}
