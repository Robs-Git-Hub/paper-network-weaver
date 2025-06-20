
import { Paper, Author } from "@/store/knowledge-graph-store";

/**
 * Represents a Paper object that has been enriched with additional data
 * specifically for UI rendering purposes.
 */
export interface EnrichedPaper extends Paper {
  authors: Author[];
  relationship_tags: string[];
}