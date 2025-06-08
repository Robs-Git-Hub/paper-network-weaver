
import React from 'react';
import { useKnowledgeGraphStore } from '@/store/knowledge-graph-store';
import { MasterPaperCard } from '@/components/MasterPaperCard';
import { UnifiedCitationsTable } from '@/components/UnifiedCitationsTable';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { workerManager } from '@/services/workerManager';

export const MainAnalysisView: React.FC = () => {
  const { papers, app_status, setAppStatus } = useKnowledgeGraphStore();
  
  // Find the master paper (the one that's not a stub and has the most relationships)
  const masterPaper = Object.values(papers).find(paper => !paper.is_stub);
  
  console.log('[MainAnalysisView] Master paper:', masterPaper);
  console.log('[MainAnalysisView] All papers:', Object.keys(papers).length);

  const handleExtendNetwork = () => {
    setAppStatus({ state: 'extending', message: 'Extending graph...' });
    workerManager.extendGraph();
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

  return (
    <div className="space-y-8">
      <MasterPaperCard paper={masterPaper} />
      
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Citation Network</h2>
        
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={handleExtendNetwork}
                disabled={app_status.state === 'extending'}
                className="bg-[#437e84] hover:bg-[#437e84]/90"
              >
                {app_status.state === 'extending' ? 'Extending...' : 'Extend Network'}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Identify 2nd degree citations and highly relevant non-citation papers</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <UnifiedCitationsTable papers={citationPapers} />
    </div>
  );
};
