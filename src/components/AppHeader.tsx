
import React, { useState } from 'react';
import { MoreHorizontal, Menu, Info } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useKnowledgeGraphStore } from '@/store/knowledge-graph-store';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { TopNav } from '@/components/TopNav';
import { ExportButton } from '@/components/ExportButton';

interface AppHeaderProps {
  isEnriching?: boolean;
  currentView?: string;
  onViewChange?: (viewName: string) => void;
  showViewControls?: boolean;
}

export const AppHeader: React.FC<AppHeaderProps> = ({ 
  isEnriching, 
  currentView = 'Table',
  onViewChange,
  showViewControls = false
}) => {
  const { setAppStatus } = useKnowledgeGraphStore();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const navigate = useNavigate();

  const handleLogoClick = () => {
    setAppStatus({ state: 'idle', message: null });
  };

  return (
    <header className="sticky top-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b shadow-sm">
      <div className="container flex h-14 items-center justify-between">
        <button 
          onClick={handleLogoClick}
          className="text-lg font-semibold text-[#437e84] hover:text-[#437e84]/80 transition-colors cursor-pointer"
        >
          ACE
        </button>
        
        {/* Desktop Navigation - No view controls, only status */}
        <div className="hidden sm:flex items-center gap-4">
          {isEnriching && (
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-[#437e84] rounded-full animate-pulse" />
              <span className="text-xs text-muted-foreground">
                Fetching paper details...
              </span>
            </div>
          )}
          
          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => navigate('/about')}
            className="gap-2"
          >
            <Info className="h-4 w-4" />
            About
          </Button>
        </div>

        {/* Mobile Navigation */}
        <div className="flex sm:hidden items-center gap-2">
          {isEnriching && (
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-[#437e84] rounded-full animate-pulse" />
            </div>
          )}
          
          <Sheet open={isMenuOpen} onOpenChange={setIsMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="sm">
                <Menu className="h-4 w-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[300px]">
              <SheetHeader>
                <SheetTitle>Menu</SheetTitle>
              </SheetHeader>
              <div className="mt-6 space-y-6">
                {showViewControls && onViewChange && (
                  <div>
                    <h3 className="text-sm font-medium mb-3">View</h3>
                    <TopNav 
                      items={['Table', 'Network']} 
                      active={currentView} 
                      onClick={(view) => {
                        onViewChange(view);
                        setIsMenuOpen(false);
                      }} 
                    />
                  </div>
                )}
                
                {showViewControls && (
                  <div>
                    <h3 className="text-sm font-medium mb-3">Actions</h3>
                    <ExportButton />
                  </div>
                )}
                
                <div>
                  <Button 
                    variant="ghost" 
                    className="w-full justify-start"
                    onClick={() => {
                      navigate('/about');
                      setIsMenuOpen(false);
                    }}
                  >
                    <Info className="h-4 w-4 mr-2" />
                    About ACE
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
};
