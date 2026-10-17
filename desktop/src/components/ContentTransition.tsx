import { createContext, useContext, useLayoutEffect, useRef, type HTMLAttributes } from 'react';
import { motion } from '../motion';

const TransitionContext = createContext<string | undefined>(undefined);

/** Content identity changes replay motion without remounting forms or tables. */
export function ContentTransition({
  identity,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { identity: string }) {
  const element = useRef<HTMLDivElement>(null);
  const parent = useContext(TransitionContext);
  const previous = useRef<{ identity: string; parent?: string }>(undefined);
  useLayoutEffect(() => {
    const last = previous.current;
    previous.current = { identity, parent };
    if (parent !== undefined && (!last || last.parent !== parent)) return;
    if (last?.identity === identity || !element.current?.animate) return;
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (preference?.matches) return;
    const animation = element.current.animate(
      [
        { opacity: 0, transform: `translateY(${motion.distance}px)` },
        { opacity: 1, transform: 'none' },
      ],
      { duration: motion.content, easing: motion.easing },
    );
    const cancel = () => animation.cancel();
    preference?.addEventListener('change', cancel);
    return () => {
      preference?.removeEventListener('change', cancel);
      cancel();
    };
  }, [identity, parent]);
  return (
    <TransitionContext value={parent === undefined ? identity : `${parent}/${identity}`}>
      <div {...props} ref={element} data-transition={identity}>
        {children}
      </div>
    </TransitionContext>
  );
}
