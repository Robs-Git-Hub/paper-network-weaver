
import React, { useState, useEffect } from 'react';
import { useKnowledgeGraphStore } from '@/store/knowledge-graph-store';
import { SearchBar } from '@/components/SearchBar';
import { PaperSelector } from '@/components/PaperSelector';
import { AppHeader } from '@/components/AppHeader';
import { MainAnalysisView } from '@/components/MainAnalysisView';
import { openAlexService } from '@/services/openAlex';
import { useToast } from '@/hooks/use-toast';

interface PaperResult {
  id: string;
  doi?: string;
  title?: string;
  display_name?: string;
  authorships: Array<{
    author: { display_name: string };
  }>;
  publication_year: number | null;
  primary_location?: {
    source?: {
      display_name: string;
    };
  };
  cited_by_count: number;
}

const Index = () => {
  const [searchResults, setSearchResults] = useState<PaperResult[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [isSearching, setIsSearching] = useState(false);
  const [worker, setWorker] = useState<Worker | null>(null);
  
  const { app_status, setAppStatus, setState } = useKnowledgeGraphStore();
  const { toast } = useToast();

  // Initialize web worker
  useEffect(() => {
    const newWorker = new Worker(new URL('../workers/graph-worker.ts', import.meta.url), {
      type: 'module'
    });

    newWorker.onmessage = (e) => {
      const { type, payload } = e.data;
      console.log('[Main Thread] Received worker message:', type, payload);
      
      switch (type) {
        case 'progress/update':
          setAppStatus({ state: app_status.state, message: payload.message });
          break;
        case 'graph/setState':
          console.log('[Main Thread] Setting graph state');
          setState(payload.data);
          setAppStatus({ state: 'active', message: null });
          break;
        case 'app/setStatus':
          console.log('[Main Thread] Setting app status:', payload);
          setAppStatus(payload);
          break;
        case 'error/fatal':
          setAppStatus({ state: 'error', message: payload.message });
          toast({
            title: "Error",
            description: payload.message,
            variant: "destructive"
          });
          break;
        default:
          console.warn('Unknown worker message type:', type);
      }
    };

    setWorker(newWorker);

    return () => {
      newWorker.terminate();
    };
  }, []);

  const handleSearch = async (query: string) => {
    setIsSearching(true);
    try {
      console.log('Searching for:', query);
      const response = await openAlexService.searchPapers(query);
      
      // Transform the results to match our expected interface
      const transformedResults = response.results.map(paper => ({
        id: paper.id,
        doi: paper.doi, // Include the DOI
        title: paper.title || paper.display_name || 'Untitled',
        display_name: paper.display_name,
        authorships: paper.authorships || [],
        publication_year: paper.publication_year,
        primary_location: paper.primary_location,
        cited_by_count: paper.cited_by_count || 0
      }));
      
      console.log('Transformed results:', transformedResults);
      
      setSearchResults(transformedResults);
      setTotalCount(response.meta.count);
      
      toast({
        title: "Search completed",
        description: `Found ${response.meta.count} papers`
      });
      
    } catch (error) {
      console.error('Search error:', error);
      toast({
        title: "Search failed",
        description: error instanceof Error ? error.message : "Unknown error occurred",
        variant: "destructive"
      });
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectPaper = async (paper: PaperResult) => {
    console.log('Selected paper:', paper);
    setAppStatus({ state: 'loading', message: 'Building initial graph...' });
    
    // Clear search results to show the main analysis view
    setSearchResults([]);
    
    // Send selected paper to web worker for processing
    if (worker) {
      worker.postMessage({
        type: 'graph/processMasterPaper',
        payload: { paper }
      });
    }
    
    toast({
      title: "Paper selected",
      description: `Processing "${paper.title || paper.display_name}"...`
    });
  };

  const showSearchInterface = app_status.state === 'idle' && searchResults.length === 0;
  const showSearchResults = searchResults.length > 0;
  const showMainAnalysis = (app_status.state === 'loading' || app_status.state === 'enriching' || app_status.state === 'active') && !showSearchResults;

  console.log('[Main Thread] Current app status:', app_status);
  console.log('[Main Thread] Show states:', { showSearchInterface, showSearchResults, showMainAnalysis });

  return (
    <div className="min-h-screen bg-background">
      <AppHeader isEnriching={app_status.state === 'enriching'} />
      
      <main className="container mx-auto px-4 py-8">
        {showSearchInterface && (
          <div className="min-h-[60vh] flex flex-col items-center justify-center text-center space-y-8">
            <div className="space-y-4">
              <h1 className="text-4xl font-bold text-foreground">
                Academic Citation Explorer
              </h1>
              <p className="text-xl text-muted-foreground max-w-2xl">
                Explore citation networks between research papers
              </p>
            </div>
            
            <SearchBar onSearch={handleSearch} isLoading={isSearching} />
          </div>
        )}

        {showSearchResults && (
          <div className="space-y-6">
            <div className="text-center space-y-4">
              <h2 className="text-2xl font-semibold">Search Results</h2>
              <SearchBar onSearch={handleSearch} isLoading={isSearching} />
            </div>
            
            <PaperSelector
              papers={searchResults}
              onSelectPaper={handleSelectPaper}
              totalCount={totalCount}
            />
          </div>
        )}

        {showMainAnalysis && (
          <>
            {app_status.state === 'loading' && (
              <div className="text-center py-20">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#437e84] mx-auto mb-4"></div>
                <p className="text-muted-foreground">
                  {app_status.message || 'Processing...'}
                </p>
              </div>
            )}
            
            {(app_status.state === 'enriching' || app_status.state === 'active') && (
              <MainAnalysisView />
            )}
          </>
        )}
      </main>
    </div>
  );
};

export default Index;
