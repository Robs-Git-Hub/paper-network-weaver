
import React from 'react';
import { useRelationshipFilters } from '@/hooks/useRelationshipFilters';
import { Button } from '@/components/ui/button';
import { EnrichedPaper } from './MainAnalysisView';
import { CitationsTable } from './CitationsTable';

interface UnifiedCitationsTableProps {
  papers: EnrichedPaper[];
}

export const UnifiedCitationsTable: React.FC<UnifiedCitationsTableProps> = ({ papers }) => {
  const { 
    activeFilters, 
    setActiveFilters, 
    filteredPapers, 
    filterCounts 
  } = useRelationshipFilters(papers);

  const handleFilterToggle = (value: string) => {
    setActiveFilters(prev => 
      prev.includes(value) 
        ? prev.filter(f => f !== value) 
        : [...prev, value]
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {filterCounts.map(filter => (
          <Button
            key={filter.value}
            variant={activeFilters.includes(filter.value) ? 'default' : 'outline'}
            onClick={() => handleFilterToggle(filter.value)}
            disabled={filter.count === 0}
            className="flex items-center gap-2"
          >
            {filter.label}
            <span className="text-xs font-mono bg-muted/50 px-1.5 py-0.5 rounded">
              {filter.count}
            </span>
          </Button>
        ))}
      </div>
      <CitationsTable papers={filteredPapers} />
    </div>
  );
};