
import JSZip from 'jszip';
import { saveAs } from 'file-saver-es';
import type { Paper, Author, Institution, Authorship, PaperRelationship } from '@/store/knowledge-graph-store';

interface ExportableData {
  papers: Record<string, Paper>;
  authors: Record<string, Author>;
  institutions: Record<string, Institution>;
  authorships: Record<string, Authorship>;
  paper_relationships: PaperRelationship[];
  external_id_index: Record<string, string>;
  relation_to_master: Record<string, string[]>; // <-- ADD THIS
}

// Convert object to CSV string
function objectsToCSV(objects: any[], headers: string[]): string {
  const csvHeaders = headers.join(',');
  const csvRows = objects.map(obj => {
    return headers.map(header => {
      const value = obj[header];
      if (value === null || value === undefined) {
        return '';
      }
      if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return String(value);
    }).join(',');
  });
  
  return [csvHeaders, ...csvRows].join('\n');
}

// Generate papers.csv
function generatePapersCSV(papers: Record<string, Paper>): string {
  const headers = [
    'short_uid', 'title', 'publication_year', 'publication_date', 'location', 
    'abstract', 'fwci', 'cited_by_count', 'type', 'language', 'oa_status', 
    'best_oa_url', 'is_stub'
  ];
  
  const paperData = Object.values(papers).map(paper => ({
    short_uid: paper.short_uid,
    title: paper.title,
    publication_year: paper.publication_year,
    publication_date: paper.publication_date,
    location: paper.location,
    abstract: paper.abstract,
    fwci: paper.fwci,
    cited_by_count: paper.cited_by_count,
    type: paper.type,
    language: paper.language,
    oa_status: paper.oa_status,
    best_oa_url: paper.best_oa_url,
    is_stub: paper.is_stub ? 'true' : 'false'
  }));
  
  return objectsToCSV(paperData, headers);
}

// Generate authors.csv
function generateAuthorsCSV(authors: Record<string, Author>): string {
  const headers = ['short_uid', 'clean_name', 'orcid', 'is_stub'];
  
  const authorData = Object.values(authors).map(author => ({
    short_uid: author.short_uid,
    clean_name: author.clean_name,
    orcid: author.orcid || '',
    is_stub: author.is_stub ? 'true' : 'false'
  }));
  
  return objectsToCSV(authorData, headers);
}

// Generate institutions.csv
function generateInstitutionsCSV(institutions: Record<string, Institution>): string {
  const headers = ['short_uid', 'ror_id', 'display_name', 'country_code', 'type'];
  
  const institutionData = Object.values(institutions).map(institution => ({
    short_uid: institution.short_uid,
    ror_id: institution.ror_id || '',
    display_name: institution.display_name,
    country_code: institution.country_code || '',
    type: institution.type || ''
  }));
  
  return objectsToCSV(institutionData, headers);
}

// Generate authorships.csv
function generateAuthorshipsCSV(authorships: Record<string, Authorship>): string {
  const headers = ['paper_short_uid', 'author_short_uid', 'author_position', 'is_corresponding', 'raw_author_name'];
  
  const authorshipData = Object.values(authorships).map(authorship => ({
    paper_short_uid: authorship.paper_short_uid,
    author_short_uid: authorship.author_short_uid,
    author_position: authorship.author_position,
    is_corresponding: authorship.is_corresponding ? 'true' : 'false',
    raw_author_name: authorship.raw_author_name || ''
  }));
  
  return objectsToCSV(authorshipData, headers);
}

// Generate authorship_institutions.csv
function generateAuthorshipInstitutionsCSV(authorships: Record<string, Authorship>): string {
  const headers = ['paper_short_uid', 'author_short_uid', 'institution_short_uid'];
  
  const data: any[] = [];
  Object.values(authorships).forEach(authorship => {
    (authorship.institution_uids || []).forEach(institutionUid => {
      data.push({
        paper_short_uid: authorship.paper_short_uid,
        author_short_uid: authorship.author_short_uid,
        institution_short_uid: institutionUid
      });
    });
  });
  
  return objectsToCSV(data, headers);
}

// Generate paper_relationships.csv
function generatePaperRelationshipsCSV(relationships: PaperRelationship[]): string {
  const headers = ['source_short_uid', 'target_short_uid', 'relationship_type'];
  
  const relationshipData = relationships.map(rel => ({
    source_short_uid: rel.source_short_uid,
    target_short_uid: rel.target_short_uid,
    relationship_type: rel.relationship_type
  }));
  
  return objectsToCSV(relationshipData, headers);
}

// --- START: FIX for relationship tags export ---
// Generate paper_relationship_types.csv
function generatePaperRelationshipTypesCSV(relation_to_master: Record<string, string[]>): string {
  const headers = ['paper_short_uid', 'relationship_type'];
  
  const data: { paper_short_uid: string, relationship_type: string }[] = [];
  Object.entries(relation_to_master).forEach(([paper_short_uid, tags]) => {
    (tags || []).forEach(tag => {
      data.push({
        paper_short_uid: paper_short_uid,
        relationship_type: tag
      });
    });
  });
  
  return objectsToCSV(data, headers);
}
// --- END: FIX for relationship tags export ---


// --- START: FIX for keyword export robustness ---
// Generate paper_keywords.csv
function generatePaperKeywordsCSV(papers: Record<string, Paper>): string {
  const headers = ['paper_short_uid', 'keyword'];
  
  const data: any[] = [];
  Object.values(papers).forEach(paper => {
    // Add safety check for paper.keywords
    (paper.keywords || []).forEach(keyword => {
      data.push({
        paper_short_uid: paper.short_uid,
        keyword: keyword
      });
    });
  });
  
  return objectsToCSV(data, headers);
}
// --- END: FIX for keyword export robustness ---

// Generate external ID CSVs (placeholder for now since external IDs aren't directly accessible)
function generateExternalIdCSV(type: 'paper' | 'author' | 'institution'): string {
  const headers = [`${type}_short_uid`, 'external_id_type', 'external_id'];
  // Return empty CSV with headers since external ID data isn't currently accessible
  return headers.join(',') + '\n';
}

// Main export function
export async function exportDataPackage(data: ExportableData): Promise<void> {
  const zip = new JSZip();
  
  // Generate all CSV files
  const csvFiles = {
    'papers.csv': generatePapersCSV(data.papers),
    'authors.csv': generateAuthorsCSV(data.authors),
    'institutions.csv': generateInstitutionsCSV(data.institutions),
    'authorships.csv': generateAuthorshipsCSV(data.authorships),
    'authorship_institutions.csv': generateAuthorshipInstitutionsCSV(data.authorships),
    'paper_relationships.csv': generatePaperRelationshipsCSV(data.paper_relationships),
    // Use the correct data source for relationship types
    'paper_relationship_types.csv': generatePaperRelationshipTypesCSV(data.relation_to_master),
    'paper_keywords.csv': generatePaperKeywordsCSV(data.papers),
    'paper_to_externalid.csv': generateExternalIdCSV('paper'),
    'author_to_externalid.csv': generateExternalIdCSV('author'),
    'institution_to_externalid.csv': generateExternalIdCSV('institution')
  };
  
  // Add CSV files to zip
  Object.entries(csvFiles).forEach(([filename, content]) => {
    zip.file(filename, content);
  });
  
  // Add the datapackage descriptor
  try {
    const response = await fetch('/docs/datapackage.package.yaml');
    const yamlContent = await response.text();
    zip.file('datapackage.package.yaml', yamlContent);
  } catch (error) {
    console.warn('Could not fetch datapackage.package.yaml:', error);
  }
  
  // Generate and download the zip file
  const blob = await zip.generateAsync({ type: 'blob' });
  saveAs(blob, 'citation-network-datapackage.zip');
}
