
import React, { useMemo } from 'react';
import { useKnowledgeGraphStore } from '@/store/knowledge-graph-store';
import { MasterPaperCard } from '@/components/MasterPaperCard';
import { UnifiedCitationsTable } from '@/components/UnifiedCitationsTable';
import { NetworkView } from '@/components/NetworkView';
import { TopNav } from '@/components/TopNav';
import { ExportButton } from '@/components/ExportButton';
import { ProgressDisplay } from '@/components/ProgressDisplay';
import { EnrichedPaper } from '@/types';

interface MainAnalysisViewProps {
  onViewChange?: (viewName: string) => void;
  currentView?: string;
}

export const MainAnalysisView: React.FC<MainAnalysisViewProps> = ({ 
  onViewChange, 
  currentView = 'Table' 
}) => {
  // We now also get the pre-computed enriched_papers map from the store.
  const { papers, enriched_papers, relation_to_master, app_status } = useKnowledgeGraphStore();
  
  const masterPaper = Object.values(papers).find(paper => !paper.is_stub && paper.publication_year);
  
  const isInitialLoading = ['loading', 'enriching'].includes(app_status.state);
  const isExtending = app_status.state === 'extending';

  // Create enriched version of master paper
  const enrichedMasterPaper = useMemo<EnrichedPaper | null>(() => {
    if (!masterPaper) return null;
    
    return enriched_papers[masterPaper.short_uid] || null;
  }, [masterPaper, enriched_papers]);

  // This calculation is now dramatically faster.
  // Instead of rebuilding everything on each render, we just do a quick lookup
  // in the pre-computed `enriched_papers` map.
  const enrichedRelatedPapers = useMemo<EnrichedPaper[]>(() => {
    if (!masterPaper) return [];

    // Get all paper UIDs that have a relationship tag.
    const allRelatedPaperUids = Object.keys(relation_to_master);

    // This is now a simple and fast lookup, not a slow computation.
    return allRelatedPaperUids
      .map(uid => enriched_papers[uid])
      .filter((paper): paper is EnrichedPaper => !!paper);

  }, [enriched_papers, relation_to_master, masterPaper]);

  if (isInitialLoading) {
    return (
      <div className="text-center py-20 max-w-2xl mx-auto">
        <ProgressDisplay 
          value={app_status.progress || 0} 
          label={app_status.message || 'Loading...'} 
        />
      </div>
    );
  }

  if (!masterPaper) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">No master paper found or analysis failed</p>
      </div>
    );
  }
  
  const renderCurrentView = () => {
    switch (currentView) {
      case 'Table':
        return <UnifiedCitationsTable papers={enrichedRelatedPapers} />;
      case 'Network':
        return enrichedMasterPaper ? (
          <NetworkView papers={enrichedRelatedPapers} masterPaper={enrichedMasterPaper} />
        ) : (
          <div className="text-center py-8">
            <p className="text-muted-foreground">Master paper data not yet enriched</p>
          </div>
        );
      default:
        return <UnifiedCitationsTable papers={enrichedRelatedPapers} />;
    }
  };

  return (
    <div className="space-y-8">
      <div className="hidden sm:flex justify-between items-center">
        <TopNav 
          items={['Table', 'Network']} 
          active={currentView} 
          onClick={onViewChange || (() => {})} 
        />
        <ExportButton />
      </div>
      
      <MasterPaperCard paper={masterPaper} />
      
      <div>
        <h2 className="text-2xl font-semibold mb-6">Related Papers</h2>
        
        {isExtending && app_status.message && (
          <ProgressDisplay 
            value={app_status.progress || 0} 
            label={app_status.message} 
          />
        )}
        
        {renderCurrentView()}
      </div>
    </div>
  );
};