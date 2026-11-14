interface InspectorPanelSectionFieldProps {
  label: string;
  value: string | number;
  unit?: string;
}

export default function InspectorPanelSectionField({
  label,
  value,
  unit,
}: InspectorPanelSectionFieldProps) {
  return (
    <div className="flex items-center gap-2 px-5 py-1">
      <span
        className="min-w-0 flex-1 truncate text-sm text-gray-800"
        title={label}
      >
        {label}
      </span>
      <span className="shrink-0 text-sm text-gray-800">
        {value}
        {unit && <span className="text-sm text-gray-800 ml-1">{unit}</span>}
      </span>
    </div>
  );
}
