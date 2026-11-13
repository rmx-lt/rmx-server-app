import { useState } from "react";
import {
    COORD_SYSTEM_OPTIONS,
    ENV_FORMAT_OPTIONS,
    ENV_TYPE_OPTIONS,
} from "@/config/db-ops/enums";
import InternalCardModalFastTab from "@/components/modals/card-modal/internal/InternalCardModalFastTab";
import CardModalField from "@/components/modals/card-modal/CardModalField";
import {
    type BenchmarkEnvironmentSetSetup,
    type BenchmarkEnvironmentSetup,
    type BenchmarkGeneratedEnvironment,
    type BenchmarkSystemEnvironmentSetup,
} from "@/features/benchmark-manager/stores/benchmarkModalStore";
import EnvPreviewGroup, { type EnvPreviewItem } from "@/components/env-preview/EnvPreviewGroup";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface BenchmarkEnvSetupTabProps {
    environmentSetup: BenchmarkEnvironmentSetup;
    onSetEnvironmentSetup: (setup: Partial<BenchmarkEnvironmentSetup>) => void;
    environmentSetSetup: BenchmarkEnvironmentSetSetup;
    onSetEnvironmentSetSetup: (setup: Partial<BenchmarkEnvironmentSetSetup>) => void;
    systemEnvironmentSetup: BenchmarkSystemEnvironmentSetup;
    onSetSystemEnvironmentSetup: (setup: Partial<BenchmarkSystemEnvironmentSetup>) => void;
    generatedEnvironments: BenchmarkGeneratedEnvironment[];
    generatedBaseSeed: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function BenchmarkEnvSetupTab({
    environmentSetup,
    onSetEnvironmentSetup,
    environmentSetSetup,
    onSetEnvironmentSetSetup,
    systemEnvironmentSetup,
    onSetSystemEnvironmentSetup,
    generatedEnvironments,
    generatedBaseSeed,
}: BenchmarkEnvSetupTabProps) {
    const [systemExpanded, setSystemExpanded] = useState(true);
    const [generatorExpanded, setGeneratorExpanded] = useState(true);
    const [setExpanded, setSetExpanded] = useState(true);
    const [previewExpanded, setPreviewExpanded] = useState(true);

    return (
        <div className="p-4 flex flex-col gap-4">
            {/* Set */}
            <InternalCardModalFastTab
                title="Set"
                expanded={setExpanded}
                onToggle={() => setSetExpanded((x) => !x)}
            >
                <CardModalField
                    id="env-set-count"
                    label="Env. Count"
                    type="number"
                    value={String(environmentSetSetup.count)}
                    onChange={(v) => onSetEnvironmentSetSetup({ count: Math.max(1, Number(v)) })}
                />
                <CardModalField
                    id="env-set-base-seed"
                    label="Base Seed"
                    type="text"
                    value={environmentSetSetup.baseSeed}
                    placeholder={!environmentSetSetup.baseSeed && generatedBaseSeed ? generatedBaseSeed : undefined}
                    onChange={(v) => onSetEnvironmentSetSetup({ baseSeed: v })}
                />
            </InternalCardModalFastTab>

            {/* System Environment */}
            <InternalCardModalFastTab
                title="Environment"
                expanded={systemExpanded}
                onToggle={() => setSystemExpanded((x) => !x)}
            >
                <CardModalField
                    id="gen-format"
                    label="Format"
                    type="select"
                    value={systemEnvironmentSetup.format}
                    options={ENV_FORMAT_OPTIONS}
                    onChange={(v) => onSetSystemEnvironmentSetup({ format: v })}
                />
                <CardModalField
                    id="gen-type"
                    label="Type"
                    type="select"
                    value={systemEnvironmentSetup.type}
                    options={ENV_TYPE_OPTIONS}
                    onChange={(v) => onSetSystemEnvironmentSetup({ type: v })}
                />
                <CardModalField
                    id="gen-coord-system"
                    label="Coordinate System"
                    type="select"
                    value={systemEnvironmentSetup.coordinateSystem}
                    options={COORD_SYSTEM_OPTIONS}
                    onChange={(v) => onSetSystemEnvironmentSetup({ coordinateSystem: v })}
                />
                <CardModalField
                    id="gen-headland"
                    label="Headland"
                    type="checkbox"
                    checked={systemEnvironmentSetup.headland}
                    onChange={(v) => onSetSystemEnvironmentSetup({ headland: Boolean(v) })}
                />
                <CardModalField
                    id="gen-headland-width"
                    label="Headland Width"
                    unitType="uom"
                    type="number"
                    disabled={!systemEnvironmentSetup.headland}
                    value={systemEnvironmentSetup.headlandWidth}
                    onChange={(v) => onSetSystemEnvironmentSetup({ headlandWidth: v })}
                />
            </InternalCardModalFastTab>

            {/* Generator */}
            <InternalCardModalFastTab
                title="Generator"
                expanded={generatorExpanded}
                onToggle={() => setGeneratorExpanded((x) => !x)}
            >
                <CardModalField
                    id="gen-width"
                    label="Width"
                    unitType="uom"
                    type="number"
                    value={String(environmentSetup.width)}
                    onChange={(v) => onSetEnvironmentSetup({ width: Number(v) })}
                />
                <CardModalField
                    id="gen-height"
                    label="Height"
                    unitType="uom"
                    type="number"
                    value={String(environmentSetup.height)}
                    onChange={(v) => onSetEnvironmentSetup({ height: Number(v) })}
                />
                <CardModalField
                    id="gen-cell-size"
                    label="Cell Size"
                    unitType="uom"
                    type="number"
                    value={String(environmentSetup.cellSize)}
                    onChange={(v) => onSetEnvironmentSetup({ cellSize: Number(v) })}
                />
                <CardModalField
                    id="gen-coverage-cell-size"
                    label="Coverage Cell Size"
                    unitType="uom"
                    type="number"
                    value={String(environmentSetup.coverageGridCellSize)}
                    onChange={(v) => onSetEnvironmentSetup({ coverageGridCellSize: Number(v) })}
                />
                <CardModalField
                    id="gen-obstacle-ratio"
                    label="Obstacle Ratio"
                    unit="%"
                    type="number"
                    value={String(environmentSetup.obstacleRatio)}
                    onChange={(v) => onSetEnvironmentSetup({ obstacleRatio: Number(v) })}
                />
                <CardModalField
                    id="gen-clustering-prob"
                    label="Clustering Prob"
                    unit="%"
                    type="number"
                    value={String(environmentSetup.clusteringProb)}
                    onChange={(v) => onSetEnvironmentSetup({ clusteringProb: Number(v) })}
                />
            </InternalCardModalFastTab>

            {/* Preview */}
            <InternalCardModalFastTab
                title="Preview"
                expanded={previewExpanded}
                onToggle={() => setPreviewExpanded((x) => !x)}
            >
                <CardModalField
                    id="preview-generated-count"
                    label="Generated Env. Count"
                    type="text"
                    value={String(generatedEnvironments.length)}
                    disabled
                />
                <div className="px-3 pt-1 pb-3 flex justify-center">
                    <EnvPreviewGroup
                        environments={generatedEnvironments.map((env): EnvPreviewItem => ({
                            id: env.index,
                            boundary: env.boundary,
                            obstacles: env.obstacles,
                            seedHex: env.usedSeedHex,
                        }))}
                    />
                </div>
            </InternalCardModalFastTab>
        </div>
    );
}
