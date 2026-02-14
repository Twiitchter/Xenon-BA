import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import db from '../database';

export interface ReportData {
  title: string;
  type: string;
  generatedBy?: number;
  data: any;
}

class PDFService {
  private reportsDir: string;

  constructor() {
    this.reportsDir = path.join(__dirname, '../../reports');
    if (!fs.existsSync(this.reportsDir)) {
      fs.mkdirSync(this.reportsDir, { recursive: true });
    }
  }

  /**
   * Generate a PDF report for assets
   */
  async generateAssetReport(assets: any[], options?: any): Promise<string> {
    const fileName = `asset-report-${Date.now()}.pdf`;
    const filePath = path.join(this.reportsDir, fileName);

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50 });
        const stream = fs.createWriteStream(filePath);

        doc.pipe(stream);

        // Header
        doc.fontSize(20).text('Asset Report', { align: 'center' });
        doc.moveDown();
        doc.fontSize(10).text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
        doc.moveDown(2);

        // Table header
        doc.fontSize(12).text('Asset Details', { underline: true });
        doc.moveDown();

        // Asset details
        assets.forEach((asset, index) => {
          doc.fontSize(10);
          doc.text(`${index + 1}. Asset Tag: ${asset.asset_tag || 'N/A'}`);
          doc.text(`   Description: ${asset.description || 'N/A'}`);
          doc.text(`   Category: ${asset.category || 'N/A'}`);
          doc.text(`   Location: ${asset.location || 'N/A'}`);
          doc.text(`   Status: ${asset.status || 'N/A'}`);
          if (asset.purchase_cost) {
            doc.text(`   Purchase Cost: $${asset.purchase_cost}`);
          }
          doc.moveDown();
        });

        // Summary
        doc.moveDown();
        doc.fontSize(12).text('Summary', { underline: true });
        doc.fontSize(10).text(`Total Assets: ${assets.length}`);

        doc.end();

        stream.on('finish', () => {
          resolve(fileName);
        });

        stream.on('error', (err) => {
          reject(err);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Generate a PDF report for asset changes
   */
  async generateChangeReport(changes: any[], options?: any): Promise<string> {
    const fileName = `change-report-${Date.now()}.pdf`;
    const filePath = path.join(this.reportsDir, fileName);

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50 });
        const stream = fs.createWriteStream(filePath);

        doc.pipe(stream);

        // Header
        doc.fontSize(20).text('Asset Change Report', { align: 'center' });
        doc.moveDown();
        doc.fontSize(10).text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
        doc.moveDown(2);

        // Changes
        doc.fontSize(12).text('Changes', { underline: true });
        doc.moveDown();

        changes.forEach((change, index) => {
          doc.fontSize(10);
          doc.text(`${index + 1}. Change Type: ${change.change_type}`);
          doc.text(`   Field: ${change.field_name || 'N/A'}`);
          doc.text(`   Old Value: ${change.old_value || 'N/A'}`);
          doc.text(`   New Value: ${change.new_value || 'N/A'}`);
          doc.text(`   Changed By: ${change.changed_by || 'N/A'}`);
          doc.text(`   Changed At: ${new Date(change.changed_at).toLocaleString()}`);
          doc.moveDown();
        });

        // Summary
        doc.moveDown();
        doc.fontSize(12).text('Summary', { underline: true });
        doc.fontSize(10).text(`Total Changes: ${changes.length}`);

        doc.end();

        stream.on('finish', () => {
          resolve(fileName);
        });

        stream.on('error', (err) => {
          reject(err);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Get the file path for a report
   */
  getReportPath(fileName: string): string {
    return path.join(this.reportsDir, fileName);
  }

  /**
   * Log report generation
   */
  async logReport(reportData: ReportData, fileName: string, status: string): Promise<void> {
    try {
      await db('report_logs').insert({
        report_type: reportData.type,
        generated_by: reportData.generatedBy || null,
        file_name: fileName,
        parameters: JSON.stringify(reportData.data),
        status,
      });
    } catch (error) {
      console.error('Failed to log report:', error);
    }
  }
}

export default new PDFService();
