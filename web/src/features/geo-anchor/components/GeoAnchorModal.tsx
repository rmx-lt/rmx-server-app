import { useEffect, useState } from "react";
import CardModal, { type CardModalFastTabConfig, type CardModalSavedState } from "@/components/modals/card-modal/CardModal";
import { useGeoAnchorStore } from "@/model/geoAnchorStore";
import { useEnvStore } from "@/model/envStore";
import { useGeoAnchorModalStore } from "@/features/geo-anchor/stores/geoAnchorModalStore";
import { useSaveStatusStore } from "@/model/saveStatusStore";

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

function toCardSavedState(status: "nothing_to_save" | "unsaved" | "saved", isSaving: boolean): CardModalSavedState {
    if (isSaving) return "saving";
    return status;
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
    const saveStatus = useSaveStatusStore((s) => s.status);
    const saveAll = useSaveStatusStore((s) => s.save);

    const [systemExpanded, setSystemExpanded] = useState(true);
    const [isEditMode, setIsEditMode] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (!isOpen) setIsEditMode(false);
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) setIsSaving(false);
    }, [isOpen]);

    const systemLatError = validateLat(systemDraft.lat);
    const systemLonError = validateLon(systemDraft.lon);
    const savedState = toCardSavedState(saveStatus, isSaving);
    const canSave = saveStatus === "unsaved";

    async function handleSave() {
        if (!canSave) return;
        setIsSaving(true);
        try {
            await saveAll();
        } finally {
            setIsSaving(false);
        }
    }

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
                    onConfirm: () => void handleSave(),
                },
                {
                    id: "system-lon",
                    label: "Longitude",
                    value: systemDraft.lon,
                    disabled: !isEditMode,
                    hint: systemLonError,
                    hintState: systemLonError ? "error" : undefined,
                    onChange: (v) => void setSystemGeoAnchorDraft({ ...systemDraft, lon: v }),
                    onConfirm: () => void handleSave(),
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
                savedState,
                onSave: () => void handleSave(),
                canSave,
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
    const env = useEnvStore((s) => s.env);

    const envDraft = useGeoAnchorStore((s) => s.environmentDraft);
    const setEnvironmentGeoAnchor = useGeoAnchorStore((s) => s.setEnvironmentGeoAnchor);
    const setEnvironmentGeoAnchorDraft = useGeoAnchorStore((s) => s.setEnvironmentGeoAnchorDraft);
    const saveStatus = useSaveStatusStore((s) => s.status);
    const saveAll = useSaveStatusStore((s) => s.save);

    const [envExpanded, setEnvExpanded] = useState(true);
    const [isSystemModalOpen, setSystemModalOpen] = useState(false);
    const [isEditMode, setIsEditMode] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (!isOpen) setSystemModalOpen(false);
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) setIsEditMode(false);
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) setIsSaving(false);
    }, [isOpen]);

    const envLatError = validateLat(envDraft.lat);
    const envLonError = validateLon(envDraft.lon);

    const savedState = toCardSavedState(saveStatus, isSaving);
    const canSave = saveStatus === "unsaved";

    async function handleSave() {
        if (!canSave) return;
        setIsSaving(true);
        try {
            await saveAll();
        } finally {
            setIsSaving(false);
        }
    }

    async function handleDelete() {
        if (env.id <= 0) return;
        await setEnvironmentGeoAnchor(env.id, null);
        setIsEditMode(false);
    }

    const fastTabs: CardModalFastTabConfig[] = [
        {
            id: "environment",
            title: "Settings",
            expanded: envExpanded,
            onToggle: () => setEnvExpanded((v) => !v),
            disabled: !isEditMode,
            fields: [
                {
                    id: "env-lat",
                    label: "Latitude",
                    value: envDraft.lat,
                    disabled: !isEditMode,
                    hint: envLatError,
                    hintState: envLatError ? "error" : undefined,
                    onChange: (v) => void setEnvironmentGeoAnchorDraft(env.id, { ...envDraft, lat: v }),
                    onConfirm: () => void handleSave(),
                },
                {
                    id: "env-lon",
                    label: "Longitude",
                    value: envDraft.lon,
                    disabled: !isEditMode,
                    hint: envLonError,
                    hintState: envLonError ? "error" : undefined,
                    onChange: (v) => void setEnvironmentGeoAnchorDraft(env.id, { ...envDraft, lon: v }),
                    onConfirm: () => void handleSave(),
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
                    recordName: env.name,
                    savedState,
                    onSave: () => void handleSave(),
                    canSave,
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
