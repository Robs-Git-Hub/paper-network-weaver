
import { useState, useMemo } from 'react';
import { useKnowledgeGraphStore } from '@/store/knowledge-graph-store';
import type { Paper } from '@/store/knowledge-graph-store';

export const RELATIONSHIP_FILTERS = [
  { value: '1st_degree', label: 'Direct Citations', description: 'Papers that directly cite the master paper' },
  { value: '2nd_degree', label: 'Second-Degree', description: 'Papers that cite the direct citations' },
  { value: 'referenced_by_1st_degree', label: 'Commonly Co-Cited', description: 'Papers commonly referenced by direct citations' },
];

export const useRelationshipFilters = (papers: Paper[]) => {
  const { paper_relationships } = useKnowledgeGraphStore();
  const [activeFilters, setActiveFilters] = useState<string[]>(['1st_degree']);

  // --- FIX: Create a map of paper UIDs to their relationship tags from the SSoT. ---
  // This is far more efficient than repeatedly filtering the relationships array.
  const paperTagsMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const rel of paper_relationships) {
      if (!map.has(rel.source_short_uid)) {
        map.set(rel.source_short_uid, new Set());
      }
      if (rel.tag) {
        map.get(rel.source_short_uid)!.add(rel.tag);
      }
    }
    return map;
  }, [paper_relationships]);

  // --- FIX: Filter papers based on the new, correct paperTagsMap. ---
  const filteredPapers = useMemo(() => {
    if (activeFilters.length === 0) return papers;
    
    return papers.filter(paper => {
      const tags = paperTagsMap.get(paper.short_uid);
      if (!tags) return false;
      return activeFilters.some(filter => tags.has(filter));
    });
  }, [papers, activeFilters, paperTagsMap]);

  // --- FIX: Calculate filter counts based on the new, correct paperTagsMap. ---
  const getFilterCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    RELATIONSHIP_FILTERS.forEach(f => counts[f.value] = 0);

    // Iterate through the papers that are actually in the table to get accurate counts
    for (const paper of papers) {
      const tags = paperTagsMap.get(paper.short_uid);
      if (tags) {
        for (const tag of tags) {
          if (counts[tag] !== undefined) {
            counts[tag]++;
          }
        }
      }
    }

    return RELATIONSHIP_FILTERS.map(filter => ({
      ...filter,
      count: counts[filter.value] || 0
    }));
  }, [papers, paperTagsMap]);

  return {
    activeFilters,
    setActiveFilters,
    filteredPapers,
    filterCounts: getFilterCounts
  };
};