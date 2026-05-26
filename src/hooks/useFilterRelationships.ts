import { useEffect, useMemo, useRef, useState } from 'react';

export type FilterRelationships = {
  techToLocations: Record<string, string[]>;
  locationToTechs: Record<string, string[]>;
  providerToLocations: Record<string, string[]>;
  locationToProviders: Record<string, string[]>;
};

const EMPTY: FilterRelationships = {
  techToLocations: {},
  locationToTechs: {},
  providerToLocations: {},
  locationToProviders: {},
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
    const collectUnion = (
      keys: string[],
      map: Record<string, string[]>,
    ): Set<string> => {
      const out = new Set<string>();
      for (const k of keys) {
        const arr = map[k];
        if (!arr) continue;
        for (const v of arr) out.add(v);
      }
      return out;
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
        for (const v of collectUnion(selectedTechs, data.techToLocations)) allowed.add(v);
      }
      if (!noProvs) {
        for (const v of collectUnion(selectedProviders, data.providerToLocations)) allowed.add(v);
      }
      return allLocations.filter((l) => allowed.has(l));
    };

    /**
     * Filter `allTechs` down to those that have jobs in any of the selected
     * locations.
     */
    const narrowTechs = (
      allTechs: string[],
      selectedLocations: string[],
    ): string[] => {
      if (!loaded) return allTechs;
      if (!selectedLocations || selectedLocations.length === 0) return allTechs;
      const allowed = collectUnion(selectedLocations, data.locationToTechs);
      return allTechs.filter((t) => allowed.has(t));
    };

    /**
     * Filter `allProviders` down to those that have jobs in any of the
     * selected locations.
     */
    const narrowProviders = (
      allProviders: string[],
      selectedLocations: string[],
    ): string[] => {
      if (!loaded) return allProviders;
      if (!selectedLocations || selectedLocations.length === 0) return allProviders;
      const allowed = collectUnion(selectedLocations, data.locationToProviders);
      return allProviders.filter((p) => allowed.has(p));
    };

    return { data, loaded, narrowLocations, narrowTechs, narrowProviders };
  }, [data, loaded]);
}
