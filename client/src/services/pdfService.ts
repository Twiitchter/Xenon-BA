/**
 * pdfService.ts
 *
 * JSON-templated PDF generation using jsPDF.
 *
 * A "template" is a plain object describing the document layout:
 *   - header: organisation/logo text, title, subtitle
 *   - sections: array of labelled field groups
 *   - footer: optional footer text
 *
 * Templates are fully data-driven so any page (work order, work request,
 * report) can produce a PDF without touching this file.
 */
import jsPDF from "jspdf";

// ── Types ────────────────────────────────────────────────────────────────────

export interface PdfField {
  label: string;
  value: string | number | null | undefined;
  /** If true the value spans the full width instead of sitting beside the label */
  fullWidth?: boolean;
}

export interface PdfSection {
  title?: string;
  fields: PdfField[];
}

export interface PdfTemplate {
  /** Document title shown at the top (large text) */
  title: string;
  /** Optional subtitle / reference number shown below the title */
  subtitle?: string;
  /** Organisation name shown in the header band */
  organisation?: string;
  /** Sections of labelled fields */
  sections: PdfSection[];
  /** Optional footer text (centred at the bottom of each page) */
  footer?: string;
  /** Filename to save as (no extension required) */
  filename?: string;
}

// ── Colour palette ───────────────────────────────────────────────────────────

const BRAND_DARK = [15, 52, 96] as const; // deep navy
const BRAND_TEAL = [0, 164, 189] as const; // teal accent
const TEXT_PRIMARY = [30, 30, 30] as const;
const TEXT_MUTED = [120, 120, 120] as const;
const DIVIDER = [220, 220, 220] as const;
const PAGE_BG = [250, 250, 252] as const;

// ── Helpers ──────────────────────────────────────────────────────────────────

function setFill(doc: jsPDF, rgb: readonly [number, number, number]) {
  doc.setFillColor(rgb[0], rgb[1], rgb[2]);
}

function setDraw(doc: jsPDF, rgb: readonly [number, number, number]) {
  doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
}

function setTextColor(doc: jsPDF, rgb: readonly [number, number, number]) {
  doc.setTextColor(rgb[0], rgb[1], rgb[2]);
}

function formatValue(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

// ── Core generator ───────────────────────────────────────────────────────────

export function generatePdf(template: PdfTemplate): void {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  const PAGE_W = 210;
  const PAGE_H = 297;
  const MARGIN = 14;
  const CONTENT_W = PAGE_W - MARGIN * 2;
  const FOOTER_H = 10;

  let y = 0;

  // ── Page background ────────────────────────────────────────────────────────
  const drawPageBackground = () => {
    setFill(doc, PAGE_BG);
    doc.rect(0, 0, PAGE_W, PAGE_H, "F");
  };

  // ── Header band ───────────────────────────────────────────────────────────
  const drawHeader = () => {
    // Dark header bar
    setFill(doc, BRAND_DARK);
    doc.rect(0, 0, PAGE_W, 28, "F");

    // Teal accent strip
    setFill(doc, BRAND_TEAL);
    doc.rect(0, 28, PAGE_W, 3, "F");

    // Organisation name
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(255, 255, 255);
    doc.text(template.organisation || "XeonB Portal", MARGIN, 12);

    // Generated date (top-right)
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(180, 210, 230);
    const dateStr = new Date().toLocaleDateString("en-AU", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
    doc.text(`Generated ${dateStr}`, PAGE_W - MARGIN, 12, { align: "right" });

    // Document title (large)
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(255, 255, 255);
    doc.text(template.title, MARGIN, 23);

    y = 38;

    // Subtitle / reference
    if (template.subtitle) {
      setTextColor(doc, BRAND_TEAL);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text(template.subtitle, MARGIN, y);
      y += 7;
    } else {
      y += 2;
    }
  };

  // ── Footer ────────────────────────────────────────────────────────────────
  const drawFooter = (pageNum: number, totalPages: number) => {
    const footerY = PAGE_H - FOOTER_H;

    setFill(doc, BRAND_DARK);
    doc.rect(0, footerY - 1, PAGE_W, FOOTER_H + 1, "F");

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(180, 210, 230);

    const leftText = template.footer || "XeonB Maintenance Portal";
    doc.text(leftText, MARGIN, footerY + 5);
    doc.text(`Page ${pageNum} of ${totalPages}`, PAGE_W - MARGIN, footerY + 5, {
      align: "right",
    });
  };

  // ── Section heading ───────────────────────────────────────────────────────
  const drawSectionTitle = (title: string) => {
    ensureSpace(12);
    y += 3;
    setFill(doc, BRAND_TEAL);
    doc.rect(MARGIN, y, 3, 6, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    setTextColor(doc, BRAND_DARK);
    doc.text(title, MARGIN + 5, y + 5);
    y += 10;

    setDraw(doc, DIVIDER);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    y += 4;
  };

  // ── Field row (label : value) ─────────────────────────────────────────────
  const LABEL_W = 55;
  const VALUE_X = MARGIN + LABEL_W + 3;
  const VALUE_W = CONTENT_W - LABEL_W - 3;
  const ROW_H = 7;
  const ROW_PAD = 1.5;

  const drawField = (field: PdfField, rowIndex: number) => {
    const val = formatValue(field.value);
    const isEven = rowIndex % 2 === 0;

    if (field.fullWidth) {
      // Full-width value (e.g. description / supporting info)
      ensureSpace(ROW_H * 2 + 6);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      setTextColor(doc, TEXT_MUTED);
      doc.text(field.label.toUpperCase(), MARGIN, y + 4);
      y += ROW_H - 1;

      const lines = doc.splitTextToSize(val, CONTENT_W);
      const blockH = lines.length * 5.5 + ROW_PAD * 2;
      ensureSpace(blockH + 2);

      setFill(doc, [243, 244, 246]);
      setDraw(doc, DIVIDER);
      doc.roundedRect(MARGIN, y, CONTENT_W, blockH, 1.5, 1.5, "FD");

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      setTextColor(doc, TEXT_PRIMARY);
      doc.text(lines, MARGIN + 3, y + 5.5);
      y += blockH + 4;
      return;
    }

    ensureSpace(ROW_H + ROW_PAD * 2);

    // Subtle zebra stripe
    if (isEven) {
      setFill(doc, [244, 246, 248]);
      doc.rect(MARGIN, y, CONTENT_W, ROW_H + ROW_PAD * 2, "F");
    }

    // Label
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    setTextColor(doc, TEXT_MUTED);
    doc.text(field.label, MARGIN + 2, y + ROW_H - 1);

    // Value
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    setTextColor(doc, TEXT_PRIMARY);
    const valLines = doc.splitTextToSize(val, VALUE_W);
    doc.text(valLines, VALUE_X, y + ROW_H - 1);

    y += ROW_H + ROW_PAD * 2;
  };

  // ── Page overflow guard ───────────────────────────────────────────────────
  const USABLE_BOTTOM = PAGE_H - FOOTER_H - 8;

  const ensureSpace = (needed: number) => {
    if (y + needed > USABLE_BOTTOM) {
      // placeholder page number; we'll overwrite footers at the end
      doc.addPage();
      drawPageBackground();
      y = MARGIN + 4;
    }
  };

  // ── Build document ────────────────────────────────────────────────────────
  drawPageBackground();
  drawHeader();

  template.sections.forEach((section) => {
    if (section.title) {
      drawSectionTitle(section.title);
    } else {
      y += 2;
    }

    section.fields.forEach((field, idx) => {
      drawField(field, idx);
    });

    y += 4; // inter-section gap
  });

  // ── Stamp footers on every page ───────────────────────────────────────────
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    drawFooter(p, totalPages);
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  const clean = (s: string) => s.replace(/[^a-z0-9_\-]/gi, "_");
  const filename = template.filename
    ? `${clean(template.filename)}.pdf`
    : `${clean(template.title)}.pdf`;

  doc.save(filename);
}

// ── Pre-built template factories ─────────────────────────────────────────────

/** Build a work order PDF template from a work order data object */
export function buildWorkOrderTemplate(
  wo: any,
  extraSection?: { title: string; content: string },
): PdfTemplate {
  const fmt = (v: any) => (v ? String(v) : undefined);
  const fmtDate = (v: any) => {
    if (!v) return undefined;
    try {
      return new Date(v).toLocaleDateString("en-AU", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return String(v);
    }
  };

  const woId = wo.assetic_work_order_id || `WO-${wo.id}`;
  const wrId =
    wo.assetic_work_request_id ||
    (wo.request_id ? `WR-${wo.request_id}` : null);

  return {
    title: "Work Order",
    subtitle: woId,
    organisation: "XeonB Maintenance Portal",
    filename: `Work_Order_${woId}`,
    footer: `Work Order ${woId} — XeonB Maintenance Portal`,
    sections: [
      {
        title: "Work Order Details",
        fields: [
          { label: "WO Reference", value: woId },
          { label: "WR Reference", value: fmt(wrId) },
          { label: "Title", value: fmt(wo.title) },
          {
            label: "Status",
            value: fmt(wo.status)?.replace(/_/g, " ").toUpperCase(),
          },
          { label: "Priority", value: fmt(wo.priority)?.toUpperCase() },
          { label: "Craft", value: fmt(wo.craft) },
          { label: "Work Group", value: fmt(wo.work_group) },
          { label: "Assigned To", value: fmt(wo.assigned_to_username) },
          { label: "Scheduled Date", value: fmtDate(wo.scheduled_date) },
          { label: "Created", value: fmtDate(wo.created_at) },
          { label: "Last Updated", value: fmtDate(wo.updated_at) },
        ],
      },
      ...(wo.description
        ? [
            {
              title: "Description",
              fields: [
                {
                  label: "Description",
                  value: fmt(wo.description),
                  fullWidth: true,
                },
              ],
            },
          ]
        : []),
      ...(wo.asset_name || wo.assetic_asset_guid
        ? [
            {
              title: "Asset Information",
              fields: [
                { label: "Asset Name", value: fmt(wo.asset_name) },
                { label: "Asset GUID", value: fmt(wo.assetic_asset_guid) },
                { label: "Location", value: fmt(wo.asset_location) },
              ],
            },
          ]
        : []),
      ...(wo.request_title
        ? [
            {
              title: "Originating Work Request",
              fields: [
                { label: "WR Title", value: fmt(wo.request_title) },
                { label: "WR Reference", value: fmt(wrId) },
              ],
            },
          ]
        : []),
      ...(extraSection && extraSection.content.trim()
        ? [
            {
              title: extraSection.title || "Additional Notes",
              fields: [
                {
                  label: extraSection.title || "Additional Notes",
                  value: extraSection.content,
                  fullWidth: true,
                },
              ],
            },
          ]
        : []),
    ],
  };
}

/** Build a work request PDF template from a maintenance request data object */
export function buildWorkRequestTemplate(req: any): PdfTemplate {
  const fmt = (v: any) => (v ? String(v) : undefined);
  const fmtDate = (v: any) => {
    if (!v) return undefined;
    try {
      return new Date(v).toLocaleDateString("en-AU", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return String(v);
    }
  };

  const wrId = req.assetic_friendly_id || `WR-${req.id}`;

  return {
    title: "Work Request",
    subtitle: wrId,
    organisation: "XeonB Maintenance Portal",
    filename: `Work_Request_${wrId}`,
    footer: `Work Request ${wrId} — XeonB Maintenance Portal`,
    sections: [
      {
        title: "Request Details",
        fields: [
          { label: "WR Reference", value: wrId },
          { label: "Title", value: fmt(req.title) },
          {
            label: "Status",
            value: fmt(req.status)?.replace(/_/g, " ").toUpperCase(),
          },
          { label: "Priority", value: fmt(req.priority)?.toUpperCase() },
          { label: "Category", value: fmt(req.category) },
          { label: "Location", value: fmt(req.location) },
          { label: "Submitted", value: fmtDate(req.created_at) },
        ],
      },
      ...(req.description || req.supporting_information
        ? [
            {
              title: "Description",
              fields: [
                {
                  label: "Description",
                  value: fmt(req.description || req.supporting_information),
                  fullWidth: true,
                },
              ],
            },
          ]
        : []),
      ...(req.requestor_display_name || req.requestor_email
        ? [
            {
              title: "Requestor",
              fields: [
                { label: "Name", value: fmt(req.requestor_display_name) },
                { label: "Email", value: fmt(req.requestor_email) },
                {
                  label: "Phone",
                  value: fmt(req.requestor_phone || req.requestor_mobile),
                },
              ],
            },
          ]
        : []),
      ...(req.asset_display_name || req.assetic_asset_guid
        ? [
            {
              title: "Asset Information",
              fields: [
                { label: "Asset", value: fmt(req.asset_display_name) },
                { label: "Asset GUID", value: fmt(req.assetic_asset_guid) },
              ],
            },
          ]
        : []),
    ],
  };
}
