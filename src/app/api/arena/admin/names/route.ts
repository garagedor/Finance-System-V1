// GET: every verified person's full name and PUBLIC display name ("First L."),
// with collision / needs-English / possible-duplicate flags. Read-only.
// Overrides are set where they always were: the review queue (display-name cases).
import { arenaRoute } from "../_lib";
import { loadMappings, loadTechnicians } from "@/lib/arena/mongo-store";
import { reviewDecisions } from "@/lib/arena/review";
import { rosterNames } from "@/lib/arena/identity";
import { personLocation } from "@/lib/arena/display-name";

export const dynamic = "force-dynamic";

export async function GET() {
  return arenaRoute("arena:console:view", async ({ ctx }) => {
    const [mappings, technicians, decisions] = await Promise.all([
      loadMappings(ctx.crmDb),
      loadTechnicians(ctx.crmDb),
      reviewDecisions(ctx.review),
    ]);
    const roster = rosterNames(mappings, technicians, decisions.displayNames);
    const techLocation = new Map(technicians.map((t) => [t._id, t.location ?? ""]));
    const crmOf = new Map(mappings.map((m) => [m.supabaseUserId, (m.crmTechNames ?? []).filter((n) => typeof n === "string" && n)]));
    const rows = [...roster.values()].map((r) => ({
      ...r,
      crmNames: crmOf.get(r.id) ?? [],
      location: personLocation(crmOf.get(r.id) ?? [], techLocation),
      possibleDuplicateOf: r.possibleDuplicateOf.map((id) => ({ id, fullName: roster.get(id)?.fullName ?? id })),
      // An unresolved collision blocks review until an override is set.
      blocking: r.collision === "unresolved",
    }));
    rows.sort((a, b) => Number(b.blocking) - Number(a.blocking) || a.displayName.localeCompare(b.displayName) || (a.id < b.id ? -1 : 1));
    return { rows, format: "FIRST_LAST_INITIAL_V1" };
  });
}
