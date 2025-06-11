
import React, { useEffect, useRef, useState } from 'react';
import { useKnowledgeGraphStore } from '@/store/knowledge-graph-store';
import { MasterPaperCard } from '@/components/MasterPaperCard';
import { UnifiedCitationsTable } from '@/components/UnifiedCitationsTable';
import { NetworkView } from '@/components/NetworkView';
import { TopNav } from '@/components/TopNav';
import { ExportButton } from '@/components/ExportButton';
import { workerManager } from '@/services/workerManager';

interface MainAnalysisViewProps {
  onViewChange?: (viewName: string) => void;
  currentView?: string;
}

export const MainAnalysisView: React.FC<MainAnalysisViewProps> = ({ 
  onViewChange, 
  currentView = 'Table' 
}) => {
  const { papers, app_status, setAppStatus } = useKnowledgeGraphStore();
  const hasExtendedRef = useRef(false);
  
  // Find the master paper (the one that's not a stub and has the most relationships)
  const masterPaper = Object.values(papers).find(paper => !paper.is_stub);
  
  console.log('[MainAnalysisView] Master paper:', masterPaper);
  console.log('[MainAnalysisView] All papers:', Object.keys(papers).length);

  // *** REPLACED THIS ENTIRE BLOCK ***
  useEffect(() => {
    // Only trigger the extension when the app becomes 'active' (after Phase B)
    // and only do it once.
    if (app_status.state === 'active' && !hasExtendedRef.current) {
      hasExtendedRef.current = true;
      // The worker will set the status to 'extending' itself.
      workerManager.extendGraph();
    }
  }, [app_status.state]); // Depend on the app status state

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
        return <NetworkView papers={citationPapers} masterPaper={masterPaper} />;
      default:
        return <UnifiedCitationsTable papers={citationPapers} />;
    }
  };

  return (
    <div className="space-y-8">
      {/* Desktop Navigation - only visible on desktop */}
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
        {renderCurrentView()}
      </div>
    </div>
  );
};
