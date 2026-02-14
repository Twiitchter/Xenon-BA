import nodemailer, { Transporter } from 'nodemailer';
import fs from 'fs';
import path from 'path';
import db from '../database';

interface EmailOptions {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: Array<{
    filename: string;
    path?: string;
    content?: Buffer;
  }>;
}

class EmailService {
  private transporter: Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.EMAIL_PORT || '587'),
      secure: process.env.EMAIL_SECURE === 'true',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
    });
  }

  /**
   * Send an email
   */
  async sendEmail(options: EmailOptions): Promise<void> {
    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
      attachments: options.attachments,
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log('Email sent:', info.messageId);

      // Log email
      await this.logEmail(
        Array.isArray(options.to) ? options.to.join(', ') : options.to,
        options.subject,
        options.text || options.html || '',
        !!(options.attachments && options.attachments.length > 0),
        options.attachments?.[0]?.filename,
        'sent',
        null
      );
    } catch (error) {
      console.error('Email send error:', error);
      
      // Log failed email
      await this.logEmail(
        Array.isArray(options.to) ? options.to.join(', ') : options.to,
        options.subject,
        options.text || options.html || '',
        !!(options.attachments && options.attachments.length > 0),
        options.attachments?.[0]?.filename,
        'failed',
        error instanceof Error ? error.message : 'Unknown error'
      );
      
      throw error;
    }
  }

  /**
   * Send email with PDF attachment
   */
  async sendEmailWithPDF(
    to: string | string[],
    subject: string,
    body: string,
    pdfPath: string
  ): Promise<void> {
    const fileName = path.basename(pdfPath);
    
    await this.sendEmail({
      to,
      subject,
      html: body,
      attachments: [
        {
          filename: fileName,
          path: pdfPath,
        },
      ],
    });
  }

  /**
   * Send asset report email
   */
  async sendAssetReport(
    to: string | string[],
    reportFileName: string,
    reportPath: string
  ): Promise<void> {
    const subject = 'Asset Report';
    const body = `
      <h2>Asset Report</h2>
      <p>Please find attached the asset report you requested.</p>
      <p>Generated: ${new Date().toLocaleString()}</p>
      <p>This is an automated email from XeonB CRM.</p>
    `;

    await this.sendEmailWithPDF(to, subject, body, reportPath);
  }

  /**
   * Send change notification email
   */
  async sendChangeNotification(
    to: string | string[],
    changes: any[],
    withPDF?: boolean,
    pdfPath?: string
  ): Promise<void> {
    const subject = 'Asset Change Notification';
    
    let changesHtml = '<ul>';
    changes.slice(0, 10).forEach((change) => {
      changesHtml += `<li>${change.change_type} - ${change.field_name}: ${change.old_value} → ${change.new_value}</li>`;
    });
    changesHtml += '</ul>';
    
    const body = `
      <h2>Asset Changes Detected</h2>
      <p>${changes.length} change(s) have been detected in the asset system.</p>
      ${changesHtml}
      ${changes.length > 10 ? '<p>... and more changes. See attached report for full details.</p>' : ''}
      <p>This is an automated email from XeonB CRM.</p>
    `;

    if (withPDF && pdfPath) {
      await this.sendEmailWithPDF(to, subject, body, pdfPath);
    } else {
      await this.sendEmail({
        to,
        subject,
        html: body,
      });
    }
  }

  /**
   * Log email to database
   */
  private async logEmail(
    recipient: string,
    subject: string,
    body: string,
    hasAttachment: boolean,
    attachmentName: string | undefined,
    status: string,
    errorMessage: string | null
  ): Promise<void> {
    try {
      await db('email_logs').insert({
        recipient,
        subject,
        body,
        has_attachment: hasAttachment,
        attachment_name: attachmentName || null,
        status,
        error_message: errorMessage,
        sent_at: status === 'sent' ? new Date() : null,
      });
    } catch (error) {
      console.error('Failed to log email:', error);
    }
  }
}

export default new EmailService();
