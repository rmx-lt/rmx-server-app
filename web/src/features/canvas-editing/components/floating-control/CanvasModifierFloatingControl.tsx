import { memo, useEffect, useRef, useState } from "react";
import {
    FloatingControl,
    FloatingControlNumberField,
    FloatingControlMainButton,
} from "@/components/floating-control";
import { useCanvasModifierFloatingControlStore } from "@/features/canvas-editing/stores/canvasModifierFloatingControlStore";
import { useCanvasSelectionStore } from "@/features/canvas-editing/stores/canvasSelectionStore";
import { useCanvasObjectStore } from "@/features/canvas-editing/stores/canvasObjectStore";
import { useUiUnitOfMeasureStore } from "@/features/ui-manager/stores/uiUnitOfMeasureStore";
import { unitLabel } from "@/utils/unitOfMeasure";
import { OBJECT_CATEGORY } from "@/config/db-ops/enums";
import { getUiPreference, setUiPreference } from "@/data/local/uiPreferences";

const UI_PREF_KEY = "floatingControl.canvas-modifier";

interface CanvasModifierFloatingControlPrefs {
    isOpen: boolean;
    position: { x: number; y: number };
    values: {
        multiplier: string;
        maxOffset: string;
    };
}

function CanvasModifierFloatingControl() {
    const isOpen = useCanvasModifierFloatingControlStore((s) => s.isOpen);
    const setOpen = useCanvasModifierFloatingControlStore((s) => s.setOpen);

    const selectedObject = useCanvasSelectionStore((s) => s.selectedObject);
    const selectVertex = useCanvasSelectionStore((s) => s.selectVertex);
    const selectedObjectCategory = useCanvasObjectStore(
        (s) => s.objects.find((o) => o.id === selectedObject?.id)?.category,
    );
    const modifyObjectVertices = useCanvasObjectStore((s) => s.modifyObjectVertices);
    const uom = useUiUnitOfMeasureStore((s) => s.unitOfMeasure);

    const [multiplier, setMultiplier] = useState("1");
    const [maxOffset, setMaxOffset] = useState("0");
    const [controlPosition, setControlPosition] = useState({ x: 16, y: 16 });
    const isHydratedRef = useRef(false);

    useEffect(() => {
        let isCancelled = false;

        async function hydrate() {
            const fallback: CanvasModifierFloatingControlPrefs = {
                isOpen: false,
                position: { x: 16, y: 16 },
                values: { multiplier: "1", maxOffset: "0" },
            };

            const saved = await getUiPreference<CanvasModifierFloatingControlPrefs>(UI_PREF_KEY, fallback);
            if (isCancelled) return;

            setOpen(saved.isOpen);
            setControlPosition(saved.position);
            setMultiplier(saved.values.multiplier);
            setMaxOffset(saved.values.maxOffset);
            isHydratedRef.current = true;
        }

        void hydrate();
        return () => {
            isCancelled = true;
        };
    }, [setOpen]);

    useEffect(() => {
        if (!isHydratedRef.current) return;

        const timeoutId = setTimeout(() => {
            const payload: CanvasModifierFloatingControlPrefs = {
                isOpen,
                position: controlPosition,
                values: { multiplier, maxOffset },
            };
            void setUiPreference(UI_PREF_KEY, payload);
        }, 120);

        return () => clearTimeout(timeoutId);
    }, [isOpen, controlPosition, multiplier, maxOffset]);

    const isValidSelection =
        !!selectedObject &&
        (selectedObjectCategory === OBJECT_CATEGORY.ZONE ||
            selectedObjectCategory === OBJECT_CATEGORY.OBSTACLE);

    const parsedMultiplier = parseFloat(multiplier);
    const parsedOffset = parseFloat(maxOffset);
    const areFieldsValid =
        !isNaN(parsedMultiplier) &&
        parsedMultiplier > 0 &&
        !isNaN(parsedOffset) &&
        parsedOffset >= 0;

    function handleApply() {
        if (!selectedObject || !isValidSelection || !areFieldsValid) return;
        modifyObjectVertices(selectedObject.id, parsedMultiplier, parsedOffset);
        selectVertex(null);
    }

    return (
        <FloatingControl
            id="canvas-modifier"
            title="Modifier"
            isOpen={isOpen}
            onClose={() => setOpen(false)}
            defaultPosition={controlPosition}
            onPositionChange={setControlPosition}
        >
            <FloatingControlNumberField
                label="Vertex multiplier"
                value={multiplier}
                onChange={setMultiplier}
                type="decimal"
                min={0.01}
                step={0.1}
            />
            <FloatingControlNumberField
                label={unitLabel(uom) ? `Max random offset (${unitLabel(uom)})` : "Max random offset"}
                value={maxOffset}
                onChange={setMaxOffset}
                type="decimal"
                min={0}
                step={1}
            />
            <div className="mx-3 my-1 border-t border-gray-300" />
            <FloatingControlMainButton
                label="Apply"
                onClick={handleApply}
                disabled={!isValidSelection || !areFieldsValid}
            />
        </FloatingControl>
    );
}

export default memo(CanvasModifierFloatingControl);
