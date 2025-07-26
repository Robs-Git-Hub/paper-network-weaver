
import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { useKnowledgeGraphStore } from '@/store/knowledge-graph-store';
import { transformPapersToNetwork } from '@/utils/network-data-transformer';
import { FilterControls } from '@/components/FilterControls';
import { useRelationshipFilters } from '@/hooks/useRelationshipFilters';
import type { EnrichedPaper } from '@/types';

interface NetworkViewProps {
  papers: EnrichedPaper[];
  masterPaper: EnrichedPaper;
}

export const NetworkView: React.FC<NetworkViewProps> = ({ papers, masterPaper }) => {
  const { authors, authorships, paper_relationships } = useKnowledgeGraphStore();
  const {
    activeFilters,
    setActiveFilters,
    filteredPapers,
    filterCounts,
    legendSelected,
    setLegendSelected
  } = useRelationshipFilters(papers);

  const chartData = useMemo(() => {
    return transformPapersToNetwork(
      filteredPapers,
      masterPaper,
      paper_relationships,
      authors,
      authorships
    );
  }, [filteredPapers, masterPaper, paper_relationships, authors, authorships]);

  const option = useMemo(() => ({
    title: {
      text: '',
      top: 'top',
      left: 'center'
    },
    tooltip: {
      trigger: 'item',
      formatter: (params: any) => {
        if (params.dataType === 'node' && params.data.paperData) {
          const data = params.data.paperData;
          return `
            <div style="max-width: 300px;">
              <div style="font-weight: bold; margin-bottom: 8px;">${data.title}</div>
              <div style="margin-bottom: 4px;"><strong>Citations:</strong> ${data.citedByCount}</div>
              <div style="margin-bottom: 4px;"><strong>Year:</strong> ${data.publicationYear || 'N/A'}</div>
              ${data.authors.length > 0 ? `<div style="margin-bottom: 4px;"><strong>Authors:</strong> ${data.authors.join(', ')}</div>` : ''}
              ${data.relationshipTags.length > 0 ? `<div><strong>Tags:</strong> ${data.relationshipTags.join(', ')}</div>` : ''}
            </div>
          `;
        }
        return '';
      }
    },
    legend: {
      show: true,
      data: chartData.categories.map(cat => cat.name),
      selected: {
        'Master Paper': true, // Always show master paper
        ...legendSelected
      },
      top: 20,
      left: 'center'
    },
    animationDurationUpdate: 1500,
    animationEasingUpdate: 'quinticInOut',
    series: [
      {
        name: 'Citation Network',
        type: 'graph',
        layout: 'force',
        data: chartData.nodes,
        links: chartData.links,
        categories: chartData.categories,
        roam: true,
        focusNodeAdjacency: true,
        itemStyle: {
          borderColor: '#fff',
          borderWidth: 1,
          shadowBlur: 10,
          shadowColor: 'rgba(0, 0, 0, 0.3)'
        },
        label: {
          show: true,
          position: 'right',
          formatter: '{b}',
          fontSize: 10
        },
        lineStyle: {
          color: 'source',
          curveness: 0.3
        },
        emphasis: {
          focus: 'adjacency',
          lineStyle: {
            width: 2
          }
        },
        force: {
          repulsion: 2000,
          gravity: 0.2,
          edgeLength: 200,
          layoutAnimation: true
        }
      }
    ]
  }), [chartData]);

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
        <div className="w-full h-[600px] border rounded-lg bg-white">
          <ReactECharts 
            option={option} 
            style={{ height: '100%', width: '100%' }}
            opts={{ renderer: 'canvas' }}
            onEvents={{
              legendselectchanged: (params: any) => {
                setLegendSelected(params.selected);
                
                // Update active filters based on legend selection
                const newActiveFilters = activeFilters.filter(filter => {
                  const categoryName = filter.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
                  return params.selected[categoryName] !== false;
                });
                setActiveFilters(newActiveFilters);
              }
            }}
          />
        </div>
      ) : (
        <div className="text-center py-8">
          <p className="text-muted-foreground">No papers match the selected filters</p>
        </div>
      )}
    </div>
  );
};
