import MenuBarItem from "@/components/menu-bar/MenuBarItem";
import { useMapStore } from "@/model/mapStore";
import { useCanvasObjectStore } from "@/features/canvas-editing/stores/canvasObjectStore";
import { buildExportXml } from "@/features/map-manager/utils/exportMapXml";
import { useMapPointStore } from "@/model/mapPointStore";
import { useGeoAnchorStore } from "@/model/geoAnchorStore";

export default function MapExportButton() {
  const map = useMapStore((s) => s.map);
  const objects = useCanvasObjectStore((s) => s.objects);
  const startPoint = useMapPointStore((s) => s.startPoint);
  const endPoint = useMapPointStore((s) => s.endPoint);
  const startEndPoint = useMapPointStore((s) => s.startEndPoint);
  const mapGeoAnchor = useGeoAnchorStore((s) => s.mapGeoAnchor);

  const handleClick = async () => {
    const mapPoints = [startPoint, endPoint, startEndPoint].filter((point): point is NonNullable<typeof point> => point !== null);
    const xml = buildExportXml(map, objects, mapPoints, mapGeoAnchor ?? undefined);

    let fileHandle: FileSystemFileHandle;
    try {
      fileHandle = await window.showSaveFilePicker({
        suggestedName: `${map.name}.xml`,
        types: [
          {
            description: "XML file",
            accept: { "application/xml": [".xml"] },
          },
        ],
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      console.error("[MapExportButton] showSaveFilePicker failed:", err);
      return;
    }

    try {
      const writable = await fileHandle.createWritable();
      await writable.write(xml);
      await writable.close();
    } catch (err) {
      console.error("[MapExportButton] File write failed:", err);
    }
  };

  return <MenuBarItem label="Export..." onClick={handleClick} />;
}
