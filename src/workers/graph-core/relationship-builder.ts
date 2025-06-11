import { semanticScholarService } from '../../services/semanticScholar';
import { fetchWithRetry } from '../../utils/api-helpers';
import { reconstructAbstract, extractKeywords, normalizeDoi, calculateMatchScore, generateShortUid } from '../../utils/data-transformers';
import { normalizeOpenAlexId } from '../../services/openAlex-util';
import { processOpenAlexPaper, processOpenAlexAuthor, processOpenAlexInstitution } from './entity-processors';
import type { Paper, Author, Institution, Authorship, PaperRelationship } from './types';

interface GraphState {
  papers: Record<string, Paper>;
  authors: Record<string, Author>;
  institutions: Record<string, Institution>;
  authorships: Record<string, Authorship>;
  paperRelationships: PaperRelationship[];
  externalIdIndex: Record<string, string>;
  masterPaperUid: string | null;
  stubCreationThreshold: number;
}

interface UtilityFunctions {
  postMessage: (type: string, payload: any) => void;
  addToExternalIndex: (idType: string, idValue: string, entityUid: string) => void;
  findByExternalId: (idType: string, idValue: string) => string | null;
}

export async function fetchFirstDegreeCitations(
  masterPaperOpenAlexId: string,
  state: GraphState,
  utils: UtilityFunctions
) {
  console.log('[Worker] Phase A, Step 2: Fetching 1st degree citations from OpenAlex.');
  utils.postMessage('progress/update', { message: 'Fetching 1st degree citations...' });
  
  const normalizedMasterId = normalizeOpenAlexId(masterPaperOpenAlexId);

  const url = `https://api.openalex.org/works?filter=cites:${normalizedMasterId}&per-page=200&select=id,title,display_name,publication_year,publication_date,primary_location,abstract_inverted_index,fwci,cited_by_count,type,language,keywords,open_access,authorships,referenced_works,related_works`;
  
  const response = await fetchWithRetry(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch citations: ${response.status}`);
  }
  
  const data = await response.json();
  
  const referencedBy1stDegreeFreq: Record<string, number> = {};
  const relatedWorksFreq: Record<string, number> = {};
  
  for (const paperData of data.results) {
    if (paperData.id) {
        paperData.id = normalizeOpenAlexId(paperData.id);
    }

    const paperUid = await processOpenAlexPaper(
      paperData, 
      false, 
      state.papers, 
      state.authors, 
      state.institutions, 
      state.authorships, 
      state.externalIdIndex, 
      utils.addToExternalIndex, 
      utils.findByExternalId
    );
    
    // Add 1st_degree tag to this paper
    if (state.papers[paperUid]) {
      if (!state.papers[paperUid].relationship_tags.includes('1st_degree')) {
        state.papers[paperUid].relationship_tags.push('1st_degree');
      }
    }
    
    state.paperRelationships.push({
      source_short_uid: paperUid,
      target_short_uid: state.masterPaperUid!,
      relationship_type: 'cites'
    });
    
    if (paperData.referenced_works) {
      for (const refWorkUrl of paperData.referenced_works) {
        const cleanId = normalizeOpenAlexId(refWorkUrl);
        if (cleanId) {
            referencedBy1stDegreeFreq[cleanId] = (referencedBy1stDegreeFreq[cleanId] || 0) + 1;
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
  
  const referencedBy1stDegreeIds = Object.entries(referencedBy1stDegreeFreq)
    .filter(([_, count]) => count >= state.stubCreationThreshold)
    .map(([id, _]) => id);
    
  const frequentRelated = Object.entries(relatedWorksFreq)
    .filter(([_, count]) => count >= state.stubCreationThreshold)
    .map(([id, _]) => id);
  
  if (referencedBy1stDegreeIds.length > 0) {
    await createStubsFromOpenAlexIds(referencedBy1stDegreeIds, 'cites', state, utils, 'referenced_by_1st_degree');
  }
  
  if (frequentRelated.length > 0) {
    await createStubsFromOpenAlexIds(frequentRelated, 'similar', state, utils, 'similar');
  }
  
  console.log(`[Worker] Phase A, Step 2: Processed ${data.results.length} citations, found ${referencedBy1stDegreeIds.length} referenced_by_1st_degree stubs and ${frequentRelated.length} frequent similar stubs.`);
}

export async function createStubsFromOpenAlexIds(
  openAlexIds: string[], 
  relationshipType: 'cites' | 'similar', 
  state: GraphState, 
  utils: UtilityFunctions,
  tag?: '1st_degree' | '2nd_degree' | 'referenced_by_1st_degree' | 'similar'
) {
  if (openAlexIds.length === 0) return;
  
  const url = `https://api.openalex.org/works?filter=openalex:${openAlexIds.join('|')}&select=id,title,display_name,publication_year,publication_date,primary_location,cited_by_count,type,authorships`;
  
  const response = await fetchWithRetry(url);
  if (!response.ok) {
    console.warn(`[Worker] Could not fetch stubs for ${relationshipType}. Status: ${response.status}`);
    return;
  }
  
  const data = await response.json();
  
  for (const paperData of data.results) {
    const stubUid = await processOpenAlexPaper(
      paperData, 
      true, 
      state.papers, 
      state.authors, 
      state.institutions, 
      state.authorships, 
      state.externalIdIndex, 
      utils.addToExternalIndex, 
      utils.findByExternalId
    );
    
    // Add relationship tag to the paper
    if (tag && state.papers[stubUid]) {
      if (!state.papers[stubUid].relationship_tags.includes(tag)) {
        state.papers[stubUid].relationship_tags.push(tag);
      }
    }
    
    const relationship: PaperRelationship = {
      source_short_uid: relationshipType === 'cites' ? state.masterPaperUid! : state.masterPaperUid!,
      target_short_uid: relationshipType === 'cites' ? stubUid : stubUid,
      relationship_type: relationshipType
    };

    if (tag) {
      relationship.tag = tag;
    }

    state.paperRelationships.push(relationship);
  }
}

export async function fetchSecondDegreeCitations(
  state: GraphState,
  utils: UtilityFunctions
) {
  console.log('[Worker] Phase C, Step 8: Fetching 2nd degree citations.');
  utils.postMessage('progress/update', { message: 'Fetching 2nd degree citations...' });

  // Get all 1st-degree citation papers (papers that cite the master paper)
  const firstDegreeCitations = state.paperRelationships.filter(
    rel => rel.relationship_type === 'cites' && rel.target_short_uid === state.masterPaperUid
  );

  if (firstDegreeCitations.length === 0) {
    console.log('[Worker] No 1st degree citations found, skipping 2nd degree fetch.');
    return;
  }

  // Collect OpenAlex IDs for these papers
  const openAlexIds: string[] = [];
  for (const rel of firstDegreeCitations) {
    const openAlexKey = Object.keys(state.externalIdIndex).find(key => 
      key.startsWith('openalex:') && state.externalIdIndex[key] === rel.source_short_uid
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
        paperData.id = normalizeOpenAlexId(paperData.id);
      }

      // Check if paper already exists
      const existingUid = utils.findByExternalId('openalex', paperData.id);
      if (existingUid) continue; // Skip if already in graph
      
      const paperUid = await processOpenAlexPaper(
        paperData, 
        false, 
        state.papers, 
        state.authors, 
        state.institutions, 
        state.authorships, 
        state.externalIdIndex, 
        utils.addToExternalIndex, 
        utils.findByExternalId
      );
      
      // Add 2nd_degree tag to this paper
      if (state.papers[paperUid]) {
        if (!state.papers[paperUid].relationship_tags.includes('2nd_degree')) {
          state.papers[paperUid].relationship_tags.push('2nd_degree');
        }
      }
      
      // Add to new data collections
      newPapers[paperUid] = state.papers[paperUid];
      
      // Find which 1st degree paper this cites
      if (paperData.referenced_works) {
        for (const refWorkUrl of paperData.referenced_works) {
          const cleanId = normalizeOpenAlexId(refWorkUrl);
          if (openAlexIds.includes(cleanId)) {
            const targetUid = utils.findByExternalId('openalex', cleanId);
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
      Object.entries(state.authorships).forEach(([key, authorship]) => {
        if (authorship.paper_short_uid === paperUid) {
          newAuthorships[key] = authorship;
          if (state.authors[authorship.author_short_uid]) {
            newAuthors[authorship.author_short_uid] = state.authors[authorship.author_short_uid];
          }
        }
      });
      
      // Collect new institutions
      Object.values(newAuthorships).forEach(authorship => {
        authorship.institution_uids.forEach(instUid => {
          if (state.institutions[instUid]) {
            newInstitutions[instUid] = state.institutions[instUid];
          }
        });
      });
    }
    
    // Add new relationships to global state
    state.paperRelationships.push(...newRelationships);
    
    // Post new data to main thread
    if (Object.keys(newPapers).length > 0) {
      utils.postMessage('graph/addNodes', {
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

export async function hydrateStubPapers(
  state: GraphState,
  utils: UtilityFunctions
) {
  console.log('[Worker] Phase C, Step 9: Hydrating stub papers.');
  utils.postMessage('progress/update', { message: 'Hydrating stub papers...' });

  // Find all stub papers
  const stubPapers = Object.values(state.papers).filter(paper => paper.is_stub);
  
  if (stubPapers.length === 0) {
    console.log('[Worker] No stub papers to hydrate.');
    return;
  }

  // Collect OpenAlex IDs for stub papers
  const openAlexIds: string[] = [];
  const stubUidToOpenAlexId: Record<string, string> = {};
  
  for (const stubPaper of stubPapers) {
    const openAlexKey = Object.keys(state.externalIdIndex).find(key => 
      key.startsWith('openalex:') && state.externalIdIndex[key] === stubPaper.short_uid
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
      const normalizedId = normalizeOpenAlexId(paperData.id);
      
      // Find the corresponding stub paper
      const stubUid = Object.keys(stubUidToOpenAlexId).find(
        uid => stubUidToOpenAlexId[uid] === normalizedId
      );
      
      if (!stubUid || !state.papers[stubUid]) continue;
      
      // Update the stub paper with full data
      const updatedPaper: Paper = {
        ...state.papers[stubUid],
        title: paperData.title || paperData.display_name || state.papers[stubUid].title,
        publication_year: paperData.publication_year || state.papers[stubUid].publication_year,
        publication_date: paperData.publication_date || state.papers[stubUid].publication_date,
        location: paperData.primary_location?.source?.display_name || state.papers[stubUid].location,
        abstract: reconstructAbstract(paperData.abstract_inverted_index) || state.papers[stubUid].abstract,
        fwci: paperData.fwci || state.papers[stubUid].fwci,
        cited_by_count: paperData.cited_by_count || state.papers[stubUid].cited_by_count,
        type: paperData.type || state.papers[stubUid].type,
        language: paperData.language || state.papers[stubUid].language,
        keywords: extractKeywords(paperData.keywords) || state.papers[stubUid].keywords,
        best_oa_url: paperData.open_access?.oa_url || state.papers[stubUid].best_oa_url,
        oa_status: paperData.open_access?.oa_status || state.papers[stubUid].oa_status,
        is_stub: false // No longer a stub
      };
      
      // Update in worker state
      state.papers[stubUid] = updatedPaper;
      
      // Post update to main thread
      utils.postMessage('papers/updateOne', {
        id: stubUid,
        changes: updatedPaper
      });
      
      // Process new authorships if available
      if (paperData.authorships) {
        for (let i = 0; i < paperData.authorships.length; i++) {
          const authorship = paperData.authorships[i];
          const authorUid = await processOpenAlexAuthor(
            authorship.author, 
            false, 
            state.authors, 
            state.institutions, 
            state.authorships, 
            state.externalIdIndex, 
            utils.addToExternalIndex, 
            utils.findByExternalId
          );
          
          // Create authorship record
          const authorshipKey = `${stubUid}_${authorUid}`;
          const newAuthorship: Authorship = {
            paper_short_uid: stubUid,
            author_short_uid: authorUid,
            author_position: i,
            is_corresponding: false,
            raw_author_name: authorship.raw_author_name || null,
            institution_uids: []
          };
          
          // Process institutions
          if (authorship.institutions) {
            for (const inst of authorship.institutions) {
              const instUid = await processOpenAlexInstitution(
                inst, 
                state.institutions, 
                state.externalIdIndex, 
                utils.addToExternalIndex, 
                utils.findByExternalId
              );
              newAuthorship.institution_uids.push(instUid);
            }
          }
          
          state.authorships[authorshipKey] = newAuthorship;
        }
      }
    }
    
    console.log(`[Worker] Successfully hydrated ${data.results.length} stub papers.`);
    
  } catch (error) {
    console.warn('[Worker] Error hydrating stub papers:', error);
  }
}

export async function hydrateMasterPaper(
  state: GraphState,
  utils: UtilityFunctions
) {
  if (!state.masterPaperUid) return;
  
  const masterPaper = state.papers[state.masterPaperUid];
  if (!masterPaper) return;
  
  const openAlexKey = Object.keys(state.externalIdIndex).find(key => 
    key.startsWith('openalex:') && state.externalIdIndex[key] === state.masterPaperUid
  );
  
  if (!openAlexKey) return;
  
  const openAlexId = openAlexKey.split('openalex:')[1];
  
  try {
    console.log('[Worker] Phase B, Step 4: Hydrating Master Paper from OpenAlex.');
    utils.postMessage('progress/update', { message: 'Enriching master paper...' });
    
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
    
    state.papers[state.masterPaperUid] = updatedPaper;
    
    utils.postMessage('papers/updateOne', {
      id: state.masterPaperUid,
      changes: updatedPaper
    });
    
    console.log('[Worker] Phase B, Step 4: Master Paper hydration complete.');
    
  } catch (error) {
    console.warn('[Worker] Master paper hydration failed:', error);
  }
}

export async function processSemanticScholarRelationships(
  ssData: any,
  state: GraphState,
  utils: UtilityFunctions
) {
  if (ssData.citations) {
    for (const citation of ssData.citations) {
      const stubUid = await processSemanticScholarPaper(citation, true, state, utils);
      if (stubUid) {
        state.paperRelationships.push({
          source_short_uid: stubUid,
          target_short_uid: state.masterPaperUid!,
          relationship_type: 'cites'
        });
      }
    }
  }
  
  if (ssData.references) {
    for (const reference of ssData.references) {
      const stubUid = await processSemanticScholarPaper(reference, true, state, utils);
      if (stubUid) {
        state.paperRelationships.push({
          source_short_uid: state.masterPaperUid!,
          target_short_uid: stubUid,
          relationship_type: 'cites'
        });
      }
    }
  }
}

async function processSemanticScholarPaper(
  paperData: any, 
  isStub = true,
  state: GraphState,
  utils: UtilityFunctions
): Promise<string | null> {
  if (paperData.externalIds?.DOI) {
    const normalizedDoi = normalizeDoi(paperData.externalIds.DOI);
    if (normalizedDoi) {
      const existingUid = utils.findByExternalId('doi', normalizedDoi);
      if (existingUid) return existingUid;
    }
  }
  
  if (paperData.paperId) {
    const existingUid = utils.findByExternalId('ss', paperData.paperId);
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
    is_stub: isStub,
    relationship_tags: []
  };
  
  state.papers[paperUid] = paper;
  
  if (paperData.paperId) {
    utils.addToExternalIndex('ss', paperData.paperId, paperUid);
  }
  if (paperData.externalIds?.DOI) {
    const normalizedDoi = normalizeDoi(paperData.externalIds.DOI);
    if (normalizedDoi) {
      utils.addToExternalIndex('doi', normalizedDoi, paperUid);
    }
  }
  
  if (paperData.authors) {
    for (let i = 0; i < paperData.authors.length; i++) {
      const authorData = paperData.authors[i];
      const authorUid = await processSemanticScholarAuthor(authorData, state, utils);
      
      const authorshipKey = `${paperUid}_${authorUid}`;
      state.authorships[authorshipKey] = {
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

async function processSemanticScholarAuthor(
  authorData: any,
  state: GraphState,
  utils: UtilityFunctions
): Promise<string> {
  if (authorData.authorId) {
    const existingUid = utils.findByExternalId('ss_author', authorData.authorId);
    if (existingUid) return existingUid;
  }
  
  const authorUid = generateShortUid();
  
  const author: Author = {
    short_uid: authorUid,
    clean_name: authorData.name || 'Unknown Author',
    orcid: null,
    is_stub: true
  };
  
  state.authors[authorUid] = author;
  
  if (authorData.authorId) {
    utils.addToExternalIndex('ss_author', authorData.authorId, authorUid);
  }
  
  return authorUid;
}
