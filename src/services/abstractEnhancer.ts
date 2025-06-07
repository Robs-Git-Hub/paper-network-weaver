
import { openAlexService } from './openAlex';
import { reconstructAbstract } from '@/utils/data-transformers';
import { Paper } from '@/store/knowledge-graph-store';

export async function enhancePapersWithAbstracts(papers: Record<string, Paper>): Promise<Record<string, Paper>> {
  const enhancedPapers = { ...papers };
  const papersNeedingAbstracts: string[] = [];
  
  // Find papers that need abstract reconstruction
  Object.keys(papers).forEach(paperKey => {
    const paper = papers[paperKey];
    if (paper.abstract === 'Abstract will be reconstructed here' || !paper.abstract) {
      papersNeedingAbstracts.push(paperKey);
    }
  });
  
  console.log(`[Abstract Enhancer] Found ${papersNeedingAbstracts.length} papers needing abstracts`);
  
  // Process each paper that needs an abstract
  for (const paperKey of papersNeedingAbstracts) {
    const paper = papers[paperKey];
    
    try {
      // Extract OpenAlex ID from the paper's external IDs
      // We need to look for the OpenAlex ID in the paper data
      // For now, we'll try to construct it from the paper's data
      const openAlexId = extractOpenAlexId(paper);
      
      if (openAlexId) {
        console.log(`[Abstract Enhancer] Fetching details for paper: ${paper.title?.substring(0, 50)}...`);
        const paperDetails = await openAlexService.fetchPaperDetails(openAlexId);
        
        if (paperDetails?.abstract_inverted_index) {
          const reconstructedAbstract = reconstructAbstract(paperDetails.abstract_inverted_index);
          if (reconstructedAbstract) {
            enhancedPapers[paperKey] = {
              ...paper,
              abstract: reconstructedAbstract
            };
            console.log(`[Abstract Enhancer] Successfully enhanced abstract for: ${paper.title?.substring(0, 50)}...`);
          }
        }
      }
    } catch (error) {
      console.warn(`[Abstract Enhancer] Failed to enhance abstract for paper ${paperKey}:`, error);
    }
  }
  
  return enhancedPapers;
}

function extractOpenAlexId(paper: Paper): string | null {
  // This is a simplified approach - in a real implementation,
  // we'd need to store the OpenAlex ID in the paper or external_id_index
  // For now, we'll return null and let the enhancement fail gracefully
  return null;
}
