
import React from 'react';
import { useKnowledgeGraphStore } from '@/store/knowledge-graph-store';
import { CitationsTable } from '@/components/CitationsTable';
import { MasterPaperCard } from '@/components/MasterPaperCard';

export const MainAnalysisView: React.FC = () => {
  const { papers, authors, authorships } = useKnowledgeGraphStore();
  
  // Find the master paper (the one that's not a stub and has the most relationships)
  const masterPaper = Object.values(papers).find(paper => !paper.is_stub);
  
  // Get all non-stub papers for the citations table
  const citationPapers = Object.values(papers).filter(paper => !paper.is_stub && paper.short_uid !== masterPaper?.short_uid);
  
  console.log('[MainAnalysisView] Master paper:', masterPaper);
  console.log('[MainAnalysisView] Citation papers count:', citationPapers.length);
  console.log('[MainAnalysisView] All papers:', Object.keys(papers).length);

  if (!masterPaper) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">No master paper found</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <MasterPaperCard paper={masterPaper} />
      
      <div>
        <h2 className="text-2xl font-semibold mb-4">Citations</h2>
        {citationPapers.length > 0 ? (
          <CitationsTable papers={citationPapers} />
        ) : (
          <div className="text-center py-8">
            <p className="text-muted-foreground">No citation papers found</p>
          </div>
        )}
      </div>
    </div>
  );
};
