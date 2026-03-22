/**
 * pdfTemplateDefaults.ts
 *
 * Shared default PDF template configuration used by both the admin routes
 * and the maintenance (public) route so defaults are defined in one place.
 */

export type TemplateType = "work_order" | "work_request";

export const VALID_TEMPLATE_TYPES: TemplateType[] = [
  "work_order",
  "work_request",
];

export const DEFAULT_PDF_TEMPLATES: Record<TemplateType, object> = {
  work_order: {
    sections: [
      { id: "details", enabled: true, customTitle: null },
      { id: "description", enabled: true, customTitle: null },
      { id: "asset", enabled: true, customTitle: null },
      { id: "originating_request", enabled: true, customTitle: null },
    ],
    customSections: [],
  },
  work_request: {
    sections: [
      { id: "details", enabled: true, customTitle: null },
      { id: "description", enabled: true, customTitle: null },
      { id: "requestor", enabled: true, customTitle: null },
      { id: "asset", enabled: true, customTitle: null },
    ],
    customSections: [],
  },
};
