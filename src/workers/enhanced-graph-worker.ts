
import { semanticScholarService } from '../services/semanticScholar';
import { fetchWithRetry } from '../utils/api-helpers';
import { reconstructAbstract, extractKeywords, normalizeDoi, calculateMatchScore, generateShortUid } from '../utils/data-transformers';

// Worker message types
interface WorkerMessage {
  type: string;
  payload: any;
}

// Data structures
interface Paper {
  short_uid: string;
  title: string;
  publication_year: number | null;
  publication_date: string | null;
  location: string | null;
  abstract: string | null;
  fwci: number | null;
  cited_by_count: number;
  type: string;
  language: string | null;
  keywords: string[];
  best_oa_url: string | null;
  oa_status: string | null;
  is_stub: boolean;
}

interface Author {
  short_uid: string;
  clean_name: string;
  orcid: string | null;
  is_stub: boolean;
}

interface Institution {
  short_uid: string;
  ror_id: string | null;
  display_name: string;
  country_code: string | null;
  type: string | null;
}

interface Authorship {
  paper_short_uid: string;
  author_short_uid: string;
  author_position: number;
  is_corresponding: boolean;
  raw_author_name: string | null;
  institution_uids: string[];
}

interface PaperRelationship {
  source_short_uid: string;
  target_short_uid: string;
  relationship_type: 'cites' | 'similar';
}

// Worker state
let papers: Record<string, Paper> = {};
let authors: Record<string, Author> = {};
let institutions: Record<string, Institution> = {};
let authorships: Record<string, Authorship> = {};
let paperRelationships: PaperRelationship[] = [];
let externalIdIndex: Record<string, string> = {};

let masterPaperUid: string | null = null;
let stubCreationThreshold = 3;

// Utility functions
function postMessage(type: string, payload: any) {
  self.postMessage({ type, payload });
}

function addToExternalIndex(idType: string, idValue: string, entityUid: string) {
  const key = `${idType}:${idValue}`;
  externalIdIndex[key] = entityUid;
}

function findByExternalId(idType: string, idValue: string): string | null {
  const key = `${idType}:${idValue}`;
  return externalIdIndex[key] || null;
}

// Phase A Implementation
async function processOpenAlexPaper(paperData: any, isStub = false): Promise<string> {
  // Check if paper already exists
  if (paperData.doi) {
    const normalizedDoi = normalizeDoi(paperData.doi);
    if (normalizedDoi) {
      const existingUid = findByExternalId('doi', normalizedDoi);
      if (existingUid) return existingUid;
    }
  }

  if (paperData.id) {
    const existingUid = findByExternalId('openalex', paperData.id);
    if (existingUid) return existingUid;
  }

  // Create new paper
  const paperUid = generateShortUid();
  
  const paper: Paper = {
    short_uid: paperUid,
    title: paperData.title || paperData.display_name || 'Untitled',
    publication_year: paperData.publication_year || null,
    publication_date: paperData.publication_date || null,
    location: paperData.primary_location?.source?.display_name || null,
    abstract: reconstructAbstract(paperData.abstract_inverted_index),
    fwci: paperData.fwci || null,
    cited_by_count: paperData.cited_by_count || 0,
    type: paperData.type || 'article',
    language: paperData.language || null,
    keywords: extractKeywords(paperData.keywords),
    best_oa_url: paperData.open_access?.oa_url || null,
    oa_status: paperData.open_access?.oa_status || null,
    is_stub: isStub
  };

  papers[paperUid] = paper;

  // Add to external index
  if (paperData.id) {
    addToExternalIndex('openalex', paperData.id, paperUid);
  }
  if (paperData.doi) {
    const normalizedDoi = normalizeDoi(paperData.doi);
    if (normalizedDoi) {
      addToExternalIndex('doi', normalizedDoi, paperUid);
    }
  }

  // Process authors
  if (paperData.authorships) {
    for (let i = 0; i < paperData.authorships.length; i++) {
      const authorship = paperData.authorships[i];
      const authorUid = await processOpenAlexAuthor(authorship.author, isStub);
      
      // Create authorship record
      const authorshipKey = `${paperUid}_${authorUid}`;
      authorships[authorshipKey] = {
        paper_short_uid: paperUid,
        author_short_uid: authorUid,
        author_position: i,
        is_corresponding: authorship.is_corresponding || false,
        raw_author_name: authorship.raw_author_name || null,
        institution_uids: []
      };

      // Process institutions
      if (authorship.institutions) {
        for (const inst of authorship.institutions) {
          const instUid = await processOpenAlexInstitution(inst);
          authorships[authorshipKey].institution_uids.push(instUid);
        }
      }
    }
  }

  return paperUid;
}

async function processOpenAlexAuthor(authorData: any, isStub = false): Promise<string> {
  if (authorData.id) {
    const existingUid = findByExternalId('openalex_author', authorData.id);
    if (existingUid) return existingUid;
  }

  const authorUid = generateShortUid();
  
  const author: Author = {
    short_uid: authorUid,
    clean_name: authorData.display_name || 'Unknown Author',
    orcid: authorData.orcid || null,
    is_stub: isStub
  };

  authors[authorUid] = author;

  if (authorData.id) {
    addToExternalIndex('openalex_author', authorData.id, authorUid);
  }

  return authorUid;
}

async function processOpenAlexInstitution(instData: any): Promise<string> {
  if (instData.id) {
    const existingUid = findByExternalId('openalex_institution', instData.id);
    if (existingUid) return existingUid;
  }

  const instUid = generateShortUid();
  
  const institution: Institution = {
    short_uid: instUid,
    ror_id: instData.ror || null,
    display_name: instData.display_name || 'Unknown Institution',
    country_code: instData.country_code || null,
    type: instData.type || null
  };

  institutions[instUid] = institution;

  if (instData.id) {
    addToExternalIndex('openalex_institution', instData.id, instUid);
  }

  return instUid;
}

async function fetchFirstDegreeCitations(masterPaperOpenAlexId: string) {
  postMessage('progress/update', { message: 'Fetching 1st degree citations...' });
  
  const url = `https://api.openalex.org/works?filter=cites:${masterPaperOpenAlexId}&per-page=200&select=id,title,display_name,publication_year,publication_date,primary_location,abstract_inverted_index,fwci,cited_by_count,type,language,keywords,open_access,authorships,referenced_works,related_works`;
  
  const response = await fetchWithRetry(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch citations: ${response.status}`);
  }
  
  const data = await response.json();
  
  // Track referenced works frequency for stub threshold
  const referencedWorksFreq: Record<string, number> = {};
  const relatedWorksFreq: Record<string, number> = {};
  
  // Process each citing paper
  for (const paperData of data.results) {
    const paperUid = await processOpenAlexPaper(paperData, false);
    
    // Create citation relationship
    paperRelationships.push({
      source_short_uid: paperUid,
      target_short_uid: masterPaperUid!,
      relationship_type: 'cites'
    });
    
    // Count referenced works
    if (paperData.referenced_works) {
      for (const refWork of paperData.referenced_works) {
        referencedWorksFreq[refWork] = (referencedWorksFreq[refWork] || 0) + 1;
      }
    }
    
    // Count related works
    if (paperData.related_works) {
      for (const relWork of paperData.related_works) {
        relatedWorksFreq[relWork] = (relatedWorksFreq[relWork] || 0) + 1;
      }
    }
  }
  
  // Create stubs for frequently referenced works
  const frequentRefs = Object.entries(referencedWorksFreq)
    .filter(([_, count]) => count >= stubCreationThreshold)
    .map(([id, _]) => id);
    
  const frequentRelated = Object.entries(relatedWorksFreq)
    .filter(([_, count]) => count >= stubCreationThreshold)
    .map(([id, _]) => id);
  
  if (frequentRefs.length > 0) {
    await createStubsFromOpenAlexIds(frequentRefs, 'cites');
  }
  
  if (frequentRelated.length > 0) {
    await createStubsFromOpenAlexIds(frequentRelated, 'similar');
  }
  
  console.log(`[Worker] Phase A: Processed ${data.results.length} citations, ${frequentRefs.length} reference stubs, ${frequentRelated.length} similar stubs`);
}

async function createStubsFromOpenAlexIds(openAlexIds: string[], relationshipType: 'cites' | 'similar') {
  if (openAlexIds.length === 0) return;
  
  const url = `https://api.openalex.org/works?filter=id:${openAlexIds.join('|')}&select=id,title,display_name,publication_year,publication_date,primary_location,cited_by_count,type,authorships`;
  
  const response = await fetchWithRetry(url);
  if (!response.ok) return; // Graceful degradation
  
  const data = await response.json();
  
  for (const paperData of data.results) {
    const stubUid = await processOpenAlexPaper(paperData, true);
    
    // Create relationship
    if (relationshipType === 'cites') {
      paperRelationships.push({
        source_short_uid: masterPaperUid!,
        target_short_uid: stubUid,
        relationship_type: 'cites'
      });
    } else {
      paperRelationships.push({
        source_short_uid: masterPaperUid!,
        target_short_uid: stubUid,
        relationship_type: 'similar'
      });
    }
  }
}

async function enrichMasterPaperWithSemanticScholar() {
  if (!masterPaperUid) return;
  
  const masterPaper = papers[masterPaperUid];
  if (!masterPaper) return;
  
  // Find DOI for Semantic Scholar lookup
  const doiKey = Object.keys(externalIdIndex).find(key => 
    key.startsWith('doi:') && externalIdIndex[key] === masterPaperUid
  );
  
  if (!doiKey) return;
  
  const doi = doiKey.split('doi:')[1];
  try {
    const ssData = await semanticScholarService.fetchPaperDetails(doi);
    if (!ssData) return;
    
    // Enrich master paper (only if fields are null)
    const updates: Partial<Paper> = {};
    if (!masterPaper.best_oa_url && ssData.openAccessPdf?.url) {
      updates.best_oa_url = ssData.openAccessPdf.url;
    }
    
    if (Object.keys(updates).length > 0) {
      papers[masterPaperUid] = { ...masterPaper, ...updates };
    }
    
    // Add external IDs
    if (ssData.paperId) {
      addToExternalIndex('ss', ssData.paperId, masterPaperUid);
    }
    if (ssData.corpusId) {
      addToExternalIndex('corpusId', ssData.corpusId.toString(), masterPaperUid);
    }
    
    // Process citations and references as stubs
    await processSemanticScholarRelationships(ssData);
    
  } catch (error) {
    console.warn('[Worker] Semantic Scholar enrichment failed:', error);
  }
}

async function processSemanticScholarRelationships(ssData: any) {
  // Process citations (papers that cite the master paper)
  if (ssData.citations) {
    for (const citation of ssData.citations) {
      const stubUid = await processSemanticScholarPaper(citation, true);
      if (stubUid) {
        paperRelationships.push({
          source_short_uid: stubUid,
          target_short_uid: masterPaperUid!,
          relationship_type: 'cites'
        });
      }
    }
  }
  
  // Process references (papers that the master paper cites)
  if (ssData.references) {
    for (const reference of ssData.references) {
      const stubUid = await processSemanticScholarPaper(reference, true);
      if (stubUid) {
        paperRelationships.push({
          source_short_uid: masterPaperUid!,
          target_short_uid: stubUid,
          relationship_type: 'cites'
        });
      }
    }
  }
}

async function processSemanticScholarPaper(paperData: any, isStub = true): Promise<string | null> {
  // Check if paper already exists
  if (paperData.externalIds?.DOI) {
    const normalizedDoi = normalizeDoi(paperData.externalIds.DOI);
    if (normalizedDoi) {
      const existingUid = findByExternalId('doi', normalizedDoi);
      if (existingUid) return existingUid;
    }
  }
  
  if (paperData.paperId) {
    const existingUid = findByExternalId('ss', paperData.paperId);
    if (existingUid) return existingUid;
  }
  
  const paperUid = generateShortUid();
  
  const paper: Paper = {
    short_uid: paperUid,
    title: paperData.title || 'Untitled',
    publication_year: paperData.year || null,
    publication_date: null,
    location: paperData.venue || null,
    abstract: paperData.abstract || null,
    fwci: null,
    cited_by_count: paperData.citationCount || 0,
    type: 'article',
    language: null,
    keywords: [],
    best_oa_url: paperData.openAccessPdf?.url || null,
    oa_status: null,
    is_stub: isStub
  };
  
  papers[paperUid] = paper;
  
  // Add to external index
  if (paperData.paperId) {
    addToExternalIndex('ss', paperData.paperId, paperUid);
  }
  if (paperData.externalIds?.DOI) {
    const normalizedDoi = normalizeDoi(paperData.externalIds.DOI);
    if (normalizedDoi) {
      addToExternalIndex('doi', normalizedDoi, paperUid);
    }
  }
  
  // Process authors as stubs
  if (paperData.authors) {
    for (let i = 0; i < paperData.authors.length; i++) {
      const authorData = paperData.authors[i];
      const authorUid = await processSemanticScholarAuthor(authorData);
      
      const authorshipKey = `${paperUid}_${authorUid}`;
      authorships[authorshipKey] = {
        paper_short_uid: paperUid,
        author_short_uid: authorUid,
        author_position: i,
        is_corresponding: false,
        raw_author_name: authorData.name || null,
        institution_uids: []
      };
    }
  }
  
  return paperUid;
}

async function processSemanticScholarAuthor(authorData: any): Promise<string> {
  if (authorData.authorId) {
    const existingUid = findByExternalId('ss_author', authorData.authorId);
    if (existingUid) return existingUid;
  }
  
  const authorUid = generateShortUid();
  
  const author: Author = {
    short_uid: authorUid,
    clean_name: authorData.name || 'Unknown Author',
    orcid: null,
    is_stub: true
  };
  
  authors[authorUid] = author;
  
  if (authorData.authorId) {
    addToExternalIndex('ss_author', authorData.authorId, authorUid);
  }
  
  return authorUid;
}

// Phase B Implementation
async function hydrateMasterPaper() {
  if (!masterPaperUid) return;
  
  const masterPaper = papers[masterPaperUid];
  if (!masterPaper) return;
  
  // Find OpenAlex ID
  const openAlexKey = Object.keys(externalIdIndex).find(key => 
    key.startsWith('openalex:') && externalIdIndex[key] === masterPaperUid
  );
  
  if (!openAlexKey) return;
  
  const openAlexId = openAlexKey.split('openalex:')[1];
  
  try {
    postMessage('progress/update', { message: 'Enriching master paper...' });
    
    const url = `https://api.openalex.org/works/${openAlexId}?select=id,title,display_name,publication_year,publication_date,primary_location,abstract_inverted_index,fwci,cited_by_count,type,language,keywords,open_access,authorships`;
    
    const response = await fetchWithRetry(url);
    if (!response.ok) return;
    
    const data = await response.json();
    
    // Update master paper with rich data
    const updatedPaper: Paper = {
      ...masterPaper,
      title: data.title || data.display_name || masterPaper.title,
      publication_year: data.publication_year || masterPaper.publication_year,
      publication_date: data.publication_date || masterPaper.publication_date,
      location: data.primary_location?.source?.display_name || masterPaper.location,
      abstract: reconstructAbstract(data.abstract_inverted_index) || masterPaper.abstract,
      fwci: data.fwci || masterPaper.fwci,
      cited_by_count: data.cited_by_count || masterPaper.cited_by_count,
      type: data.type || masterPaper.type,
      language: data.language || masterPaper.language,
      keywords: extractKeywords(data.keywords) || masterPaper.keywords,
      best_oa_url: data.open_access?.oa_url || masterPaper.best_oa_url,
      oa_status: data.open_access?.oa_status || masterPaper.oa_status,
      is_stub: false
    };
    
    papers[masterPaperUid] = updatedPaper;
    
    // Send update to main thread
    postMessage('papers/updateOne', {
      id: masterPaperUid,
      changes: updatedPaper
    });
    
  } catch (error) {
    console.warn('[Worker] Master paper hydration failed:', error);
  }
}

async function performAuthorReconciliation() {
  postMessage('progress/update', { message: 'Reconciling authors...' });
  
  // Step 5: Gather stub authors and build reconciliation map
  const stubAuthors = Object.values(authors).filter(author => author.is_stub);
  
  if (stubAuthors.length === 0) {
    postMessage('app_status/update', { state: 'active', message: null });
    return;
  }
  
  // Build map of DOIs to stub authors
  const reconciliationMap = new Map<string, any[]>();
  
  // For each stub author, find their papers and DOIs
  for (const stubAuthor of stubAuthors) {
    const stubAuthorships = Object.values(authorships).filter(
      auth => auth.author_short_uid === stubAuthor.short_uid
    );
    
    for (const authorship of stubAuthorships) {
      const paper = papers[authorship.paper_short_uid];
      if (!paper) continue;
      
      // Find DOI for this paper
      const doiKey = Object.keys(externalIdIndex).find(key => 
        key.startsWith('doi:') && externalIdIndex[key] === paper.short_uid
      );
      
      if (doiKey) {
        const doi = doiKey.split('doi:')[1];
        if (!reconciliationMap.has(doi)) {
          reconciliationMap.set(doi, []);
        }
        reconciliationMap.get(doi)!.push({
          stubAuthor,
          authorship,
          paper
        });
      }
    }
  }
  
  if (reconciliationMap.size === 0) {
    postMessage('app_status/update', { state: 'active', message: null });
    return;
  }
  
  // Step 6: Fetch OpenAlex data and perform matching
  const dois = Array.from(reconciliationMap.keys());
  const successfulMatches: Array<{
    stubAuthor: Author;
    candidateAuthor: any;
    score: number;
    paper: Paper;
  }> = [];
  
  try {
    const url = `https://api.openalex.org/works?filter=doi:${dois.join('|')}&select=id,title,authorships`;
    const response = await fetchWithRetry(url);
    
    if (response.ok) {
      const data = await response.json();
      
      for (const paperData of data.results) {
        const paperDoi = normalizeDoi(paperData.doi);
        if (!paperDoi || !reconciliationMap.has(paperDoi)) continue;
        
        const stubInfo = reconciliationMap.get(paperDoi)!;
        
        for (const stub of stubInfo) {
          for (const openAlexAuthorship of paperData.authorships || []) {
            const score = calculateMatchScore(
              stub.stubAuthor.clean_name,
              openAlexAuthorship.author.display_name
            );
            
            if (score > 0.85) {
              successfulMatches.push({
                stubAuthor: stub.stubAuthor,
                candidateAuthor: openAlexAuthorship.author,
                score,
                paper: stub.paper
              });
            }
          }
        }
      }
    }
  } catch (error) {
    console.warn('[Worker] Author reconciliation API call failed:', error);
  }
  
  // Build and execute merge plan
  if (successfulMatches.length > 0) {
    const mergePlan = new Map<string, {
      winnerUid: string;
      loserUids: string[];
      canonicalData: any;
    }>();
    
    for (const match of successfulMatches) {
      const openAlexId = match.candidateAuthor.id;
      
      if (!mergePlan.has(openAlexId)) {
        // First time seeing this OpenAlex author - they become the winner
        mergePlan.set(openAlexId, {
          winnerUid: match.stubAuthor.short_uid,
          loserUids: [],
          canonicalData: match.candidateAuthor
        });
      } else {
        // Additional stub for this OpenAlex author - add to losers
        const plan = mergePlan.get(openAlexId)!;
        plan.loserUids.push(match.stubAuthor.short_uid);
      }
    }
    
    // Execute merge plan
    const authorUpdates: Array<{ id: string; changes: Partial<Author> }> = [];
    const authorshipUpdates: Array<{ id: string; changes: Partial<Authorship> }> = [];
    const authorDeletions: string[] = [];
    
    for (const [openAlexId, plan] of mergePlan) {
      // Update winner with canonical data
      authorUpdates.push({
        id: plan.winnerUid,
        changes: {
          clean_name: plan.canonicalData.display_name,
          orcid: plan.canonicalData.orcid || null,
          is_stub: false
        }
      });
      
      // Add OpenAlex ID to external index
      addToExternalIndex('openalex_author', openAlexId, plan.winnerUid);
      
      // Re-parent loser authorships
      for (const loserUid of plan.loserUids) {
        const loserAuthorships = Object.entries(authorships).filter(
          ([_, auth]) => auth.author_short_uid === loserUid
        );
        
        for (const [key, authorship] of loserAuthorships) {
          authorshipUpdates.push({
            id: key,
            changes: {
              author_short_uid: plan.winnerUid
            }
          });
        }
        
        authorDeletions.push(loserUid);
      }
    }
    
    // Send merge updates to main thread
    postMessage('graph/applyAuthorMerge', {
      updates: {
        authors: authorUpdates,
        authorships: authorshipUpdates
      },
      deletions: {
        authors: authorDeletions
      }
    });
    
    console.log(`[Worker] Author reconciliation: ${successfulMatches.length} matches, ${authorDeletions.length} merged`);
  }
  
  postMessage('app_status/update', { state: 'active', message: null });
}

// Message handler
self.addEventListener('message', async (event: MessageEvent<WorkerMessage>) => {
  const { type, payload } = event.data;
  
  try {
    switch (type) {
      case 'graph/processMasterPaper':
        // Initialize worker state
        papers = {};
        authors = {};
        institutions = {};
        authorships = {};
        paperRelationships = [];
        externalIdIndex = {};
        
        stubCreationThreshold = payload.stub_creation_threshold || 3;
        
        // Process master paper
        postMessage('app_status/update', { state: 'loading', message: 'Processing master paper...' });
        masterPaperUid = await processOpenAlexPaper(payload.paper, false);
        
        // Phase A: Fetch citations and relationships
        if (payload.paper.id) {
          await fetchFirstDegreeCitations(payload.paper.id);
          await enrichMasterPaperWithSemanticScholar();
        }
        
        // Send initial graph to main thread
        postMessage('graph/setState', {
          data: {
            papers,
            authors,
            institutions,
            authorships,
            paper_relationships: paperRelationships,
            external_id_index: externalIdIndex
          }
        });
        
        postMessage('app_status/update', { state: 'enriching', message: null });
        
        // Phase B: Background enrichment
        await hydrateMasterPaper();
        await performAuthorReconciliation();
        
        break;
        
      default:
        console.warn('[Worker] Unknown message type:', type);
    }
  } catch (error) {
    console.error('[Worker] Error processing message:', error);
    postMessage('error/fatal', { 
      message: `Worker error: ${error instanceof Error ? error.message : 'Unknown error'}` 
    });
  }
});

// Export for TypeScript
export {};
