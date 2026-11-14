import {
    ENV_FORMAT,
    ENV_TYPE,
    COORD_SYSTEM,
    OBJECT_CATEGORY,
    OBJECT_TYPE,
    type EnvFormat,
    type EnvType,
    type CoordSystemType,
    type ObjectCategory,
    type ObjectType,
} from "@/config/db-ops/enums";
import type { EnvPointType, GeoAnchor } from "@/data/local/schemaTypes";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedObject {
    id: number;
    category: ObjectCategory;
    type: ObjectType;
    vertices: Array<{ x: number; y: number }>;
}

export interface ImportedWorkspaceData {
    name: string;
    format: EnvFormat;
    type: EnvType;
    coordSystem: CoordSystemType;
    headlandEnabled: boolean;
    headlandWidth: string;
    objects: ParsedObject[];
    envPoints: ParsedEnvPoint[];
    geoAnchor?: GeoAnchor;
}

export interface ParsedEnvPoint {
    type: EnvPointType;
    point: { x: number; y: number };
}

export interface ImportParseError {
    error: string;
}

export function isImportError(result: ImportedWorkspaceData | ImportParseError): result is ImportParseError {
    return "error" in result;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const VALID_FORMATS = Object.values(ENV_FORMAT) as string[];
const VALID_TYPES = Object.values(ENV_TYPE) as string[];
const VALID_COORD_SYSTEMS = Object.values(COORD_SYSTEM) as string[];
const VALID_CATEGORIES = Object.values(OBJECT_CATEGORY) as string[];
const VALID_OBJECT_TYPES = Object.values(OBJECT_TYPE) as string[];
const VALID_ENV_POINT_TYPES: EnvPointType[] = ["start", "end", "start_end"];

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

export function parseImportXml(xml: string): ImportedWorkspaceData | ImportParseError {
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
    if (root.tagName !== "workspace") {
        return { error: `Expected root element <workspace>, got <${root.tagName}>.` };
    }

    const rootAttrErr = checkNoAttributes(root, "<workspace>");
    if (rootAttrErr) return rootAttrErr;
    const rootChildErr = checkChildren(root, ["environment", "objects", "envPoints", "geoAnchor"], "<workspace>");
    if (rootChildErr) return rootChildErr;

    // --- <environment> ---
    const envEl = root.querySelector(":scope > environment");
    if (!envEl) return { error: "Missing <environment> element." };

    const envAttrErr = checkNoAttributes(envEl, "<workspace>");
    if (envAttrErr) return envAttrErr;
    const envChildErr = checkChildren(envEl, ["name", "format", "type", "coordSystem", "headlandEnabled", "headlandWidth"], "<environment>");
    if (envChildErr) return envChildErr;

    const nameResult = requireText(envEl, "name", "<environment>");
    if (typeof nameResult !== "string") return nameResult;
    const name = nameResult;

    const formatResult = requireText(envEl, "format", "<environment>");
    if (typeof formatResult !== "string") return formatResult;
    if (!VALID_FORMATS.includes(formatResult)) {
        return { error: `Invalid <format> value "${formatResult}". Expected one of: ${VALID_FORMATS.join(", ")}.` };
    }
    const format = formatResult as EnvFormat;

    const typeResult = requireText(envEl, "type", "<environment>");
    if (typeof typeResult !== "string") return typeResult;
    if (!VALID_TYPES.includes(typeResult)) {
        return { error: `Invalid <type> value "${typeResult}". Expected one of: ${VALID_TYPES.join(", ")}.` };
    }
    const type = typeResult as EnvType;

    const coordResult = requireText(envEl, "coordSystem", "<environment>");
    if (typeof coordResult !== "string") return coordResult;
    if (!VALID_COORD_SYSTEMS.includes(coordResult)) {
        return { error: `Invalid <coordSystem> value "${coordResult}". Expected one of: ${VALID_COORD_SYSTEMS.join(", ")}.` };
    }
    const coordSystem = coordResult as CoordSystemType;

    const headlandEnabledText = textContent(envEl, "headlandEnabled");
    let headlandEnabled = true;
    if (headlandEnabledText !== null) {
        if (headlandEnabledText !== "true" && headlandEnabledText !== "false") {
            return { error: `Invalid <headlandEnabled> value "${headlandEnabledText}". Expected "true" or "false".` };
        }
        headlandEnabled = headlandEnabledText === "true";
    }

    const headlandWidth = textContent(envEl, "headlandWidth") ?? "10";

    // --- <objects> ---
    const objectsEl = root.querySelector(":scope > objects");
    if (!objectsEl) return { error: "Missing <objects> element." };

    const objectsAttrErr = checkNoAttributes(objectsEl, "<workspace>");
    if (objectsAttrErr) return objectsAttrErr;
    const objectsChildErr = checkChildren(objectsEl, ["object"], "<objects>");
    if (objectsChildErr) return objectsChildErr;

    const objects: ParsedObject[] = [];
    const objectEls = objectsEl.querySelectorAll(":scope > object");

    for (let i = 0; i < objectEls.length; i++) {
        const objEl = objectEls[i]!;
        const label = `<object> #${i + 1}`;

        const objAttrErr = checkNoAttributes(objEl, label);
        if (objAttrErr) return objAttrErr;
        const objChildErr = checkChildren(objEl, ["id", "category", "type", "vertices"], label);
        if (objChildErr) return objChildErr;

        const idText = textContent(objEl, "id");
        const id = idText !== null ? parseInt(idText, 10) : i + 1;

        const categoryResult = requireText(objEl, "category", label);
        if (typeof categoryResult !== "string") return categoryResult;
        if (!VALID_CATEGORIES.includes(categoryResult)) {
            return { error: `Invalid <category> "${categoryResult}" in ${label}.` };
        }
        const category = categoryResult as ObjectCategory;

        const objTypeText = textContent(objEl, "type") ?? "";
        if (!VALID_OBJECT_TYPES.includes(objTypeText)) {
            return { error: `Invalid <type> "${objTypeText}" in ${label}.` };
        }
        const objType = objTypeText as ObjectType;

        const verticesEl = objEl.querySelector(":scope > vertices");
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

        objects.push({ id, category, type: objType, vertices });
    }

    // --- <envPoints> (optional) ---
    const envPointsEl = root.querySelector(":scope > envPoints");
    const envPoints: ParsedEnvPoint[] = [];
    if (envPointsEl) {
        const envPointsAttrErr = checkNoAttributes(envPointsEl, "<envPoints>");
        if (envPointsAttrErr) return envPointsAttrErr;
        const envPointsChildErr = checkChildren(envPointsEl, ["point"], "<envPoints>");
        if (envPointsChildErr) return envPointsChildErr;

        const pointEls = envPointsEl.querySelectorAll(":scope > point");
        const seenTypes = new Set<EnvPointType>();

        for (let i = 0; i < pointEls.length; i++) {
            const pointEl = pointEls[i]!;
            const label = `<point> #${i + 1}`;

            const pointAttrErr = checkNoAttributes(pointEl, label);
            if (pointAttrErr) return pointAttrErr;
            const pointChildErr = checkChildren(pointEl, ["type", "x", "y"], label);
            if (pointChildErr) return pointChildErr;

            const pointTypeResult = requireText(pointEl, "type", label);
            if (typeof pointTypeResult !== "string") return pointTypeResult;
            if (!VALID_ENV_POINT_TYPES.includes(pointTypeResult as EnvPointType)) {
                return { error: `Invalid <type> "${pointTypeResult}" in ${label}.` };
            }
            const type = pointTypeResult as EnvPointType;

            if (seenTypes.has(type)) {
                return { error: `Duplicate env point type "${type}" in <envPoints>.` };
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
            envPoints.push({ type, point: { x, y } });
        }

        const hasStartEnd = seenTypes.has("start_end");
        if (hasStartEnd && (seenTypes.has("start") || seenTypes.has("end"))) {
            return { error: `Invalid <envPoints>: <type>start_end</type> cannot be combined with <type>start</type> or <type>end</type>.` };
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

    return { name, format, type, coordSystem, headlandEnabled, headlandWidth, objects, envPoints, geoAnchor };
}
