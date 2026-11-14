import { useEffect, useState } from "react";
import ControlsPanelSection from "@/components/controls-panel/ControlsPanelSection";
import ControlsPanelSeparator from "@/components/controls-panel/ControlsPanelSeparator";
import ControlsPanelSectionCheckbox from "@/components/controls-panel/ControlsPanelSectionCheckbox";
import ControlsPanelSectionInput from "@/components/controls-panel/ControlsPanelSectionInput";
import CoordinateSystemSelect from "@/features/coverage-planning/components/controls-panel/map-section/CoordinateSystemSelect";
import FormatSelection from "@/features/coverage-planning/components/controls-panel/map-section/FormatSelect";
import MapTypeSelection from "@/features/coverage-planning/components/controls-panel/map-section/MapTypeSelect";
import { useUiUnitOfMeasureStore } from "@/features/ui-manager/stores/uiUnitOfMeasureStore";
import { useMapStore } from "@/model/mapStore";
import { useLayerSettingsStore } from "@/model/layerSettingsStore";
import { LAYER_ID } from "@/data/planning/layerRegistry";
import { parseHeadlandWidth } from "@/features/canvas-editing/utils/headlandGeometry";
import { unitLabel } from "@/utils/unitOfMeasure";

export default function CoveragePlanningControlsPanel() {
    const setLayerVisible = useLayerSettingsStore((state) => state.setVisible);
    const headlandEnabled = useMapStore((state) => state.map.headlandEnabled);
    const headlandWidth = useMapStore((state) => state.map.headlandWidth);
    const setHeadlandEnabled = useMapStore((state) => state.setHeadlandEnabled);
    const setHeadlandWidth = useMapStore((state) => state.setHeadlandWidth);
    // The width being edited while the input has focus; null shows the stored width.
    const [headlandWidthDraft, setHeadlandWidthDraft] = useState<string | null>(null);
    const selectedUnitOfMeasure = useUiUnitOfMeasureStore((s) => s.unitOfMeasure);

    const uom = unitLabel(selectedUnitOfMeasure);
    const headlandWidthLabel = uom ? `Headland Width (${uom})` : "Headland Width";

    useEffect(() => {
        const shrunkenZonesPK = { id: LAYER_ID.SHRUNKEN_MOWING_ZONES, algorithmId: 0, providerId: 0 };
        const expandedNoGoZonesPK = { id: LAYER_ID.EXPANDED_NO_GO_ZONES, algorithmId: 0, providerId: 0 };
        setLayerVisible(shrunkenZonesPK, headlandEnabled);
        setLayerVisible(expandedNoGoZonesPK, headlandEnabled);
    }, [headlandEnabled, setLayerVisible]);

    return (
        <div>
            <ControlsPanelSection sectionId="map" title="Map">
                <FormatSelection />
                <MapTypeSelection />
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
