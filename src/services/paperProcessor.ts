
import { reconstructAbstract } from '@/utils/data-transformers';
import { Paper } from '@/store/knowledge-graph-store';

interface RawPaperData {
  abstract_inverted_index?: Record<string, number[]>;
  [key: string]: any;
}

export function processAbstractFromRawData(rawData: RawPaperData, existingPaper?: Paper): string | null {
  // If we have the inverted index, reconstruct the abstract
  if (rawData.abstract_inverted_index) {
    const reconstructed = reconstructAbstract(rawData.abstract_inverted_index);
    if (reconstructed) {
      console.log('[Paper Processor] Successfully reconstructed abstract:', reconstructed.substring(0, 100) + '...');
      return reconstructed;
    }
  }
  
  // Fall back to existing abstract if available
  if (existingPaper?.abstract && existingPaper.abstract !== 'Abstract will be reconstructed here') {
    return existingPaper.abstract;
  }
  
  // No abstract available
  return null;
}

export function enhancePaperWithAbstract(paper: Paper, rawData?: RawPaperData): Paper {
  if (!rawData) return paper;
  
  const enhancedAbstract = processAbstractFromRawData(rawData, paper);
  return {
    ...paper,
    abstract: enhancedAbstract
  };
}
