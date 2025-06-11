
// src/workers/graph-core/relationship-builder.ts

import { openAlexService } from '../../services/openAlex';
import { reconstructAbstract, extractKeywords, normalizeDoi, generateShortUid } from '../../utils/data-transformers';
import { normalizeOpenAlexId } from '../../services/openAlex-util';
import { processOpenAlexPaper, processOpenAlexAuthor, processOpenAlexInstitution } from './entity-processors';
import { findByExternalId } from './utils';
import type { Paper, Author, Institution, Authorship, PaperRelationship, GraphState, UtilityFunctions } from './types';

export async function fetchFirstDegreeCitations(
  masterPaperOpenAlexId: string,
  getGraphState: () => GraphState,
  utils: UtilityFunctions
) {
  console.log('[Worker] Phase A, Step 2: Fetching 1st degree citations from OpenAlex.');
  utils.postMessage('progress/update', { message: 'Fetching 1st degree citations...' });
  
  const data = await openAlexService.fetchCitations(masterPaperOpenAlexId);
  
  const referencedBy1stDegreeFreq: Record<string, number> = {};
  const relatedWorksFreq: Record<string, number> = {};
  
  for (const paperData of data.results) {
    const state = getGraphState();
    const cleanPaperData = { ...paperData, id: normalizeOpenAlexId(paperData.id) };
    const paperUid = await processOpenAlexPaper(
      cleanPaperData, false, state.papers, state.authors, state.institutions, state.authorships
    );
    
    if (state.papers[paperUid] && !state.papers[paperUid].relationship_tags.includes('1st_degree')) {
      state.papers[paperUid].relationship_tags.push('1st_degree');
    }
    
    state.paperRelationships.push({
      source_short_uid: paperUid,
      target_short_uid: getGraphState().masterPaperUid!,
      relationship_type: 'cites'
    });
    
    (paperData.referenced_works || []).forEach(refWorkUrl => {
      const cleanId = normalizeOpenAlexId(refWorkUrl);
      if (cleanId) referencedBy1stDegreeFreq[cleanId] = (referencedBy1stDegreeFreq[cleanId] || 0) + 1;
    });
    
    (paperData.related_works || []).forEach(relWorkUrl => {
      const cleanId = normalizeOpenAlexId(relWorkUrl);
      if (cleanId) relatedWorksFreq[cleanId] = (relatedWorksFreq[cleanId] || 0) + 1;
    });
  }
  
  const referencedBy1stDegreeIds = Object.keys(referencedBy1stDegreeFreq).filter(id => referencedBy1stDegreeFreq[id] >= getGraphState().stubCreationThreshold);
  const frequentRelated = Object.keys(relatedWorksFreq).filter(id => relatedWorksFreq[id] >= getGraphState().stubCreationThreshold);
  
  if (referencedBy1stDegreeIds.length > 0) {
    await createStubsFromOpenAlexIds(referencedBy1stDegreeIds, 'cites', getGraphState, utils, 'referenced_by_1st_degree');
  }
  
  if (frequentRelated.length > 0) {
    await createStubsFromOpenAlexIds(frequentRelated, 'similar', getGraphState, utils, 'similar');
  }
  
  console.log(`[Worker] Phase A, Step 2: Processed ${data.results.length} citations, found ${referencedBy1stDegreeIds.length} referenced_by_1st_degree stubs and ${frequentRelated.length} frequent similar stubs.`);
}

export async function createStubsFromOpenAlexIds(
  openAlexIds: string[], 
  relationshipType: 'cites' | 'similar', 
  getGraphState: () => GraphState,
  utils: UtilityFunctions,
  tag?: '1st_degree' | '2nd_degree' | 'referenced_by_1st_degree' | 'similar'
) {
  if (openAlexIds.length === 0) return;
  
  const responseData = await openAlexService.fetchMultiplePapers(openAlexIds, 'STUB_CREATION');
  
  for (const paperData of responseData.results) {
    const state = getGraphState();
    const cleanPaperData = { ...paperData, id: normalizeOpenAlexId(paperData.id) };
    const stubUid = await processOpenAlexPaper(
      cleanPaperData, true, state.papers, state.authors, state.institutions, state.authorships
    );
    
    if (tag && state.papers[stubUid] && !state.papers[stubUid].relationship_tags.includes(tag)) {
      state.papers[stubUid].relationship_tags.push(tag);
    }
    
    const relationship: PaperRelationship = {
      source_short_uid: getGraphState().masterPaperUid!,
      target_short_uid: stubUid,
      relationship_type: relationshipType,
      ...(tag && { tag })
    };
    state.paperRelationships.push(relationship);
  }
}

export async function fetchSecondDegreeCitations(
  getGraphState: () => GraphState,
  utils: UtilityFunctions
) {
  console.log('[Worker] Phase C, Step 8: Fetching 2nd degree citations.');
  utils.postMessage('progress/update', { message: 'Fetching 2nd degree citations...' });

  const state = getGraphState();

  const firstDegreeRelationships = state.paperRelationships
    .filter(rel => rel.relationship_type === 'cites' && rel.target_short_uid === state.masterPaperUid);
  
  const firstDegreeCitationUids = firstDegreeRelationships.map(rel => rel.source_short_uid);

  if (firstDegreeCitationUids.length === 0) {
    console.log('[Worker] No 1st degree citations found, skipping 2nd degree fetch.');
    return;
  }

  const uidToOpenAlexIdMap: Record<string, string> = {};
  for (const key in state.externalIdIndex) {
    if (key.startsWith('openalex:')) {
      const uid = state.externalIdIndex[key];
      const openAlexId = key.substring('openalex:'.length);
      uidToOpenAlexIdMap[uid] = openAlexId;
    }
  }

  const openAlexIdsOfFirstDegreePapers = firstDegreeCitationUids
    .map(uid => uidToOpenAlexIdMap[uid])
    .filter((id): id is string => id !== null && id !== undefined);

  if (openAlexIdsOfFirstDegreePapers.length === 0) {
    console.log('[Worker] No OpenAlex IDs found for 1st degree citations. This indicates a logic error in data indexing.');
    return;
  }

  try {
    const data = await openAlexService.fetchCitationsForMultiplePapers(openAlexIdsOfFirstDegreePapers);
    console.log(`[Worker] Found ${data.results.length} 2nd degree citations.`);
    
    const newPapers: Record<string, Paper> = {};
    const newAuthors: Record<string, Author> = {};
    const newInstitutions: Record<string, Institution> = {};
    const newAuthorships: Record<string, Authorship> = {};
    const newRelationships: PaperRelationship[] = [];
    
    for (const paperData of data.results) {
      const currentState = getGraphState();
      const cleanPaperData = { ...paperData, id: normalizeOpenAlexId(paperData.id) };
      
      let paperUid = utils.findByExternalId('openalex', cleanPaperData.id);
      if (!paperUid) {
        paperUid = await processOpenAlexPaper(
          cleanPaperData, false, currentState.papers, currentState.authors, currentState.institutions, currentState.authorships
        );
        
        newPapers[paperUid] = currentState.papers[paperUid];
        Object.entries(currentState.authorships).forEach(([key, authorship]) => {
          if (authorship.paper_short_uid === paperUid) {
            newAuthorships[key] = authorship;
            if (currentState.authors[authorship.author_short_uid]) {
              newAuthors[authorship.author_short_uid] = currentState.authors[authorship.author_short_uid];
            }
            authorship.institution_uids.forEach(instUid => {
              if (currentState.institutions[instUid]) {
                newInstitutions[instUid] = currentState.institutions[instUid];
              }
            });
          }
        });
      }
      
      if (currentState.papers[paperUid] && !currentState.papers[paperUid].relationship_tags.includes('2nd_degree')) {
        currentState.papers[paperUid].relationship_tags.push('2nd_degree');
      }
      
      (paperData.referenced_works || []).forEach(refWorkUrl => {
        const citedWorkId = normalizeOpenAlexId(refWorkUrl);
        if (openAlexIdsOfFirstDegreePapers.includes(citedWorkId)) {
          const targetUid = utils.findByExternalId('openalex', citedWorkId);
          if (targetUid) {
            newRelationships.push({
              source_short_uid: paperUid!,
              target_short_uid: targetUid,
              relationship_type: 'cites'
            });
          }
        }
      });
    }
    
    getGraphState().paperRelationships.push(...newRelationships);
    
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
    
    console.log(`[Worker] Added ${Object.keys(newPapers).length} new 2nd degree citation papers and ${newRelationships.length} new relationships.`);
    
  } catch (error) {
    console.warn('[Worker] Error fetching 2nd degree citations:', error);
  }
}

export async function hydrateStubPapers(
  getGraphState: () => GraphState,
  utils: UtilityFunctions
) {
  console.log('[Worker] Phase C, Step 9: Hydrating stub papers.');
  utils.postMessage('progress/update', { message: 'Hydrating stub papers...' });

  const state = getGraphState();
  const stubUids = Object.values(state.papers)
    .filter(paper => paper.is_stub)
    .map(paper => paper.short_uid);

  if (stubUids.length === 0) return;

  const uidToOpenAlexIdMap: Record<string, string> = {};
  for (const key in state.externalIdIndex) {
    if (key.startsWith('openalex:')) {
      const uid = state.externalIdIndex[key];
      const openAlexId = key.substring('openalex:'.length);
      uidToOpenAlexIdMap[uid] = openAlexId;
    }
  }

  const openAlexIdsToHydrate = stubUids
    .map(uid => uidToOpenAlexIdMap[uid])
    .filter((id): id is string => id !== null && id !== undefined);

  if (openAlexIdsToHydrate.length === 0) return;

  try {
    const responseData = await openAlexService.fetchMultiplePapers(openAlexIdsToHydrate, 'FULL_INGESTION');
    console.log(`[Worker] Hydrating ${responseData.results.length} stub papers.`);
    
    const openAlexIdToUidMap = Object.fromEntries(Object.entries(uidToOpenAlexIdMap).map(([uid, id]) => [id, uid]));

    for (const paperData of responseData.results) {
      const currentState = getGraphState();
      const normalizedId = normalizeOpenAlexId(paperData.id);
      const stubUid = openAlexIdToUidMap[normalizedId];
      
      if (!stubUid || !currentState.papers[stubUid]) continue;
      
      const updatedPaper: Paper = {
        ...currentState.papers[stubUid],
        title: paperData.title || paperData.display_name || currentState.papers[stubUid].title,
        publication_year: paperData.publication_year || currentState.papers[stubUid].publication_year,
        publication_date: paperData.publication_date || currentState.papers[stubUid].publication_date,
        location: paperData.primary_location?.source?.display_name || currentState.papers[stubUid].location,
        abstract: reconstructAbstract(paperData.abstract_inverted_index) || currentState.papers[stubUid].abstract,
        fwci: paperData.fwci || currentState.papers[stubUid].fwci,
        cited_by_count: paperData.cited_by_count || currentState.papers[stubUid].cited_by_count,
        type: paperData.type || currentState.papers[stubUid].type,
        language: paperData.language || currentState.papers[stubUid].language,
        keywords: extractKeywords(paperData.keywords) || currentState.papers[stubUid].keywords,
        best_oa_url: paperData.open_access?.oa_url || currentState.papers[stubUid].best_oa_url,
        oa_status: paperData.open_access?.oa_status || currentState.papers[stubUid].oa_status,
        is_stub: false
      };
      
      currentState.papers[stubUid] = updatedPaper;
      
      utils.postMessage('papers/updateOne', { id: stubUid, changes: updatedPaper });
      
      if (paperData.authorships) {
        for (let i = 0; i < paperData.authorships.length; i++) {
          const authorship = paperData.authorships[i];
          const authorUid = await processOpenAlexAuthor(authorship.author, false, getGraphState().authors);
          
          const authorshipKey = `${stubUid}_${authorUid}`;
          const newAuthorship: Authorship = {
            paper_short_uid: stubUid,
            author_short_uid: authorUid,
            author_position: i,
            is_corresponding: false,
            raw_author_name: authorship.raw_author_name || null,
            institution_uids: []
          };
          
          if (authorship.institutions) {
            for (const inst of authorship.institutions) {
              const instUid = await processOpenAlexInstitution(inst, getGraphState().institutions);
              newAuthorship.institution_uids.push(instUid);
            }
          }
          
          getGraphState().authorships[authorshipKey] = newAuthorship;
        }
      }
    }
    
    console.log(`[Worker] Successfully hydrated ${responseData.results.length} stub papers.`);
  } catch (error) {
    console.warn('[Worker] Error hydrating stub papers:', error);
  }
}

export async function hydrateMasterPaper(
  getGraphState: () => GraphState,
  utils: UtilityFunctions
) {
  const state = getGraphState();
  if (!state.masterPaperUid) return;
  const masterPaper = state.papers[state.masterPaperUid];
  if (!masterPaper) return;
  
  let openAlexId: string | null = null;
  for (const key in state.externalIdIndex) {
    if (state.externalIdIndex[key] === state.masterPaperUid && key.startsWith('openalex:')) {
      openAlexId = key.substring('openalex:'.length);
      break; 
    }
  }

  if (!openAlexId) return;
  
  try {
    console.log('[Worker] Phase B, Step 4: Hydrating Master Paper from OpenAlex.');
    utils.postMessage('progress/update', { message: 'Enriching master paper...' });
    
    const data = await openAlexService.fetchPaperDetails(openAlexId);
    if (!data) return;
    
    const currentState = getGraphState();
    const currentMasterPaper = currentState.papers[currentState.masterPaperUid!];

    const updatedPaper: Paper = {
      ...currentMasterPaper,
      title: data.title || data.display_name || currentMasterPaper.title,
      publication_year: data.publication_year || currentMasterPaper.publication_year,
      publication_date: data.publication_date || currentMasterPaper.publication_date,
      location: data.primary_location?.source?.display_name || currentMasterPaper.location,
      abstract: reconstructAbstract(data.abstract_inverted_index) || currentMasterPaper.abstract,
      fwci: data.fwci || currentMasterPaper.fwci,
      cited_by_count: data.cited_by_count || currentMasterPaper.cited_by_count,
      type: data.type || currentMasterPaper.type,
      language: data.language || currentMasterPaper.language,
      keywords: extractKeywords(data.keywords) || currentMasterPaper.keywords,
      best_oa_url: data.open_access?.oa_url || currentMasterPaper.best_oa_url,
      oa_status: data.open_access?.oa_status || currentMasterPaper.oa_status,
      is_stub: false
    };
    
    currentState.papers[currentState.masterPaperUid!] = updatedPaper;
    
    utils.postMessage('papers/updateOne', {
      id: currentState.masterPaperUid!,
      changes: updatedPaper
    });
    
    console.log('[Worker] Phase B, Step 4: Master Paper hydration complete.');
  } catch (error) {
    console.warn('[Worker] Master paper hydration failed:', error);
  }
}

export async function processSemanticScholarRelationships(
  ssData: any,
  getGraphState: () => GraphState,
  utils: UtilityFunctions
) {
  if (ssData.citations) {
    for (const citation of ssData.citations) {
      const stubUid = await processSemanticScholarPaper(citation, true, getGraphState, utils);
      if (stubUid) {
        getGraphState().paperRelationships.push({
          source_short_uid: stubUid,
          target_short_uid: getGraphState().masterPaperUid!,
          relationship_type: 'cites'
        });
      }
    }
  }
  
  if (ssData.references) {
    for (const reference of ssData.references) {
      const stubUid = await processSemanticScholarPaper(reference, true, getGraphState, utils);
      if (stubUid) {
        getGraphState().paperRelationships.push({
          source_short_uid: getGraphState().masterPaperUid!,
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
  getGraphState: () => GraphState,
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
  
  getGraphState().papers[paperUid] = paper;
  
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
      const authorUid = await processSemanticScholarAuthor(authorData, getGraphState, utils);
      
      const authorshipKey = `${paperUid}_${authorUid}`;
      getGraphState().authorships[authorshipKey] = {
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
  getGraphState: () => GraphState,
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
  
  getGraphState().authors[authorUid] = author;
  
  if (authorData.authorId) {
    utils.addToExternalIndex('ss_author', authorData.authorId, authorUid);
  }
  
  return authorUid;
}