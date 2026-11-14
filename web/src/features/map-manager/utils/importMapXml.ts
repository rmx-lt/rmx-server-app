import {
    MAP_FORMAT,
    MAP_TYPE,
    COORD_SYSTEM,
    ZONE_CATEGORY,
    ZONE_TYPE,
    type MapFormat,
    type MapType,
    type CoordSystemType,
    type ZoneCategory,
    type ZoneType,
} from "@/config/db-ops/enums";
import type { MapPointType, GeoAnchor } from "@/data/planning/schemaTypes";

// Reads a map from the XML file the export writes (exportMapXml.ts). Files of
// earlier versions (root <workspace>, zone categories "zone" and "obstacle")
// are not read.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedZone {
    id: number;
    category: ZoneCategory;
    type: ZoneType;
    vertices: Array<{ x: number; y: number }>;
}

export interface ImportedMapData {
    name: string;
    format: MapFormat;
    type: MapType;
    coordSystem: CoordSystemType;
    headlandEnabled: boolean;
    headlandWidth: string;
    zones: ParsedZone[];
    mapPoints: ParsedMapPoint[];
    geoAnchor?: GeoAnchor;
}

export interface ParsedMapPoint {
    type: MapPointType;
    point: { x: number; y: number };
}

export interface ImportParseError {
    error: string;
}

export function isImportError(result: ImportedMapData | ImportParseError): result is ImportParseError {
    return "error" in result;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const VALID_FORMATS = Object.values(MAP_FORMAT) as string[];
const VALID_TYPES = Object.values(MAP_TYPE) as string[];
const VALID_COORD_SYSTEMS = Object.values(COORD_SYSTEM) as string[];
const VALID_CATEGORIES = Object.values(ZONE_CATEGORY) as string[];
const VALID_ZONE_TYPES = Object.values(ZONE_TYPE) as string[];
const VALID_MAP_POINT_TYPES: MapPointType[] = ["start", "end", "start_end"];

/**
 * The zone category of a <category> value, or an error naming the values
 * allowed. Only the server's categories are read.
 */
export function parseZoneCategory(value: string, context: string): ZoneCategory | ImportParseError {
    if (VALID_CATEGORIES.includes(value)) return value as ZoneCategory;
    return { error: `Invalid <category> "${value}" in ${context}. Expected one of: ${VALID_CATEGORIES.join(", ")}.` };
}

function textContent(parent: Element, tag: string): string | null {
    return parent.querySelector(tag)?.textContent?.trim() ?? null;
}

function requireText(parent: Element, tag: string, context: string): string | ImportParseError {
    const value = textContent(parent, tag);
    if (value === null) return { error: `Missing <${tag}> in ${context}.` };
    return value;
}

function checkChildren(el: Element, allowed: readonly string[], context: string): ImportParseError | null {
    for (let i = 0; i < el.children.length; i++) {
        const child = el.children[i]!;
        if (!allowed.includes(child.tagName)) {
            return { error: `Unknown element <${child.tagName}> in ${context}. Allowed: ${allowed.map((t) => `<${t}>`).join(", ")}.` };
        }
    }
    return null;
}

function checkNoAttributes(el: Element, context: string): ImportParseError | null {
    if (el.attributes.length > 0) {
        const names = Array.from(el.attributes).map((a) => a.name).join(", ");
        return { error: `Unexpected attribute(s) "${names}" on <${el.tagName}> in ${context}. Use child elements only.` };
    }
    return null;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export function parseImportXml(xml: string): ImportedMapData | ImportParseError {
    let doc: Document;
    try {
        doc = new DOMParser().parseFromString(xml, "application/xml");
    } catch {
        return { error: "Failed to parse file as XML." };
    }

    const parseError = doc.querySelector("parsererror");
    if (parseError) {
        return { error: "Invalid XML: " + (parseError.textContent?.split("\n")[0] ?? "parse error") };
    }

    const root = doc.documentElement;
    if (root.tagName !== "map") {
        return { error: `Expected root element <map>, got <${root.tagName}>.` };
    }

    const rootAttrErr = checkNoAttributes(root, "<map>");
    if (rootAttrErr) return rootAttrErr;
    const rootChildErr = checkChildren(root, ["info", "zones", "points", "geoAnchor"], "<map>");
    if (rootChildErr) return rootChildErr;

    // --- <info> ---
    const mapEl = root.querySelector(":scope > info");
    if (!mapEl) return { error: "Missing <info> element." };

    const mapAttrErr = checkNoAttributes(mapEl, "<info>");
    if (mapAttrErr) return mapAttrErr;
    const mapChildErr = checkChildren(mapEl, ["name", "format", "type", "coordSystem", "headlandEnabled", "headlandWidth"], "<info>");
    if (mapChildErr) return mapChildErr;

    const nameResult = requireText(mapEl, "name", "<info>");
    if (typeof nameResult !== "string") return nameResult;
    const name = nameResult;

    const formatResult = requireText(mapEl, "format", "<info>");
    if (typeof formatResult !== "string") return formatResult;
    if (!VALID_FORMATS.includes(formatResult)) {
        return { error: `Invalid <format> value "${formatResult}". Expected one of: ${VALID_FORMATS.join(", ")}.` };
    }
    const format = formatResult as MapFormat;

    const typeResult = requireText(mapEl, "type", "<info>");
    if (typeof typeResult !== "string") return typeResult;
    if (!VALID_TYPES.includes(typeResult)) {
        return { error: `Invalid <type> value "${typeResult}". Expected one of: ${VALID_TYPES.join(", ")}.` };
    }
    const type = typeResult as MapType;

    const coordResult = requireText(mapEl, "coordSystem", "<info>");
    if (typeof coordResult !== "string") return coordResult;
    if (!VALID_COORD_SYSTEMS.includes(coordResult)) {
        return { error: `Invalid <coordSystem> value "${coordResult}". Expected one of: ${VALID_COORD_SYSTEMS.join(", ")}.` };
    }
    const coordSystem = coordResult as CoordSystemType;

    const headlandEnabledText = textContent(mapEl, "headlandEnabled");
    let headlandEnabled = true;
    if (headlandEnabledText !== null) {
        if (headlandEnabledText !== "true" && headlandEnabledText !== "false") {
            return { error: `Invalid <headlandEnabled> value "${headlandEnabledText}". Expected "true" or "false".` };
        }
        headlandEnabled = headlandEnabledText === "true";
    }

    const headlandWidth = textContent(mapEl, "headlandWidth") ?? "10";

    // --- <zones> ---
    const zonesEl = root.querySelector(":scope > zones");
    if (!zonesEl) return { error: "Missing <zones> element." };

    const zonesAttrErr = checkNoAttributes(zonesEl, "<zones>");
    if (zonesAttrErr) return zonesAttrErr;
    const zonesChildErr = checkChildren(zonesEl, ["zone"], "<zones>");
    if (zonesChildErr) return zonesChildErr;

    const zones: ParsedZone[] = [];
    const zoneEls = zonesEl.querySelectorAll(":scope > zone");

    for (let i = 0; i < zoneEls.length; i++) {
        const zoneEl = zoneEls[i]!;
        const label = `<zone> #${i + 1}`;

        const zoneAttrErr = checkNoAttributes(zoneEl, label);
        if (zoneAttrErr) return zoneAttrErr;
        const zoneChildErr = checkChildren(zoneEl, ["id", "category", "type", "vertices"], label);
        if (zoneChildErr) return zoneChildErr;

        const idText = textContent(zoneEl, "id");
        const id = idText !== null ? parseInt(idText, 10) : i + 1;

        const categoryResult = requireText(zoneEl, "category", label);
        if (typeof categoryResult !== "string") return categoryResult;
        const category = parseZoneCategory(categoryResult, label);
        if (typeof category !== "string") return category;

        const zoneTypeText = textContent(zoneEl, "type") ?? "";
        if (!VALID_ZONE_TYPES.includes(zoneTypeText)) {
            return { error: `Invalid <type> "${zoneTypeText}" in ${label}.` };
        }
        const zoneType = zoneTypeText as ZoneType;

        const verticesEl = zoneEl.querySelector(":scope > vertices");
        if (!verticesEl) return { error: `Missing <vertices> in ${label}.` };

        const verticesAttrErr = checkNoAttributes(verticesEl, label);
        if (verticesAttrErr) return verticesAttrErr;
        const verticesChildErr = checkChildren(verticesEl, ["vertex"], `<vertices> in ${label}`);
        if (verticesChildErr) return verticesChildErr;

        const vertexEls = verticesEl.querySelectorAll(":scope > vertex");
        if (vertexEls.length < 3) {
            return { error: `${label} must have at least 3 vertices, got ${vertexEls.length}.` };
        }

        const vertices: Array<{ x: number; y: number }> = [];
        for (let j = 0; j < vertexEls.length; j++) {
            const vEl = vertexEls[j]!;

            const vAttrErr = checkNoAttributes(vEl, `vertex #${j + 1} of ${label}`);
            if (vAttrErr) return vAttrErr;
            const vChildErr = checkChildren(vEl, ["x", "y"], `vertex #${j + 1} of ${label}`);
            if (vChildErr) return vChildErr;

            const xText = textContent(vEl, "x");
            const yText = textContent(vEl, "y");
            if (xText === null || yText === null) {
                return { error: `Missing <x> or <y> in vertex #${j + 1} of ${label}.` };
            }
            const x = parseFloat(xText);
            const y = parseFloat(yText);
            if (!isFinite(x) || !isFinite(y)) {
                return { error: `Non-numeric coordinate in vertex #${j + 1} of ${label}.` };
            }
            vertices.push({ x, y });
        }

        zones.push({ id, category, type: zoneType, vertices });
    }

    // --- <points> (optional) ---
    const mapPointsEl = root.querySelector(":scope > points");
    const mapPoints: ParsedMapPoint[] = [];
    if (mapPointsEl) {
        const mapPointsAttrErr = checkNoAttributes(mapPointsEl, "<points>");
        if (mapPointsAttrErr) return mapPointsAttrErr;
        const mapPointsChildErr = checkChildren(mapPointsEl, ["point"], "<points>");
        if (mapPointsChildErr) return mapPointsChildErr;

        const pointEls = mapPointsEl.querySelectorAll(":scope > point");
        const seenTypes = new Set<MapPointType>();

        for (let i = 0; i < pointEls.length; i++) {
            const pointEl = pointEls[i]!;
            const label = `<point> #${i + 1}`;

            const pointAttrErr = checkNoAttributes(pointEl, label);
            if (pointAttrErr) return pointAttrErr;
            const pointChildErr = checkChildren(pointEl, ["type", "x", "y"], label);
            if (pointChildErr) return pointChildErr;

            const pointTypeResult = requireText(pointEl, "type", label);
            if (typeof pointTypeResult !== "string") return pointTypeResult;
            if (!VALID_MAP_POINT_TYPES.includes(pointTypeResult as MapPointType)) {
                return { error: `Invalid <type> "${pointTypeResult}" in ${label}.` };
            }
            const type = pointTypeResult as MapPointType;

            if (seenTypes.has(type)) {
                return { error: `Duplicate point type "${type}" in <points>.` };
            }

            const xText = textContent(pointEl, "x");
            const yText = textContent(pointEl, "y");
            if (xText === null || yText === null) {
                return { error: `Missing <x> or <y> in ${label}.` };
            }

            const x = parseFloat(xText);
            const y = parseFloat(yText);
            if (!isFinite(x) || !isFinite(y)) {
                return { error: `Non-numeric coordinate in ${label}.` };
            }

            seenTypes.add(type);
            mapPoints.push({ type, point: { x, y } });
        }

        const hasStartEnd = seenTypes.has("start_end");
        if (hasStartEnd && (seenTypes.has("start") || seenTypes.has("end"))) {
            return { error: `Invalid <points>: <type>start_end</type> cannot be combined with <type>start</type> or <type>end</type>.` };
        }
    }

    // --- <geoAnchor> (optional) ---
    let geoAnchor: GeoAnchor | undefined;
    const geoAnchorEl = root.querySelector(":scope > geoAnchor");
    if (geoAnchorEl) {
        const geoAttrErr = checkNoAttributes(geoAnchorEl, "<geoAnchor>");
        if (geoAttrErr) return geoAttrErr;
        const geoChildErr = checkChildren(geoAnchorEl, ["lat", "lon"], "<geoAnchor>");
        if (geoChildErr) return geoChildErr;

        const latText = textContent(geoAnchorEl, "lat");
        const lonText = textContent(geoAnchorEl, "lon");

        if (latText === null || lonText === null) {
            return { error: "<geoAnchor> must contain <lat> and <lon>." };
        }

        const lat = parseFloat(latText);
        const lon = parseFloat(lonText);

        if (!isFinite(lat) || !isFinite(lon)) {
            return { error: "Non-numeric value in <geoAnchor>." };
        }

        geoAnchor = { lat, lon };
    }

    return { name, format, type, coordSystem, headlandEnabled, headlandWidth, zones, mapPoints, geoAnchor };
}
