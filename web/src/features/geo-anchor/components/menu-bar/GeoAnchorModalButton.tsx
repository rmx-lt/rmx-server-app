import MenuBarItem from "@/components/menu-bar/MenuBarItem";
import { useGeoAnchorModalStore } from "@/features/geo-anchor/stores/geoAnchorModalStore";

export default function GeoAnchorModalButton() {
    const open = useGeoAnchorModalStore((s) => s.open);

    return (
        <MenuBarItem
            label="Geo Anchor..."
            onClick={open}
        />
    );
}
