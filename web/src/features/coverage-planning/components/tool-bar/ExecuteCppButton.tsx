import ToolBarButton from "@/components/tool-bar/ToolBarButton";
import { executeComputeRequest } from "@/features/coverage-planning/data/computeService";
import { useComputeResultStore } from "@/model/useComputeResultStore";

export default function ExecuteCppButton() {
  const status = useComputeResultStore((s) => s.status);
  const isBusy = status === "submitting" || status === "polling";

  function handleClick() {
    executeComputeRequest().then((result) => {
      if (!result.ok) {
        console.error("[ExecuteCpp] error:", result.error);
      }
    });
  }

  return (
    <ToolBarButton
      title="Execute coverage path planning"
      icon="motion_play"
      isDisabled={isBusy}
      onClick={handleClick}
    />
  );
}
