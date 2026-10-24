import { useEffect, useRef } from 'react';

/**
 * Hardware back button (Android) and Escape key routing. The most recently registered
 * active handler wins — so an open sheet closes before the screen navigates back.
 */
type Handler = () => void;
const stack: { id: number; fn: { current: Handler } }[] = [];
let nextId = 0;

export function useBackHandler(fn: Handler, active = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return;
    const id = ++nextId;
    stack.push({ id, fn: ref });
    return () => {
      const i = stack.findIndex((s) => s.id === id);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [active]);
}

/** Returns true if a registered handler consumed the event. */
export function dispatchBack(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.fn.current();
  return true;
}
