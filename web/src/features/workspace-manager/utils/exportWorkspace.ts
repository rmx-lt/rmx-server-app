import type { Environment, GeoAnchor } from "@/data/local/schemaTypes";
import type { Object } from "@/data/local/schemaTypes";
import type { EnvPoint } from "@/data/local/schemaTypes";

function escapeXmlText(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

export function buildExportXml(env: Environment, objects: Object[], envPoints: EnvPoint[] = [], geoAnchor?: GeoAnchor): string {
    const lines: string[] = [];

    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push("<workspace>");

    lines.push("  <environment>");
    lines.push(`    <name>${escapeXmlText(env.name)}</name>`);
    lines.push(`    <format>${escapeXmlText(env.format)}</format>`);
    lines.push(`    <type>${escapeXmlText(env.type)}</type>`);
    lines.push(`    <coordSystem>${escapeXmlText(env.coordSystem)}</coordSystem>`);
    lines.push(`    <headlandEnabled>${env.headlandEnabled}</headlandEnabled>`);
    lines.push(`    <headlandWidth>${escapeXmlText(env.headlandWidth)}</headlandWidth>`);
    lines.push("  </environment>");

    lines.push("  <objects>");

    for (const obj of objects) {
        lines.push(`    <object>`);
        lines.push(`      <id>${obj.id}</id>`);
        lines.push(`      <category>${escapeXmlText(obj.category)}</category>`);
        lines.push(`      <type>${escapeXmlText(obj.type)}</type>`);
        lines.push(`      <vertices>`);
        for (const v of obj.vertices) {
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

    for (const envPoint of envPoints) {
        lines.push("    <point>");
        lines.push(`      <type>${escapeXmlText(envPoint.type)}</type>`);
        lines.push(`      <x>${envPoint.point.x}</x>`);
        lines.push(`      <y>${envPoint.point.y}</y>`);
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
