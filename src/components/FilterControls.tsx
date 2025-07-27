
import React from 'react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Badge } from '@/components/ui/badge';

interface FilterControl {
  value: string;
  label: string;
  description: string;
  count: number;
}

interface FilterControlsProps {
  filters: FilterControl[];
  activeFilters: string[];
  onFiltersChange: (filters: string[]) => void;
  totalCount: number;
  filteredCount: number;
}

export const FilterControls: React.FC<FilterControlsProps> = ({
  filters,
  activeFilters,
  onFiltersChange,
  totalCount,
  filteredCount
}) => {
  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">Relationship Types:</div>
      <ToggleGroup 
        type="multiple" 
        value={activeFilters} 
        onValueChange={onFiltersChange}
        className="justify-start flex-wrap gap-2"
      >
        {filters.map(filter => (
          <ToggleGroupItem 
            key={filter.value} 
            value={filter.value} 
            variant="outline"
            className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
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
          ? `Showing ${filteredCount} of ${totalCount} papers`
          : 'Select filters to view papers'
        }
      </div>
    </div>
  );
};
