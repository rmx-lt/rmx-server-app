interface InspectorPanelSectionTitleProps {
  title: string;
}

export default function InspectorPanelSectionTitle({
  title,
}: InspectorPanelSectionTitleProps) {
  return (
    <div className="w-full flex items-center px-4 pt-3">
      <span className="text-sm font-medium text-gray-700">{title}</span>
    </div>
  );
}
