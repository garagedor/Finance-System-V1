// Cross-relationships between techs/providers/locations derived from the
// Job collection. Used by filter dropdowns to narrow themselves: picking a
// tech limits the location options to that tech's locations (union across
// multiple selected techs), and so on.

import { NextRequest, NextResponse } from 'next/server';
import { MongoClient } from "mongodb";
import { getMongoClient } from "@/lib/mongo";
import type { JobRow } from '../../../../types/job';

const DB_NAME = 'ag';
const JOB_COLLECTION = 'Job';

let cachedClient: MongoClient | null = null;
async function getClient(): Promise<MongoClient> {
  if (cachedClient) return cachedClient;
  const c = await getMongoClient();
  await c.connect();
  cachedClient = c;
  return c;
}

export type FilterRelationships = {
  techToLocations: Record<string, string[]>;
  locationToTechs: Record<string, string[]>;
  providerToLocations: Record<string, string[]>;
  locationToProviders: Record<string, string[]>;
  techToProviders: Record<string, string[]>;
  providerToTechs: Record<string, string[]>;
};

const norm = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export async function GET(_req: NextRequest) {
  try {
    const client = await getClient();
    const col = client.db(DB_NAME).collection<JobRow>(JOB_COLLECTION);

    const cursor = col.find(
      { $or: [
        { tech: { $type: 'string' } },
        { location: { $type: 'string' } },
        { provider: { $type: 'string' } },
      ] },
      { projection: { tech: 1, location: 1, provider: 1, _id: 0 } },
    );

    const techToLocations = new Map<string, Set<string>>();
    const locationToTechs = new Map<string, Set<string>>();
    const providerToLocations = new Map<string, Set<string>>();
    const locationToProviders = new Map<string, Set<string>>();
    const techToProviders = new Map<string, Set<string>>();
    const providerToTechs = new Map<string, Set<string>>();

    const addPair = (
      a: string,
      b: string,
      aToB: Map<string, Set<string>>,
      bToA: Map<string, Set<string>>,
    ) => {
      if (!a || !b) return;
      let setA = aToB.get(a);
      if (!setA) { setA = new Set(); aToB.set(a, setA); }
      setA.add(b);
      let setB = bToA.get(b);
      if (!setB) { setB = new Set(); bToA.set(b, setB); }
      setB.add(a);
    };

    for await (const j of cursor) {
      const t = norm((j as any).tech);
      const l = norm((j as any).location);
      const p = norm((j as any).provider);
      if (t && l) addPair(t, l, techToLocations, locationToTechs);
      if (p && l) addPair(p, l, providerToLocations, locationToProviders);
      if (t && p) addPair(t, p, techToProviders, providerToTechs);
    }

    const toRecord = (m: Map<string, Set<string>>): Record<string, string[]> => {
      const out: Record<string, string[]> = {};
      for (const [k, v] of m.entries()) {
        out[k] = Array.from(v).sort((a, b) => a.localeCompare(b));
      }
      return out;
    };

    const body: FilterRelationships = {
      techToLocations: toRecord(techToLocations),
      locationToTechs: toRecord(locationToTechs),
      providerToLocations: toRecord(providerToLocations),
      locationToProviders: toRecord(locationToProviders),
      techToProviders: toRecord(techToProviders),
      providerToTechs: toRecord(providerToTechs),
    };

    return NextResponse.json(body);
  } catch (err: any) {
    console.error('GET /api/lookups/relationships error', err);
    return NextResponse.json(
      { error: 'Failed to load relationships', detail: err?.message || String(err) },
      { status: 500 },
    );
  }
}
