/**
 * @file Defines the weights for calculating progress during the analysis.
 * This file provides a single, easily editable source of truth for tuning
 * the user-facing progress bar behavior.
 *
 * The weights for Phase A and B represent the initial loading sequence before
 * the main table is displayed.
 *
 * The weights for Phase C represent the "extend graph" background task.
 * The sum of Phase C weights should be 100.
 */

// --- Phase A & B (Initial Load) ---
export const PHASE_A_B_WEIGHTS = {
  INITIALIZING: 0,
  FETCH_FIRST_DEGREE: 10,
  ENRICH_SEMANTIC_SCHOLAR: 40,
  HYDRATE_MASTER_PAPER: 50,
  RECONCILE_AUTHORS: 55,
  COMPLETE: 70, // The point at which Phase C is triggered
};

// --- Phase C (Background Extension) ---
// These weights are relative to the start of Phase C (which begins at 70% of the overall progress).
export const PHASE_C_WEIGHTS = {
  // First half of Phase C - fetching second-degree citations
  FETCH_SECOND_DEGREE: 50,

  // Second half of Phase C - hydrating stub papers
  HYDRATE_STUBS: 50,
};