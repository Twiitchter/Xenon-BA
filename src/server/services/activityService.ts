import db from '../database';

export interface ActivityLogEntry {
  entity_type: string;
  entity_id: number;
  action: string;
  details?: any;
  performed_by?: number;
}

class ActivityService {
  /**
   * Log an activity entry
   */
  async log(entry: ActivityLogEntry): Promise<void> {
    try {
      await db('activity_log').insert({
        entity_type: entry.entity_type,
        entity_id: entry.entity_id,
        action: entry.action,
        details: entry.details ? JSON.stringify(entry.details) : null,
        performed_by: entry.performed_by || null,
      });
    } catch (error) {
      console.error('Failed to log activity:', error);
      // Non-critical — don't throw
    }
  }

  /**
   * Get activity log entries for an entity
   */
  async getForEntity(entityType: string, entityId: number, limit = 50) {
    return db('activity_log as al')
      .leftJoin('users as u', 'al.performed_by', 'u.id')
      .select('al.*', 'u.username as performed_by_username', 'u.first_name', 'u.last_name')
      .where('al.entity_type', entityType)
      .where('al.entity_id', entityId)
      .orderBy('al.created_at', 'desc')
      .limit(limit);
  }

  /**
   * Get recent activity across all entities
   */
  async getRecent(limit = 50) {
    return db('activity_log as al')
      .leftJoin('users as u', 'al.performed_by', 'u.id')
      .select('al.*', 'u.username as performed_by_username', 'u.first_name', 'u.last_name')
      .orderBy('al.created_at', 'desc')
      .limit(limit);
  }
}

export const activityService = new ActivityService();
export default activityService;
