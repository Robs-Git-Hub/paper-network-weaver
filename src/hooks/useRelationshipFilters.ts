
import { useState, useMemo } from 'react';
import type { Paper } from '@/store/knowledge-graph-store';

export const RELATIONSHIP_FILTERS = [
  { value: '1st_degree', label: 'Direct Citations', description: 'Papers that directly cite the master paper' },
  { value: '2nd_degree', label: 'Second-Degree', description: 'Papers that cite the direct citations' },
  { value: 'referenced_by_1st_degree', label: 'Commonly Co-Cited', description: 'Papers commonly referenced by direct citations' },
];

export const useRelationshipFilters = (papers: Paper[]) => {
  const [activeFilters, setActiveFilters] = useState<string[]>(['1st_degree', '2nd_degree', 'referenced_by_1st_degree']);

  const filteredPapers = useMemo(() => {
    if (activeFilters.length === 0) return papers;
    
    return papers.filter(paper => 
      paper.relationship_tags?.some(tag => activeFilters.includes(tag))
    );
  }, [papers, activeFilters]);

  const getFilterCounts = useMemo(() => {
    return RELATIONSHIP_FILTERS.map(filter => ({
      ...filter,
      count: papers.filter(paper => 
        paper.relationship_tags?.includes(filter.value)
      ).length
    }));
  }, [papers]);

  return {
    activeFilters,
    setActiveFilters,
    filteredPapers,
    filterCounts: getFilterCounts
  };
};
