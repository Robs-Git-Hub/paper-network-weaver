
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

  if (papers.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">No citation papers found</p>
      </div>
    );
  }

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
          <p className="text-muted-foreground">No papers match the selected filters</p>
        </div>
      )}
    </div>
  );
};
