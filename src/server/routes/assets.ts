import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import asseticClient from '../services/asseticClient';
import db from '../database';

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
    
    let qb = db('assets');

    if (status) {
      qb = qb.where('status', status as string);
    }

    if (category) {
      qb = qb.where('category', category as string);
    }

    const assets = await qb
      .orderBy('created_at', 'desc')
      .limit(Number(limit))
      .offset(Number(offset));

    res.json({
      assets,
      total: assets.length,
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
    
    const asset = await db('assets').where('id', id).first();

    if (!asset) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    res.json(asset);
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

    const changes = await db('asset_changes')
      .where('asset_id', id)
      .orderBy('changed_at', 'desc')
      .limit(Number(limit))
      .offset(Number(offset));

    res.json({
      changes,
      total: changes.length,
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
        const existing = await db('assets')
          .where('assetic_id', asseticAsset.id)
          .select('id', 'data')
          .first();

        if (existing) {
          // Update existing asset and track changes
          const oldData = typeof existing.data === 'string' ? JSON.parse(existing.data) : existing.data;
          const changes = compareAssetData(oldData, asseticAsset);

          await db('assets')
            .where('assetic_id', asseticAsset.id)
            .update({
              asset_tag: asseticAsset.assetTag,
              description: asseticAsset.description,
              category: asseticAsset.category,
              location: asseticAsset.location,
              status: asseticAsset.status,
              data: JSON.stringify(asseticAsset),
              last_synced_at: db.fn.now(),
              updated_at: db.fn.now(),
            });

          // Log changes
          for (const change of changes) {
            await db('asset_changes').insert({
              asset_id: existing.id,
              change_type: 'update',
              field_name: change.field,
              old_value: change.oldValue,
              new_value: change.newValue,
              changed_at: db.fn.now(),
            });
          }
        } else {
          // Insert new asset
          await db('assets').insert({
            assetic_id: asseticAsset.id,
            asset_tag: asseticAsset.assetTag,
            description: asseticAsset.description,
            category: asseticAsset.category,
            location: asseticAsset.location,
            status: asseticAsset.status,
            data: JSON.stringify(asseticAsset),
            last_synced_at: db.fn.now(),
          });
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
    if (oldData?.[field] !== newData[field]) {
      changes.push({
        field,
        oldValue: oldData?.[field],
        newValue: newData[field],
      });
    }
  }

  return changes;
}

export default router;
