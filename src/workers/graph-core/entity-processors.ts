
import { reconstructAbstract, extractKeywords, normalizeDoi, generateShortUid } from '../../utils/data-transformers';
import { normalizeOpenAlexId } from '../../services/openAlex-util';
import { addToExternalIndex, findByExternalId } from './utils';
import type { Paper, Author, Institution, Authorship } from './types';

// Entity processing functions
// Will contain: processOpenAlexPaper, processOpenAlexAuthor, processOpenAlexInstitution

export async function processOpenAlexPaper(
  paperData: any, 
  isStub = false,
  papers: Record<string, Paper>,
  authors: Record<string, Author>,
  institutions: Record<string, Institution>,
  authorships: Record<string, Authorship>
): Promise<string> {
  let paperUid: string | null = null;

  // Step 1: Find an existing paper using any available ID.
  if (paperData.doi) {
    const normalizedDoi = normalizeDoi(paperData.doi);
    if (normalizedDoi) {
      paperUid = findByExternalId('doi', normalizedDoi);
    }
  }
  if (!paperUid && paperData.id) {
    paperUid = findByExternalId('openalex', paperData.id);
  }

  // Step 2: If no paper was found, create a new one.
  if (!paperUid) {
    paperUid = generateShortUid();
    const newPaper: Paper = {
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
      is_stub: isStub,
      relationship_tags: []
    };
    papers[paperUid] = newPaper;
  } else {
    if (!isStub && papers[paperUid].is_stub) {
      papers[paperUid].is_stub = false;
    }
  }

  // Step 3: Ensure ALL available IDs are in the index.
  if (paperData.id) {
    addToExternalIndex('openalex', paperData.id, paperUid);
  }
  if (paperData.doi) {
    const normalizedDoi = normalizeDoi(paperData.doi);
    if (normalizedDoi) {
      addToExternalIndex('doi', normalizedDoi, paperUid);
    }
  }

  // Step 4: Process authorships for non-stubs.
  if (!isStub && paperData.authorships) {
    for (let i = 0; i < paperData.authorships.length; i++) {
      const authorship = paperData.authorships[i];
      const authorUid = await processOpenAlexAuthor(authorship.author, isStub, authors);
      
      const authorshipKey = `${paperUid}_${authorUid}`;
      if (!authorships[authorshipKey]) {
        authorships[authorshipKey] = {
          paper_short_uid: paperUid,
          author_short_uid: authorUid,
          author_position: i,
          is_corresponding: authorship.is_corresponding || false,
          raw_author_name: authorship.raw_author_name || null,
          institution_uids: []
        };

        if (authorship.institutions) {
          for (const inst of authorship.institutions) {
            const instUid = await processOpenAlexInstitution(inst, institutions);
            authorships[authorshipKey].institution_uids.push(instUid);
          }
        }
      }
    }
  }

  return paperUid;
}

export async function processOpenAlexAuthor(
  authorData: any, 
  isStub = false,
  authors: Record<string, Author>
): Promise<string> {
  if (authorData.id) {
    const cleanId = normalizeOpenAlexId(authorData.id);
    const existingUid = findByExternalId('openalex_author', cleanId);
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
    const cleanId = normalizeOpenAlexId(authorData.id);
    addToExternalIndex('openalex_author', cleanId, authorUid);
  }

  return authorUid;
}

export async function processOpenAlexInstitution(
  instData: any,
  institutions: Record<string, Institution>
): Promise<string> {
  if (instData.id) {
    const cleanId = normalizeOpenAlexId(instData.id);
    const existingUid = findByExternalId('openalex_institution', cleanId);
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
    const cleanId = normalizeOpenAlexId(instData.id);
    addToExternalIndex('openalex_institution', cleanId, instUid);
  }

  return instUid;
}