import { useEffect, useRef, useState } from 'react';

import { useFetchClient } from '@strapi/strapi/admin';

export interface AdminListResponse<TRow> {
  results: TRow[];
  pagination: { total: number };
}

export interface UseAdminLists<TRow> {
  data: Record<string, AdminListResponse<TRow>> | null;
  loading: boolean;
  failed: boolean;
}

/**
 * Loads several Content Manager list URLs in parallel, keyed like the input.
 * Widgets mount once per homepage visit, so there is no polling.
 */
export const useAdminLists = <TRow>(urls: Record<string, string>): UseAdminLists<TRow> => {
  const { get } = useFetchClient();
  const getRef = useRef(get);
  getRef.current = get;

  const [state, setState] = useState<UseAdminLists<TRow>>({
    data: null,
    loading: true,
    failed: false,
  });
  const urlsKey = JSON.stringify(urls);

  useEffect(() => {
    let active = true;
    const entries = Object.entries(JSON.parse(urlsKey) as Record<string, string>);

    Promise.all(
      entries.map(async ([key, url]) => {
        const response = await getRef.current<AdminListResponse<TRow>>(url);
        return [key, response.data] as const;
      }),
    )
      .then((pairs) => {
        if (active) {
          setState({ data: Object.fromEntries(pairs), loading: false, failed: false });
        }
      })
      .catch(() => {
        if (active) {
          setState({ data: null, loading: false, failed: true });
        }
      });

    return () => {
      active = false;
    };
  }, [urlsKey]);

  return state;
};
