import nodemailer, { Transporter } from "nodemailer";
import https from "https";
import path from "path";
import db from "../database";
import settingsService from "./settingsService";

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

interface WRNotificationData {
  requestId: number;
  friendlyId?: string | null;
  title: string;
  description?: string | null;
  priority: string;
  location?: string | null;
  requestorName?: string | null;
  requestorEmail?: string | null;
}

interface WONotificationData {
  workOrderId: number;
  friendlyId?: string | null;
  title: string;
  description?: string | null;
  priority: string;
  location?: string | null;
  craft?: string | null;
  workGroup?: string | null;
  status?: string;
  requestorName?: string | null;
  requestorEmail?: string | null;
  assigneeName?: string | null;
  assigneeEmail?: string | null;
  wrFriendlyId?: string | null;
}

class EmailService {
  private transporter: Transporter | null = null;

  /**
   * Build or rebuild the SMTP transporter from current settings.
   */
  private async getTransporter(): Promise<Transporter> {
    const host = await settingsService.get("email_smtp_host");
    const port = await settingsService.get("email_smtp_port", "587");
    const secure = await settingsService.getBool("email_smtp_secure");
    const user = await settingsService.get("email_smtp_user");
    const pass = await settingsService.get("email_smtp_password");

    this.transporter = nodemailer.createTransport({
      host: host || undefined,
      port: parseInt(port, 10),
      secure,
      auth: user ? { user, pass } : undefined,
    });

    return this.transporter;
  }

  /**
   * Return the configured From header value.
   */
  private async getFrom(): Promise<string> {
    const address = await settingsService.get("email_from_address");
    const name = await settingsService.get(
      "email_from_name",
      "Facilities Management Portal",
    );
    if (!address) return "";
    return name ? `"${name}" <${address}>` : address;
  }

  /**
   * Send email via the configured API provider (SendGrid / Mailgun).
   * Uses the built-in https module so no extra dependency is needed.
   */
  private async sendViaApi(
    from: string,
    to: string,
    subject: string,
    html: string,
  ): Promise<void> {
    const provider = await settingsService.get(
      "email_api_provider",
      "sendgrid",
    );
    const apiKey = await settingsService.get("email_api_key");

    if (!apiKey) {
      throw new Error("Email API key is not configured");
    }

    if (provider === "sendgrid") {
      await this.sendViaSendGrid(apiKey, from, to, subject, html);
    } else if (provider === "mailgun") {
      const domain = await settingsService.get("email_api_domain");
      if (!domain) {
        throw new Error("Mailgun domain is not configured");
      }
      await this.sendViaMailgun(apiKey, domain, from, to, subject, html);
    } else {
      throw new Error(`Unsupported email API provider: ${provider}`);
    }
  }

  private sendViaSendGrid(
    apiKey: string,
    from: string,
    to: string,
    subject: string,
    html: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: from.replace(/^".*"\s*<(.+)>$/, "$1") || from },
        subject,
        content: [{ type: "text/html", value: html }],
      });

      const req = https.request(
        {
          hostname: "api.sendgrid.com",
          path: "/v3/mail/send",
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve();
            } else {
              reject(
                new Error(
                  `SendGrid API error (${res.statusCode}): ${data || "No response body"}`,
                ),
              );
            }
          });
        },
      );
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }

  private sendViaMailgun(
    apiKey: string,
    domain: string,
    from: string,
    to: string,
    subject: string,
    html: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const params = new URLSearchParams();
      params.append("from", from);
      params.append("to", to);
      params.append("subject", subject);
      params.append("html", html);
      const body = params.toString();

      const req = https.request(
        {
          hostname: "api.mailgun.net",
          path: `/v3/${domain}/messages`,
          method: "POST",
          headers: {
            Authorization:
              "Basic " + Buffer.from(`api:${apiKey}`).toString("base64"),
            "Content-Type": "application/x-www-form-urlencoded",
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve();
            } else {
              reject(
                new Error(
                  `Mailgun API error (${res.statusCode}): ${data || "No response body"}`,
                ),
              );
            }
          });
        },
      );
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }

  // ─── Core send ──────────────────────────────────────────────────────

  /**
   * Send an email using the configured provider.
   * Falls back from SMTP → API automatically if the primary method fails
   * and the other method is configured.
   */
  async sendEmail(options: EmailOptions): Promise<void> {
    const enabled = await settingsService.getBool(
      "email_notifications_enabled",
    );
    if (!enabled) {
      console.log("[Email] Notifications disabled — skipping send");
      return;
    }

    const from = await this.getFrom();
    if (!from) {
      console.warn("[Email] From address not configured — skipping send");
      return;
    }

    const recipient = Array.isArray(options.to)
      ? options.to.join(", ")
      : options.to;

    const provider = await settingsService.get("email_provider", "smtp");

    try {
      if (provider === "api") {
        await this.sendViaApi(
          from,
          recipient,
          options.subject,
          options.html || options.text || "",
        );
      } else {
        // SMTP
        const transporter = await this.getTransporter();
        await transporter.sendMail({
          from,
          to: recipient,
          subject: options.subject,
          text: options.text,
          html: options.html,
          attachments: options.attachments,
        });
      }
      console.log(`[Email] Sent to ${recipient}: ${options.subject}`);
      await this.logEmail(recipient, options.subject, options.html || options.text || "", "sent", null);
    } catch (primaryError) {
      const primaryMsg =
        primaryError instanceof Error ? primaryError.message : "Unknown error";
      console.error(`[Email] Primary send failed (${provider}):`, primaryMsg);

      // Attempt fallback
      const fallbackProvider = provider === "smtp" ? "api" : "smtp";
      try {
        if (fallbackProvider === "api") {
          await this.sendViaApi(
            from,
            recipient,
            options.subject,
            options.html || options.text || "",
          );
        } else {
          const transporter = await this.getTransporter();
          await transporter.sendMail({
            from,
            to: recipient,
            subject: options.subject,
            text: options.text,
            html: options.html,
            attachments: options.attachments,
          });
        }
        console.log(
          `[Email] Sent via fallback (${fallbackProvider}) to ${recipient}`,
        );
        await this.logEmail(recipient, options.subject, options.html || options.text || "", "sent", null);
      } catch (fallbackError) {
        const fallbackMsg =
          fallbackError instanceof Error
            ? fallbackError.message
            : "Unknown error";
        const combinedMsg = `Primary (${provider}): ${primaryMsg} | Fallback (${fallbackProvider}): ${fallbackMsg}`;
        console.error("[Email] Fallback also failed:", fallbackMsg);
        await this.logEmail(
          recipient,
          options.subject,
          options.html || options.text || "",
          "failed",
          combinedMsg,
        );
      }
    }
  }

  /**
   * Send email with PDF attachment
   */
  async sendEmailWithPDF(
    to: string | string[],
    subject: string,
    body: string,
    pdfPath: string,
  ): Promise<void> {
    const fileName = path.basename(pdfPath);

    await this.sendEmail({
      to,
      subject,
      html: body,
      attachments: [{ filename: fileName, path: pdfPath }],
    });
  }

  /**
   * Send asset report email
   */
  async sendAssetReport(
    to: string | string[],
    _reportFileName: string,
    reportPath: string,
  ): Promise<void> {
    const appName = await settingsService.get(
      "app_name",
      "Facilities Management Portal",
    );
    const subject = "Asset Report";
    const body = `
      <h2>Asset Report</h2>
      <p>Please find attached the asset report you requested.</p>
      <p>Generated: ${new Date().toLocaleString()}</p>
      <p>This is an automated email from ${appName}.</p>
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
    pdfPath?: string,
  ): Promise<void> {
    const appName = await settingsService.get(
      "app_name",
      "Facilities Management Portal",
    );
    const subject = "Asset Change Notification";

    let changesHtml = "<ul>";
    changes.slice(0, 10).forEach((change) => {
      changesHtml += `<li>${change.change_type} - ${change.field_name}: ${change.old_value} → ${change.new_value}</li>`;
    });
    changesHtml += "</ul>";

    const body = `
      <h2>Asset Changes Detected</h2>
      <p>${changes.length} change(s) have been detected in the asset system.</p>
      ${changesHtml}
      ${changes.length > 10 ? "<p>... and more changes. See attached report for full details.</p>" : ""}
      <p>This is an automated email from ${appName}.</p>
    `;

    if (withPDF && pdfPath) {
      await this.sendEmailWithPDF(to, subject, body, pdfPath);
    } else {
      await this.sendEmail({ to, subject, html: body });
    }
  }

  // ─── WR / WO notification methods ──────────────────────────────────

  /**
   * Notify admins when a new work request is submitted.
   */
  async notifyNewWorkRequest(data: WRNotificationData): Promise<void> {
    const adminEmails = await this.getAdminEmails();
    if (!adminEmails.length) return;

    const html = await this.buildTemplate("New Work Request Submitted", [
      { label: "WR #", value: data.friendlyId || String(data.requestId) },
      { label: "Title", value: data.title },
      { label: "Priority", value: data.priority },
      ...(data.location ? [{ label: "Location", value: data.location }] : []),
      ...(data.requestorName
        ? [{ label: "Requestor", value: data.requestorName }]
        : []),
      ...(data.description
        ? [{ label: "Description", value: data.description }]
        : []),
    ]);

    await this.sendEmail({
      to: adminEmails,
      subject: `New Work Request: ${data.title}`,
      html,
    });
  }

  /**
   * Notify the requestor when a work order is created from their request.
   */
  async notifyWorkOrderCreated(data: WONotificationData): Promise<void> {
    const to = data.requestorEmail;
    if (!to) return;

    const html = await this.buildTemplate(
      "Work Order Created",
      [
        {
          label: "WO #",
          value: data.friendlyId || String(data.workOrderId),
        },
        { label: "Title", value: data.title },
        { label: "Priority", value: data.priority },
        ...(data.craft ? [{ label: "Craft", value: data.craft }] : []),
        ...(data.workGroup
          ? [{ label: "Work Group", value: data.workGroup }]
          : []),
        ...(data.location
          ? [{ label: "Location", value: data.location }]
          : []),
        ...(data.wrFriendlyId
          ? [{ label: "Work Request", value: data.wrFriendlyId }]
          : []),
      ],
      data.workOrderId,
    );

    await this.sendEmail({
      to,
      subject: `Work Order Created: ${data.title}`,
      html,
    });
  }

  /**
   * Notify the requestor when a work order status changes.
   */
  async notifyWorkOrderStatusChanged(
    data: WONotificationData,
    oldStatus: string,
    newStatus: string,
  ): Promise<void> {
    const to = data.requestorEmail;
    if (!to) return;

    const html = await this.buildTemplate(
      "Work Order Status Updated",
      [
        {
          label: "WO #",
          value: data.friendlyId || String(data.workOrderId),
        },
        { label: "Title", value: data.title },
        { label: "Previous Status", value: oldStatus },
        { label: "New Status", value: newStatus },
        { label: "Priority", value: data.priority },
        ...(data.location
          ? [{ label: "Location", value: data.location }]
          : []),
      ],
      data.workOrderId,
    );

    await this.sendEmail({
      to,
      subject: `Work Order Updated (${newStatus}): ${data.title}`,
      html,
    });
  }

  /**
   * Notify the assignee when a work order is assigned to them.
   */
  async notifyWorkOrderAssigned(data: WONotificationData): Promise<void> {
    const to = data.assigneeEmail;
    if (!to) return;

    const html = await this.buildTemplate(
      "Work Order Assigned to You",
      [
        {
          label: "WO #",
          value: data.friendlyId || String(data.workOrderId),
        },
        { label: "Title", value: data.title },
        { label: "Priority", value: data.priority },
        ...(data.craft ? [{ label: "Craft", value: data.craft }] : []),
        ...(data.workGroup
          ? [{ label: "Work Group", value: data.workGroup }]
          : []),
        ...(data.location
          ? [{ label: "Location", value: data.location }]
          : []),
        ...(data.description
          ? [{ label: "Description", value: data.description }]
          : []),
      ],
      data.workOrderId,
    );

    await this.sendEmail({
      to,
      subject: `Work Order Assigned: ${data.title}`,
      html,
    });
  }

  /**
   * Verify the current email configuration by sending a test message.
   */
  async sendTestEmail(to: string): Promise<void> {
    const html = await this.buildTemplate("Email Configuration Test", [
      {
        label: "Status",
        value: "Your email settings are working correctly.",
      },
      { label: "Sent at", value: new Date().toLocaleString() },
    ]);

    // Bypass the enabled check for test emails
    const from = await this.getFrom();
    if (!from) {
      throw new Error("From address is not configured");
    }

    const provider = await settingsService.get("email_provider", "smtp");
    const recipient = Array.isArray(to) ? to : to;

    if (provider === "api") {
      await this.sendViaApi(from, recipient, "Email Configuration Test", html);
    } else {
      const transporter = await this.getTransporter();
      await transporter.sendMail({
        from,
        to: recipient,
        subject: "Email Configuration Test",
        html,
      });
    }
    await this.logEmail(recipient, "Email Configuration Test", html, "sent", null);
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  /**
   * Build a consistent HTML email template.
   */
  private async buildTemplate(
    heading: string,
    fields: { label: string; value: string }[],
    workOrderId?: number,
  ): Promise<string> {
    const appName = await settingsService.get(
      "app_name",
      "Facilities Management Portal",
    );
    const portalUrl = await settingsService.get("email_portal_url");

    const rows = fields
      .map(
        (f) =>
          `<tr><td style="padding:6px 12px;font-weight:600;color:#555;white-space:nowrap">${f.label}</td><td style="padding:6px 12px">${f.value}</td></tr>`,
      )
      .join("");

    const linkSection =
      portalUrl && workOrderId
        ? `<p style="margin-top:20px"><a href="${portalUrl}/work-orders/${workOrderId}" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;display:inline-block">View in Portal</a></p>`
        : "";

    return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f4f4f7;color:#333">
  <div style="max-width:600px;margin:20px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
    <div style="background:#1e293b;padding:20px 24px">
      <h1 style="margin:0;font-size:20px;color:#fff">${appName}</h1>
    </div>
    <div style="padding:24px">
      <h2 style="margin:0 0 16px;font-size:18px;color:#1e293b">${heading}</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        ${rows}
      </table>
      ${linkSection}
    </div>
    <div style="background:#f8fafc;padding:16px 24px;font-size:12px;color:#94a3b8;text-align:center">
      This is an automated message from ${appName}. Please do not reply.
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Get admin user email addresses for notifications.
   */
  private async getAdminEmails(): Promise<string[]> {
    try {
      const admins = await db("users")
        .where("role", "admin")
        .where("is_active", true)
        .select("email");
      return admins.map((a: { email: string }) => a.email).filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Log email send attempt to the email_logs table.
   */
  private async logEmail(
    recipient: string,
    subject: string,
    body: string,
    status: string,
    errorMessage: string | null,
  ): Promise<void> {
    try {
      await db("email_logs").insert({
        recipient,
        subject,
        body,
        has_attachment: false,
        attachment_name: null,
        status,
        error_message: errorMessage,
        sent_at: status === "sent" ? new Date() : null,
      });
    } catch (error) {
      console.error("Failed to log email:", error);
    }
  }
}

export default new EmailService();
