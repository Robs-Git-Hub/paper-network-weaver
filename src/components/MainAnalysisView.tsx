
import React from 'react';
import { useKnowledgeGraphStore } from '@/store/knowledge-graph-store';
import { MasterPaperCard } from '@/components/MasterPaperCard';
import { UnifiedCitationsTable } from '@/components/UnifiedCitationsTable';
import { NetworkView } from '@/components/NetworkView';
import { TopNav } from '@/components/TopNav';
import { ExportButton } from '@/components/ExportButton';
import { ProgressDisplay } from '@/components/ProgressDisplay';

interface MainAnalysisViewProps {
  onViewChange?: (viewName: string) => void;
  currentView?: string;
}

export const MainAnalysisView: React.FC<MainAnalysisViewProps> = ({ 
  onViewChange, 
  currentView = 'Table' 
}) => {
  const { papers, app_status, paper_relationships } = useKnowledgeGraphStore();
  
  // --- DIAGNOSTIC LOGS ---
  // Let's inspect the data the component is receiving from the store.
  console.log('[DIAGNOSTIC] All papers in store:', Object.values(papers));
  console.log('[DIAGNOSTIC] All relationships in store:', paper_relationships);
  // --- END DIAGNOSTIC LOGS ---

  const masterPaper = Object.values(papers).find(paper => !paper.is_stub);
  
  const isInitialLoading = ['loading', 'enriching'].includes(app_status.state);
  const isExtending = app_status.state === 'extending';

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
        <p className="text-muted-foreground">No master paper found</p>
      </div>
    );
  }

  const citationPapers = Object.values(papers).filter(paper => 
    paper.short_uid !== masterPaper.short_uid && 
    (!paper.is_stub || (paper.relationship_tags && paper.relationship_tags.length > 0))
  );
  
  const renderCurrentView = () => {
    switch (currentView) {
      case 'Table':
        return <UnifiedCitationsTable papers={citationPapers} />;
      case 'Network':
        return <NetworkView papers={citationPapers} masterPaper={masterPaper} />;
      default:
        return <UnifiedCitationsTable papers={citationPapers} />;
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