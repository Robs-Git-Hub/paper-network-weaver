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
  console.log('[Worker] Phase A, Step 2: Fetching 1st degree citations from OpenAlex.');
  postMessage('progress/update', { message: 'Fetching 1st degree citations...' });

  const normalizeOpenAlexId = (id: string): string => {
    if (!id) return '';
    return id.replace('https://openalex.org/', '');
  };
  
  const normalizedMasterId = normalizeOpenAlexId(masterPaperOpenAlexId);

  const url = `https://api.openalex.org/works?filter=cites:${normalizedMasterId}&per-page=200&select=id,title,display_name,publication_year,publication_date,primary_location,abstract_inverted_index,fwci,cited_by_count,type,language,keywords,open_access,authorships,referenced_works,related_works`;
  
  const response = await fetchWithRetry(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch citations: ${response.status}`);
  }
  
  const data = await response.json();
  
  const referencedWorksFreq: Record<string, number> = {};
  const relatedWorksFreq: Record<string, number> = {};
  
  for (const paperData of data.results) {
    if (paperData.id) {
        paperData.id = normalizeOpenAlexId(paperData.id);
    }

    const paperUid = await processOpenAlexPaper(paperData, false);
    
    paperRelationships.push({
      source_short_uid: paperUid,
      target_short_uid: masterPaperUid!,
      relationship_type: 'cites'
    });
    
    if (paperData.referenced_works) {
      for (const refWorkUrl of paperData.referenced_works) {
        const cleanId = normalizeOpenAlexId(refWorkUrl);
        if (cleanId) {
            referencedWorksFreq[cleanId] = (referencedWorksFreq[cleanId] || 0) + 1;
        }
      }
    }
    
    if (paperData.related_works) {
      for (const relWorkUrl of paperData.related_works) {
        const cleanId = normalizeOpenAlexId(relWorkUrl);
        if (cleanId) {
            relatedWorksFreq[cleanId] = (relatedWorksFreq[cleanId] || 0) + 1;
        }
      }
    }
  }
  
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
  
  console.log(`[Worker] Phase A, Step 2: Processed ${data.results.length} citations, found ${frequentRefs.length} frequent reference stubs and ${frequentRelated.length} frequent similar stubs.`);
}

async function createStubsFromOpenAlexIds(openAlexIds: string[], relationshipType: 'cites' | 'similar') {
  if (openAlexIds.length === 0) return;
  
  const url = `https://api.openalex.org/works?filter=openalex:${openAlexIds.join('|')}&select=id,title,display_name,publication_year,publication_date,primary_location,cited_by_count,type,authorships`;
  
  const response = await fetchWithRetry(url);
  if (!response.ok) {
    console.warn(`[Worker] Could not fetch stubs for ${relationshipType}. Status: ${response.status}`);
    return;
  }
  
  const data = await response.json();
  
  for (const paperData of data.results) {
    const stubUid = await processOpenAlexPaper(paperData, true);
    
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
  
  const doiKey = Object.keys(externalIdIndex).find(key => 
    key.startsWith('doi:') && externalIdIndex[key] === masterPaperUid
  );
  
  if (!doiKey) {
    console.warn('[Worker] Phase A, Step 3: Skipped Semantic Scholar enrichment, no DOI found for Master Paper.');
    return;
  }
  
  console.log('[Worker] Phase A, Step 3: Enriching with Semantic Scholar data.');
  const doi = doiKey.split('doi:')[1];
  try {
    const ssData = await semanticScholarService.fetchPaperDetails(doi);
    if (!ssData) return;
    
    const updates: Partial<Paper> = {};
    if (!masterPaper.best_oa_url && ssData.openAccessPdf?.url) {
      updates.best_oa_url = ssData.openAccessPdf.url;
    }
    
    if (Object.keys(updates).length > 0) {
      papers[masterPaperUid] = { ...masterPaper, ...updates };
    }
    
    if (ssData.paperId) {
      addToExternalIndex('ss', ssData.paperId, masterPaperUid);
    }
    if (ssData.corpusId) {
      addToExternalIndex('corpusId', ssData.corpusId.toString(), masterPaperUid);
    }
    
    await processSemanticScholarRelationships(ssData);
    
  } catch (error) {
    console.warn('[Worker] Semantic Scholar enrichment failed:', error);
  }
}

async function processSemanticScholarRelationships(ssData: any) {
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
  
  if (paperData.paperId) {
    addToExternalIndex('ss', paperData.paperId, paperUid);
  }
  if (paperData.externalIds?.DOI) {
    const normalizedDoi = normalizeDoi(paperData.externalIds.DOI);
    if (normalizedDoi) {
      addToExternalIndex('doi', normalizedDoi, paperUid);
    }
  }
  
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

async function hydrateMasterPaper() {
  if (!masterPaperUid) return;
  
  const masterPaper = papers[masterPaperUid];
  if (!masterPaper) return;
  
  const openAlexKey = Object.keys(externalIdIndex).find(key => 
    key.startsWith('openalex:') && externalIdIndex[key] === masterPaperUid
  );
  
  if (!openAlexKey) return;
  
  const openAlexId = openAlexKey.split('openalex:')[1];
  
  try {
    console.log('[Worker] Phase B, Step 4: Hydrating Master Paper from OpenAlex.');
    postMessage('progress/update', { message: 'Enriching master paper...' });
    
    const url = `https://api.openalex.org/works/${openAlexId}?select=id,title,display_name,publication_year,publication_date,primary_location,abstract_inverted_index,fwci,cited_by_count,type,language,keywords,open_access,authorships`;
    
    const response = await fetchWithRetry(url);
    if (!response.ok) return;
    
    const data = await response.json();
    
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
    
    postMessage('papers/updateOne', {
      id: masterPaperUid,
      changes: updatedPaper
    });
    
    console.log('[Worker] Phase B, Step 4: Master Paper hydration complete.');
    
  } catch (error) {
    console.warn('[Worker] Master paper hydration failed:', error);
  }
}

async function performAuthorReconciliation() {
  console.log('[Worker] Phase B, Steps 5 & 6: Starting Author Reconciliation.');
  postMessage('progress/update', { message: 'Reconciling authors...' });
  
  const stubAuthors = Object.values(authors).filter(author => author.is_stub);
  
  if (stubAuthors.length === 0) {
    console.log('[Worker] Phase B, Steps 5 & 6: No stub authors to reconcile. Finishing enrichment.');
    postMessage('app_status/update', { state: 'active', message: null });
    return;
  }
  
  const reconciliationMap = new Map<string, any[]>();
  
  for (const stubAuthor of stubAuthors) {
    const stubAuthorships = Object.values(authorships).filter(
      auth => auth.author_short_uid === stubAuthor.short_uid
    );
    
    for (const authorship of stubAuthorships) {
      const paper = papers[authorship.paper_short_uid];
      if (!paper) continue;
      
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
    console.log('[Worker] Phase B, Steps 5 & 6: No DOIs found for stub authors. Finishing enrichment.');
    postMessage('app_status/update', { state: 'active', message: null });
    return;
  }
  
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
  
  if (successfulMatches.length > 0) {
    const mergePlan = new Map<string, {
      winnerUid: string;
      loserUids: string[];
      canonicalData: any;
    }>();
    
    for (const match of successfulMatches) {
      const openAlexId = match.candidateAuthor.id;
      
      if (!mergePlan.has(openAlexId)) {
        mergePlan.set(openAlexId, {
          winnerUid: match.stubAuthor.short_uid,
          loserUids: [],
          canonicalData: match.candidateAuthor
        });
      } else {
        const plan = mergePlan.get(openAlexId)!;
        plan.loserUids.push(match.stubAuthor.short_uid);
      }
    }
    
    const authorUpdates: Array<{ id: string; changes: Partial<Author> }> = [];
    const authorshipUpdates: Array<{ id: string; changes: Partial<Authorship> }> = [];
    const authorDeletions: string[] = [];
    
    for (const [openAlexId, plan] of mergePlan) {
      authorUpdates.push({
        id: plan.winnerUid,
        changes: {
          clean_name: plan.canonicalData.display_name,
          orcid: plan.canonicalData.orcid || null,
          is_stub: false
        }
      });
      
      addToExternalIndex('openalex_author', openAlexId, plan.winnerUid);
      
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
    
    postMessage('graph/applyAuthorMerge', {
      updates: {
        authors: authorUpdates,
        authorships: authorshipUpdates
      },
      deletions: {
        authors: authorDeletions
      }
    });
    
    console.log(`[Worker] Phase B, Steps 5 & 6: Author reconciliation complete. Merged ${authorDeletions.length} stub authors into ${mergePlan.size} canonical authors.`);
  } else {
    console.log('[Worker] Phase B, Steps 5 & 6: No high-confidence author matches found.');
  }
  
  postMessage('app_status/update', { state: 'active', message: null });
}

async function fetchSecondDegreeCitations() {
  console.log('[Worker] Phase C, Step 8: Fetching 2nd degree citations.');
  postMessage('progress/update', { message: 'Fetching 2nd degree citations...' });

  // Get all 1st-degree citation papers (papers that cite the master paper)
  const firstDegreeCitations = paperRelationships.filter(
    rel => rel.relationship_type === 'cites' && rel.target_short_uid === masterPaperUid
  );

  if (firstDegreeCitations.length === 0) {
    console.log('[Worker] No 1st degree citations found, skipping 2nd degree fetch.');
    return;
  }

  // Collect OpenAlex IDs for these papers
  const openAlexIds: string[] = [];
  for (const rel of firstDegreeCitations) {
    const openAlexKey = Object.keys(externalIdIndex).find(key => 
      key.startsWith('openalex:') && externalIdIndex[key] === rel.source_short_uid
    );
    if (openAlexKey) {
      const openAlexId = openAlexKey.split('openalex:')[1];
      openAlexIds.push(openAlexId);
    }
  }

  if (openAlexIds.length === 0) {
    console.log('[Worker] No OpenAlex IDs found for 1st degree citations.');
    return;
  }

  try {
    // Make batch API call to find papers that cite any of these 1st degree papers
    const url = `https://api.openalex.org/works?filter=cites:${openAlexIds.join('|')}&per-page=200&select=id,title,display_name,publication_year,publication_date,primary_location,abstract_inverted_index,fwci,cited_by_count,type,language,keywords,open_access,authorships`;
    
    const response = await fetchWithRetry(url);
    if (!response.ok) {
      console.warn(`[Worker] Failed to fetch 2nd degree citations: ${response.status}`);
      return;
    }
    
    const data = await response.json();
    console.log(`[Worker] Found ${data.results.length} 2nd degree citations.`);
    
    const newPapers: Record<string, Paper> = {};
    const newAuthors: Record<string, Author> = {};
    const newInstitutions: Record<string, Institution> = {};
    const newAuthorships: Record<string, Authorship> = {};
    const newRelationships: PaperRelationship[] = [];
    
    for (const paperData of data.results) {
      // Normalize OpenAlex ID
      if (paperData.id) {
        paperData.id = paperData.id.replace('https://openalex.org/', '');
      }

      // Check if paper already exists
      const existingUid = findByExternalId('openalex', paperData.id);
      if (existingUid) continue; // Skip if already in graph
      
      const paperUid = await processOpenAlexPaper(paperData, false);
      
      // Add to new data collections
      newPapers[paperUid] = papers[paperUid];
      
      // Find which 1st degree paper this cites
      if (paperData.referenced_works) {
        for (const refWorkUrl of paperData.referenced_works) {
          const cleanId = refWorkUrl.replace('https://openalex.org/', '');
          if (openAlexIds.includes(cleanId)) {
            const targetUid = findByExternalId('openalex', cleanId);
            if (targetUid) {
              newRelationships.push({
                source_short_uid: paperUid,
                target_short_uid: targetUid,
                relationship_type: 'cites'
              });
            }
          }
        }
      }
      
      // Collect new authors and authorships
      Object.entries(authorships).forEach(([key, authorship]) => {
        if (authorship.paper_short_uid === paperUid) {
          newAuthorships[key] = authorship;
          if (authors[authorship.author_short_uid]) {
            newAuthors[authorship.author_short_uid] = authors[authorship.author_short_uid];
          }
        }
      });
      
      // Collect new institutions
      Object.values(newAuthorships).forEach(authorship => {
        authorship.institution_uids.forEach(instUid => {
          if (institutions[instUid]) {
            newInstitutions[instUid] = institutions[instUid];
          }
        });
      });
    }
    
    // Add new relationships to global state
    paperRelationships.push(...newRelationships);
    
    // Post new data to main thread
    if (Object.keys(newPapers).length > 0) {
      postMessage('graph/addNodes', {
        data: {
          papers: newPapers,
          authors: newAuthors,
          institutions: newInstitutions,
          authorships: newAuthorships,
          paper_relationships: newRelationships
        }
      });
    }
    
    console.log(`[Worker] Added ${Object.keys(newPapers).length} new 2nd degree citation papers.`);
    
  } catch (error) {
    console.warn('[Worker] Error fetching 2nd degree citations:', error);
  }
}

async function hydrateStubPapers() {
  console.log('[Worker] Phase C, Step 9: Hydrating stub papers.');
  postMessage('progress/update', { message: 'Hydrating stub papers...' });

  // Find all stub papers
  const stubPapers = Object.values(papers).filter(paper => paper.is_stub);
  
  if (stubPapers.length === 0) {
    console.log('[Worker] No stub papers to hydrate.');
    return;
  }

  // Collect OpenAlex IDs for stub papers
  const openAlexIds: string[] = [];
  const stubUidToOpenAlexId: Record<string, string> = {};
  
  for (const stubPaper of stubPapers) {
    const openAlexKey = Object.keys(externalIdIndex).find(key => 
      key.startsWith('openalex:') && externalIdIndex[key] === stubPaper.short_uid
    );
    if (openAlexKey) {
      const openAlexId = openAlexKey.split('openalex:')[1];
      openAlexIds.push(openAlexId);
      stubUidToOpenAlexId[stubPaper.short_uid] = openAlexId;
    }
  }

  if (openAlexIds.length === 0) {
    console.log('[Worker] No OpenAlex IDs found for stub papers.');
    return;
  }

  try {
    // Make batch API call to get full data for stub papers
    const url = `https://api.openalex.org/works?filter=openalex:${openAlexIds.join('|')}&select=id,title,display_name,publication_year,publication_date,primary_location,abstract_inverted_index,fwci,cited_by_count,type,language,keywords,open_access,authorships`;
    
    const response = await fetchWithRetry(url);
    if (!response.ok) {
      console.warn(`[Worker] Failed to hydrate stub papers: ${response.status}`);
      return;
    }
    
    const data = await response.json();
    console.log(`[Worker] Hydrating ${data.results.length} stub papers.`);
    
    for (const paperData of data.results) {
      // Normalize OpenAlex ID
      const normalizedId = paperData.id.replace('https://openalex.org/', '');
      
      // Find the corresponding stub paper
      const stubUid = Object.keys(stubUidToOpenAlexId).find(
        uid => stubUidToOpenAlexId[uid] === normalizedId
      );
      
      if (!stubUid || !papers[stubUid]) continue;
      
      // Update the stub paper with full data
      const updatedPaper: Paper = {
        ...papers[stubUid],
        title: paperData.title || paperData.display_name || papers[stubUid].title,
        publication_year: paperData.publication_year || papers[stubUid].publication_year,
        publication_date: paperData.publication_date || papers[stubUid].publication_date,
        location: paperData.primary_location?.source?.display_name || papers[stubUid].location,
        abstract: reconstructAbstract(paperData.abstract_inverted_index) || papers[stubUid].abstract,
        fwci: paperData.fwci || papers[stubUid].fwci,
        cited_by_count: paperData.cited_by_count || papers[stubUid].cited_by_count,
        type: paperData.type || papers[stubUid].type,
        language: paperData.language || papers[stubUid].language,
        keywords: extractKeywords(paperData.keywords) || papers[stubUid].keywords,
        best_oa_url: paperData.open_access?.oa_url || papers[stubUid].best_oa_url,
        oa_status: paperData.open_access?.oa_status || papers[stubUid].oa_status,
        is_stub: false // No longer a stub
      };
      
      // Update in worker state
      papers[stubUid] = updatedPaper;
      
      // Post update to main thread
      postMessage('papers/updateOne', {
        id: stubUid,
        changes: updatedPaper
      });
      
      // Process new authorships if available
      if (paperData.authorships) {
        for (let i = 0; i < paperData.authorships.length; i++) {
          const authorship = paperData.authorships[i];
          const authorUid = await processOpenAlexAuthor(authorship.author, false);
          
          // Create authorship record
          const authorshipKey = `${stubUid}_${authorUid}`;
          const newAuthorship: Authorship = {
            paper_short_uid: stubUid,
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
              newAuthorship.institution_uids.push(instUid);
            }
          }
          
          authorships[authorshipKey] = newAuthorship;
        }
      }
    }
    
    console.log(`[Worker] Successfully hydrated ${data.results.length} stub papers.`);
    
  } catch (error) {
    console.warn('[Worker] Error hydrating stub papers:', error);
  }
}

self.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
  const { type, payload } = event.data;

  switch (type) {
    case 'graph/processMasterPaper':
      // ... keep existing code (the existing async function implementation)
      (async () => {
        try {
          console.log("--- [Worker] Received 'graph/processMasterPaper'. Starting Phase A. ---");
          papers = {};
          authors = {};
          institutions = {};
          authorships = {};
          paperRelationships = [];
          externalIdIndex = {};
          
          stubCreationThreshold = payload.stub_creation_threshold || 3;
          
          postMessage('app_status/update', { state: 'loading', message: 'Processing master paper...' });
          
          console.log('[Worker] Phase A, Step 1: Processing Master Paper.');
          masterPaperUid = await processOpenAlexPaper(payload.paper, false);
          console.log('[Worker] Phase A, Step 1: Master Paper processed.');
          
          if (payload.paper.id) {
            await fetchFirstDegreeCitations(payload.paper.id);
            await enrichMasterPaperWithSemanticScholar();
          }
          
          console.log('--- [Worker] Phase A Complete. Posting initial graph to main thread. ---');
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
          
          console.log('--- [Worker] Starting Phase B: Background Enrichment. ---');
          postMessage('app_status/update', { state: 'enriching', message: null });
          
          await hydrateMasterPaper();
          await performAuthorReconciliation();
          
          console.log('--- [Worker] Phase B Complete. All enrichment finished. ---');

        } catch (error) {
          console.error('[Worker] A fatal error occurred during graph build:', error);
          postMessage('error/fatal', { 
            message: `Worker error: ${error instanceof Error ? error.message : 'Unknown error'}` 
          });
        }
      })();
      break;

    case 'graph/extend':
      console.log('--- [Worker] Received "graph/extend". Starting Phase C. ---');
      
      (async () => {
        try {
          postMessage('app_status/update', { state: 'extending', message: 'Extending network...' });
          
          // Fetch 2nd degree citations (Work Plan Step 8)
          await fetchSecondDegreeCitations();

          // Hydrate existing stubs (Work Plan Step 9)
          await hydrateStubPapers();

          console.log('--- [Worker] Phase C Complete. Graph extension finished. ---');
          postMessage('app_status/update', { state: 'active', message: null });
        } catch (error) {
          console.error('[Worker] Error during graph extension:', error);
          postMessage('error/fatal', { 
            message: `Extension error: ${error instanceof Error ? error.message : 'Unknown error'}` 
          });
        }
      })();
      break;
      
    default:
      console.warn('[Worker] Unknown message type:', type);
  }
});

export {};
