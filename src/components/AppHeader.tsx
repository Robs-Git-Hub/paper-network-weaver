
import React from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AppHeaderProps {
  isEnriching?: boolean;
}

export const AppHeader: React.FC<AppHeaderProps> = ({ isEnriching }) => {
  return (
    <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center justify-between">
        <h1 className="text-lg font-semibold">ACE</h1>
        
        <div className="flex items-center gap-2">
          {isEnriching && (
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-[#437e84] rounded-full animate-pulse" />
              <span className="text-xs text-muted-foreground hidden sm:inline">
                Fetching paper details...
              </span>
            </div>
          )}
          
          <Button variant="ghost" size="sm">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  );
};
