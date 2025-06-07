
import { openAlexService } from '../services/openAlex';
import { semanticScholarService } from '../services/semanticScholar';
import { generateShortUid, reconstructAbstract, extractKeywords, normalizeDoi } from '../utils/data-transformers';

interface PaperResult {
  id: string;
  title?: string;
  display_name?: string;
  authorships: Array<{
    author: { display_name: string };
  }>;
  publication_year: number | null;
  primary_location?: {
    source?: {
      display_name: string;
    };
  };
  cited_by_count: number;
}

self.onmessage = async (e) => {
  const { type, payload } = e.data;
  
  console.log('Worker received message:', type, payload);
  
  try {
    switch (type) {
      case 'graph/processMasterPaper':
        await processMasterPaper(payload.paper);
        break;
      default:
        console.warn('Unknown worker message type:', type);
    }
  } catch (error) {
    console.error('Worker error:', error);
    self.postMessage({
      type: 'error/fatal',
      payload: { message: error instanceof Error ? error.message : 'Unknown worker error' }
    });
  }
};

async function processMasterPaper(paper: PaperResult) {
  console.log('Processing master paper:', paper);
  
  // Step 1: Update progress
  self.postMessage({
    type: 'progress/update',
    payload: { message: 'Fetching citations from OpenAlex...' }
  });
  
  try {
    // Step 2A: Fetch 1st degree citations from OpenAlex
    console.log('Fetching citations for paper ID:', paper.id);
    const citationsResponse = await openAlexService.fetchCitations(paper.id);
    console.log('OpenAlex citations response received:', citationsResponse);
    
    // Step 2B: Update progress for Semantic Scholar
    self.postMessage({
      type: 'progress/update',
      payload: { message: 'Fetching paper details from Semantic Scholar...' }
    });
    
    // Step 3A: Get DOI from the master paper and fetch from Semantic Scholar
    let semanticScholarResponse = null;
    const paperDoi = extractDoiFromPaper(paper);
    
    if (paperDoi) {
      console.log('Fetching Semantic Scholar data for DOI:', paperDoi);
      try {
        semanticScholarResponse = await semanticScholarService.fetchPaperDetails(paperDoi);
        console.log('Semantic Scholar response received:', semanticScholarResponse);
      } catch (ssError) {
        console.warn('Semantic Scholar fetch failed:', ssError);
        // Continue without SS data - this is non-fatal for Phase A
      }
    } else {
      console.warn('No DOI found for master paper, skipping Semantic Scholar fetch');
    }
    
    // Step 4: Update progress
    self.postMessage({
      type: 'progress/update',
      payload: { message: 'Building initial graph...' }
    });
    
    // Step 5: Build initial graph data structure
    const graphData = buildInitialGraph(paper, citationsResponse.results, semanticScholarResponse);
    
    // Step 6: Send complete graph data to main thread
    self.postMessage({
      type: 'graph/setState',
      payload: { data: graphData }
    });
    
    // Step 7: Update app status to show data is ready
    self.postMessage({
      type: 'app/setStatus',
      payload: { state: 'enriching', message: null }
    });
    
    console.log('Initial graph build complete');
    
  } catch (error) {
    console.error('Error in processMasterPaper:', error);
    throw error;
  }
}

function extractDoiFromPaper(paper: PaperResult): string | null {
  // For now, we'll need to fetch the full paper details to get the DOI
  // This is a limitation of the current search response not including DOI
  console.log('Need to implement DOI extraction - paper search results don\'t include DOI');
  return null; // Will implement DOI extraction in next step
}

function buildInitialGraph(masterPaper: PaperResult, openAlexCitations: any[], semanticScholarData: any | null) {
  console.log('Building initial graph with:', {
    masterPaper: masterPaper.title,
    openAlexCitations: openAlexCitations.length,
    hasSemanticScholarData: !!semanticScholarData
  });
  
  const papers: Record<string, any> = {};
  const authors: Record<string, any> = {};
  const institutions: Record<string, any> = {};
  const authorships: Record<string, any> = {};
  const paper_relationships: any[] = [];
  const external_id_index: Record<string, string> = {};
  
  // Process master paper
  const masterPaperUid = generateShortUid();
  papers[masterPaperUid] = {
    short_uid: masterPaperUid,
    title: masterPaper.title || masterPaper.display_name || 'Untitled',
    publication_year: masterPaper.publication_year,
    publication_date: null,
    location: masterPaper.primary_location?.source?.display_name || null,
    abstract: null,
    fwci: null,
    cited_by_count: masterPaper.cited_by_count || 0,
    type: 'article',
    language: null,
    keywords: [],
    best_oa_url: null,
    oa_status: null,
    is_stub: false
  };
  
  // Index master paper by OpenAlex ID
  external_id_index[`openalex:${masterPaper.id}`] = masterPaperUid;
  
  console.log('Master paper processed:', papers[masterPaperUid]);
  
  // Process OpenAlex citations (1st degree)
  openAlexCitations.forEach((citation, index) => {
    console.log(`Processing OpenAlex citation ${index + 1}:`, citation);
    
    const citationUid = generateShortUid();
    papers[citationUid] = {
      short_uid: citationUid,
      title: citation.title || citation.display_name || 'Untitled',
      publication_year: citation.publication_year,
      publication_date: citation.publication_date,
      location: citation.primary_location?.source?.display_name || null,
      abstract: citation.abstract_inverted_index ? reconstructAbstract(citation.abstract_inverted_index) : null,
      fwci: citation.fwci || null,
      cited_by_count: citation.cited_by_count || 0,
      type: citation.type || 'article',
      language: citation.language || null,
      keywords: citation.keywords ? extractKeywords(citation.keywords) : [],
      best_oa_url: citation.best_oa_location?.pdf_url || null,
      oa_status: citation.open_access?.oa_status || null,
      is_stub: false
    };
    
    // Index citation by OpenAlex ID
    external_id_index[`openalex:${citation.id}`] = citationUid;
    
    // Index by DOI if present
    if (citation.doi) {
      const normalizedDoi = normalizeDoi(citation.doi);
      if (normalizedDoi) {
        external_id_index[`doi:${normalizedDoi}`] = citationUid;
      }
    }
    
    // Create relationship: citation cites master paper
    paper_relationships.push({
      source_short_uid: citationUid,
      target_short_uid: masterPaperUid,
      relationship_type: 'cites'
    });
  });
  
  // Process Semantic Scholar data if available
  if (semanticScholarData) {
    console.log('Processing Semantic Scholar data...');
    
    // Process SS citations
    if (semanticScholarData.citations) {
      semanticScholarData.citations.forEach((ssCitation: any, index: number) => {
        console.log(`Processing SS citation ${index + 1}:`, ssCitation);
        
        // Check if this paper already exists (by DOI matching)
        let existingUid = null;
        if (ssCitation.externalIds?.DOI) {
          const normalizedDoi = normalizeDoi(ssCitation.externalIds.DOI);
          if (normalizedDoi) {
            existingUid = external_id_index[`doi:${normalizedDoi}`];
          }
        }
        
        if (!existingUid) {
          // Create new paper with stub status
          const ssCitationUid = generateShortUid();
          papers[ssCitationUid] = {
            short_uid: ssCitationUid,
            title: ssCitation.title || 'Untitled',
            publication_year: ssCitation.year,
            publication_date: null,
            location: ssCitation.venue || null,
            abstract: ssCitation.abstract || null,
            fwci: null,
            cited_by_count: ssCitation.citationCount || 0,
            type: 'article',
            language: null,
            keywords: [],
            best_oa_url: ssCitation.openAccessPdf?.url || null,
            oa_status: null,
            is_stub: true // SS-discovered papers are stubs initially
          };
          
          // Index by SS ID
          external_id_index[`ss:${ssCitation.paperId}`] = ssCitationUid;
          
          // Index by DOI if present
          if (ssCitation.externalIds?.DOI) {
            const normalizedDoi = normalizeDoi(ssCitation.externalIds.DOI);
            if (normalizedDoi) {
              external_id_index[`doi:${normalizedDoi}`] = ssCitationUid;
            }
          }
          
          // Create relationship: SS citation cites master paper
          paper_relationships.push({
            source_short_uid: ssCitationUid,
            target_short_uid: masterPaperUid,
            relationship_type: 'cites'
          });
        }
      });
    }
    
    // Process SS references
    if (semanticScholarData.references) {
      semanticScholarData.references.forEach((ssReference: any, index: number) => {
        console.log(`Processing SS reference ${index + 1}:`, ssReference);
        
        // Check if this paper already exists (by DOI matching)
        let existingUid = null;
        if (ssReference.externalIds?.DOI) {
          const normalizedDoi = normalizeDoi(ssReference.externalIds.DOI);
          if (normalizedDoi) {
            existingUid = external_id_index[`doi:${normalizedDoi}`];
          }
        }
        
        if (!existingUid) {
          // Create new paper with stub status
          const ssReferenceUid = generateShortUid();
          papers[ssReferenceUid] = {
            short_uid: ssReferenceUid,
            title: ssReference.title || 'Untitled',
            publication_year: ssReference.year,
            publication_date: null,
            location: ssReference.venue || null,
            abstract: ssReference.abstract || null,
            fwci: null,
            cited_by_count: ssReference.citationCount || 0,
            type: 'article',
            language: null,
            keywords: [],
            best_oa_url: ssReference.openAccessPdf?.url || null,
            oa_status: null,
            is_stub: true // SS-discovered papers are stubs initially
          };
          
          // Index by SS ID
          external_id_index[`ss:${ssReference.paperId}`] = ssReferenceUid;
          
          // Index by DOI if present
          if (ssReference.externalIds?.DOI) {
            const normalizedDoi = normalizeDoi(ssReference.externalIds.DOI);
            if (normalizedDoi) {
              external_id_index[`doi:${normalizedDoi}`] = ssReferenceUid;
            }
          }
          
          // Create relationship: master paper cites SS reference
          paper_relationships.push({
            source_short_uid: masterPaperUid,
            target_short_uid: ssReferenceUid,
            relationship_type: 'cites'
          });
        }
      });
    }
  }
  
  console.log('Graph data built:', {
    papers: Object.keys(papers).length,
    authors: Object.keys(authors).length,
    institutions: Object.keys(institutions).length,
    authorships: Object.keys(authorships).length,
    paper_relationships: paper_relationships.length,
    external_id_index: Object.keys(external_id_index).length
  });
  
  return {
    papers,
    authors,
    institutions,
    authorships,
    paper_relationships,
    external_id_index
  };
}
