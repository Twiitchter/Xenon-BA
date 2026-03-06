export interface HierarchyFloor {
  id: string;
  name: string;
}

export interface HierarchyBuilding {
  id: string;
  name: string;
  floors?: HierarchyFloor[];
}

export interface HierarchySite {
  id: string;
  name: string;
  buildings: HierarchyBuilding[];
}

export interface HierarchyRegion {
  id: string;
  name: string;
  sites: HierarchySite[];
}

export interface HierarchyTree {
  regions: HierarchyRegion[];
}

export interface LocationSelection {
  regionId: string;
  siteId: string;
  buildingId: string;
  floorId: string;
}

export const EMPTY_LOCATION_SELECTION: LocationSelection = {
  regionId: "",
  siteId: "",
  buildingId: "",
  floorId: "",
};

export function buildLocationPath(
  hierarchy: HierarchyTree | null,
  selection: LocationSelection,
): string {
  if (!hierarchy) return "";

  const region = hierarchy.regions.find((r) => r.id === selection.regionId);
  if (!region) return "";

  const site = region.sites.find((s) => s.id === selection.siteId);
  if (!site) return region.name;

  const building = site.buildings.find((b) => b.id === selection.buildingId);
  if (!building) return `${region.name} > ${site.name}`;

  const floor = building.floors?.find((f) => f.id === selection.floorId);
  if (!floor) return `${region.name} > ${site.name} > ${building.name}`;

  return `${region.name} > ${site.name} > ${building.name} > ${floor.name}`;
}

interface Props {
  hierarchy: HierarchyTree | null;
  selection: LocationSelection;
  onChange: (value: LocationSelection) => void;
}

export default function LocationHierarchyPicker({
  hierarchy,
  selection,
  onChange,
}: Props) {
  const regions = hierarchy?.regions || [];
  const region = regions.find((r) => r.id === selection.regionId);
  const sites = region?.sites || [];
  const site = sites.find((s) => s.id === selection.siteId);
  const buildings = site?.buildings || [];
  const building = buildings.find((b) => b.id === selection.buildingId);
  const floors = building?.floors || [];

  if (!hierarchy || regions.length === 0) {
    return (
      <div className="settings-muted" style={{ marginBottom: "10px" }}>
        Location hierarchy is not available yet.
      </div>
    );
  }

  return (
    <div className="location-picker-grid">
      <div className="form-group">
        <label>Region</label>
        <select
          value={selection.regionId}
          onChange={(e) =>
            onChange({
              regionId: e.target.value,
              siteId: "",
              buildingId: "",
              floorId: "",
            })
          }
        >
          <option value="">Select region...</option>
          {regions.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label>Site</label>
        <select
          value={selection.siteId}
          onChange={(e) =>
            onChange({
              ...selection,
              siteId: e.target.value,
              buildingId: "",
              floorId: "",
            })
          }
          disabled={!selection.regionId}
        >
          <option value="">Select site...</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label>Building</label>
        <select
          value={selection.buildingId}
          onChange={(e) =>
            onChange({
              ...selection,
              buildingId: e.target.value,
              floorId: "",
            })
          }
          disabled={!selection.siteId}
        >
          <option value="">Select building...</option>
          {buildings.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label>Floor (optional)</label>
        <select
          value={selection.floorId}
          onChange={(e) => onChange({ ...selection, floorId: e.target.value })}
          disabled={!selection.buildingId || floors.length === 0}
        >
          <option value="">Select floor...</option>
          {floors.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
