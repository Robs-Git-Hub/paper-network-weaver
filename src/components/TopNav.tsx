
import React from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface TopNavProps {
  items: string[];
  active: string;
  onClick: (viewName: string) => void;
}

export const TopNav: React.FC<TopNavProps> = ({ items, active, onClick }) => {
  return (
    <div className="mb-6">
      <Tabs value={active} onValueChange={onClick}>
        <TabsList className="grid w-fit grid-cols-2">
          {items.map((item) => (
            <TabsTrigger key={item} value={item}>
              {item}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
};
