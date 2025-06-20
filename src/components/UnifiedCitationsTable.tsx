
import React from 'react';
import { CitationsTable } from '@/components/CitationsTable';
import { FilterControls } from '@/components/FilterControls';
import { useRelationshipFilters } from '@/hooks/useRelationshipFilters';
import type { Paper } from '@/store/knowledge-graph-store';

interface UnifiedCitationsTableProps {
  papers: Paper[];
}

export const UnifiedCitationsTable: React.FC<UnifiedCitationsTableProps> = ({ papers }) => {
  const {
    activeFilters,
    setActiveFilters,
    filteredPapers,
    filterCounts
  } = useRelationshipFilters(papers);

  return (
    <div className="space-y-6">
      <FilterControls
        filters={filterCounts}
        activeFilters={activeFilters}
        onFiltersChange={setActiveFilters}
        totalCount={papers.length}
        filteredCount={filteredPapers.length}
      />

      {filteredPapers.length > 0 ? (
        <CitationsTable papers={filteredPapers} showRelationshipTags />
      ) : (
        <div className="text-center py-8">
          <p className="text-muted-foreground">
            {activeFilters.length > 0 && papers.length > 0
              ? 'No papers match the selected filters'
              : 'Loading or no related papers found.'
            }
          </p>
        </div>
      )}
    </div>
  );
};
