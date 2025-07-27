
import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search } from 'lucide-react';

interface SearchBarProps {
  onSearch: (query: string) => void;
  isLoading?: boolean;
  exampleQuery?: string;
  onExampleClick?: () => void;
}

export const SearchBar: React.FC<SearchBarProps> = ({ onSearch, isLoading, exampleQuery, onExampleClick }) => {
  const [query, setQuery] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim() && !isLoading) {
      onSearch(query.trim());
    }
  };

  const handleExampleClick = () => {
    if (exampleQuery) {
      setQuery(exampleQuery);
      onExampleClick?.();
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-3">
      <form onSubmit={handleSubmit}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-5 w-5" />
          <Input
            type="text"
            placeholder="Enter the full title of a research paper..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-10 pr-24 py-3 text-base focus:ring-2 focus:ring-primary focus:border-primary"
            disabled={isLoading}
          />
          <Button
            type="submit"
            disabled={!query.trim() || isLoading}
            className="absolute right-2 top-1/2 transform -translate-y-1/2 bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {isLoading ? 'Searching...' : 'Search'}
          </Button>
        </div>
      </form>
      
      {exampleQuery && !query.trim() && (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleExampleClick}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Try an example
          </Button>
        </div>
      )}
    </div>
  );
};
