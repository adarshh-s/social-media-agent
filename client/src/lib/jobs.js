import { useEffect, useState } from 'react';
import { api } from './api';

/** Polls a background job until it finishes. Returns the latest job row (or null). */
export function useJob(jobId, intervalMs = 2500) {
  const [job, setJob] = useState(null);
  useEffect(() => {
    if (!jobId) {
      setJob(null);
      return;
    }
    let stop = false;
    let timer;
    const poll = async () => {
      try {
        const j = await api.get(`/jobs/${jobId}`);
        if (stop) return;
        setJob(j);
        if (j.status === 'queued' || j.status === 'running') timer = setTimeout(poll, intervalMs);
      } catch {
        if (!stop) timer = setTimeout(poll, intervalMs * 2);
      }
    };
    poll();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [jobId, intervalMs]);
  return job;
}
