export type ControlsPanelSectionId = string;

export interface ControlsPanelState {
  expandedSections: Record<string, boolean>;
  toggleSection: (sectionId: ControlsPanelSectionId) => void;
  expandSection: (sectionId: ControlsPanelSectionId) => void;
  collapseSection: (sectionId: ControlsPanelSectionId) => void;
}

export interface ControlsPanelSectionTitleProps {
  sectionId: ControlsPanelSectionId;
  title: string;
}

export interface ControlsPanelSectionButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'default' | 'danger';
}

export interface ControlsPanelSectionCheckboxProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export interface ControlsPanelSectionInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  disabled?: boolean;
  placeholder?: string;
  type?: string;
  min?: number;
  max?: number;
}

export interface ControlsPanelSectionSelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  placeholder?: string;
}
