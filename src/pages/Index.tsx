
import React, { useState } from 'react';
import { useKnowledgeGraphStore } from '@/store/knowledge-graph-store';
import { SearchBar } from '@/components/SearchBar';
import { PaperSelector } from '@/components/PaperSelector';
import { AppHeader } from '@/components/AppHeader';
import { openAlexService } from '@/services/openAlex';
import { useToast } from '@/hooks/use-toast';

interface PaperResult {
  id: string;
  title: string;
  authors: Array<{ display_name: string }>;
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
  
  const { app_status, setAppStatus } = useKnowledgeGraphStore();
  const { toast } = useToast();

  const handleSearch = async (query: string) => {
    setIsSearching(true);
    try {
      console.log('Searching for:', query);
      const response = await openAlexService.searchPapers(query);
      
      setSearchResults(response.results);
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
    
    // TODO: Send selected paper to web worker for Phase A processing
    // For now, just show loading state
    toast({
      title: "Paper selected",
      description: `Processing "${paper.title}"...`
    });
  };

  const showSearchInterface = app_status.state === 'idle' && searchResults.length === 0;
  const showSearchResults = searchResults.length > 0;
  const showMainAnalysis = app_status.state !== 'idle' && !showSearchResults;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader isEnriching={app_status.state === 'enriching'} />
      
      <main className="container mx-auto px-4 py-8">
        {showSearchInterface && (
          <div className="min-h-[60vh] flex flex-col items-center justify-center text-center space-y-8">
            <div className="space-y-4">
              <h1 className="text-4xl font-bold text-foreground">
                Academic Knowledge Graph Explorer
              </h1>
              <p className="text-xl text-muted-foreground max-w-2xl">
                Discover citation networks and explore the connections between research papers
              </p>
            </div>
            
            <SearchBar onSearch={handleSearch} isLoading={isSearching} />
            
            <p className="text-sm text-muted-foreground max-w-lg">
              Enter the full title of a research paper to build a citation graph and explore its academic network
            </p>
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
          <div className="text-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#437e84] mx-auto mb-4"></div>
            <p className="text-muted-foreground">
              {app_status.message || 'Processing...'}
            </p>
          </div>
        )}
      </main>
    </div>
  );
};

export default Index;
