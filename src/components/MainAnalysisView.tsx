
import React, { useMemo } from 'react';
import { useKnowledgeGraphStore, Paper, Author } from '@/store/knowledge-graph-store';
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

// DEFINE: A new type for the rich paper objects our selector will create.
export interface EnrichedPaper extends Paper {
  authors: Author[];
  relationship_tags: string[];
}

export const MainAnalysisView: React.FC<MainAnalysisViewProps> = ({ 
  onViewChange, 
  currentView = 'Table' 
}) => {
  const { papers, authors, authorships, relation_to_master, app_status } = useKnowledgeGraphStore();
  
  const masterPaper = Object.values(papers).find(paper => !paper.is_stub && paper.publication_year);
  
  const isInitialLoading = ['loading', 'enriching'].includes(app_status.state);
  const isExtending = app_status.state === 'extending';

  // --- START: UI "SELECTOR" IMPLEMENTATION ---
  // This memoized selector creates the rich data needed by the UI table.
  const enrichedRelatedPapers = useMemo<EnrichedPaper[]>(() => {
    if (!masterPaper) return [];

    const relatedPaperUids = Object.keys(relation_to_master);

    return relatedPaperUids
      .map(uid => papers[uid])
      // FIX: Use a proper type predicate to safely filter out undefined papers.
      .filter((paper): paper is Paper => !!paper)
      .map(paper => {
        const paperAuthorships = Object.values(authorships).filter(
          auth => auth.paper_short_uid === paper.short_uid
        );
        const paperAuthors = paperAuthorships
          .sort((a, b) => a.author_position - b.author_position)
          .map(auth => authors[auth.author_short_uid])
          // FIX: Use a proper type predicate to safely filter out undefined authors.
          .filter((author): author is Author => !!author);

        const tags = relation_to_master[paper.short_uid] || [];

        return {
          ...paper,
          authors: paperAuthors,
          relationship_tags: tags,
        };
      });
  }, [papers, authors, authorships, relation_to_master, masterPaper]);
  // --- END: UI "SELECTOR" IMPLEMENTATION ---

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
        return <NetworkView papers={enrichedRelatedPapers} masterPaper={masterPaper} />;
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