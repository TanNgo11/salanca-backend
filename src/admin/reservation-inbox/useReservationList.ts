import { useCallback, useEffect, useRef, useState } from 'react';

import { useFetchClient } from '@strapi/strapi/admin';

import { buildReservationListQuery, type ReservationListFilters } from './reservation-inbox.helper';
import type { ApiReservationListResult, ReservationStatus } from './reservation-inbox.types';

const LIST_PATH = '/reservation-inbox/list';

interface ListEnvelope {
  data?: ApiReservationListResult;
}

export interface UseReservationList {
  result: ApiReservationListResult | null;
  loading: boolean;
  failed: boolean;
  reload(): Promise<void>;
  setStatus(documentId: string, status: ReservationStatus): Promise<boolean>;
}

/**
 * Filtered, paginated reservation requests for the inbox screen. `refreshKey`
 * lets the caller force a reload when a live event arrives.
 */
export const useReservationList = (
  filters: ReservationListFilters,
  refreshKey: number,
): UseReservationList => {
  const { get, post } = useFetchClient();
  const clientRef = useRef({ get, post });
  clientRef.current = { get, post };

  const [result, setResult] = useState<ApiReservationListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const requestSeq = useRef(0);

  const query = buildReservationListQuery(filters);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    try {
      const response = await clientRef.current.get(`${LIST_PATH}?${query}`);
      if (seq !== requestSeq.current) {
        return;
      }
      setResult((response.data as ListEnvelope | null)?.data ?? null);
      setFailed(false);
    } catch {
      if (seq === requestSeq.current) {
        setFailed(true);
      }
    } finally {
      if (seq === requestSeq.current) {
        setLoading(false);
      }
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const setStatus = useCallback(
    async (documentId: string, status: ReservationStatus): Promise<boolean> => {
      try {
        await clientRef.current.post(
          `/reservation-inbox/${encodeURIComponent(documentId)}/status`,
          { status },
        );
        await load();
        return true;
      } catch {
        return false;
      }
    },
    [load],
  );

  return { result, loading, failed, reload: load, setStatus };
};
