import React from 'react';
import { Progress } from '@/components/ui/progress';

interface ProgressDisplayProps {
  value: number;
  label: string;
}

export const ProgressDisplay: React.FC<ProgressDisplayProps> = ({ value, label }) => {
  return (
    <div className="space-y-2 my-4">
      <div className="flex justify-between text-sm text-muted-foreground px-1">
        <span>{label}</span>
        <span>{Math.round(value)}%</span>
      </div>
      <Progress value={value} className="w-full" />
    </div>
  );
};