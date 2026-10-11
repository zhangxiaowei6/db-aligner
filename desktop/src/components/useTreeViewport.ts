import { useLayoutEffect, useRef, useState } from 'react';

/** Tree needs an explicit viewport height to virtualize both rows and expansion motion. */
export function useTreeViewport() {
  const ref = useRef<HTMLDivElement>(null);
  // Never render the entire tree while waiting for the first measurement.
  const [height, setHeight] = useState(1);
  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;
    const measure = () => {
      const style = getComputedStyle(container);
      setHeight(
        Math.max(
          1,
          container.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
        ),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  return { ref, height };
}
