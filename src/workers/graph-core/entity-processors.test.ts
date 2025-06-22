
// Import testing utilities from Vitest and the function we want to test.
import { describe, it, expect, vi, Mock } from 'vitest';
import { processOpenAlexPaper } from './entity-processors';
import type { Paper, UtilityFunctions } from './types';

// 'describe' creates a test suite, a container for related tests.
describe('processOpenAlexPaper', () => {

  // 'it' defines a single test case. The name should describe what it tests.
  it('should opportunistically enrich a minimal stub with new data', async () => {
    // --- ARRANGE ---
    // First, we set up all the necessary variables and mock data for our test.

    // Mock the state objects that our function will interact with.
    const papers: Record<string, Paper> = {};
    const authors = {};
    const institutions = {};
    const authorships = {};

    // Mock the utility functions. We use `vi.fn()` to create "spy" functions
    // that record that they were called, without doing anything.
    const mockUtils: UtilityFunctions = {
      postMessage: vi.fn(),
      addToExternalIndex: vi.fn(),
      findByExternalId: vi.fn(),
    };

    // Define our test data.
    const paperId = 'https://openalex.org/W12345';
    const minimalStubData = { id: paperId }; // The first time we see a co-cited paper
    const richData = { 
      id: paperId, 
      title: 'A Richer Title', 
      publication_year: 2024 
    }; // The data we get when it appears again, e.g., as a 2nd-degree citation

    // --- ACT ---
    // Now, we run the function(s) we want to test.

    // Explicitly cast the mock function to tell TypeScript about its special methods.
    (mockUtils.findByExternalId as Mock).mockReturnValue(null);
    
    // 1. First call: Create the minimal stub, as if it were a co-cited paper.
    const initialUid = await processOpenAlexPaper(minimalStubData, true, papers, authors, institutions, authorships, mockUtils);
    
    // Before the second call, we need to adjust our mock to simulate that the paper
    // now exists. `findByExternalId` should now return the UID we just created.
    (mockUtils.findByExternalId as Mock).mockReturnValue(initialUid);

    // 2. Second call: Process the paper again, this time with rich data, but still
    // as a "stub discovery" call (`isStub = true`). This simulates the scenario
    // that was previously failing.
    await processOpenAlexPaper(richData, true, papers, authors, institutions, authorships, mockUtils);

    // --- ASSERT ---
    // Finally, we check if the outcome is what we expect.

    const finalPaperState = papers[initialUid];

    // Expect that the paper with our ID exists in the state.
    expect(finalPaperState).toBeDefined();

    // The most important checks for our feature:
    // Expect that the paper's title has been updated from 'Untitled'.
    expect(finalPaperState.title).toBe('A Richer Title');
    expect(finalPaperState.publication_year).toBe(2024);

    // Expect that the paper is STILL a stub, because we haven't made a formal
    // hydration call (`isStub = false`) yet. This confirms the enrichment
    // happened without prematurely flipping the stub flag.
    expect(finalPaperState.is_stub).toBe(true);

    // FIX: The update message is the THIRD message sent overall.
    // Call 0: 'graph/addPaper'
    // Call 1: 'graph/setExternalId'
    // Call 2: 'papers/updateOne'
    const updateCall = (mockUtils.postMessage as Mock).mock.calls[2];
    expect(updateCall[0]).toBe('papers/updateOne');
    expect(updateCall[1].changes.title).toBe('A Richer Title');
  });
});