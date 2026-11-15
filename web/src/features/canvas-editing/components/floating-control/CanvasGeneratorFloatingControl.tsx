import { memo, useMemo, useEffect, useRef } from "react";
import {
    FloatingControl,
    FloatingControlNumberField,
    FloatingControlRangeField,
    FloatingControlTextField,
    FloatingControlButton,
    FloatingControlMainButton,
    parseRangeFieldValue,
} from "@/components/floating-control";
import { useCanvasGeneratorFloatingControlStore } from "@/features/canvas-editing/stores/canvasGeneratorFloatingControlStore";
import { useCanvasObjectStore } from "@/features/canvas-editing/stores/canvasObjectStore";
import {
    generateCompliantMap,
    computeResolvedNoGoZoneRatioPct,
    computeResolvedClusteringPct,
    validateGeneratorSystemParams,
} from "@/features/canvas-editing/utils/mapGenerator";
import { validateCanvasGeneratorInputs } from "@/features/canvas-editing/utils/mapInputValidation";
import { useUiUnitOfMeasureStore } from "@/features/ui-manager/stores/uiUnitOfMeasureStore";
import { useMapPointStore } from "@/model/mapPointStore";
import { useMapStore } from "@/model/mapStore";
import {
    ZONE_CATEGORY,
    MAP_FORMAT_OPTIONS,
    COORD_SYSTEM_OPTIONS,
} from "@/config/db-ops/enums";
import { unitLabel } from "@/utils/unitOfMeasure";
import { getUiPreference, setUiPreference } from "@/data/planning/uiPreferences";
import type { CanvasGeneratorFloatingControlPrefs } from "@/features/canvas-editing/types/canvasGeneratorPrefs";

const UI_PREF_KEY = "floatingControl.canvas-generator";

function CanvasGeneratorFloatingControl() {
    const isOpen = useCanvasGeneratorFloatingControlStore((s) => s.isOpen);
    const width = useCanvasGeneratorFloatingControlStore((s) => s.width);
    const height = useCanvasGeneratorFloatingControlStore((s) => s.height);
    const cellSize = useCanvasGeneratorFloatingControlStore((s) => s.cellSize);
    const noGoZoneRatio = useCanvasGeneratorFloatingControlStore((s) => s.noGoZoneRatio);
    const clusteringProb = useCanvasGeneratorFloatingControlStore((s) => s.clusteringProb);
    const seed = useCanvasGeneratorFloatingControlStore((s) => s.seed);
    const autoNoGoZoneRatioHint = useCanvasGeneratorFloatingControlStore((s) => s.autoNoGoZoneRatioHint);
    const autoClusteringHint = useCanvasGeneratorFloatingControlStore((s) => s.autoClusteringHint);
    const lastSeedHex = useCanvasGeneratorFloatingControlStore((s) => s.lastSeedHex);
    const controlPosition = useCanvasGeneratorFloatingControlStore((s) => s.controlPosition);
    const hasObsLeftField = useCanvasGeneratorFloatingControlStore((s) => s.hasObsLeftField);
    const hasClustLeftField = useCanvasGeneratorFloatingControlStore((s) => s.hasClustLeftField);
    const lastPickedObsValue = useCanvasGeneratorFloatingControlStore((s) => s.lastPickedObsValue);
    const lastPickedClustValue = useCanvasGeneratorFloatingControlStore((s) => s.lastPickedClustValue);
    const setOpen = useCanvasGeneratorFloatingControlStore((s) => s.setOpen);
    const setWidth = useCanvasGeneratorFloatingControlStore((s) => s.setWidth);
    const setHeight = useCanvasGeneratorFloatingControlStore((s) => s.setHeight);
    const setCellSize = useCanvasGeneratorFloatingControlStore((s) => s.setCellSize);
    const setNoGoZoneRatio = useCanvasGeneratorFloatingControlStore((s) => s.setNoGoZoneRatio);
    const setClusteringProb = useCanvasGeneratorFloatingControlStore((s) => s.setClusteringProb);
    const setSeed = useCanvasGeneratorFloatingControlStore((s) => s.setSeed);
    const setAutoNoGoZoneRatioHint = useCanvasGeneratorFloatingControlStore((s) => s.setAutoNoGoZoneRatioHint);
    const setAutoClusteringHint = useCanvasGeneratorFloatingControlStore((s) => s.setAutoClusteringHint);
    const setLastSeedHex = useCanvasGeneratorFloatingControlStore((s) => s.setLastSeedHex);
    const setControlPosition = useCanvasGeneratorFloatingControlStore((s) => s.setControlPosition);
    const setHasObsLeftField = useCanvasGeneratorFloatingControlStore((s) => s.setHasObsLeftField);
    const setHasClustLeftField = useCanvasGeneratorFloatingControlStore((s) => s.setHasClustLeftField);
    const setLastPickedObsValue = useCanvasGeneratorFloatingControlStore((s) => s.setLastPickedObsValue);
    const setLastPickedClustValue = useCanvasGeneratorFloatingControlStore((s) => s.setLastPickedClustValue);

    const objects = useCanvasObjectStore((s) => s.objects);
    const deleteObject = useCanvasObjectStore((s) => s.deleteObject);
    const addObject = useCanvasObjectStore((s) => s.addObject);
    const upsertPoint = useMapPointStore((s) => s.upsertPoint);
    const deletePoint = useMapPointStore((s) => s.deletePoint);
    const mapId = useMapStore((s) => s.map.id);
    const map = useMapStore((s) => s.map);
    const uom = useUiUnitOfMeasureStore((s) => s.unitOfMeasure);

    const isHydratedRef = useRef(false);

    const uomLabel = unitLabel(uom);
    const widthLabel = uomLabel ? `Width (${uomLabel})` : "Width";
    const heightLabel = uomLabel ? `Height (${uomLabel})` : "Height";
    const cellSizeLabel = uomLabel ? `Cell size (${uomLabel})` : "Cell size";

    // Seed-derived previews; recomputed when seed or field value changes
    const seedDerivedObsRatio = useMemo(() => {
        const parsed = parseRangeFieldValue(noGoZoneRatio);
        const range = Array.isArray(parsed) ? parsed : undefined;
        return computeResolvedNoGoZoneRatioPct(seed, range);
    }, [seed, noGoZoneRatio]);

    const seedDerivedClust = useMemo(() => {
        const parsed = parseRangeFieldValue(clusteringProb);
        const range = Array.isArray(parsed) ? parsed : undefined;
        return computeResolvedClusteringPct(seed, range);
    }, [seed, clusteringProb]);

    const obsIsAuto = noGoZoneRatio === "";
    const obsHintStr = seedDerivedObsRatio !== null
        ? String(seedDerivedObsRatio)
        : autoNoGoZoneRatioHint !== null ? String(autoNoGoZoneRatioHint) : "auto";
    // Blank → show auto hint as placeholder; after Generate, replace hint with the actual picked value
    const obsPlaceholder = obsIsAuto
        ? (lastPickedObsValue !== null ? String(lastPickedObsValue) : obsHintStr)
        : undefined;

    const clustIsAuto = clusteringProb === "";
    const clustHintStr = seedDerivedClust !== null
        ? String(seedDerivedClust)
        : autoClusteringHint !== null ? String(autoClusteringHint) : "auto";
    // Same: after Generate, replace hint with actual picked value when field is blank
    const clustPlaceholder = clustIsAuto
        ? (lastPickedClustValue !== null ? String(lastPickedClustValue) : clustHintStr)
        : undefined;

    const {
        isRequiredFieldsValid,
        cellSizeFitError,
        noGoZoneRatioError,
        clusteringError,
        hasAnyRangeFieldError,
        canGenerate,
    } = useMemo(() => validateCanvasGeneratorInputs({
        width,
        height,
        cellSize,
        noGoZoneRatio,
        clusteringProb,
        hasObsLeftField,
        hasClustLeftField,
    }), [
        width,
        height,
        cellSize,
        noGoZoneRatio,
        clusteringProb,
        hasObsLeftField,
        hasClustLeftField,
    ]);

    const generatorSystemValidation = useMemo(() => validateGeneratorSystemParams({
        format: map.format,
        coordSystem: map.coordSystem,
    }), [map.format, map.coordSystem]);

    const systemParamsError = generatorSystemValidation.error;
    const isSystemParamsCompatible = generatorSystemValidation.ok;

    useEffect(() => {
        let isCancelled = false;

        async function hydrate() {
            const fallback: CanvasGeneratorFloatingControlPrefs = {
                isOpen: false,
                position: { x: 16, y: 16 },
                values: {
                    width: "2000",
                    height: "2000",
                    cellSize: "50",
                    obstacleRatio: "20..30",
                    clusteringProb: "95..99",
                    seed: "",
                    lastSeedHex: null,
                },
            };

            const saved = await getUiPreference<CanvasGeneratorFloatingControlPrefs>(UI_PREF_KEY, fallback);
            if (isCancelled) return;

            setOpen(saved.isOpen);
            setControlPosition(saved.position);
            setWidth(saved.values.width);
            setHeight(saved.values.height);
            setCellSize(saved.values.cellSize);
            setNoGoZoneRatio(saved.values.obstacleRatio);
            setClusteringProb(saved.values.clusteringProb);
            setSeed(saved.values.seed);
            setLastSeedHex(saved.values.lastSeedHex);
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
            const payload: CanvasGeneratorFloatingControlPrefs = {
                isOpen,
                position: controlPosition,
                values: {
                    width,
                    height,
                    cellSize,
                    obstacleRatio: noGoZoneRatio,
                    clusteringProb,
                    seed,
                    lastSeedHex,
                },
            };
            void setUiPreference(UI_PREF_KEY, payload);
        }, 120);

        return () => clearTimeout(timeoutId);
    }, [
        isOpen,
        controlPosition,
        width,
        height,
        cellSize,
        noGoZoneRatio,
        clusteringProb,
        seed,
        lastSeedHex,
    ]);

    function handleClearMap() {
        const snapshot = [...objects];
        snapshot.forEach((o) => deleteObject(o));
        deletePoint(mapId, "start_end");
        deletePoint(mapId, "start");
        deletePoint(mapId, "end");
    }

    async function handleGenerate(): Promise<boolean> {
        if (!isRequiredFieldsValid) return false;
        if (cellSizeFitError !== null) return false;
        if (hasAnyRangeFieldError) return false;
        if (!isSystemParamsCompatible) return false;

        const w = parseFloat(width);
        const h = parseFloat(height);
        const cs = parseFloat(cellSize);
        const obRatio = parseRangeFieldValue(noGoZoneRatio);
        const clusteringProbVal = parseRangeFieldValue(clusteringProb);

        const snapshot = [...objects];
        snapshot.forEach((o) => deleteObject(o));

        const compliantResult = generateCompliantMap({
            width: w,
            height: h,
            cellSize: cs,
            noGoZoneRatio: obRatio,
            clusteringProb: clusteringProbVal,
            seed,
            systemParams: {
                format: map.format,
                type: map.type,
                coordSystem: map.coordSystem,
            },
        });

        if (!compliantResult.ok) return false;

        const generatedMap = compliantResult.value.map;
        const generatedObjectType = compliantResult.value.objectType;

        // Update auto-hints so placeholders reflect the values actually used
        if (obRatio === undefined) setAutoNoGoZoneRatioHint(generatedMap.usedNoGoZoneRatioPct);
        if (clusteringProbVal === undefined) setAutoClusteringHint(generatedMap.usedClusteringPct);
        setLastSeedHex(generatedMap.usedSeedHex);

        // Capture the randomly picked values for inline display.
        // Use generatedMap.pickedNoGoZoneRatioPct / generatedMap.pickedClusteringPct (the value actually selected
        // from the user's range) rather than the final achieved ratio, which can diverge from the
        // requested range due to the percolation staircase behaviour.
        const seedWasRandomlyGenerated = !seed.trim();

        if (generatedMap.pickedNoGoZoneRatioPct !== null) {
            // Range mode: show the value picked from the range
            setLastPickedObsValue(generatedMap.pickedNoGoZoneRatioPct);
        } else if (seedWasRandomlyGenerated && obRatio === undefined) {
            // Auto mode with random seed: show the actual achieved ratio
            setLastPickedObsValue(generatedMap.usedNoGoZoneRatioPct);
        } else {
            setLastPickedObsValue(null);
        }

        if (generatedMap.pickedClusteringPct !== null) {
            // Range mode: show the value picked from the range
            setLastPickedClustValue(generatedMap.pickedClusteringPct);
        } else if (seedWasRandomlyGenerated && clusteringProbVal === undefined) {
            // Auto mode with random seed: show the actual achieved ratio
            setLastPickedClustValue(generatedMap.usedClusteringPct);
        } else {
            setLastPickedClustValue(null);
        }

        addObject(ZONE_CATEGORY.MOWING, generatedMap.boundary, generatedObjectType);
        for (const obs of generatedMap.noGoZones) {
            addObject(ZONE_CATEGORY.NO_GO, obs, generatedObjectType);
        }
        await upsertPoint(mapId, "start_end", generatedMap.startEndPoint);
        return true;
    }

    return (
        <FloatingControl
            id="canvas-generator"
            title="Generator"
            isOpen={isOpen}
            onClose={() => setOpen(false)}
            defaultPosition={controlPosition}
            onPositionChange={setControlPosition}
        >
            <FloatingControlNumberField
                label={widthLabel}
                value={width}
                onChange={setWidth}
                type="decimal"
                min={0}
                step={1}
            />
            <FloatingControlNumberField
                label={heightLabel}
                value={height}
                onChange={setHeight}
                type="decimal"
                min={0}
                step={1}
            />
            <div className="flex items-center gap-2 px-3 h-8">
                <div className="w-29/50 shrink-0 flex items-center gap-1 min-w-0">
                    <span className="text-xs text-gray-500 truncate select-none">{cellSizeLabel}</span>
                    <span className="flex-1 min-w-0 h-1 bg-[radial-gradient(circle,#d1d5db_1.5px,transparent_1.5px)] bg-size-[10px_10px] bg-repeat-x bg-center" />
                    {cellSizeFitError && (
                        <span
                            className="shrink-0 flex items-center cursor-default transition-colors text-red-500 hover:text-red-600"
                            title={cellSizeFitError}
                        >
                            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>error</span>
                        </span>
                    )}
                </div>
                <div className="relative flex-1 min-w-0">
                    <input
                        type="number"
                        value={cellSize}
                        onChange={(e) => setCellSize(e.target.value)}
                        step={1}
                        min={0}
                        placeholder=""
                        className="w-full border rounded bg-white text-xs px-2 h-6 focus:outline-none transition-colors [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none placeholder:text-gray-400 placeholder:italic border-gray-300 text-gray-900"
                    />
                </div>
            </div>
            <FloatingControlRangeField
                label="No-go zone ratio (%)"
                value={noGoZoneRatio}
                onChange={(v) => {
                    setNoGoZoneRatio(v);
                    setLastPickedObsValue(null);
                }}
                onFocus={() => setHasObsLeftField(false)}
                onBlur={() => setHasObsLeftField(true)}
                min={0}
                max={100}
                placeholder={obsPlaceholder}
                pickedValue={obsIsAuto ? null : lastPickedObsValue}
                error={noGoZoneRatioError}
            />
            <FloatingControlRangeField
                label="Clustering prob. (%)"
                value={clusteringProb}
                onChange={(v) => {
                    setClusteringProb(v);
                    setLastPickedClustValue(null);
                }}
                onFocus={() => setHasClustLeftField(false)}
                onBlur={() => setHasClustLeftField(true)}
                min={0}
                max={100}
                placeholder={clustPlaceholder}
                pickedValue={clustIsAuto ? null : lastPickedClustValue}
                error={clusteringError}
            />
            <FloatingControlTextField
                label="Seed"
                value={seed}
                onChange={(v) => { setSeed(v); setLastSeedHex(null); }}
                placeholder={lastSeedHex ?? undefined}
            />
            <div className="mx-3 my-1 border-t border-gray-300" />
            {systemParamsError && (
                <div className="mx-3 mb-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
                    {systemParamsError} Current values: Format = {MAP_FORMAT_OPTIONS.find((opt) => opt.value === map.format)?.label ?? map.format}, Coordinate System = {COORD_SYSTEM_OPTIONS.find((opt) => opt.value === map.coordSystem)?.label ?? map.coordSystem}.
                </div>
            )}
            <FloatingControlButton
                label="Clear Map"
                onClick={handleClearMap}
            />
            <FloatingControlMainButton
                label="Generate"
                onClick={handleGenerate}
                disabled={!canGenerate || !isSystemParamsCompatible}
            />
        </FloatingControl>
    );
}

export default memo(CanvasGeneratorFloatingControl);
