import { useEffect, useRef, useState } from "react";

/**
 * Measures visible menu items against the available container width and returns
 * the number of items that fit.  The remaining items should be placed inside a
 * "More" overflow dropdown.
 *
 * @param itemCount        Total number of primary menu items (excluding the More button).
 * @param moreButtonWidth  Width (px) reserved for the More button when it is shown.
 */
export function useMenuBarOverflow(itemCount: number, moreButtonWidth = 60) {
    const containerRef = useRef<HTMLDivElement>(null);
    const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
    const [visibleCount, setVisibleCount] = useState(itemCount);

    useEffect(() => {
        itemRefs.current = itemRefs.current.slice(0, itemCount);
    }, [itemCount]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        function compute() {
            const available = container!.clientWidth;
            const widths = itemRefs.current.map((el) =>
                el ? el.getBoundingClientRect().width : 0,
            );
            const totalWidth = widths.reduce((s, w) => s + w, 0);

            // All items fit — show everything, no More button needed.
            if (totalWidth <= available) {
                setVisibleCount(itemCount);
                return;
            }

            // Greedy: accumulate items while there is still room for both the item
            // and the More button that will appear at the end.
            let used = 0;
            let count = 0;
            for (let i = 0; i < itemCount; i++) {
                const w = widths[i] ?? 0;
                if (used + w + moreButtonWidth <= available) {
                    used += w;
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
    }, [itemCount, moreButtonWidth]);

    return { containerRef, itemRefs, visibleCount };
}
