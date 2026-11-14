import { useEffect, useState } from "react";
import ControlsPanelSection from "@/components/controls-panel/ControlsPanelSection";
import ControlsPanelSeparator from "@/components/controls-panel/ControlsPanelSeparator";
import ControlsPanelSectionCheckbox from "@/components/controls-panel/ControlsPanelSectionCheckbox";
import ControlsPanelSectionInput from "@/components/controls-panel/ControlsPanelSectionInput";
import CoordinateSystemSelect from "@/features/coverage-planning/components/controls-panel/env-section/CoordinateSystemSelect";
import FormatSelection from "@/features/coverage-planning/components/controls-panel/env-section/FormatSelect";
import EnvTypeSelection from "@/features/coverage-planning/components/controls-panel/env-section/EnvTypeSelect";
import { useUiUnitOfMeasureStore } from "@/features/ui-manager/stores/uiUnitOfMeasureStore";
import { useEnvStore } from "@/model/envStore";
import { useLayerSettingsStore } from "@/model/layerSettingsStore";
import { LAYER_ID } from "@/data/local/layerRegistry";
import { parseHeadlandWidth } from "@/features/canvas-editing/utils/headlandGeometry";
import { unitLabel } from "@/utils/unitOfMeasure";

export default function CoveragePlanningControlsPanel() {
    const setLayerVisible = useLayerSettingsStore((state) => state.setVisible);
    const headlandEnabled = useEnvStore((state) => state.env.headlandEnabled);
    const headlandWidth = useEnvStore((state) => state.env.headlandWidth);
    const setHeadlandEnabled = useEnvStore((state) => state.setHeadlandEnabled);
    const setHeadlandWidth = useEnvStore((state) => state.setHeadlandWidth);
    // The width being edited while the input has focus; null shows the stored width.
    const [headlandWidthDraft, setHeadlandWidthDraft] = useState<string | null>(null);
    const selectedUnitOfMeasure = useUiUnitOfMeasureStore((s) => s.unitOfMeasure);

    const uom = unitLabel(selectedUnitOfMeasure);
    const headlandWidthLabel = uom ? `Headland Width (${uom})` : "Headland Width";

    useEffect(() => {
        const shrunkenZonesPK = { id: LAYER_ID.SHRUNKEN_ZONES, algorithmId: 0, providerId: 0 };
        const expandedObstaclesPK = { id: LAYER_ID.EXPANDED_OBSTACLES, algorithmId: 0, providerId: 0 };
        setLayerVisible(shrunkenZonesPK, headlandEnabled);
        setLayerVisible(expandedObstaclesPK, headlandEnabled);
    }, [headlandEnabled, setLayerVisible]);

    return (
        <div>
            <ControlsPanelSection sectionId="environment" title="Environment">
                <FormatSelection />
                <EnvTypeSelection />
                <CoordinateSystemSelect />
            </ControlsPanelSection>

            <ControlsPanelSeparator />

            <ControlsPanelSection sectionId="headland-system" title="Headland">
                <ControlsPanelSectionCheckbox
                    label="Headland"
                    checked={headlandEnabled}
                    onChange={setHeadlandEnabled}
                />
                {headlandEnabled && (
                    <ControlsPanelSectionInput
                        label={headlandWidthLabel}
                        value={headlandWidthDraft ?? headlandWidth}
                        onChange={setHeadlandWidthDraft}
                        onFocus={() => setHeadlandWidthDraft(headlandWidth)}
                        onBlur={() => {
                            const draft = headlandWidthDraft ?? headlandWidth;
                            setHeadlandWidthDraft(null);
                            const parsed = parseHeadlandWidth(draft);
                            if (parsed === null) {
                                setHeadlandWidth("");
                                return;
                            }
                            setHeadlandWidth(String(parsed));
                        }}
                        type="number"
                        min={0}
                    />
                )}
            </ControlsPanelSection>
        </div>
    );
}
