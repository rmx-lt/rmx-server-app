import type { GeoAnchor, MapInfo, MapPoint, Zone } from "@/data/planning/schemaTypes";

// Writes a map as XML (read back by importMapXml.ts): <map> holds <info> (name,
// format, type, coordinate system, headland), <zones> (one <zone> each, with
// the server's categories "mowing" and "no_go"), <points> and <geoAnchor>.

function escapeXmlText(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

export function buildExportXml(map: MapInfo, zones: Zone[], mapPoints: MapPoint[] = [], geoAnchor?: GeoAnchor): string {
    const lines: string[] = [];

    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push("<map>");

    lines.push("  <info>");
    lines.push(`    <name>${escapeXmlText(map.name)}</name>`);
    lines.push(`    <format>${escapeXmlText(map.format)}</format>`);
    lines.push(`    <type>${escapeXmlText(map.type)}</type>`);
    lines.push(`    <coordSystem>${escapeXmlText(map.coordSystem)}</coordSystem>`);
    lines.push(`    <headlandEnabled>${map.headlandEnabled}</headlandEnabled>`);
    lines.push(`    <headlandWidth>${escapeXmlText(map.headlandWidth)}</headlandWidth>`);
    lines.push("  </info>");

    lines.push("  <zones>");

    for (const zone of zones) {
        lines.push(`    <zone>`);
        lines.push(`      <id>${zone.id}</id>`);
        lines.push(`      <category>${escapeXmlText(zone.category)}</category>`);
        lines.push(`      <type>${escapeXmlText(zone.type)}</type>`);
        lines.push(`      <vertices>`);
        for (const v of zone.vertices) {
            lines.push(`        <vertex>`);
            lines.push(`          <x>${v.x}</x>`);
            lines.push(`          <y>${v.y}</y>`);
            lines.push(`        </vertex>`);
        }
        lines.push(`      </vertices>`);
        lines.push("    </zone>");
    }

    lines.push("  </zones>");

    lines.push("  <points>");

    for (const mapPoint of mapPoints) {
        lines.push("    <point>");
        lines.push(`      <type>${escapeXmlText(mapPoint.type)}</type>`);
        lines.push(`      <x>${mapPoint.point.x}</x>`);
        lines.push(`      <y>${mapPoint.point.y}</y>`);
        lines.push("    </point>");
    }

    lines.push("  </points>");

    if (geoAnchor) {
        lines.push("  <geoAnchor>");
        lines.push(`    <lat>${geoAnchor.lat}</lat>`);
        lines.push(`    <lon>${geoAnchor.lon}</lon>`);
        lines.push("  </geoAnchor>");
    }

    lines.push("</map>");

    return lines.join("\n");
}
