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
    generateCompliantEnvironment,
    computeResolvedObstacleRatioPct,
    computeResolvedClusteringPct,
    validateGeneratorSystemParams,
} from "@/features/canvas-editing/utils/envGenerator";
import { validateCanvasGeneratorInputs } from "@/features/canvas-editing/utils/environmentInputValidation";
import { useUiUnitOfMeasureStore } from "@/features/ui-manager/stores/uiUnitOfMeasureStore";
import { useEnvPointStore } from "@/model/envPointStore";
import { useEnvStore } from "@/model/envStore";
import {
    OBJECT_CATEGORY,
    ENV_FORMAT_OPTIONS,
    COORD_SYSTEM_OPTIONS,
} from "@/config/db-ops/enums";
import { unitLabel } from "@/utils/unitOfMeasure";
import { getUiPreference, setUiPreference } from "@/data/local/uiPreferences";
import { useComputeResultStore } from "@/model/useComputeResultStore";
import { executeComputeRequest } from "@/features/coverage-planning/data/computeService";
import type { CanvasGeneratorFloatingControlPrefs } from "@/features/canvas-editing/types/canvasGeneratorPrefs";

const UI_PREF_KEY = "floatingControl.canvas-generator";

function CanvasGeneratorFloatingControl() {
    const isOpen = useCanvasGeneratorFloatingControlStore((s) => s.isOpen);
    const width = useCanvasGeneratorFloatingControlStore((s) => s.width);
    const height = useCanvasGeneratorFloatingControlStore((s) => s.height);
    const cellSize = useCanvasGeneratorFloatingControlStore((s) => s.cellSize);
    const obstacleRatio = useCanvasGeneratorFloatingControlStore((s) => s.obstacleRatio);
    const clusteringProb = useCanvasGeneratorFloatingControlStore((s) => s.clusteringProb);
    const seed = useCanvasGeneratorFloatingControlStore((s) => s.seed);
    const autoObstacleRatioHint = useCanvasGeneratorFloatingControlStore((s) => s.autoObstacleRatioHint);
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
    const setObstacleRatio = useCanvasGeneratorFloatingControlStore((s) => s.setObstacleRatio);
    const setClusteringProb = useCanvasGeneratorFloatingControlStore((s) => s.setClusteringProb);
    const setSeed = useCanvasGeneratorFloatingControlStore((s) => s.setSeed);
    const setAutoObstacleRatioHint = useCanvasGeneratorFloatingControlStore((s) => s.setAutoObstacleRatioHint);
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
    const upsertPoint = useEnvPointStore((s) => s.upsertPoint);
    const deletePoint = useEnvPointStore((s) => s.deletePoint);
    const envId = useEnvStore((s) => s.env.id);
    const env = useEnvStore((s) => s.env);
    const uom = useUiUnitOfMeasureStore((s) => s.unitOfMeasure);
    const computeStatus = useComputeResultStore((s) => s.status);
    const isComputeBusy = computeStatus === "submitting" || computeStatus === "polling";

    const isHydratedRef = useRef(false);

    const uomLabel = unitLabel(uom);
    const widthLabel = uomLabel ? `Width (${uomLabel})` : "Width";
    const heightLabel = uomLabel ? `Height (${uomLabel})` : "Height";
    const cellSizeLabel = uomLabel ? `Cell size (${uomLabel})` : "Cell size";

    // Seed-derived previews; recomputed when seed or field value changes
    const seedDerivedObsRatio = useMemo(() => {
        const parsed = parseRangeFieldValue(obstacleRatio);
        const range = Array.isArray(parsed) ? parsed : undefined;
        return computeResolvedObstacleRatioPct(seed, range);
    }, [seed, obstacleRatio]);

    const seedDerivedClust = useMemo(() => {
        const parsed = parseRangeFieldValue(clusteringProb);
        const range = Array.isArray(parsed) ? parsed : undefined;
        return computeResolvedClusteringPct(seed, range);
    }, [seed, clusteringProb]);

    const obsIsAuto = obstacleRatio === "";
    const obsHintStr = seedDerivedObsRatio !== null
        ? String(seedDerivedObsRatio)
        : autoObstacleRatioHint !== null ? String(autoObstacleRatioHint) : "auto";
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
        obstacleRatioError,
        clusteringError,
        hasAnyRangeFieldError,
        canGenerate,
    } = useMemo(() => validateCanvasGeneratorInputs({
        width,
        height,
        cellSize,
        obstacleRatio,
        clusteringProb,
        hasObsLeftField,
        hasClustLeftField,
    }), [
        width,
        height,
        cellSize,
        obstacleRatio,
        clusteringProb,
        hasObsLeftField,
        hasClustLeftField,
    ]);

    const generatorSystemValidation = useMemo(() => validateGeneratorSystemParams({
        format: env.format,
        coordSystem: env.coordSystem,
    }), [env.format, env.coordSystem]);

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
            setObstacleRatio(saved.values.obstacleRatio);
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
                    obstacleRatio,
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
        obstacleRatio,
        clusteringProb,
        seed,
        lastSeedHex,
    ]);

    function handleClearEnvironment() {
        const snapshot = [...objects];
        snapshot.forEach((o) => deleteObject(o));
        deletePoint(envId, "start_end");
        deletePoint(envId, "start");
        deletePoint(envId, "end");
    }

    async function handleGenerate(): Promise<boolean> {
        if (!isRequiredFieldsValid) return false;
        if (cellSizeFitError !== null) return false;
        if (hasAnyRangeFieldError) return false;
        if (!isSystemParamsCompatible) return false;

        const w = parseFloat(width);
        const h = parseFloat(height);
        const cs = parseFloat(cellSize);
        const obRatio = parseRangeFieldValue(obstacleRatio);
        const clusteringProbVal = parseRangeFieldValue(clusteringProb);

        const snapshot = [...objects];
        snapshot.forEach((o) => deleteObject(o));

        const compliantResult = generateCompliantEnvironment({
            width: w,
            height: h,
            cellSize: cs,
            obstacleRatio: obRatio,
            clusteringProb: clusteringProbVal,
            seed,
            systemParams: {
                format: env.format,
                type: env.type,
                coordSystem: env.coordSystem,
            },
        });

        if (!compliantResult.ok) return false;

        const generatedEnv = compliantResult.value.environment;
        const generatedObjectType = compliantResult.value.objectType;

        // Update auto-hints so placeholders reflect the values actually used
        if (obRatio === undefined) setAutoObstacleRatioHint(generatedEnv.usedObstacleRatioPct);
        if (clusteringProbVal === undefined) setAutoClusteringHint(generatedEnv.usedClusteringPct);
        setLastSeedHex(generatedEnv.usedSeedHex);

        // Capture the randomly picked values for inline display.
        // Use env.pickedObstacleRatioPct / env.pickedClusteringPct (the value actually selected
        // from the user's range) rather than the final achieved ratio, which can diverge from the
        // requested range due to the percolation staircase behaviour.
        const seedWasRandomlyGenerated = !seed.trim();

        if (generatedEnv.pickedObstacleRatioPct !== null) {
            // Range mode: show the value picked from the range
            setLastPickedObsValue(generatedEnv.pickedObstacleRatioPct);
        } else if (seedWasRandomlyGenerated && obRatio === undefined) {
            // Auto mode with random seed: show the actual achieved ratio
            setLastPickedObsValue(generatedEnv.usedObstacleRatioPct);
        } else {
            setLastPickedObsValue(null);
        }

        if (generatedEnv.pickedClusteringPct !== null) {
            // Range mode: show the value picked from the range
            setLastPickedClustValue(generatedEnv.pickedClusteringPct);
        } else if (seedWasRandomlyGenerated && clusteringProbVal === undefined) {
            // Auto mode with random seed: show the actual achieved ratio
            setLastPickedClustValue(generatedEnv.usedClusteringPct);
        } else {
            setLastPickedClustValue(null);
        }

        addObject(OBJECT_CATEGORY.ZONE, generatedEnv.boundary, generatedObjectType);
        for (const obs of generatedEnv.obstacles) {
            addObject(OBJECT_CATEGORY.OBSTACLE, obs, generatedObjectType);
        }
        await upsertPoint(envId, "start_end", generatedEnv.startEndPoint);
        return true;
    }

    async function handleGenerateAndRun() {
        const generated = await handleGenerate();
        if (!generated) return;
        executeComputeRequest().then((result) => {
            if (!result.ok) {
                console.error("[GenerateAndRun] compute error:", result.error);
            }
        });
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
                label="Obstacle ratio (%)"
                value={obstacleRatio}
                onChange={(v) => {
                    setObstacleRatio(v);
                    setLastPickedObsValue(null);
                }}
                onFocus={() => setHasObsLeftField(false)}
                onBlur={() => setHasObsLeftField(true)}
                min={0}
                max={100}
                placeholder={obsPlaceholder}
                pickedValue={obsIsAuto ? null : lastPickedObsValue}
                error={obstacleRatioError}
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
                    {systemParamsError} Current values: Format = {ENV_FORMAT_OPTIONS.find((opt) => opt.value === env.format)?.label ?? env.format}, Coordinate System = {COORD_SYSTEM_OPTIONS.find((opt) => opt.value === env.coordSystem)?.label ?? env.coordSystem}.
                </div>
            )}
            <FloatingControlButton
                label="Clear Environment"
                onClick={handleClearEnvironment}
            />
            <FloatingControlButton
                label="Generate"
                onClick={handleGenerate}
                disabled={!canGenerate || !isSystemParamsCompatible}
            />
            <FloatingControlMainButton
                label="Generate and Run"
                onClick={handleGenerateAndRun}
                disabled={isComputeBusy || !canGenerate || !isSystemParamsCompatible}
            />
        </FloatingControl>
    );
}

export default memo(CanvasGeneratorFloatingControl);
