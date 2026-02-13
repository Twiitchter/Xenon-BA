import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import asseticClient from '../services/asseticClient';
import { query } from '../database';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

/**
 * GET /api/assets
 * Get all assets from local database
 */
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { status, category, limit = 100, offset = 0 } = req.query;
    
    let queryText = 'SELECT * FROM assets WHERE 1=1';
    const params: any[] = [];
    let paramCount = 0;

    if (status) {
      paramCount++;
      queryText += ` AND status = $${paramCount}`;
      params.push(status);
    }

    if (category) {
      paramCount++;
      queryText += ` AND category = $${paramCount}`;
      params.push(category);
    }

    paramCount++;
    queryText += ` ORDER BY created_at DESC LIMIT $${paramCount}`;
    params.push(limit);

    paramCount++;
    queryText += ` OFFSET $${paramCount}`;
    params.push(offset);

    const result = await query(queryText, params);

    res.json({
      assets: result.rows,
      total: result.rowCount,
    });
  } catch (error) {
    console.error('Error fetching assets:', error);
    res.status(500).json({ error: 'Failed to fetch assets' });
  }
});

/**
 * GET /api/assets/:id
 * Get a specific asset
 */
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    
    const result = await query('SELECT * FROM assets WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching asset:', error);
    res.status(500).json({ error: 'Failed to fetch asset' });
  }
});

/**
 * GET /api/assets/:id/changes
 * Get change history for an asset
 */
router.get('/:id/changes', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    const result = await query(
      `SELECT * FROM asset_changes 
       WHERE asset_id = $1 
       ORDER BY changed_at DESC 
       LIMIT $2 OFFSET $3`,
      [id, limit, offset]
    );

    res.json({
      changes: result.rows,
      total: result.rowCount,
    });
  } catch (error) {
    console.error('Error fetching asset changes:', error);
    res.status(500).json({ error: 'Failed to fetch asset changes' });
  }
});

/**
 * POST /api/assets/sync
 * Sync assets from Assetic API to local database
 */
router.post('/sync', async (req: AuthRequest, res: Response) => {
  try {
    // Fetch assets from Assetic API
    const asseticAssets = await asseticClient.getAssets();

    let syncedCount = 0;
    let errorCount = 0;

    for (const asseticAsset of asseticAssets) {
      try {
        // Check if asset exists
        const existing = await query('SELECT id, data FROM assets WHERE assetic_id = $1', [
          asseticAsset.id,
        ]);

        if (existing.rows.length > 0) {
          // Update existing asset and track changes
          const oldData = existing.rows[0].data;
          const changes = compareAssetData(oldData, asseticAsset);

          await query(
            `UPDATE assets 
             SET asset_tag = $1, description = $2, category = $3, location = $4, 
                 status = $5, data = $6, last_synced_at = NOW(), updated_at = NOW()
             WHERE assetic_id = $7`,
            [
              asseticAsset.assetTag,
              asseticAsset.description,
              asseticAsset.category,
              asseticAsset.location,
              asseticAsset.status,
              JSON.stringify(asseticAsset),
              asseticAsset.id,
            ]
          );

          // Log changes
          for (const change of changes) {
            await query(
              `INSERT INTO asset_changes (asset_id, change_type, field_name, old_value, new_value, changed_at)
               VALUES ($1, $2, $3, $4, $5, NOW())`,
              [existing.rows[0].id, 'update', change.field, change.oldValue, change.newValue]
            );
          }
        } else {
          // Insert new asset
          await query(
            `INSERT INTO assets (assetic_id, asset_tag, description, category, location, status, data, last_synced_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
            [
              asseticAsset.id,
              asseticAsset.assetTag,
              asseticAsset.description,
              asseticAsset.category,
              asseticAsset.location,
              asseticAsset.status,
              JSON.stringify(asseticAsset),
            ]
          );
        }

        syncedCount++;
      } catch (error) {
        console.error(`Error syncing asset ${asseticAsset.id}:`, error);
        errorCount++;
      }
    }

    res.json({
      message: 'Sync completed',
      syncedCount,
      errorCount,
      total: asseticAssets.length,
    });
  } catch (error) {
    console.error('Error syncing assets:', error);
    res.status(500).json({ error: 'Failed to sync assets' });
  }
});

/**
 * Helper function to compare asset data and detect changes
 */
function compareAssetData(oldData: any, newData: any): Array<{ field: string; oldValue: any; newValue: any }> {
  const changes: Array<{ field: string; oldValue: any; newValue: any }> = [];
  const fieldsToCompare = ['assetTag', 'description', 'category', 'location', 'status'];

  for (const field of fieldsToCompare) {
    if (oldData[field] !== newData[field]) {
      changes.push({
        field,
        oldValue: oldData[field],
        newValue: newData[field],
      });
    }
  }

  return changes;
}

export default router;
