
import React, { useState, useEffect } from 'react';
import { SearchBar } from '@/components/SearchBar';
import { PaperSelector } from '@/components/PaperSelector';
import { MainAnalysisView } from '@/components/MainAnalysisView';
import { AppHeader } from '@/components/AppHeader';
import { useKnowledgeGraphStore } from '@/store/knowledge-graph-store';
import { workerManager } from '@/services/workerManager';
import { openAlexService } from '@/services/openAlex';
import { PaperResult } from '@/types/api'; // --- FIX: Import the shared type

const Index = () => {
  const [searchResults, setSearchResults] = useState<PaperResult[]>([]);
  const [totalCount, setTotalCount] = useState<number | undefined>();
  const [isSearching, setIsSearching] = useState(false);
  const [currentView, setCurrentView] = useState('Table');
  
  const { app_status, setAppStatus } = useKnowledgeGraphStore();

  useEffect(() => {
    // Initialize worker on component mount
    workerManager.initialize();
    
    return () => {
      // Cleanup worker on unmount
      workerManager.terminate();
    };
  }, []);

  const handleSearch = async (query: string) => {
    setIsSearching(true);
    setSearchResults([]);
    setTotalCount(undefined);

    try {
      const data = await openAlexService.searchPapers(query);
      setSearchResults(data.results || []);
      setTotalCount(data.meta?.count);
    } catch (error) {
      console.error('Search error:', error);
      setAppStatus({
        state: 'error',
        message: 'Search failed. Please try again.'
      });
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectPaper = (paper: PaperResult) => {
    setSearchResults([]);
    setTotalCount(undefined);
    
    // Reset any previous error state
    setAppStatus({ state: 'loading', message: 'Processing your selected paper.' });
    
    // Start processing with the worker
    workerManager.processMasterPaper(paper);
  };

  const handleViewChange = (viewName: string) => {
    setCurrentView(viewName);
  };

  // --- FIX: Removed legacy spinner block. UI is now handled by MainAnalysisView. ---

  // Error state
  if (app_status.state === 'error') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4 max-w-md">
          <div className="text-red-500">
            <h2 className="text-lg font-semibold">Error</h2>
            <p className="text-sm">{app_status.message}</p>
          </div>
          <button
            onClick={() => {
              setAppStatus({ state: 'idle', message: null });
              workerManager.initialize();
            }}
            className="px-4 py-2 bg-[#437e84] text-white rounded hover:bg-[#437e84]/90"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // --- FIX: Added 'loading' state to this condition to render MainAnalysisView immediately. ---
  // Main analysis view (active or enriching states)
  if (['loading', 'enriching', 'extending', 'active'].includes(app_status.state)) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader 
          isEnriching={app_status.state === 'enriching'} 
          currentView={currentView}
          onViewChange={handleViewChange}
          showViewControls={true}
        />
        <div className="container mx-auto px-4 py-8">
          <MainAnalysisView 
            currentView={currentView}
            onViewChange={handleViewChange}
          />
        </div>
      </div>
    );
  }

  // Initial search interface
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppHeader />
      <div className="flex-1 flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-4xl space-y-8 mt-[20vh] sm:mt-0">
          <div className="text-center space-y-4">
            <h1 className="text-4xl font-bold tracking-tight">
              Academic Citation Explorer
            </h1>
            <p className="text-xl text-muted-foreground">
              Search for a research paper to build and analyze its citation network
            </p>
          </div>

          <SearchBar onSearch={handleSearch} isLoading={isSearching} />

          {searchResults.length > 0 && (
            <PaperSelector
              papers={searchResults}
              onSelectPaper={handleSelectPaper}
              totalCount={totalCount}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default Index;
