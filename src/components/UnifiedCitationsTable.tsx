
import React, { useState, useMemo } from 'react';
import { CitationsTable } from '@/components/CitationsTable';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Badge } from '@/components/ui/badge';
import type { Paper } from '@/store/knowledge-graph-store';

interface UnifiedCitationsTableProps {
  papers: Paper[];
}

const RELATIONSHIP_FILTERS = [
  { value: '1st_degree', label: 'Direct Citations', description: 'Papers that directly cite the master paper' },
  { value: '2nd_degree', label: 'Second-Degree', description: 'Papers that cite the direct citations' },
  { value: 'referenced_by_1st_degree', label: 'Co-Cited Papers', description: 'Papers frequently referenced by direct citations' },
  { value: 'similar', label: 'Similar Papers', description: 'Papers identified as related through OpenAlex similarity' }
];

export const UnifiedCitationsTable: React.FC<UnifiedCitationsTableProps> = ({ papers }) => {
  const [activeFilters, setActiveFilters] = useState<string[]>(['1st_degree', '2nd_degree', 'referenced_by_1st_degree', 'similar']);

  const filteredPapers = useMemo(() => {
    if (activeFilters.length === 0) return papers;
    
    return papers.filter(paper => 
      paper.relationship_tags?.some(tag => activeFilters.includes(tag))
    );
  }, [papers, activeFilters]);

  const getFilterCounts = () => {
    return RELATIONSHIP_FILTERS.map(filter => ({
      ...filter,
      count: papers.filter(paper => 
        paper.relationship_tags?.includes(filter.value)
      ).length
    }));
  };

  const filterCounts = getFilterCounts();

  if (papers.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">No citation papers found</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div>
          <h3 className="text-xl font-semibold mb-2">Citation Analysis</h3>
          <p className="text-sm text-muted-foreground">
            Filter papers by their relationship to the master paper
          </p>
        </div>
        
        <div className="space-y-3">
          <div className="text-sm font-medium">Relationship Types:</div>
          <ToggleGroup 
            type="multiple" 
            value={activeFilters} 
            onValueChange={setActiveFilters}
            className="justify-start flex-wrap gap-2"
          >
            {filterCounts.map(filter => (
              <ToggleGroupItem 
                key={filter.value} 
                value={filter.value} 
                variant="outline"
                className="data-[state=on]:bg-[#437e84] data-[state=on]:text-white"
              >
                <div className="flex items-center gap-2">
                  <span>{filter.label}</span>
                  <Badge variant="secondary" className="text-xs">
                    {filter.count}
                  </Badge>
                </div>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          
          <div className="text-xs text-muted-foreground">
            {activeFilters.length > 0 
              ? `Showing ${filteredPapers.length} of ${papers.length} papers`
              : 'Select filters to view papers'
            }
          </div>
        </div>
      </div>

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
