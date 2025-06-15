
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
  const { papers, app_status } = useKnowledgeGraphStore();
  
  const masterPaper = Object.values(papers).find(paper => !paper.is_stub);
  
  // *** THIS IS THE FIX FOR THE UI LOGIC ***
  // We now define processing states for the initial load vs. the background extension.
  const isInitialLoading = ['loading', 'enriching'].includes(app_status.state);
  const isExtending = app_status.state === 'extending';

  // Show the full-page progress bar during the entire initial load (Phases A & B).
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

  // If loading is finished but we still have no paper, show an error/empty state.
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
        
        {/* Show the inline progress bar ONLY during the 'extending' phase (Phase C) */}
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