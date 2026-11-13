import { useEffect, useRef, useState } from "react";

const GAP = 8; // gap-2 = 0.5rem = 8px

/**
 * Measures each toolbar group's natural width against the available container
 * width and returns how many groups fit.  The remaining groups should be placed
 * inside a "More" overflow dropdown.
 *
 * @param groupCount      Total number of groups (excluding the More button).
 * @param moreButtonWidth Width (px) reserved for the More button when shown.
 */
export function useToolBarOverflow(groupCount: number, moreButtonWidth = 40) {
    const containerRef = useRef<HTMLDivElement>(null);
    const ghostRef = useRef<HTMLDivElement>(null);
    const groupRefs = useRef<(HTMLDivElement | null)[]>([]);
    const [visibleCount, setVisibleCount] = useState(groupCount);

    useEffect(() => {
        groupRefs.current = groupRefs.current.slice(0, groupCount);
    }, [groupCount]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        function compute() {
            const available = container!.clientWidth;
            const widths = groupRefs.current.map((el) =>
                el ? el.getBoundingClientRect().width : 0,
            );

            // All groups fit — no More button needed.
            const totalGaps = groupCount > 1 ? (groupCount - 1) * GAP : 0;
            const totalWidth = widths.reduce((s, w) => s + w, 0) + totalGaps;
            if (totalWidth <= available) {
                setVisibleCount(groupCount);
                return;
            }

            // Greedy: accumulate groups while there is room for the group AND
            // the More button that will appear at the end.
            let used = 0;
            let count = 0;
            for (let i = 0; i < groupCount; i++) {
                const w = widths[i] ?? 0;
                const gapBefore = count > 0 ? GAP : 0;
                const isLastGroup = i === groupCount - 1;
                // Only reserve More-button space when this isn't the final group.
                const moreSpace = isLastGroup ? 0 : GAP + moreButtonWidth;
                if (used + gapBefore + w + moreSpace <= available) {
                    used += gapBefore + w;
                    count++;
                } else {
                    break;
                }
            }
            setVisibleCount(count);
        }

        const observer = new ResizeObserver(compute);
        observer.observe(container);
        compute();

        return () => observer.disconnect();
    }, [groupCount, moreButtonWidth]);

    return { containerRef, ghostRef, groupRefs, visibleCount };
}
