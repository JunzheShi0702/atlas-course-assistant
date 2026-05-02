import { useCallback } from 'react';
import { useAtom } from 'jotai';
import { sisDetailsCacheAtom, SisCourseDetails } from '@/store/atoms';
import { apiUrl } from '@/lib/apiUrl';

export function useSisDetailsCache() {
  const [cache, setCache] = useAtom(sisDetailsCacheAtom);

  const prefetchSisDetails = useCallback(async (courseId: string) => {
    if (!courseId) return;

    let shouldFetch = false;
    setCache(prev => {
      if (prev.has(courseId)) return prev;
      shouldFetch = true;
      return new Map(prev).set(courseId, 'loading');
    });
    if (!shouldFetch) return;

    try {
      const res = await fetch(apiUrl(`/api/courses/${encodeURIComponent(courseId)}/details`), {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error('failed');
      const data = await res.json() as { details: SisCourseDetails | null };
      setCache(prev => new Map(prev).set(courseId, data.details ?? 'error'));
    } catch {
      setCache(prev => new Map(prev).set(courseId, 'error'));
    }
  }, [setCache]);

  return { cache, prefetchSisDetails };
}
