import { useState } from "react";
import Button from "@/components/ui/Button";
import SettingsPanelSeparator from "@/components/settings-panel/SettingsPanelSeparator";
import SettingsPanelRow from "@/components/settings-panel/SettingsPanelRow";
import { logout } from "@/features/auth/data/session";
import { useAuthStore } from "@/features/auth/stores/authStore";

export default function AccountPage() {
    const username = useAuthStore((s) => s.username);
    const [busy, setBusy] = useState(false);

    function run(everywhere: boolean) {
        setBusy(true);
        void logout(everywhere).finally(() => setBusy(false));
    }

    return (
        <>
            <SettingsPanelSeparator label="Account" />
            <SettingsPanelRow label="User name">
                <span className="min-w-0 flex-1 truncate text-sm text-muted">{username}</span>
            </SettingsPanelRow>
            <SettingsPanelSeparator label="Sessions" />
            <SettingsPanelRow label="This browser">
                <Button disabled={busy} onClick={() => run(false)}>
                    Log out
                </Button>
            </SettingsPanelRow>
            <SettingsPanelRow label="Every device" tooltip="Ends every session of this user, on all devices">
                <Button disabled={busy} onClick={() => run(true)}>
                    Log out everywhere
                </Button>
            </SettingsPanelRow>
        </>
    );
}
