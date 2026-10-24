import { useEffect, useRef, useState, useSyncExternalStore, type DependencyList } from 'react';
import { libraryVersion, subscribeLibrary } from '../services/library';

/** Re-runs an async query whenever the library changes (or deps change). */
export function useLive<T>(query: () => Promise<T>, deps: DependencyList): { data: T | undefined; error: Error | null; loading: boolean } {
  const version = useSyncExternalStore(subscribeLibrary, libraryVersion, libraryVersion);
  const [state, setState] = useState<{ data: T | undefined; error: Error | null; loading: boolean }>({ data: undefined, error: null, loading: true });
  const q = useRef(query);
  q.current = query;
  useEffect(() => {
    let alive = true;
    q.current()
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((error: Error) => alive && setState((s) => ({ data: s.data, error, loading: false })));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, ...deps]);
  return state;
}
