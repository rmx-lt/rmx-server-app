import MenuBarItem from "@/components/menu-bar/MenuBarItem";
import { useSaveModalStore } from "@/features/workspace-manager/stores/saveModalStore";
import { parseImportXml, isImportError } from "@/features/workspace-manager/utils/importWorkspace";
import { useImportModalStore } from "@/features/workspace-manager/stores/importModalStore";
import { useConfirmationModalStore } from "@/components/modals/confirmation-modal/confirmationModalStore";

export default function WorkspaceImportButton() {
  function handleClick() {
    useSaveModalStore.getState().requestWithSaveGuard(async () => {
      let fileHandle: FileSystemFileHandle;
      try {
        const [handle] = await window.showOpenFilePicker({
          multiple: false,
          types: [
            {
              description: "XML file",
              accept: { "application/xml": [".xml"] },
            },
          ],
        });
        if (!handle) return;
        fileHandle = handle;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("[WorkspaceImportButton] showOpenFilePicker failed:", err);
        return;
      }

      let xml: string;
      try {
        const file = await fileHandle.getFile();
        xml = await file.text();
      } catch (err) {
        console.error("[WorkspaceImportButton] File read failed:", err);
        return;
      }

      const result = parseImportXml(xml);

      if (isImportError(result)) {
        useConfirmationModalStore.getState().requestConfirmation({
          title: "Import Failed",
          message: result.error,
          tone: "danger",
          confirmLabel: "OK",
          cancelLabel: "Close",
        });
        return;
      }

      useImportModalStore.getState().open(result);
    });
  }

  return <MenuBarItem label="Import..." onClick={handleClick} />;
}
