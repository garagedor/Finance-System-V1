import { useEffect, useMemo, useRef, useState } from 'react';

export type FilterRelationships = {
  techToLocations: Record<string, string[]>;
  locationToTechs: Record<string, string[]>;
  providerToLocations: Record<string, string[]>;
  locationToProviders: Record<string, string[]>;
  techToProviders: Record<string, string[]>;
  providerToTechs: Record<string, string[]>;
};

const EMPTY: FilterRelationships = {
  techToLocations: {},
  locationToTechs: {},
  providerToLocations: {},
  locationToProviders: {},
  techToProviders: {},
  providerToTechs: {},
};

/**
 * Fetch tech/provider/location cross-relationships derived from Jobs once
 * and expose helpers to narrow a filter dropdown's options based on what's
 * currently selected in sibling filters.
 *
 * Union semantics: when multiple filters are set, the narrowed options are
 * the UNION of options that satisfy any single filter — picking a tech AND
 * a provider widens the location dropdown to (locations from the tech) ∪
 * (locations from the provider) rather than the intersection.
 */
export function useFilterRelationships() {
  const [data, setData] = useState<FilterRelationships>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    fetch('/api/lookups/relationships')
      .then((r) => (r.ok ? r.json() : EMPTY))
      .then((j) => setData(j as FilterRelationships))
      .catch(() => setData(EMPTY))
      .finally(() => setLoaded(true));
  }, []);

  return useMemo(() => {
    // Normalize for tolerant lookup: lowercase + collapse internal whitespace.
    // The lookup _id used in dropdowns (e.g. Provider._id, Technician._id)
    // can differ from the raw Job.tech / Job.provider string by case or
    // trailing whitespace, which would silently break exact-match lookups.
    const norm = (s: string) => (s || '').toLowerCase().trim().replace(/\s+/g, ' ');

    // Pre-build normalized-key variants of each map so lookups are O(1).
    const normalizeMap = (m: Record<string, string[]>): Record<string, Set<string>> => {
      const out: Record<string, Set<string>> = {};
      for (const [k, vals] of Object.entries(m)) {
        const nk = norm(k);
        const set = out[nk] || new Set<string>();
        for (const v of vals) set.add(v);
        out[nk] = set;
      }
      return out;
    };
    const techToLocationsN = normalizeMap(data.techToLocations);
    const locationToTechsN = normalizeMap(data.locationToTechs);
    const providerToLocationsN = normalizeMap(data.providerToLocations);
    const locationToProvidersN = normalizeMap(data.locationToProviders);
    const techToProvidersN = normalizeMap(data.techToProviders);
    const providerToTechsN = normalizeMap(data.providerToTechs);

    const collectUnion = (
      keys: string[],
      map: Record<string, Set<string>>,
    ): Set<string> => {
      const out = new Set<string>();
      for (const k of keys) {
        const arr = map[norm(k)];
        if (!arr) continue;
        for (const v of arr) out.add(v);
      }
      return out;
    };

    // Match an option against a set of allowed values using normalized
    // comparison so case/whitespace mismatches don't drop valid options.
    const allowsOption = (opt: string, allowed: Set<string>): boolean => {
      if (allowed.has(opt)) return true;
      const n = norm(opt);
      for (const v of allowed) if (norm(v) === n) return true;
      return false;
    };

    /**
     * Filter `allLocations` down to those touched by any selected tech OR any
     * selected provider. Empty selections in BOTH = no narrowing.
     */
    const narrowLocations = (
      allLocations: string[],
      selectedTechs: string[],
      selectedProviders: string[],
    ): string[] => {
      if (!loaded) return allLocations;
      const noTechs = !selectedTechs || selectedTechs.length === 0;
      const noProvs = !selectedProviders || selectedProviders.length === 0;
      if (noTechs && noProvs) return allLocations;
      const allowed = new Set<string>();
      if (!noTechs) {
        for (const v of collectUnion(selectedTechs, techToLocationsN)) allowed.add(v);
      }
      if (!noProvs) {
        for (const v of collectUnion(selectedProviders, providerToLocationsN)) allowed.add(v);
      }
      return allLocations.filter((l) => allowsOption(l, allowed));
    };

    /**
     * Filter `allTechs` down to those that have jobs in any selected
     * location OR with any selected provider. Empty selections in both
     * dimensions = no narrowing.
     */
    const narrowTechs = (
      allTechs: string[],
      selectedLocations: string[],
      selectedProviders: string[] = [],
    ): string[] => {
      if (!loaded) return allTechs;
      const noLocs = !selectedLocations || selectedLocations.length === 0;
      const noProvs = !selectedProviders || selectedProviders.length === 0;
      if (noLocs && noProvs) return allTechs;
      const allowed = new Set<string>();
      if (!noLocs) {
        for (const v of collectUnion(selectedLocations, locationToTechsN)) allowed.add(v);
      }
      if (!noProvs) {
        for (const v of collectUnion(selectedProviders, providerToTechsN)) allowed.add(v);
      }
      return allTechs.filter((t) => allowsOption(t, allowed));
    };

    /**
     * Filter `allProviders` down to those with jobs in any selected location
     * OR with any selected tech.
     */
    const narrowProviders = (
      allProviders: string[],
      selectedLocations: string[],
      selectedTechs: string[] = [],
    ): string[] => {
      if (!loaded) return allProviders;
      const noLocs = !selectedLocations || selectedLocations.length === 0;
      const noTechs = !selectedTechs || selectedTechs.length === 0;
      if (noLocs && noTechs) return allProviders;
      const allowed = new Set<string>();
      if (!noLocs) {
        for (const v of collectUnion(selectedLocations, locationToProvidersN)) allowed.add(v);
      }
      if (!noTechs) {
        for (const v of collectUnion(selectedTechs, techToProvidersN)) allowed.add(v);
      }
      return allProviders.filter((p) => allowsOption(p, allowed));
    };

    return { data, loaded, narrowLocations, narrowTechs, narrowProviders };
  }, [data, loaded]);
}
