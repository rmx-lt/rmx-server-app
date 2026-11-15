import { CircleDot, CirclePause, CirclePlay, Gamepad2, LocateFixed, OctagonX, Play, Route, Rewind, Save, Scissors, SlidersHorizontal, Spline } from "lucide-react";
import { ToolStrip, ToolStripButton, ToolStripSeparator } from "@/components/tool-strip/ToolStrip";
import PlanTools from "@/features/canvas-editing/components/tool-strip/PlanTools";
import { useModeStore } from "@/model/modeStore";

// Drive and Mow are the shell only: every tool below is inert and says what it will do.
// The behaviour comes with rmx-server-app#94 and #105 (drive) and #106 (mow).

function DriveTools() {
    return (
        <>
            <ToolStripButton inert label="Driving control" hint="drives the mower by hand" icon={Gamepad2} />
            <ToolStripButton inert label="Mower mode" hint="sets the mower's mode" icon={SlidersHorizontal} />
            <ToolStripButton inert label="Blade" hint="turns the blade on and off" icon={Scissors} />
            <ToolStripButton inert label="Stop" hint="stops the mower at once" icon={OctagonX} />
            <ToolStripSeparator />
            <ToolStripButton inert label="Record border" hint="records a border while you drive" icon={CircleDot} />
            <ToolStripButton inert label="Rewind" hint="steps back along the recorded border" icon={Rewind} />
            <ToolStripButton inert label="Save as zone" hint="turns the recorded border into a zone" icon={Save} />
        </>
    );
}

function MowTools() {
    return (
        <>
            <ToolStripButton inert label="Plan job" hint="plans a mowing job for the zones" icon={Route} />
            <ToolStripButton inert label="Start" hint="starts the job" icon={Play} />
            <ToolStripButton inert label="Pause" hint="pauses the job" icon={CirclePause} />
            <ToolStripButton inert label="Resume" hint="resumes the paused job" icon={CirclePlay} />
            <ToolStripSeparator />
            <ToolStripButton inert label="Go to point" hint="sends the mower to a point on the map" icon={LocateFixed} />
            <ToolStripButton inert label="Follow path" hint="makes the mower follow a drawn path" icon={Spline} />
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
