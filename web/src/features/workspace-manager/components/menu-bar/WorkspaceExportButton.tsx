import MenuBarItem from "@/components/menu-bar/MenuBarItem";
import { useEnvStore } from "@/model/envStore";
import { useCanvasObjectStore } from "@/features/canvas-editing/stores/canvasObjectStore";
import { buildExportXml } from "@/features/workspace-manager/utils/exportWorkspace";
import { useEnvPointStore } from "@/model/envPointStore";
import { useGeoAnchorStore } from "@/model/geoAnchorStore";

export default function WorkspaceExportButton() {
  const env = useEnvStore((s) => s.env);
  const objects = useCanvasObjectStore((s) => s.objects);
  const startPoint = useEnvPointStore((s) => s.startPoint);
  const endPoint = useEnvPointStore((s) => s.endPoint);
  const startEndPoint = useEnvPointStore((s) => s.startEndPoint);
  const environmentGeoAnchor = useGeoAnchorStore((s) => s.environmentGeoAnchor);

  const handleClick = async () => {
    const envPoints = [startPoint, endPoint, startEndPoint].filter((point): point is NonNullable<typeof point> => point !== null);
    const xml = buildExportXml(env, objects, envPoints, environmentGeoAnchor ?? undefined);

    let fileHandle: FileSystemFileHandle;
    try {
      fileHandle = await window.showSaveFilePicker({
        suggestedName: `${env.name}.xml`,
        types: [
          {
            description: "XML file",
            accept: { "application/xml": [".xml"] },
          },
        ],
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      console.error("[WorkspaceExportButton] showSaveFilePicker failed:", err);
      return;
    }

    try {
      const writable = await fileHandle.createWritable();
      await writable.write(xml);
      await writable.close();
    } catch (err) {
      console.error("[WorkspaceExportButton] File write failed:", err);
    }
  };

  return <MenuBarItem label="Export..." onClick={handleClick} />;
}
