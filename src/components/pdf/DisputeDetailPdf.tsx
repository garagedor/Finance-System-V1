// Renders a precomputed DisputeDetail (address + cost-share lines) inside a PDF,
// printed inline under a dispute/refund line in the reports.

import { Text, View } from "@react-pdf/renderer";
import { palette } from "./sharedPdfStyles";
import type { DisputeDetail } from "@/lib/dispute-detail";

export function DisputeDetailPdf({ detail }: { detail: DisputeDetail }) {
  if (!detail || detail.lines.length === 0) return null;
  return (
    <View style={{ marginTop: 2, marginBottom: 4, paddingLeft: 10, paddingVertical: 3, borderLeftWidth: 1.5, borderLeftColor: palette.navy600 }} wrap={false}>
      {detail.address ? <Text style={{ fontSize: 7.5, color: palette.slate300 }}>Address: {detail.address}</Text> : null}
      {detail.customer ? <Text style={{ fontSize: 7.5, color: palette.slate300 }}>Customer: {detail.customer}</Text> : null}
      {detail.lines.map((l, i) =>
        l.head ? (
          <Text key={i} style={{ fontSize: 6.5, color: palette.slate400, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 3 }}>{l.label}</Text>
        ) : (
          <View key={i} style={{ flexDirection: "row", justifyContent: "space-between", paddingLeft: l.sub ? 8 : 0 }}>
            <Text style={{ fontSize: 7.5, color: l.hi ? palette.indigo400 : l.sub ? palette.slate500 : palette.slate300, fontFamily: l.strong ? "Helvetica-Bold" : "Helvetica" }}>{l.label}</Text>
            <Text style={{ fontSize: 7.5, color: l.hi ? palette.indigo400 : palette.slate100, fontFamily: l.strong ? "Helvetica-Bold" : "Helvetica" }}>{l.value}</Text>
          </View>
        ),
      )}
    </View>
  );
}
