import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { query } from '../database';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// ─── Maintenance Requests ───────────────────────────────────────────────────

/**
 * GET /api/maintenance/requests
 * List maintenance requests
 */
router.get('/requests', async (req: AuthRequest, res: Response) => {
  try {
    const { status, priority, limit = 100, offset = 0 } = req.query;

    let queryText = 'SELECT mr.*, u.username AS requested_by_username FROM maintenance_requests mr LEFT JOIN users u ON mr.requested_by = u.id WHERE 1=1';
    const params: any[] = [];
    let paramCount = 0;

    if (status) {
      paramCount++;
      queryText += ` AND mr.status = $${paramCount}`;
      params.push(status);
    }

    if (priority) {
      paramCount++;
      queryText += ` AND mr.priority = $${paramCount}`;
      params.push(priority);
    }

    paramCount++;
    queryText += ` ORDER BY mr.created_at DESC LIMIT $${paramCount}`;
    params.push(limit);

    paramCount++;
    queryText += ` OFFSET $${paramCount}`;
    params.push(offset);

    const result = await query(queryText, params);

    res.json({
      requests: result.rows,
      total: result.rowCount,
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

    const result = await query(
      'SELECT mr.*, u.username AS requested_by_username FROM maintenance_requests mr LEFT JOIN users u ON mr.requested_by = u.id WHERE mr.id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Maintenance request not found' });
    }

    res.json(result.rows[0]);
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

      const result = await query(
        `INSERT INTO maintenance_requests (asset_id, requested_by, title, description, priority, category, location)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [assetId || null, req.user.id, title, description || null, priority || 'medium', category || null, location || null]
      );

      res.status(201).json(result.rows[0]);
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

      const existing = await query('SELECT id FROM maintenance_requests WHERE id = $1', [id]);
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: 'Maintenance request not found' });
      }

      const result = await query(
        `UPDATE maintenance_requests
         SET title = COALESCE($1, title),
             description = COALESCE($2, description),
             priority = COALESCE($3, priority),
             status = COALESCE($4, status),
             category = COALESCE($5, category),
             location = COALESCE($6, location),
             updated_at = NOW()
         WHERE id = $7
         RETURNING *`,
        [title || null, description || null, priority || null, status || null, category || null, location || null, id]
      );

      res.json(result.rows[0]);
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

    let queryText = `SELECT wo.*, u.username AS assigned_to_username, mr.title AS request_title
       FROM work_orders wo
       LEFT JOIN users u ON wo.assigned_to = u.id
       LEFT JOIN maintenance_requests mr ON wo.request_id = mr.id
       WHERE 1=1`;
    const params: any[] = [];
    let paramCount = 0;

    if (status) {
      paramCount++;
      queryText += ` AND wo.status = $${paramCount}`;
      params.push(status);
    }

    if (craft) {
      paramCount++;
      queryText += ` AND wo.craft = $${paramCount}`;
      params.push(craft);
    }

    paramCount++;
    queryText += ` ORDER BY wo.created_at DESC LIMIT $${paramCount}`;
    params.push(limit);

    paramCount++;
    queryText += ` OFFSET $${paramCount}`;
    params.push(offset);

    const result = await query(queryText, params);

    res.json({
      workOrders: result.rows,
      total: result.rowCount,
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

    const result = await query(
      `SELECT wo.*, u.username AS assigned_to_username, mr.title AS request_title
       FROM work_orders wo
       LEFT JOIN users u ON wo.assigned_to = u.id
       LEFT JOIN maintenance_requests mr ON wo.request_id = mr.id
       WHERE wo.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Work order not found' });
    }

    res.json(result.rows[0]);
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
      const reqCheck = await query('SELECT id FROM maintenance_requests WHERE id = $1', [requestId]);
      if (reqCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Maintenance request not found' });
      }

      const result = await query(
        `INSERT INTO work_orders (request_id, assigned_to, craft, title, description, priority, scheduled_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [requestId, assignedTo || null, craft || null, title, description || null, priority || 'medium', scheduledDate || null]
      );

      // Update the maintenance request status to in_progress
      await query(
        `UPDATE maintenance_requests SET status = 'in_progress', updated_at = NOW() WHERE id = $1`,
        [requestId]
      );

      res.status(201).json(result.rows[0]);
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

      const existing = await query('SELECT id, request_id FROM work_orders WHERE id = $1', [id]);
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: 'Work order not found' });
      }

      const completedAt = status === 'completed' ? 'NOW()' : null;

      const result = await query(
        `UPDATE work_orders
         SET title = COALESCE($1, title),
             description = COALESCE($2, description),
             priority = COALESCE($3, priority),
             status = COALESCE($4, status),
             craft = COALESCE($5, craft),
             assigned_to = COALESCE($6, assigned_to),
             scheduled_date = COALESCE($7, scheduled_date),
             completed_at = ${completedAt ? completedAt : 'completed_at'},
             updated_at = NOW()
         WHERE id = $8
         RETURNING *`,
        [title || null, description || null, priority || null, status || null, craft || null, assignedTo || null, scheduledDate || null, id]
      );

      // If work order is completed, update maintenance request status
      if (status === 'completed') {
        await query(
          `UPDATE maintenance_requests SET status = 'completed', updated_at = NOW() WHERE id = $1`,
          [existing.rows[0].request_id]
        );
      }

      res.json(result.rows[0]);
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

    const result = await query(
      `SELECT wom.*, u.username AS sender_username
       FROM work_order_messages wom
       LEFT JOIN users u ON wom.sender_id = u.id
       WHERE wom.work_order_id = $1
       ORDER BY wom.created_at ASC
       LIMIT $2 OFFSET $3`,
      [id, limit, offset]
    );

    res.json({
      messages: result.rows,
      total: result.rowCount,
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
      const woCheck = await query('SELECT id FROM work_orders WHERE id = $1', [id]);
      if (woCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Work order not found' });
      }

      const result = await query(
        `INSERT INTO work_order_messages (work_order_id, sender_id, message)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [id, req.user.id, message]
      );

      res.status(201).json(result.rows[0]);
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
    const result = await query(
      `SELECT DISTINCT craft FROM work_orders WHERE craft IS NOT NULL ORDER BY craft ASC`,
      []
    );

    const crafts = result.rows.map((row: any) => row.craft);

    res.json({ crafts });
  } catch (error) {
    console.error('Error fetching crafts:', error);
    res.status(500).json({ error: 'Failed to fetch crafts' });
  }
});

export default router;
