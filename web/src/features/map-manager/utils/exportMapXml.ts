import type { GeoAnchor, MapInfo, MapPoint, Zone } from "@/data/planning/schemaTypes";

// Writes a map as XML (read back by importMapXml.ts). The element names
// (<workspace>, <environment>, <objects>, <envPoints>) are the file format's
// and stay as they are; zone categories are the server's ("mowing", "no_go").

function escapeXmlText(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

export function buildExportXml(map: MapInfo, zones: Zone[], mapPoints: MapPoint[] = [], geoAnchor?: GeoAnchor): string {
    const lines: string[] = [];

    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push("<workspace>");

    lines.push("  <environment>");
    lines.push(`    <name>${escapeXmlText(map.name)}</name>`);
    lines.push(`    <format>${escapeXmlText(map.format)}</format>`);
    lines.push(`    <type>${escapeXmlText(map.type)}</type>`);
    lines.push(`    <coordSystem>${escapeXmlText(map.coordSystem)}</coordSystem>`);
    lines.push(`    <headlandEnabled>${map.headlandEnabled}</headlandEnabled>`);
    lines.push(`    <headlandWidth>${escapeXmlText(map.headlandWidth)}</headlandWidth>`);
    lines.push("  </environment>");

    lines.push("  <objects>");

    for (const zone of zones) {
        lines.push(`    <object>`);
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
        lines.push("    </object>");
    }

    lines.push("  </objects>");

    lines.push("  <envPoints>");

    for (const mapPoint of mapPoints) {
        lines.push("    <point>");
        lines.push(`      <type>${escapeXmlText(mapPoint.type)}</type>`);
        lines.push(`      <x>${mapPoint.point.x}</x>`);
        lines.push(`      <y>${mapPoint.point.y}</y>`);
        lines.push("    </point>");
    }

    lines.push("  </envPoints>");

    if (geoAnchor) {
        lines.push("  <geoAnchor>");
        lines.push(`    <lat>${geoAnchor.lat}</lat>`);
        lines.push(`    <lon>${geoAnchor.lon}</lon>`);
        lines.push("  </geoAnchor>");
    }

    lines.push("</workspace>");

    return lines.join("\n");
}
