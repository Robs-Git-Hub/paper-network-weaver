
import React from 'react';
import { useKnowledgeGraphStore } from '@/store/knowledge-graph-store';
import { MasterPaperCard } from '@/components/MasterPaperCard';
import { DirectCitationsTable } from '@/components/DirectCitationsTable';
import { SecondDegreeCitationsTable } from '@/components/SecondDegreeCitationsTable';
import { CoCitedPapersTable } from '@/components/CoCitedPapersTable';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { workerManager } from '@/services/workerManager';
import { categorizeCitations } from '@/utils/citation-categorizer';

export const MainAnalysisView: React.FC = () => {
  const { papers, authors, authorships, paper_relationships, app_status, setAppStatus } = useKnowledgeGraphStore();
  
  // Find the master paper (the one that's not a stub and has the most relationships)
  const masterPaper = Object.values(papers).find(paper => !paper.is_stub);
  
  console.log('[MainAnalysisView] Master paper:', masterPaper);
  console.log('[MainAnalysisView] All papers:', Object.keys(papers).length);
  console.log('[MainAnalysisView] Paper relationships:', paper_relationships.length);

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

  // Categorize citations into three types
  const categorizedCitations = categorizeCitations(papers, paper_relationships, masterPaper.short_uid);
  
  console.log('[MainAnalysisView] First degree citations:', categorizedCitations.firstDegree.length);
  console.log('[MainAnalysisView] Second degree citations:', categorizedCitations.secondDegree.length);
  console.log('[MainAnalysisView] Co-cited papers:', categorizedCitations.referencedByFirstDegree.length);

  return (
    <div className="space-y-8">
      <MasterPaperCard paper={masterPaper} />
      
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Citation Analysis</h2>
        
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

      {/* Direct Citations (1st Degree) */}
      <div className="space-y-4">
        <div>
          <h3 className="text-xl font-semibold">Direct Citations</h3>
          <p className="text-sm text-muted-foreground">
            Papers that directly cite the master paper ({categorizedCitations.firstDegree.length})
          </p>
        </div>
        <DirectCitationsTable papers={categorizedCitations.firstDegree} />
      </div>

      {/* Second Degree Citations */}
      <div className="space-y-4">
        <div>
          <h3 className="text-xl font-semibold">Second-Degree Citations</h3>
          <p className="text-sm text-muted-foreground">
            Papers that cite the direct citations ({categorizedCitations.secondDegree.length})
          </p>
        </div>
        <SecondDegreeCitationsTable papers={categorizedCitations.secondDegree} />
      </div>

      {/* Co-Cited Papers (Referenced by 1st Degree) */}
      <div className="space-y-4">
        <div>
          <h3 className="text-xl font-semibold">Co-Cited Papers</h3>
          <p className="text-sm text-muted-foreground">
            Papers frequently referenced by direct citations ({categorizedCitations.referencedByFirstDegree.length})
          </p>
        </div>
        <CoCitedPapersTable papers={categorizedCitations.referencedByFirstDegree} />
      </div>
    </div>
  );
};
