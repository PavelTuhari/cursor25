/**
 * Runs a JSON `DataQuery` against the local database. Every screen block reads
 * its data through this hook, so the UI never talks to SQL directly and always
 * works from the offline copy.
 */
import { useEffect, useMemo, useState } from 'react';

import type { DataQuery } from '../config/types';
import type { EntityRecord } from '../db/records';
import { useApp } from './AppContext';

export interface QueryResult<T> {
  data: T[];
  loading: boolean;
  error: Error | null;
}

export function useEntityQuery<T extends EntityRecord = EntityRecord>(
  query: DataQuery | null | undefined,
  params?: Record<string, unknown>,
): QueryResult<T> {
  const { db, locale, storeId, session, dataVersion } = useApp();
  const [state, setState] = useState<QueryResult<T>>({ data: [], loading: true, error: null });

  const key = useMemo(() => JSON.stringify({ query, params }), [query, params]);

  useEffect(() => {
    let cancelled = false;
    if (!query) {
      setState({ data: [], loading: false, error: null });
      return () => {
        cancelled = true;
      };
    }

    setState((previous) => ({ ...previous, loading: true }));
    db.repository<T>(query.entity)
      .query(query, { locale, storeId, userId: session.userId, params })
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null });
      })
      .catch((error: Error) => {
        if (!cancelled) setState({ data: [], loading: false, error });
      });

    return () => {
      cancelled = true;
    };
    // `key` covers query/params; dataVersion re-runs after writes and syncs.
  }, [db, key, locale, storeId, session.userId, dataVersion]);

  return state;
}

export function useEntityRecord<T extends EntityRecord = EntityRecord>(
  entity: string,
  id: string | null | undefined,
): QueryResult<T> {
  const query = useMemo<DataQuery | null>(() => {
    if (!id) return null;
    return { entity, where: [{ field: 'id', op: '=', value: id }], limit: 1 };
  }, [entity, id]);
  return useEntityQuery<T>(query);
}
