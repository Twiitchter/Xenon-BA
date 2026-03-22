import React, { useState, useEffect } from "react";
import Modal from "./Modal";

const STORAGE_KEY = "xeonb_pdf_wo_section";

export interface WorkOrderPDFSection {
  title: string;
  content: string;
}

const DEFAULTS: WorkOrderPDFSection = {
  title: "Additional Notes",
  content: "",
};

/** Load the persisted custom section from localStorage. Returns defaults if nothing is saved. */
export function loadWorkOrderPDFSection(): WorkOrderPDFSection {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null) {
        return {
          title: typeof parsed.title === "string" ? parsed.title : DEFAULTS.title,
          content: typeof parsed.content === "string" ? parsed.content : DEFAULTS.content,
        };
      }
    }
  } catch {
    // ignore
  }
  return { ...DEFAULTS };
}

interface WorkOrderPDFEditorProps {
  onClose: () => void;
  onSave: (section: WorkOrderPDFSection) => void;
}

const WorkOrderPDFEditor: React.FC<WorkOrderPDFEditorProps> = ({
  onClose,
  onSave,
}) => {
  const [title, setTitle] = useState(DEFAULTS.title);
  const [content, setContent] = useState(DEFAULTS.content);

  // Load persisted values on open
  useEffect(() => {
    const saved = loadWorkOrderPDFSection();
    setTitle(saved.title);
    setContent(saved.content);
  }, []);

  const handleSave = () => {
    const section: WorkOrderPDFSection = { title: title.trim() || DEFAULTS.title, content };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(section));
    } catch {
      // non-critical
    }
    onSave(section);
    onClose();
  };

  const handleClear = () => {
    setContent("");
  };

  return (
    <Modal onClose={onClose} maxWidth="560px">
      <div className="modal-header">
        <div>
          <h3>Work Order PDF — Custom Section</h3>
          <div style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "4px" }}>
            This section appears at the bottom of every work order PDF.
          </div>
        </div>
        <button className="btn-ghost" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="modal-body">
        {/* Section title */}
        <div className="form-group">
          <label htmlFor="pdf-section-title">Section Title</label>
          <input
            id="pdf-section-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Additional Notes, Instructions, Safety Notes…"
            maxLength={80}
          />
        </div>

        {/* Free text content */}
        <div className="form-group">
          <label htmlFor="pdf-section-content">Content</label>
          <textarea
            id="pdf-section-content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Enter the text that will appear in this section on every work order PDF. Leave blank to omit the section."
            rows={8}
            style={{ resize: "vertical", marginBottom: 0 }}
          />
          <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "4px" }}>
            Leave blank to omit this section from generated PDFs.
          </div>
        </div>

        {/* Info card */}
        <div
          style={{
            background: "var(--bg-secondary)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "12px 14px",
            fontSize: "13px",
            color: "var(--text-secondary)",
            marginBottom: "20px",
            lineHeight: 1.5,
          }}
        >
          <strong style={{ color: "var(--text-primary)" }}>How it works:</strong> When a
          work order PDF is downloaded, this section is appended after all work order fields.
          Use it for standing instructions, safety reminders, sign-off areas, or any standard
          text your team needs on every job sheet.
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
          {content && (
            <button
              className="btn-ghost btn-danger-ghost"
              onClick={handleClear}
              style={{ marginRight: "auto" }}
            >
              Clear Content
            </button>
          )}
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={handleSave}
            style={{ width: "auto", padding: "8px 20px" }}
          >
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default WorkOrderPDFEditor;
