
// src/types/api.ts

/**
 * Defines the shape of a paper object returned from the OpenAlex search API,
 * tailored for use in the UI components like PaperSelector.
 * This serves as the single source of truth for this data structure.
 */
export interface PaperResult {
  id: string;
  title?: string;
  display_name?: string;
  // authorships and author can be optional in the API response
  authorships?: Array<{
    author?: { display_name: string };
  }>;
  // publication_year can be optional in the API response
  publication_year?: number | null;
  // The entire location structure can be optional
  primary_location?: {
    source?: {
      display_name?: string;
    };
  };
  // --- FIX: Made cited_by_count optional to match the API response type ---
  cited_by_count?: number;
  doi?: string;
}