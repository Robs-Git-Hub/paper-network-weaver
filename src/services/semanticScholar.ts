
import { fetchWithRetry } from '../utils/api-helpers';

interface SemanticScholarResponse {
  paperId: string;
  corpusId: number;
  externalIds: {
    MAG?: string;
    DOI?: string;
    CorpusId?: string;
  };
  url: string;
  title: string;
  citationCount: number;
  openAccessPdf?: {
    url: string;
  };
  citationStyles: {
    bibtex: string;
  };
  authors: Array<{
    authorId: string;
    name: string;
  }>;
  citations: Array<{
    paperId: string;
    externalIds: {
      DOI?: string;
      CorpusId?: string;
      DBLP?: string;
    };
    title: string;
    year: number;
    citationCount: number;
    abstract: string;
    openAccessPdf?: {
      url: string;
    };
    venue: string;
    citationStyles: any;
    authors: Array<{
      authorId: string;
      name: string;
    }>;
  }>;
  references: Array<{
    paperId: string;
    externalIds: {
      MAG?: string;
      DOI?: string;
      CorpusId?: string;
    };
    title: string;
    year: number;
    citationCount: number;
    abstract: string;
    openAccessPdf?: {
      url: string;
    };
    authors: Array<{
      authorId: string;
      name: string;
    }>;
  }>;
}

export class SemanticScholarService {
  private readonly baseUrl = 'https://api.semanticscholar.org/graph/v1';
  
  async fetchPaperDetails(doi: string): Promise<SemanticScholarResponse | null> {
    const url = `${this.baseUrl}/paper/DOI:${doi}?fields=paperId,corpusId,externalIds,url,citationStyles,citationCount,citations,citations.externalIds,citations.url,citations.title,citations.abstract,citations.venue,citations.year,citations.citationStyles,citations.authors,references,references.externalIds,references.url,references.title,references.abstract,references.venue,references.year,references.citationStyles,references.authors`;
    
    console.log('Semantic Scholar URL:', url);
    
    const response = await fetchWithRetry(url);
    
    // Handle 404 gracefully - paper not found in SS is not an error
    if (response.status === 404) {
      console.warn(`Paper with DOI ${doi} not found in Semantic Scholar, continuing gracefully`);
      return null;
    }
    
    if (!response.ok) {
      throw new Error(`Semantic Scholar API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('Semantic Scholar response:', data);
    
    return data;
  }
}

export const semanticScholarService = new SemanticScholarService();
