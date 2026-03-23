import React, { useState, useEffect, useCallback } from "react";
import Modal from "./Modal";
import {
  adminService,
  type PdfTemplateConfig,
  type PdfSectionConfig,
  type PdfCustomSection,
} from "../services/adminService";

// ── Section metadata ──────────────────────────────────────────────────────────

const SECTION_LABELS: Record<string, Record<string, string>> = {
  work_order: {
    details: "Work Order Details",
    description: "Description",
    asset: "Asset Information",
    originating_request: "Originating Work Request",
  },
  work_request: {
    details: "Request Details",
    description: "Description",
    requestor: "Requestor",
    asset: "Asset Information",
  },
};

const DEFAULT_CONFIGS: Record<string, PdfTemplateConfig> = {
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

// ── Helper ────────────────────────────────────────────────────────────────────

function generateId(): string {
  return `cs_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ── Sub-component: one fixed section row ─────────────────────────────────────

interface SectionRowProps {
  section: PdfSectionConfig;
  label: string;
  onChange: (updated: PdfSectionConfig) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
}

const SectionRow: React.FC<SectionRowProps> = ({
  section,
  label,
  onChange,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}) => {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(section.customTitle || "");

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        gap: "10px",
        alignItems: "center",
        padding: "10px 12px",
        background: "var(--bg-secondary)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        marginBottom: "8px",
        opacity: section.enabled ? 1 : 0.5,
      }}
    >
      {/* Enable toggle */}
      <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", userSelect: "none" }}>
        <input
          type="checkbox"
          checked={section.enabled}
          onChange={(e) => onChange({ ...section, enabled: e.target.checked })}
          style={{ width: "16px", height: "16px", cursor: "pointer" }}
        />
      </label>

      {/* Section title / custom title editor */}
      <div>
        {editingTitle ? (
          <div style={{ display: "flex", gap: "6px" }}>
            <input
              autoFocus
              type="text"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              placeholder={label}
              style={{ flex: 1, padding: "4px 8px", fontSize: "13px" }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onChange({ ...section, customTitle: titleDraft.trim() || null });
                  setEditingTitle(false);
                } else if (e.key === "Escape") {
                  setTitleDraft(section.customTitle || "");
                  setEditingTitle(false);
                }
              }}
            />
            <button
              className="btn-ghost"
              style={{ padding: "4px 8px", fontSize: "12px" }}
              onClick={() => {
                onChange({ ...section, customTitle: titleDraft.trim() || null });
                setEditingTitle(false);
              }}
            >
              ✓
            </button>
            <button
              className="btn-ghost"
              style={{ padding: "4px 8px", fontSize: "12px" }}
              onClick={() => {
                setTitleDraft(section.customTitle || "");
                setEditingTitle(false);
              }}
            >
              ✕
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontWeight: 500, fontSize: "14px" }}>
              {section.customTitle || label}
            </span>
            {section.customTitle && (
              <span style={{ fontSize: "11px", color: "var(--text-muted)", fontStyle: "italic" }}>
                (default: {label})
              </span>
            )}
            <button
              className="btn-ghost"
              style={{ padding: "2px 6px", fontSize: "11px", opacity: 0.6 }}
              title="Rename section in PDF"
              onClick={() => {
                setTitleDraft(section.customTitle || "");
                setEditingTitle(true);
              }}
            >
              ✏
            </button>
            {section.customTitle && (
              <button
                className="btn-ghost"
                style={{ padding: "2px 6px", fontSize: "11px", opacity: 0.6 }}
                title="Reset to default name"
                onClick={() => onChange({ ...section, customTitle: null })}
              >
                ↺
              </button>
            )}
          </div>
        )}
      </div>

      {/* Reorder buttons */}
      <div style={{ display: "flex", gap: "4px" }}>
        <button
          className="btn-ghost"
          style={{ padding: "2px 6px", fontSize: "12px" }}
          onClick={onMoveUp}
          disabled={isFirst}
          title="Move up"
        >
          ↑
        </button>
        <button
          className="btn-ghost"
          style={{ padding: "2px 6px", fontSize: "12px" }}
          onClick={onMoveDown}
          disabled={isLast}
          title="Move down"
        >
          ↓
        </button>
      </div>
    </div>
  );
};

// ── Sub-component: custom free-text section ───────────────────────────────────

interface CustomSectionRowProps {
  section: PdfCustomSection;
  onChange: (updated: PdfCustomSection) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
}

const CustomSectionRow: React.FC<CustomSectionRowProps> = ({
  section,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}) => {
  return (
    <div
      style={{
        padding: "12px",
        background: "var(--bg-secondary)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        marginBottom: "8px",
      }}
    >
      <div style={{ display: "flex", gap: "8px", marginBottom: "8px", alignItems: "center" }}>
        <input
          type="text"
          value={section.title}
          onChange={(e) => onChange({ ...section, title: e.target.value })}
          placeholder="Section title (e.g. Safety Notes)"
          style={{ flex: 1, padding: "4px 8px", fontSize: "13px" }}
          maxLength={80}
        />
        <button
          className="btn-ghost"
          style={{ padding: "2px 6px", fontSize: "12px" }}
          onClick={onMoveUp}
          disabled={isFirst}
          title="Move up"
        >
          ↑
        </button>
        <button
          className="btn-ghost"
          style={{ padding: "2px 6px", fontSize: "12px" }}
          onClick={onMoveDown}
          disabled={isLast}
          title="Move down"
        >
          ↓
        </button>
        <button
          className="btn-ghost btn-danger-ghost"
          style={{ padding: "2px 8px", fontSize: "12px" }}
          onClick={onDelete}
          title="Remove this custom section"
        >
          ✕ Remove
        </button>
      </div>
      <textarea
        value={section.content}
        onChange={(e) => onChange({ ...section, content: e.target.value })}
        placeholder="Section content (leave blank to omit from PDF)"
        rows={4}
        style={{ width: "100%", resize: "vertical", padding: "6px 8px", fontSize: "13px", boxSizing: "border-box" }}
      />
    </div>
  );
};

// ── Main component ────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  work_order: "Work Order PDF",
  work_request: "Work Request PDF",
};

const PdfTemplateEditor: React.FC = () => {
  const [activeType, setActiveType] = useState<"work_order" | "work_request">("work_order");
  const [configs, setConfigs] = useState<Record<string, PdfTemplateConfig>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [confirmingReset, setConfirmingReset] = useState(false);

  useEffect(() => {
    void fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await adminService.getPdfTemplates();
      // Merge with defaults to ensure all sections are present
      const merged: Record<string, PdfTemplateConfig> = {};
      for (const type of ["work_order", "work_request"] as const) {
        const serverConfig = data.templates[type] as PdfTemplateConfig | undefined;
        const defaultConfig = DEFAULT_CONFIGS[type];
        if (serverConfig) {
          // Ensure all default section ids are represented
          const serverIds = new Set(serverConfig.sections.map((s) => s.id));
          const missingSections = defaultConfig.sections.filter((s) => !serverIds.has(s.id));
          merged[type] = {
            sections: [...serverConfig.sections, ...missingSections],
            customSections: serverConfig.customSections || [],
          };
        } else {
          merged[type] = { ...defaultConfig };
        }
      }
      setConfigs(merged);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to load PDF templates");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await adminService.updatePdfTemplate(activeType, configs[activeType]);
      setSuccess("PDF template saved successfully");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to save PDF template");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setConfirmingReset(true);
  };

  const confirmReset = () => {
    setConfigs((prev) => ({
      ...prev,
      [activeType]: { ...DEFAULT_CONFIGS[activeType] },
    }));
    setConfirmingReset(false);
  };

  const updateSection = useCallback(
    (idx: number, updated: PdfSectionConfig) => {
      setConfigs((prev) => {
        const sections = [...prev[activeType].sections];
        sections[idx] = updated;
        return { ...prev, [activeType]: { ...prev[activeType], sections } };
      });
    },
    [activeType],
  );

  const moveSection = useCallback(
    (from: number, to: number) => {
      setConfigs((prev) => {
        const sections = [...prev[activeType].sections];
        const [item] = sections.splice(from, 1);
        sections.splice(to, 0, item);
        return { ...prev, [activeType]: { ...prev[activeType], sections } };
      });
    },
    [activeType],
  );

  const addCustomSection = () => {
    setConfigs((prev) => ({
      ...prev,
      [activeType]: {
        ...prev[activeType],
        customSections: [
          ...prev[activeType].customSections,
          { id: generateId(), title: "Custom Section", content: "" },
        ],
      },
    }));
  };

  const updateCustomSection = useCallback(
    (idx: number, updated: PdfCustomSection) => {
      setConfigs((prev) => {
        const customSections = [...prev[activeType].customSections];
        customSections[idx] = updated;
        return { ...prev, [activeType]: { ...prev[activeType], customSections } };
      });
    },
    [activeType],
  );

  const deleteCustomSection = useCallback(
    (idx: number) => {
      setConfigs((prev) => {
        const customSections = prev[activeType].customSections.filter(
          (_, i) => i !== idx,
        );
        return { ...prev, [activeType]: { ...prev[activeType], customSections } };
      });
    },
    [activeType],
  );

  const moveCustomSection = useCallback(
    (from: number, to: number) => {
      setConfigs((prev) => {
        const customSections = [...prev[activeType].customSections];
        const [item] = customSections.splice(from, 1);
        customSections.splice(to, 0, item);
        return { ...prev, [activeType]: { ...prev[activeType], customSections } };
      });
    },
    [activeType],
  );

  if (loading) {
    return <div className="loading">Loading PDF templates…</div>;
  }

  const config = configs[activeType];
  if (!config) return null;

  const sectionLabels = SECTION_LABELS[activeType] || {};

  return (
    <div>
      <h3 style={{ marginTop: 0 }}>PDF Template Editor</h3>
      <p className="settings-muted">
        Configure which sections appear in generated PDFs and add custom text
        sections such as safety notices or instructions. Changes affect all
        users.
      </p>

      {error && <div className="error card" style={{ marginBottom: "12px" }}>{error}</div>}
      {success && <div className="success card" style={{ marginBottom: "12px" }}>{success}</div>}

      {/* Document type tabs */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
        {(["work_order", "work_request"] as const).map((type) => (
          <button
            key={type}
            className={activeType === type ? "btn-primary" : "btn-outline"}
            style={{ padding: "6px 16px", fontSize: "13px", width: "auto" }}
            onClick={() => setActiveType(type)}
          >
            {TYPE_LABELS[type]}
          </button>
        ))}
      </div>

      {/* Fixed sections */}
      <div style={{ marginBottom: "20px" }}>
        <h4 style={{ margin: "0 0 8px", fontSize: "14px" }}>
          Standard Sections
        </h4>
        <p className="settings-muted" style={{ marginBottom: "12px", fontSize: "12px" }}>
          Toggle sections on/off, rename them, or reorder them. Sections are
          only included when they have relevant data (e.g. Description only
          appears when a description is set).
        </p>
        {config.sections.map((section, idx) => (
          <SectionRow
            key={section.id}
            section={section}
            label={sectionLabels[section.id] || section.id}
            onChange={(updated) => updateSection(idx, updated)}
            onMoveUp={() => moveSection(idx, idx - 1)}
            onMoveDown={() => moveSection(idx, idx + 1)}
            isFirst={idx === 0}
            isLast={idx === config.sections.length - 1}
          />
        ))}
      </div>

      {/* Custom sections */}
      <div style={{ marginBottom: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
          <h4 style={{ margin: 0, fontSize: "14px" }}>Custom Sections</h4>
          <button
            className="btn-outline"
            style={{ padding: "4px 12px", fontSize: "12px", width: "auto" }}
            onClick={addCustomSection}
          >
            + Add Section
          </button>
        </div>
        <p className="settings-muted" style={{ marginBottom: "12px", fontSize: "12px" }}>
          Add free-text sections to every PDF (e.g. safety reminders,
          instructions, sign-off areas). Leave content blank to omit a section.
        </p>
        {config.customSections.length === 0 && (
          <div className="settings-muted" style={{ fontSize: "13px", fontStyle: "italic" }}>
            No custom sections. Click "Add Section" to create one.
          </div>
        )}
        {config.customSections.map((cs, idx) => (
          <CustomSectionRow
            key={cs.id}
            section={cs}
            onChange={(updated) => updateCustomSection(idx, updated)}
            onDelete={() => deleteCustomSection(idx)}
            onMoveUp={() => moveCustomSection(idx, idx - 1)}
            onMoveDown={() => moveCustomSection(idx, idx + 1)}
            isFirst={idx === 0}
            isLast={idx === config.customSections.length - 1}
          />
        ))}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: "10px" }}>
        <button
          className="btn-primary"
          onClick={handleSave}
          disabled={saving}
          style={{ width: "auto", padding: "8px 24px" }}
        >
          {saving ? "Saving…" : "Save Template"}
        </button>
        <button
          className="btn-ghost"
          onClick={handleReset}
          disabled={saving}
          style={{ width: "auto" }}
        >
          Reset to Defaults
        </button>
      </div>

      {/* Reset confirmation modal */}
      {confirmingReset && (
        <Modal onClose={() => setConfirmingReset(false)} maxWidth="400px">
          <div className="modal-header">
            <h3>Reset to Defaults?</h3>
            <button className="btn-ghost" onClick={() => setConfirmingReset(false)}>✕</button>
          </div>
          <div className="modal-body">
            <p style={{ marginBottom: "20px" }}>
              This will reset the <strong>{TYPE_LABELS[activeType]}</strong> template to factory
              defaults, removing any custom sections or renames. This action does not save until you
              click "Save Template".
            </p>
            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
              <button className="btn-ghost" onClick={() => setConfirmingReset(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={confirmReset} style={{ width: "auto", padding: "8px 20px" }}>
                Reset
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default PdfTemplateEditor;
