import { CircleDot, CirclePause, CirclePlay, Gamepad2, LocateFixed, OctagonX, Play, Route, Rewind, Save, Scissors, SlidersHorizontal, Spline } from "lucide-react";
import { ToolStrip, ToolStripButton, ToolStripSeparator } from "@/components/tool-strip/ToolStrip";
import PlanTools from "@/features/canvas-editing/components/tool-strip/PlanTools";
import { useModeStore } from "@/model/modeStore";

// Drive and Mow are the shell only: every tool below is inert and says what it will do.
// The behaviour comes with rmx-server-app#94 and #105 (drive) and #106 (mow).

function DriveTools() {
    return (
        <>
            <ToolStripButton inert label="Driving control" note="drives the mower by hand" icon={Gamepad2} />
            <ToolStripButton inert label="Mower mode" note="sets the mower's mode" icon={SlidersHorizontal} />
            <ToolStripButton inert label="Blade" note="turns the blade on and off" icon={Scissors} />
            <ToolStripButton inert label="Stop" note="stops the mower at once" icon={OctagonX} />
            <ToolStripSeparator />
            <ToolStripButton inert label="Record border" note="records a border while you drive" icon={CircleDot} />
            <ToolStripButton inert label="Rewind" note="steps back along the recorded border" icon={Rewind} />
            <ToolStripButton inert label="Save as area" note="turns the recorded border into an area" icon={Save} />
        </>
    );
}

function MowTools() {
    return (
        <>
            <ToolStripButton inert label="Plan job" note="plans a mowing job for the areas" icon={Route} />
            <ToolStripButton inert label="Start" note="starts the job" icon={Play} />
            <ToolStripButton inert label="Pause" note="pauses the job" icon={CirclePause} />
            <ToolStripButton inert label="Resume" note="resumes the paused job" icon={CirclePlay} />
            <ToolStripSeparator />
            <ToolStripButton inert label="Go to point" note="sends the mower to a point on the map" icon={LocateFixed} />
            <ToolStripButton inert label="Follow path" note="makes the mower follow a drawn path" icon={Spline} />
        </>
    );
}

/** The tool strip of the current mode. */
export default function CanvasTools() {
    const mode = useModeStore((s) => s.mode);
    return (
        <ToolStrip label={`${mode === "plan" ? "Plan" : mode === "drive" ? "Drive" : "Mow"} tools`}>
            {mode === "plan" ? <PlanTools /> : mode === "drive" ? <DriveTools /> : <MowTools />}
        </ToolStrip>
    );
}
