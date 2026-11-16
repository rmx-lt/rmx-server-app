import Tooltip from "@/components/tooltip/Tooltip";

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
    <div className="flex items-center gap-2 px-5 py-1.5">
      <Tooltip label={label}>
        <span className="min-w-0 flex-1 truncate text-sm text-fg">{label}</span>
      </Tooltip>
      <span className="shrink-0 text-sm text-fg">
        {value}
        {unit && <span className="text-sm text-fg ml-1 text-muted">{unit}</span>}
      </span>
    </div>
  );
}
