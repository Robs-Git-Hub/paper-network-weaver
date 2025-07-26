
import { useState, useMemo } from 'react';
// REFACTOR: Import `relation_to_master` instead of `paper_relationships`.
import { useKnowledgeGraphStore } from '@/store/knowledge-graph-store';
// FIX: Import the EnrichedPaper type from its new central location.
import { EnrichedPaper } from '@/types';

export const RELATIONSHIP_FILTERS = [
  { value: '1st_degree', label: 'Direct Citations', description: 'Papers that directly cite the master paper' },
  { value: '2nd_degree', label: 'Second-Degree', description: 'Papers that cite the direct citations' },
  { value: 'referenced_by_1st_degree', label: 'Commonly Co-Cited', description: 'Papers commonly referenced by direct citations' },
];

export const useRelationshipFilters = (papers: EnrichedPaper[]) => {
  const { relation_to_master } = useKnowledgeGraphStore();
  const [activeFilters, setActiveFilters] = useState<string[]>(['1st_degree']);
  const [legendSelected, setLegendSelected] = useState<Record<string, boolean>>({
    'Direct Citations': true,
    'Second-Degree': false,
    'Co-Cited': false
  });

  const filteredPapers = useMemo(() => {
    // If no filters are active, return all papers provided to the hook.
    if (activeFilters.length === 0) return papers;
    
    return papers.filter(paper => {
      const tags = paper.relationship_tags;
      if (!tags) return false;
      return activeFilters.some(filter => tags.includes(filter));
    });
  }, [papers, activeFilters]);

  const filterCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    RELATIONSHIP_FILTERS.forEach(f => counts[f.value] = 0);

    for (const paper of papers) {
      for (const tag of paper.relationship_tags) {
        if (counts[tag] !== undefined) {
          counts[tag]++;
        }
      }
    }

    return RELATIONSHIP_FILTERS.map(filter => ({
      ...filter,
      count: counts[filter.value] || 0
    }));
  }, [papers]);

  return {
    activeFilters,
    setActiveFilters,
    filteredPapers,
    filterCounts,
    legendSelected,
    setLegendSelected
  };
};