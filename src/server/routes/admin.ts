import { Router, Response } from 'express';
import bcrypt from 'bcrypt';
import { body, validationResult } from 'express-validator';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import db from '../database';
import settingsService from '../services/settingsService';
import activityService from '../services/activityService';

const router = Router();

// All admin routes require authentication
router.use(authenticateToken);

// Middleware: require admin role
const requireAdmin = async (req: AuthRequest, res: Response, next: Function) => {
  try {
    const user = await db('users').where('id', req.user.id).select('role').first();
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  } catch {
    res.status(500).json({ error: 'Authorization check failed' });
  }
};

router.use(requireAdmin);

// ═══════════════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/settings
 * Get all system settings (optionally filtered by category)
 */
router.get('/settings', async (req: AuthRequest, res: Response) => {
  try {
    const { category } = req.query;
    const settings = await settingsService.getAll(category as string | undefined);
    res.json({ settings });
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

/**
 * PUT /api/admin/settings
 * Bulk update settings
 * Body: { settings: { key: value, ... } }
 */
router.put('/settings', async (req: AuthRequest, res: Response) => {
  try {
    const { settings } = req.body;
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'Settings object required' });
    }

    await settingsService.bulkSet(settings, req.user.id);

    await activityService.log({
      entity_type: 'setting',
      entity_id: 0,
      action: 'updated',
      details: { keys: Object.keys(settings) },
      performed_by: req.user.id,
    });

    res.json({ message: 'Settings updated successfully' });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

/**
 * POST /api/admin/settings/test-assetic
 * Test Assetic API connection with current settings
 */
router.post('/settings/test-assetic', async (req: AuthRequest, res: Response) => {
  try {
    const apiUrl = await settingsService.get('assetic_api_url');
    const apiKey = await settingsService.get('assetic_api_key');
    const apiVersion = await settingsService.get('assetic_api_version', 'v1');

    if (!apiUrl || !apiKey) {
      return res.status(400).json({ error: 'Assetic API URL and key must be configured first' });
    }

    const axios = require('axios');
    const response = await axios.get(`${apiUrl}/${apiVersion}/assets?limit=1`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });

    res.json({ success: true, message: 'Connection successful', status: response.status });
  } catch (error: any) {
    res.json({
      success: false,
      message: error.response?.data?.message || error.message || 'Connection failed',
      status: error.response?.status || 0,
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// USER MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/users
 * List all users
 */
router.get('/users', async (req: AuthRequest, res: Response) => {
  try {
    const users = await db('users')
      .select('id', 'username', 'email', 'first_name', 'last_name', 'role', 'auth_provider', 'is_active', 'department', 'phone', 'created_at', 'updated_at')
      .orderBy('created_at', 'desc');

    res.json({ users });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

/**
 * POST /api/admin/users
 * Create a new local user
 */
router.post(
  '/users',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 6 }),
    body('firstName').optional().trim(),
    body('lastName').optional().trim(),
    body('role').optional().isIn(['admin', 'manager', 'user']),
    body('department').optional().trim(),
    body('phone').optional().trim(),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { email, password, firstName, lastName, role, department, phone } = req.body;

      // Check if user already exists
      const existing = await db('users').where('email', email).first();
      if (existing) {
        return res.status(409).json({ error: 'Email already exists' });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const username = email.split('@')[0]; // derive username from email

      const [inserted] = await db('users')
        .insert({
          username,
          email,
          password_hash: passwordHash,
          first_name: firstName || null,
          last_name: lastName || null,
          role: role || 'user',
          auth_provider: 'local',
          is_active: true,
          department: department || null,
          phone: phone || null,
        })
        .returning('*');

      let user = inserted;
      if (!user || typeof user === 'number') {
        const id = typeof user === 'number' ? user : (user as any);
        user = await db('users').where('id', id).first();
      }

      await activityService.log({
        entity_type: 'user',
        entity_id: user.id,
        action: 'created',
        details: { email, role: role || 'user' },
        performed_by: req.user.id,
      });

      res.status(201).json({
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          role: user.role,
          isActive: user.is_active,
        },
      });
    } catch (error) {
      console.error('Error creating user:', error);
      res.status(500).json({ error: 'Failed to create user' });
    }
  }
);

/**
 * PUT /api/admin/users/:id
 * Update a user
 */
router.put(
  '/users/:id',
  [
    body('email').optional().isEmail().normalizeEmail(),
    body('firstName').optional().trim(),
    body('lastName').optional().trim(),
    body('role').optional().isIn(['admin', 'manager', 'user']),
    body('isActive').optional().isBoolean(),
    body('password').optional().isLength({ min: 6 }),
    body('department').optional().trim(),
    body('phone').optional().trim(),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { id } = req.params;
      const { email, firstName, lastName, role, isActive, password, department, phone } = req.body;

      const existing = await db('users').where('id', id).first();
      if (!existing) {
        return res.status(404).json({ error: 'User not found' });
      }

      const updateData: any = { updated_at: db.fn.now() };
      if (email) updateData.email = email;
      if (firstName !== undefined) updateData.first_name = firstName;
      if (lastName !== undefined) updateData.last_name = lastName;
      if (role) updateData.role = role;
      if (isActive !== undefined) updateData.is_active = isActive;
      if (department !== undefined) updateData.department = department;
      if (phone !== undefined) updateData.phone = phone;
      if (password) {
        updateData.password_hash = await bcrypt.hash(password, 10);
      }

      await db('users').where('id', id).update(updateData);

      await activityService.log({
        entity_type: 'user',
        entity_id: Number(id),
        action: 'updated',
        details: { fields: Object.keys(updateData).filter((k) => k !== 'updated_at' && k !== 'password_hash') },
        performed_by: req.user.id,
      });

      const updated = await db('users')
        .where('id', id)
        .select('id', 'username', 'email', 'first_name', 'last_name', 'role', 'auth_provider', 'is_active', 'department', 'phone')
        .first();

      res.json({ user: updated });
    } catch (error) {
      console.error('Error updating user:', error);
      res.status(500).json({ error: 'Failed to update user' });
    }
  }
);

/**
 * DELETE /api/admin/users/:id
 * Deactivate a user (soft delete)
 */
router.delete('/users/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Prevent self-deletion
    if (Number(id) === req.user.id) {
      return res.status(400).json({ error: 'Cannot deactivate your own account' });
    }

    await db('users').where('id', id).update({ is_active: false, updated_at: db.fn.now() });

    await activityService.log({
      entity_type: 'user',
      entity_id: Number(id),
      action: 'deactivated',
      performed_by: req.user.id,
    });

    res.json({ message: 'User deactivated' });
  } catch (error) {
    console.error('Error deactivating user:', error);
    res.status(500).json({ error: 'Failed to deactivate user' });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// ACTIVITY LOG
// ═══════════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/activity
 * Get recent activity log
 */
router.get('/activity', async (req: AuthRequest, res: Response) => {
  try {
    const { limit = 50 } = req.query;
    const activity = await activityService.getRecent(Number(limit));
    res.json({ activity });
  } catch (error) {
    console.error('Error fetching activity log:', error);
    res.status(500).json({ error: 'Failed to fetch activity log' });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// DASHBOARD STATS
// ═══════════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/stats
 * Get dashboard statistics
 */
router.get('/stats', async (req: AuthRequest, res: Response) => {
  try {
    const [requestStats] = await db('maintenance_requests')
      .select(
        db.raw('COUNT(*) as total'),
        db.raw("COUNT(CASE WHEN status = 'open' THEN 1 END) as open_count"),
        db.raw("COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress_count"),
        db.raw("COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_count")
      );

    const [workOrderStats] = await db('work_orders')
      .select(
        db.raw('COUNT(*) as total'),
        db.raw("COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count"),
        db.raw("COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress_count"),
        db.raw("COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_count")
      );

    const [userStats] = await db('users')
      .select(
        db.raw('COUNT(*) as total'),
        db.raw("COUNT(CASE WHEN is_active = 1 OR is_active = true THEN 1 END) as active_count")
      );

    res.json({
      requests: requestStats,
      workOrders: workOrderStats,
      users: userStats,
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

export default router;
