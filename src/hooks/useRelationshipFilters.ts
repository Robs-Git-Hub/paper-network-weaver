
import { useState, useMemo } from 'react';
// REFACTOR: Import `relation_to_master` instead of `paper_relationships`.
import { useKnowledgeGraphStore } from '@/store/knowledge-graph-store';
import type { Paper } from '@/store/knowledge-graph-store';

export const RELATIONSHIP_FILTERS = [
  { value: '1st_degree', label: 'Direct Citations', description: 'Papers that directly cite the master paper' },
  { value: '2nd_degree', label: 'Second-Degree', description: 'Papers that cite the direct citations' },
  { value: 'referenced_by_1st_degree', label: 'Commonly Co-Cited', description: 'Papers commonly referenced by direct citations' },
];

export const useRelationshipFilters = (papers: Paper[]) => {
  // REFACTOR: Use the new `relation_to_master` index from the store.
  const { relation_to_master } = useKnowledgeGraphStore();
  const [activeFilters, setActiveFilters] = useState<string[]>(['1st_degree']);

  // REFACTOR: The memoized `paperTagsMap` is no longer needed.
  // The `relation_to_master` object from the store is already in the optimal format.

  // REFACTOR: Filter papers based on the new, efficient `relation_to_master` index.
  const filteredPapers = useMemo(() => {
    // If no filters are active, return all papers provided to the hook.
    if (activeFilters.length === 0) return papers;
    
    return papers.filter(paper => {
      // Direct lookup in the index.
      const tags = relation_to_master[paper.short_uid];
      if (!tags) return false;
      // Check if any of the paper's tags match an active filter.
      return activeFilters.some(filter => tags.includes(filter));
    });
  }, [papers, activeFilters, relation_to_master]);

  // REFACTOR: Calculate filter counts directly from the `relation_to_master` index.
  // This is more efficient as it no longer needs to iterate over the `papers` array.
  const filterCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    RELATIONSHIP_FILTERS.forEach(f => counts[f.value] = 0);

    // Iterate through the tag arrays in our index to build the counts.
    for (const tags of Object.values(relation_to_master)) {
      for (const tag of tags) {
        if (counts[tag] !== undefined) {
          counts[tag]++;
        }
      }
    }

    return RELATIONSHIP_FILTERS.map(filter => ({
      ...filter,
      count: counts[filter.value] || 0
    }));
  }, [relation_to_master]);

  return {
    activeFilters,
    setActiveFilters,
    filteredPapers,
    filterCounts // NOTE: Renamed from `getFilterCounts` for clarity, as it's a value not a function.
  };
};