import React, { useState, useEffect } from "react";

interface FilterPreset {
  id: string;
  name: string;
  filters: Record<string, string>;
}

interface Props {
  storageKey: string;
  currentFilters: Record<string, string>;
  onApply: (filters: Record<string, string>) => void;
}

const FilterPresetsPanel: React.FC<Props> = ({
  storageKey,
  currentFilters,
  onApply,
}) => {
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setPresets(JSON.parse(saved));
    } catch {
      // ignore corrupt localStorage data
    }
  }, [storageKey]);

  const persist = (list: FilterPreset[]) => {
    setPresets(list);
    localStorage.setItem(storageKey, JSON.stringify(list));
  };

  const handleSave = () => {
    const name = newName.trim();
    if (!name) return;
    persist([
      ...presets,
      { id: Date.now().toString(), name, filters: { ...currentFilters } },
    ]);
    setNewName("");
  };

  const handleDelete = (id: string) => {
    persist(presets.filter((p) => p.id !== id));
  };

  const activeCount = Object.values(currentFilters).filter(Boolean).length;

  const presetSummary = (f: Record<string, string>) => {
    const parts = Object.entries(f)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`);
    return parts.length ? parts.join(" · ") : "No active filters";
  };

  return (
    <div className="presets-panel">
      <div className="presets-panel-header">Saved Filters</div>
      <div className="presets-list">
        {presets.length === 0 ? (
          <div className="presets-empty">
            Save filter combinations here to quick-switch between views.
          </div>
        ) : (
          presets.map((p) => (
            <div key={p.id} className="preset-item">
              <button
                className="preset-apply"
                onClick={() => onApply(p.filters)}
                title={presetSummary(p.filters)}
              >
                {p.name}
              </button>
              <button
                className="preset-delete btn-ghost"
                onClick={() => handleDelete(p.id)}
                title="Remove preset"
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>
      <div className="presets-save">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
          placeholder="Name this filter set…"
        />
        <button
          onClick={handleSave}
          disabled={!newName.trim() || activeCount === 0}
          style={{ width: "100%", marginTop: "6px" }}
          title={activeCount === 0 ? "Set at least one filter first" : ""}
        >
          Save Current Filters
        </button>
      </div>
    </div>
  );
};

export default FilterPresetsPanel;
