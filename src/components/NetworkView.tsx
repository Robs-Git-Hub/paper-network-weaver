
import React, { useMemo, useRef, useEffect } from 'react';
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
    setLegendSelected,
    setIsUpdatingFromChart
  } = useRelationshipFilters(papers);

  const chartRef = useRef<ReactECharts>(null);

  // Mapping from filter values to legend category names
  const filterToLegendMap = {
    '1st_degree': 'Direct Citations',
    '2nd_degree': 'Second-Degree',
    'referenced_by_1st_degree': 'Co-Cited'
  };

  // Reverse mapping from legend category names to filter values
  const legendToFilterMap = Object.fromEntries(
    Object.entries(filterToLegendMap).map(([filter, legend]) => [legend, filter])
  );

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
      confine: true,
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      borderColor: 'rgba(255, 255, 255, 0.2)',
      borderWidth: 1,
      textStyle: {
        color: '#fff'
      },
      formatter: (params: any) => {
        if (params.dataType === 'node' && params.data.paperData) {
          const data = params.data.paperData;
          
          // Truncate title if too long
          const maxTitleLength = 80;
          const displayTitle = data.title.length > maxTitleLength 
            ? data.title.substring(0, maxTitleLength) + '...' 
            : data.title;
          
          // Handle authors list with line breaks for readability
          let authorsDisplay = '';
          if (data.authors.length > 0) {
            const maxAuthorsPerLine = 3;
            const authorGroups = [];
            for (let i = 0; i < data.authors.length; i += maxAuthorsPerLine) {
              authorGroups.push(data.authors.slice(i, i + maxAuthorsPerLine).join(', '));
            }
            authorsDisplay = authorGroups.join('<br/>');
          }
          
          // Handle tags with proper wrapping
          const tagsDisplay = data.relationshipTags.length > 0 
            ? data.relationshipTags.join(', ') 
            : '';
          
          return `
            <div style="
              max-width: 320px;
              word-wrap: break-word;
              overflow-wrap: break-word;
              white-space: normal;
              line-height: 1.4;
              box-sizing: border-box;
              padding: 8px;
            ">
              <div style="
                font-weight: bold; 
                margin-bottom: 8px;
                word-wrap: break-word;
                overflow-wrap: break-word;
              ">${displayTitle}</div>
              <div style="margin-bottom: 4px;"><strong>Citations:</strong> ${data.citedByCount}</div>
              <div style="margin-bottom: 4px;"><strong>Year:</strong> ${data.publicationYear || 'N/A'}</div>
              ${data.authors.length > 0 ? `<div style="margin-bottom: 4px; word-wrap: break-word;"><strong>Authors:</strong><br/>${authorsDisplay}</div>` : ''}
              ${data.relationshipTags.length > 0 ? `<div style="word-wrap: break-word;"><strong>Tags:</strong> ${tagsDisplay}</div>` : ''}
            </div>
          `;
        }
        return '';
      }
    },
    legend: {
      show: true,
      data: chartData.categories.map(cat => cat.name),
      selected: legendSelected,
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
  }), [chartData, legendSelected]);

  // Sync ECharts legend state when legendSelected changes
  useEffect(() => {
    if (chartRef.current) {
      const chartInstance = chartRef.current.getEchartsInstance();
      chartInstance.setOption({
        legend: {
          selected: legendSelected
        }
      });
    }
  }, [legendSelected]);

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
            ref={chartRef}
            option={option} 
            style={{ height: '100%', width: '100%' }}
            opts={{ renderer: 'canvas' }}
            onEvents={{
              legendselectchanged: (params: any) => {
                setIsUpdatingFromChart(true);
                
                // Ensure Master Paper always stays selected
                const updatedSelected = {
                  ...params.selected,
                  'Master Paper': true
                };
                
                setLegendSelected(updatedSelected);
                
                // Update active filters based on legend selection (additive behavior)
                const newActiveFilters: string[] = [];
                Object.entries(updatedSelected).forEach(([legendName, isSelected]) => {
                  if (isSelected && legendToFilterMap[legendName]) {
                    newActiveFilters.push(legendToFilterMap[legendName]);
                  }
                });
                setActiveFilters(newActiveFilters);
                
                // Reset the circular update flag after a brief delay
                setTimeout(() => setIsUpdatingFromChart(false), 100);
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
