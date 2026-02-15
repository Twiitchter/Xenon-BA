import db from '../database';

/**
 * Assetic API call logger.
 *
 * Persists every outbound Assetic API call (with focus on work request
 * create/update operations) into the `assetic_api_log` table for
 * debugging and audit purposes.
 *
 * Payloads are JSON-truncated to a configurable max length so the
 * table doesn't grow unbounded.
 */

export type ApiLogEntityType =
  | 'work_request'
  | 'work_order'
  | 'asset'
  | 'auth'
  | 'document'
  | 'lookup'
  | 'other';

export type ApiLogStatus = 'success' | 'error' | 'timeout';

export interface ApiLogEntry {
  method: string;
  endpoint: string;
  description?: string;
  entityType: ApiLogEntityType;
  entityGuid?: string;
  requestBody?: any;
  responseBody?: any;
  httpStatus?: number;
  errorMessage?: string;
  durationMs?: number;
  workerId?: number;
  performedBy?: number;
  source?: string;
  status: ApiLogStatus;
}

export interface ApiLogQuery {
  entityType?: ApiLogEntityType;
  entityGuid?: string;
  httpStatus?: number;
  status?: ApiLogStatus;
  performedBy?: number;
  from?: string;       // ISO date
  to?: string;         // ISO date
  limit?: number;
  offset?: number;
}

const MAX_PAYLOAD_LENGTH = 8000; // chars — keeps rows manageable

class AsseticApiLogger {
  /**
   * Write a log entry. Non-blocking — errors are caught and printed
   * so logging never crashes the request.
   */
  async log(entry: ApiLogEntry): Promise<void> {
    try {
      await db('assetic_api_log').insert({
        method: entry.method,
        endpoint: entry.endpoint,
        description: entry.description || null,
        entity_type: entry.entityType,
        entity_guid: entry.entityGuid || null,
        request_body: this.safeStringify(entry.requestBody),
        response_body: this.safeStringify(entry.responseBody),
        http_status: entry.httpStatus ?? null,
        error_message: entry.errorMessage || null,
        duration_ms: entry.durationMs ?? null,
        worker_id: entry.workerId ?? null,
        performed_by: entry.performedBy ?? null,
        source: entry.source || null,
        status: entry.status,
      });
    } catch (error) {
      console.error('[AsseticApiLogger] Failed to write log entry:', error);
    }
  }

  /**
   * Query log entries with optional filters and pagination.
   */
  async query(params: ApiLogQuery = {}) {
    const {
      entityType,
      entityGuid,
      httpStatus,
      status,
      performedBy,
      from,
      to,
      limit = 100,
      offset = 0,
    } = params;

    let qb = db('assetic_api_log as l')
      .leftJoin('users as u', 'l.performed_by', 'u.id')
      .select(
        'l.*',
        'u.username as performed_by_username',
        'u.first_name as performed_by_first_name',
        'u.last_name as performed_by_last_name',
      );

    if (entityType) qb = qb.where('l.entity_type', entityType);
    if (entityGuid) qb = qb.where('l.entity_guid', entityGuid);
    if (httpStatus) qb = qb.where('l.http_status', httpStatus);
    if (status) qb = qb.where('l.status', status);
    if (performedBy) qb = qb.where('l.performed_by', performedBy);
    if (from) qb = qb.where('l.created_at', '>=', from);
    if (to) qb = qb.where('l.created_at', '<=', to);

    const logs = await qb
      .orderBy('l.created_at', 'desc')
      .limit(limit)
      .offset(offset);

    return logs;
  }

  /**
   * Get a single log entry by ID (includes full payloads).
   */
  async getById(id: number) {
    return db('assetic_api_log as l')
      .leftJoin('users as u', 'l.performed_by', 'u.id')
      .select(
        'l.*',
        'u.username as performed_by_username',
        'u.first_name as performed_by_first_name',
        'u.last_name as performed_by_last_name',
      )
      .where('l.id', id)
      .first();
  }

  /**
   * Count log entries matching filters (for pagination).
   */
  async count(params: Omit<ApiLogQuery, 'limit' | 'offset'> = {}): Promise<number> {
    const { entityType, entityGuid, httpStatus, status, performedBy, from, to } = params;

    let qb = db('assetic_api_log');

    if (entityType) qb = qb.where('entity_type', entityType);
    if (entityGuid) qb = qb.where('entity_guid', entityGuid);
    if (httpStatus) qb = qb.where('http_status', httpStatus);
    if (status) qb = qb.where('status', status);
    if (performedBy) qb = qb.where('performed_by', performedBy);
    if (from) qb = qb.where('created_at', '>=', from);
    if (to) qb = qb.where('created_at', '<=', to);

    const [{ count: total }] = await qb.count('id as count');
    return Number(total);
  }

  /**
   * Purge logs older than `days` days.
   * Can be called periodically or from an admin endpoint.
   */
  async purgeOlderThan(days: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const deleted = await db('assetic_api_log')
      .where('created_at', '<', cutoff.toISOString())
      .del();
    console.log(`[AsseticApiLogger] Purged ${deleted} log entries older than ${days} days`);
    return deleted;
  }

  // ─── Internal ─────────────────────────────────────────────────────

  private safeStringify(value: any): string | null {
    if (value === undefined || value === null) return null;
    try {
      const json = typeof value === 'string' ? value : JSON.stringify(value);
      if (json.length > MAX_PAYLOAD_LENGTH) {
        return json.substring(0, MAX_PAYLOAD_LENGTH) + '...[truncated]';
      }
      return json;
    } catch {
      return '[unserializable]';
    }
  }
}

export const asseticApiLogger = new AsseticApiLogger();
export default asseticApiLogger;
