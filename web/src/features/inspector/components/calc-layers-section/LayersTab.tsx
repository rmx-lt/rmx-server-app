import { useLayerSettingsStore } from "@/model/layerSettingsStore";
import { useEnvStore } from "@/model/envStore";
import { LAYER_ID, LAYER_PARAM_KEY } from "@/config/layers/layerRegistry";
import LayerRow from "@/features/inspector/components/calc-layers-section/LayerRow";
import type { LayerPK } from "@/data/local/layerTypes";

function toLayerPK(layer: { id: number; algorithmId: number; providerId: number }): LayerPK {
    return { id: layer.id, algorithmId: layer.algorithmId, providerId: layer.providerId };
}

export default function LayersTab() {
    const layers = useLayerSettingsStore((s) => s.layers);
    const setVisible = useLayerSettingsStore((s) => s.setVisible);
    const setParam = useLayerSettingsStore((s) => s.setParam);
    const reorderLayers = useLayerSettingsStore((s) => s.reorderLayers);
    const headlandEnabled = useEnvStore((s) => s.env.headlandEnabled);

    if (layers.length === 0) {
        return (
            <div className="px-4 py-3 text-xs text-gray-400">
                No layers found. Clear IndexedDB to reload defaults.
            </div>
        );
    }

    // The headland layers are hidden while the headland is switched off.
    const visible = layers.filter(
        (item) =>
            headlandEnabled ||
            (item.layer.id !== LAYER_ID.SHRUNKEN_ZONES && item.layer.id !== LAYER_ID.EXPANDED_OBSTACLES),
    );

    // ── Sort all layers by Z-Index descending ────────────────────────────────
    const sorted = [...visible].sort((a, b) => {
        const az = parseInt(a.settings.find((p) => p.key === LAYER_PARAM_KEY.Z_INDEX)?.value ?? "0", 10);
        const bz = parseInt(b.settings.find((p) => p.key === LAYER_PARAM_KEY.Z_INDEX)?.value ?? "0", 10);
        return bz - az;
    });

    // ── Move handlers ─────────────────────────────────────────────────────────
    function handleMoveUp(movableIndex: number) {
        if (movableIndex <= 0) return;
        const next = [...sorted];
        [next[movableIndex - 1], next[movableIndex]] = [next[movableIndex]!, next[movableIndex - 1]!];
        reorderLayers(next.map((l) => toLayerPK(l.layer)));
    }

    function handleMoveDown(movableIndex: number) {
        if (movableIndex >= sorted.length - 1) return;
        const next = [...sorted];
        [next[movableIndex], next[movableIndex + 1]] = [next[movableIndex + 1]!, next[movableIndex]!];
        reorderLayers(next.map((l) => toLayerPK(l.layer)));
    }

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="flex flex-col divide-y divide-gray-200">
            {sorted.map((item) => {
                const movableIdx = sorted.indexOf(item);
                const isFirst = movableIdx === 0;
                const isLast = movableIdx === sorted.length - 1;

                return (
                    <LayerRow
                        key={`${item.layer.id}-${item.layer.algorithmId}-${item.layer.providerId}`}
                        layer={item.layer}
                        settings={item.settings}
                        isFirst={isFirst}
                        isLast={isLast}
                        onMoveUp={() => handleMoveUp(movableIdx)}
                        onMoveDown={() => handleMoveDown(movableIdx)}
                        onVisibilityChange={(visible) => setVisible(toLayerPK(item.layer), visible)}
                        onParamChange={(name, value) => setParam(item.layer.id, name, value)}
                    />
                );
            })}
        </div>
    );
}
