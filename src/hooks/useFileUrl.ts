import { useEffect, useState } from 'react';
import { fileStore } from '../infrastructure/fileStore';

/** Resolves an internal file path to a displayable URL (null while loading or if missing). */
export function useFileUrl(path: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (!path) return;
    fileStore
      .url(path)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setUrl(null));
    return () => {
      alive = false;
    };
  }, [path]);
  return url;
}
