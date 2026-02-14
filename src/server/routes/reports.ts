import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import pdfService from '../services/pdfService';
import emailService from '../services/emailService';
import db from '../database';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

/**
 * POST /api/reports/assets
 * Generate PDF report for assets
 */
router.post('/assets', async (req: AuthRequest, res: Response) => {
  try {
    const { status, category, email } = req.body;

    // Fetch assets based on filters
    let qb = db('assets');

    if (status) {
      qb = qb.where('status', status);
    }

    if (category) {
      qb = qb.where('category', category);
    }

    const assets = await qb.orderBy('created_at', 'desc');

    // Generate PDF
    const fileName = await pdfService.generateAssetReport(assets);
    const filePath = pdfService.getReportPath(fileName);

    // Log report generation
    await pdfService.logReport(
      {
        title: 'Asset Report',
        type: 'assets',
        generatedBy: req.user.id,
        data: { status, category, assetCount: assets.length },
      },
      fileName,
      'success'
    );

    // Send email if requested
    if (email) {
      await emailService.sendAssetReport(email, fileName, filePath);
      return res.json({
        message: 'Report generated and emailed successfully',
        fileName,
      });
    }

    res.json({
      message: 'Report generated successfully',
      fileName,
      downloadUrl: `/api/reports/download/${fileName}`,
    });
  } catch (error) {
    console.error('Error generating asset report:', error);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

/**
 * POST /api/reports/changes
 * Generate PDF report for asset changes
 */
router.post('/changes', async (req: AuthRequest, res: Response) => {
  try {
    const { assetId, startDate, endDate, email } = req.body;

    // Fetch changes based on filters
    let qb = db('asset_changes');

    if (assetId) {
      qb = qb.where('asset_id', assetId);
    }

    if (startDate) {
      qb = qb.where('changed_at', '>=', startDate);
    }

    if (endDate) {
      qb = qb.where('changed_at', '<=', endDate);
    }

    const changes = await qb.orderBy('changed_at', 'desc');

    // Generate PDF
    const fileName = await pdfService.generateChangeReport(changes);
    const filePath = pdfService.getReportPath(fileName);

    // Log report generation
    await pdfService.logReport(
      {
        title: 'Change Report',
        type: 'changes',
        generatedBy: req.user.id,
        data: { assetId, startDate, endDate, changeCount: changes.length },
      },
      fileName,
      'success'
    );

    // Send email if requested
    if (email) {
      await emailService.sendChangeNotification(email, changes, true, filePath);
      return res.json({
        message: 'Report generated and emailed successfully',
        fileName,
      });
    }

    res.json({
      message: 'Report generated successfully',
      fileName,
      downloadUrl: `/api/reports/download/${fileName}`,
    });
  } catch (error) {
    console.error('Error generating change report:', error);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

/**
 * GET /api/reports/download/:fileName
 * Download a generated report
 */
router.get('/download/:fileName', async (req: AuthRequest, res: Response) => {
  try {
    const { fileName } = req.params;
    const filePath = pdfService.getReportPath(fileName);

    // Check if file exists
    const fs = require('fs');
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Report not found' });
    }

    res.download(filePath, fileName);
  } catch (error) {
    console.error('Error downloading report:', error);
    res.status(500).json({ error: 'Failed to download report' });
  }
});

/**
 * POST /api/reports/email
 * Send an email with optional PDF attachment
 */
router.post(
  '/email',
  [
    body('to').isEmail().normalizeEmail(),
    body('subject').isLength({ min: 1 }).trim(),
    body('body').isLength({ min: 1 }),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { to, subject, body, attachmentFileName } = req.body;

      if (attachmentFileName) {
        const filePath = pdfService.getReportPath(attachmentFileName);
        await emailService.sendEmailWithPDF(to, subject, body, filePath);
      } else {
        await emailService.sendEmail({
          to,
          subject,
          html: body,
        });
      }

      res.json({ message: 'Email sent successfully' });
    } catch (error) {
      console.error('Error sending email:', error);
      res.status(500).json({ error: 'Failed to send email' });
    }
  }
);

export default router;
