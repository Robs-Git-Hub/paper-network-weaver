
import React, { useEffect, useRef, useState } from 'react';
import { useKnowledgeGraphStore } from '@/store/knowledge-graph-store';
import { MasterPaperCard } from '@/components/MasterPaperCard';
import { UnifiedCitationsTable } from '@/components/UnifiedCitationsTable';
import { TopNav } from '@/components/TopNav';
import { workerManager } from '@/services/workerManager';

export const MainAnalysisView: React.FC = () => {
  const { papers, app_status, setAppStatus } = useKnowledgeGraphStore();
  const hasExtendedRef = useRef(false);
  const [currentView, setCurrentView] = useState('Table');
  
  // Find the master paper (the one that's not a stub and has the most relationships)
  const masterPaper = Object.values(papers).find(paper => !paper.is_stub);
  
  console.log('[MainAnalysisView] Master paper:', masterPaper);
  console.log('[MainAnalysisView] All papers:', Object.keys(papers).length);

  // Automatically extend the graph once when master paper is available
  useEffect(() => {
    if (masterPaper && !hasExtendedRef.current) {
      hasExtendedRef.current = true;
      setAppStatus({ state: 'extending', message: 'Extending graph...' });
      workerManager.extendGraph();
    }
  }, [masterPaper, setAppStatus]);

  const handleViewChange = (viewName: string) => {
    setCurrentView(viewName);
  };

  if (!masterPaper) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">No master paper found</p>
      </div>
    );
  }

  // Get all citation papers (excluding master paper and pure stubs without relationship tags)
  const citationPapers = Object.values(papers).filter(paper => 
    paper.short_uid !== masterPaper.short_uid && 
    (!paper.is_stub || (paper.relationship_tags && paper.relationship_tags.length > 0))
  );
  
  console.log('[MainAnalysisView] Citation papers:', citationPapers.length);

  const renderCurrentView = () => {
    switch (currentView) {
      case 'Table':
        return <UnifiedCitationsTable papers={citationPapers} />;
      case 'Network':
        return (
          <div className="text-center py-20">
            <p className="text-muted-foreground">Network view coming soon</p>
          </div>
        );
      default:
        return <UnifiedCitationsTable papers={citationPapers} />;
    }
  };

  return (
    <div className="space-y-8">
      <TopNav 
        items={['Table', 'Network']} 
        active={currentView} 
        onClick={handleViewChange} 
      />
      
      <MasterPaperCard paper={masterPaper} />
      
      <div>
        <h2 className="text-2xl font-semibold mb-6">Related Papers</h2>
        {renderCurrentView()}
      </div>
    </div>
  );
};
