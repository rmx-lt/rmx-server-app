import ToolBarButton from "@/components/tool-bar/ToolBarButton";
import { useComputeResultStore } from "@/model/useComputeResultStore";

export default function ClearCppButton() {
  const result = useComputeResultStore((s) => s.result);
  const status = useComputeResultStore((s) => s.status);

  const isDisabled = result === null || status === "submitting" || status === "polling";

  function handleClick() {
    useComputeResultStore.getState().clearResult();
  }

  return (
    <ToolBarButton
      title="Clear coverage path planning output"
      icon="ink_eraser"
      isDisabled={isDisabled}
      onClick={handleClick}
    />
  );
}
