import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import db from '../database';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// ─── My Items (Combined User View) ─────────────────────────────────────────

/**
 * GET /api/maintenance/my-items
 * Get combined work requests and work orders for the current user
 * When a work order exists for a work request, the work order takes precedence
 */
router.get('/my-items', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id;
    const { status, priority, limit = 100, offset = 0 } = req.query;

    // Get work requests created by this user
    let wrQuery = db('maintenance_requests as mr')
      .leftJoin('users as u', 'mr.requested_by', 'u.id')
      .leftJoin('work_orders as wo', 'mr.id', 'wo.request_id')
      .select(
        'mr.id',
        'mr.title',
        'mr.description',
        'mr.priority',
        'mr.status',
        'mr.category',
        'mr.location',
        'mr.created_at',
        'mr.updated_at',
        db.raw('? as item_type', ['request']),
        'wo.id as work_order_id',
        'wo.status as work_order_status',
        'wo.craft as work_order_craft',
        db.raw('NULL as assigned_to_username'),
        db.raw('NULL as scheduled_date')
      )
      .where('mr.requested_by', userId);

    if (status) {
      wrQuery = wrQuery.where('mr.status', status as string);
    }
    if (priority) {
      wrQuery = wrQuery.where('mr.priority', priority as string);
    }

    const requests = await wrQuery.orderBy('mr.created_at', 'desc');

    // Transform and combine results, applying display logic
    const items = requests.map(r => ({
      ...r,
      // If work order exists, show work order status
      display_type: r.work_order_id ? 'work_order' : 'request',
      display_status: r.work_order_id ? r.work_order_status : r.status,
    })).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(Number(offset), Number(offset) + Number(limit));

    res.json({
      items,
      total: items.length,
    });
  } catch (error) {
    console.error('Error fetching user items:', error);
    res.status(500).json({ error: 'Failed to fetch items' });
  }
});

// ─── Maintenance Requests ───────────────────────────────────────────────────

/**
 * GET /api/maintenance/requests
 * List maintenance requests
 */
router.get('/requests', async (req: AuthRequest, res: Response) => {
  try {
    const { status, priority, limit = 100, offset = 0 } = req.query;

    let qb = db('maintenance_requests as mr')
      .leftJoin('users as u', 'mr.requested_by', 'u.id')
      .select('mr.*', 'u.username as requested_by_username');

    if (status) {
      qb = qb.where('mr.status', status as string);
    }

    if (priority) {
      qb = qb.where('mr.priority', priority as string);
    }

    const requests = await qb
      .orderBy('mr.created_at', 'desc')
      .limit(Number(limit))
      .offset(Number(offset));

    res.json({
      requests,
      total: requests.length,
    });
  } catch (error) {
    console.error('Error fetching maintenance requests:', error);
    res.status(500).json({ error: 'Failed to fetch maintenance requests' });
  }
});

/**
 * GET /api/maintenance/requests/:id
 * Get a specific maintenance request
 */
router.get('/requests/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const request = await db('maintenance_requests as mr')
      .leftJoin('users as u', 'mr.requested_by', 'u.id')
      .select('mr.*', 'u.username as requested_by_username')
      .where('mr.id', id)
      .first();

    if (!request) {
      return res.status(404).json({ error: 'Maintenance request not found' });
    }

    res.json(request);
  } catch (error) {
    console.error('Error fetching maintenance request:', error);
    res.status(500).json({ error: 'Failed to fetch maintenance request' });
  }
});

/**
 * POST /api/maintenance/requests
 * Create a new maintenance request
 */
router.post(
  '/requests',
  [
    body('title').isLength({ min: 1 }).trim(),
    body('description').optional().trim(),
    body('priority').optional().isIn(['low', 'medium', 'high', 'critical']),
    body('category').optional().trim(),
    body('location').optional().trim(),
    body('assetId').optional().isInt(),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { title, description, priority, category, location, assetId } = req.body;

      const [inserted] = await db('maintenance_requests')
        .insert({
          asset_id: assetId || null,
          requested_by: req.user.id,
          title,
          description: description || null,
          priority: priority || 'medium',
          category: category || null,
          location: location || null,
        })
        .returning('*');

      // For MySQL/MSSQL that don't support RETURNING, fetch the inserted row
      if (!inserted || typeof inserted === 'number') {
        const id = typeof inserted === 'number' ? inserted : (inserted as any);
        const row = await db('maintenance_requests').where('id', id).first();
        return res.status(201).json(row);
      }

      res.status(201).json(inserted);
    } catch (error) {
      console.error('Error creating maintenance request:', error);
      res.status(500).json({ error: 'Failed to create maintenance request' });
    }
  }
);

/**
 * PUT /api/maintenance/requests/:id
 * Update a maintenance request
 */
router.put(
  '/requests/:id',
  [
    body('title').optional().isLength({ min: 1 }).trim(),
    body('description').optional().trim(),
    body('priority').optional().isIn(['low', 'medium', 'high', 'critical']),
    body('status').optional().isIn(['open', 'in_progress', 'completed', 'cancelled']),
    body('category').optional().trim(),
    body('location').optional().trim(),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { id } = req.params;
      const { title, description, priority, status, category, location } = req.body;

      const existing = await db('maintenance_requests').where('id', id).first();
      if (!existing) {
        return res.status(404).json({ error: 'Maintenance request not found' });
      }

      const updateData: any = { updated_at: db.fn.now() };
      if (title) updateData.title = title;
      if (description) updateData.description = description;
      if (priority) updateData.priority = priority;
      if (status) updateData.status = status;
      if (category) updateData.category = category;
      if (location) updateData.location = location;

      await db('maintenance_requests').where('id', id).update(updateData);
      const updated = await db('maintenance_requests').where('id', id).first();

      res.json(updated);
    } catch (error) {
      console.error('Error updating maintenance request:', error);
      res.status(500).json({ error: 'Failed to update maintenance request' });
    }
  }
);

// ─── Work Orders ────────────────────────────────────────────────────────────

/**
 * GET /api/maintenance/work-orders
 * List work orders
 */
router.get('/work-orders', async (req: AuthRequest, res: Response) => {
  try {
    const { status, craft, limit = 100, offset = 0 } = req.query;

    let qb = db('work_orders as wo')
      .leftJoin('users as u', 'wo.assigned_to', 'u.id')
      .leftJoin('maintenance_requests as mr', 'wo.request_id', 'mr.id')
      .select('wo.*', 'u.username as assigned_to_username', 'mr.title as request_title');

    if (status) {
      qb = qb.where('wo.status', status as string);
    }

    if (craft) {
      qb = qb.where('wo.craft', craft as string);
    }

    const workOrders = await qb
      .orderBy('wo.created_at', 'desc')
      .limit(Number(limit))
      .offset(Number(offset));

    res.json({
      workOrders,
      total: workOrders.length,
    });
  } catch (error) {
    console.error('Error fetching work orders:', error);
    res.status(500).json({ error: 'Failed to fetch work orders' });
  }
});

/**
 * GET /api/maintenance/work-orders/:id
 * Get a specific work order
 */
router.get('/work-orders/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const workOrder = await db('work_orders as wo')
      .leftJoin('users as u', 'wo.assigned_to', 'u.id')
      .leftJoin('maintenance_requests as mr', 'wo.request_id', 'mr.id')
      .select('wo.*', 'u.username as assigned_to_username', 'mr.title as request_title')
      .where('wo.id', id)
      .first();

    if (!workOrder) {
      return res.status(404).json({ error: 'Work order not found' });
    }

    res.json(workOrder);
  } catch (error) {
    console.error('Error fetching work order:', error);
    res.status(500).json({ error: 'Failed to fetch work order' });
  }
});

/**
 * POST /api/maintenance/work-orders
 * Create a work order from a maintenance request
 */
router.post(
  '/work-orders',
  [
    body('requestId').isInt(),
    body('title').isLength({ min: 1 }).trim(),
    body('description').optional().trim(),
    body('priority').optional().isIn(['low', 'medium', 'high', 'critical']),
    body('craft').optional().trim(),
    body('assignedTo').optional().isInt(),
    body('scheduledDate').optional().isISO8601(),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { requestId, title, description, priority, craft, assignedTo, scheduledDate } = req.body;

      // Verify the maintenance request exists
      const reqCheck = await db('maintenance_requests').where('id', requestId).first();
      if (!reqCheck) {
        return res.status(404).json({ error: 'Maintenance request not found' });
      }

      const [inserted] = await db('work_orders')
        .insert({
          request_id: requestId,
          assigned_to: assignedTo || null,
          craft: craft || null,
          title,
          description: description || null,
          priority: priority || 'medium',
          scheduled_date: scheduledDate || null,
        })
        .returning('*');

      // Update the maintenance request status to in_progress
      await db('maintenance_requests')
        .where('id', requestId)
        .update({ status: 'in_progress', updated_at: db.fn.now() });

      // For MySQL/MSSQL that don't support RETURNING, fetch the inserted row
      if (!inserted || typeof inserted === 'number') {
        const id = typeof inserted === 'number' ? inserted : (inserted as any);
        const row = await db('work_orders').where('id', id).first();
        return res.status(201).json(row);
      }

      res.status(201).json(inserted);
    } catch (error) {
      console.error('Error creating work order:', error);
      res.status(500).json({ error: 'Failed to create work order' });
    }
  }
);

/**
 * PUT /api/maintenance/work-orders/:id
 * Update a work order (status, assignment, craft, etc.)
 */
router.put(
  '/work-orders/:id',
  [
    body('title').optional().isLength({ min: 1 }).trim(),
    body('description').optional().trim(),
    body('priority').optional().isIn(['low', 'medium', 'high', 'critical']),
    body('status').optional().isIn(['pending', 'in_progress', 'completed', 'cancelled']),
    body('craft').optional().trim(),
    body('assignedTo').optional().isInt(),
    body('scheduledDate').optional().isISO8601(),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { id } = req.params;
      const { title, description, priority, status, craft, assignedTo, scheduledDate } = req.body;

      const existing = await db('work_orders').where('id', id).select('id', 'request_id').first();
      if (!existing) {
        return res.status(404).json({ error: 'Work order not found' });
      }

      const updateData: any = { updated_at: db.fn.now() };
      if (title) updateData.title = title;
      if (description) updateData.description = description;
      if (priority) updateData.priority = priority;
      if (status) updateData.status = status;
      if (craft) updateData.craft = craft;
      if (assignedTo) updateData.assigned_to = assignedTo;
      if (scheduledDate) updateData.scheduled_date = scheduledDate;
      if (status === 'completed') updateData.completed_at = db.fn.now();

      await db('work_orders').where('id', id).update(updateData);

      // If work order is completed, update maintenance request status
      if (status === 'completed') {
        await db('maintenance_requests')
          .where('id', existing.request_id)
          .update({ status: 'completed', updated_at: db.fn.now() });
      }

      const updated = await db('work_orders').where('id', id).first();
      res.json(updated);
    } catch (error) {
      console.error('Error updating work order:', error);
      res.status(500).json({ error: 'Failed to update work order' });
    }
  }
);

// ─── Work Order Messages ────────────────────────────────────────────────────

/**
 * GET /api/maintenance/work-orders/:id/messages
 * Get messages for a work order
 */
router.get('/work-orders/:id/messages', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    const messages = await db('work_order_messages as wom')
      .leftJoin('users as u', 'wom.sender_id', 'u.id')
      .select('wom.*', 'u.username as sender_username')
      .where('wom.work_order_id', id)
      .orderBy('wom.created_at', 'asc')
      .limit(Number(limit))
      .offset(Number(offset));

    res.json({
      messages,
      total: messages.length,
    });
  } catch (error) {
    console.error('Error fetching work order messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

/**
 * POST /api/maintenance/work-orders/:id/messages
 * Add a message to a work order
 */
router.post(
  '/work-orders/:id/messages',
  [body('message').isLength({ min: 1 }).trim()],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { id } = req.params;
      const { message } = req.body;

      // Verify the work order exists
      const woCheck = await db('work_orders').where('id', id).first();
      if (!woCheck) {
        return res.status(404).json({ error: 'Work order not found' });
      }

      const [inserted] = await db('work_order_messages')
        .insert({
          work_order_id: id,
          sender_id: req.user.id,
          message,
        })
        .returning('*');

      if (!inserted || typeof inserted === 'number') {
        const newId = typeof inserted === 'number' ? inserted : (inserted as any);
        const row = await db('work_order_messages').where('id', newId).first();
        return res.status(201).json(row);
      }

      res.status(201).json(inserted);
    } catch (error) {
      console.error('Error creating work order message:', error);
      res.status(500).json({ error: 'Failed to create message' });
    }
  }
);

// ─── Crafts/Trades ──────────────────────────────────────────────────────────

/**
 * GET /api/maintenance/crafts
 * Get list of available crafts/trades for work order assignment
 */
router.get('/crafts', async (_req: AuthRequest, res: Response) => {
  try {
    const result = await db('work_orders')
      .distinct('craft')
      .whereNotNull('craft')
      .orderBy('craft', 'asc');

    const crafts = result.map((row: any) => row.craft);

    res.json({ crafts });
  } catch (error) {
    console.error('Error fetching crafts:', error);
    res.status(500).json({ error: 'Failed to fetch crafts' });
  }
});

export default router;
