import { useState } from "react";
import CardModal, { type CardModalFastTabConfig } from "@/components/modals/card-modal/CardModal";
import { useGeoAnchorStore } from "@/model/geoAnchorStore";
import { useMapStore } from "@/model/mapStore";
import { useGeoAnchorModalStore } from "@/features/geo-anchor/stores/geoAnchorModalStore";

function validateLat(v: string): string | undefined {
    const n = Number.parseFloat(v);
    if (Number.isNaN(n)) return;
    if (n < -90 || n > 90) return "Range: -90 to 90";
}

function validateLon(v: string): string | undefined {
    const n = Number.parseFloat(v);
    if (Number.isNaN(n)) return;
    if (n < -180 || n > 180) return "Range: -180 to 180";
}

function GeoAnchorSystemModal({
    isOpen,
    onClose,
}: {
    isOpen: boolean;
    onClose: () => void;
}) {
    const systemDraft = useGeoAnchorStore((s) => s.systemDraft);
    const setSystemGeoAnchor = useGeoAnchorStore((s) => s.setSystemGeoAnchor);
    const setSystemGeoAnchorDraft = useGeoAnchorStore((s) => s.setSystemGeoAnchorDraft);

    const [systemExpanded, setSystemExpanded] = useState(true);
    const [isEditMode, setIsEditMode] = useState(false);

    // Closing resets edit mode (adjusted during render, not in an effect).
    const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
    if (isOpen !== prevIsOpen) {
        setPrevIsOpen(isOpen);
        if (!isOpen) {
            setIsEditMode(false);
        }
    }

    const systemLatError = validateLat(systemDraft.lat);
    const systemLonError = validateLon(systemDraft.lon);
    async function handleDelete() {
        await setSystemGeoAnchor(null);
        setIsEditMode(false);
    }

    const fastTabs: CardModalFastTabConfig[] = [
        {
            id: "system",
            title: "Settings",
            expanded: systemExpanded,
            onToggle: () => setSystemExpanded((v) => !v),
            disabled: !isEditMode,
            fields: [
                {
                    id: "system-lat",
                    label: "Latitude",
                    value: systemDraft.lat,
                    disabled: !isEditMode,
                    hint: systemLatError,
                    hintState: systemLatError ? "error" : undefined,
                    onChange: (v) => void setSystemGeoAnchorDraft({ ...systemDraft, lat: v }),
                },
                {
                    id: "system-lon",
                    label: "Longitude",
                    value: systemDraft.lon,
                    disabled: !isEditMode,
                    hint: systemLonError,
                    hintState: systemLonError ? "error" : undefined,
                    onChange: (v) => void setSystemGeoAnchorDraft({ ...systemDraft, lon: v }),
                },
            ],
        },
    ];

    return (
        <CardModal
            isOpen={isOpen}
            title="Geo Setup"
            shortcutToken="geoSetupModal"
            onClose={onClose}
            widthClassName="w-160"
            header={{
                recordId: null,
                recordName: "System",
                isEditMode,
                onEdit: () => setIsEditMode((v) => !v),
                onNew: () => { },
                onDelete: () => void handleDelete(),
                canEdit: true,
                canNew: false,
                canDelete: true,
            }}
            fastTabs={fastTabs}
        />
    );
}

export default function GeoAnchorModal() {
    const { isOpen, close } = useGeoAnchorModalStore();
    const map = useMapStore((s) => s.map);

    const mapDraft = useGeoAnchorStore((s) => s.mapDraft);
    const setMapGeoAnchor = useGeoAnchorStore((s) => s.setMapGeoAnchor);
    const setMapGeoAnchorDraft = useGeoAnchorStore((s) => s.setMapGeoAnchorDraft);

    const [mapExpanded, setMapExpanded] = useState(true);
    const [isSystemModalOpen, setSystemModalOpen] = useState(false);
    const [isEditMode, setIsEditMode] = useState(false);

    // Closing closes the system modal and resets edit mode
    // (adjusted during render, not in an effect).
    const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
    if (isOpen !== prevIsOpen) {
        setPrevIsOpen(isOpen);
        if (!isOpen) {
            setSystemModalOpen(false);
            setIsEditMode(false);
        }
    }

    const mapLatError = validateLat(mapDraft.lat);
    const mapLonError = validateLon(mapDraft.lon);

    async function handleDelete() {
        if (map.id <= 0) return;
        await setMapGeoAnchor(map.id, null);
        setIsEditMode(false);
    }

    const fastTabs: CardModalFastTabConfig[] = [
        {
            id: "map",
            title: "Settings",
            expanded: mapExpanded,
            onToggle: () => setMapExpanded((v) => !v),
            disabled: !isEditMode,
            fields: [
                {
                    id: "map-lat",
                    label: "Latitude",
                    value: mapDraft.lat,
                    disabled: !isEditMode,
                    hint: mapLatError,
                    hintState: mapLatError ? "error" : undefined,
                    onChange: (v) => void setMapGeoAnchorDraft(map.id, { ...mapDraft, lat: v }),
                },
                {
                    id: "map-lon",
                    label: "Longitude",
                    value: mapDraft.lon,
                    disabled: !isEditMode,
                    hint: mapLonError,
                    hintState: mapLonError ? "error" : undefined,
                    onChange: (v) => void setMapGeoAnchorDraft(map.id, { ...mapDraft, lon: v }),
                },
            ],
        },
    ];

    return (
        <>
            <CardModal
                isOpen={isOpen}
                title="Geo Anchor"
                shortcutToken="geoAnchorModal"
                onClose={close}
                widthClassName="w-160"
                header={{
                    recordId: null,
                    recordName: map.name,
                    isEditMode,
                    onEdit: () => setIsEditMode((v) => !v),
                    onNew: () => { },
                    onDelete: () => void handleDelete(),
                    canEdit: true,
                    canNew: false,
                    canDelete: true,
                }}
                actionBarActions={[
                    {
                        id: "open-geo-setup",
                        icon: "settings",
                        label: "Open Geo Setup",
                        onClick: () => setSystemModalOpen(true),
                        showStatusSection: false,
                    },
                ]}
                fastTabs={fastTabs}
            />

            <GeoAnchorSystemModal
                isOpen={isSystemModalOpen}
                onClose={() => setSystemModalOpen(false)}
            />
        </>
    );
}
