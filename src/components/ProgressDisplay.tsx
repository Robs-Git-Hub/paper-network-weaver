import React, { useState, useEffect } from 'react';
import { Progress } from '@/components/ui/progress';

interface ProgressDisplayProps {
  value: number;
  label: string;
}

export const ProgressDisplay: React.FC<ProgressDisplayProps> = ({ value, label }) => {
  const [animatedValue, setAnimatedValue] = useState(0);

  useEffect(() => {
    // Animate to the new value whenever the prop changes.
    // The initial jump from 0 is instant for immediate feedback.
    const timeout = setTimeout(() => setAnimatedValue(value), animatedValue === 0 ? 0 : 100);
    return () => clearTimeout(timeout);
  }, [value]);

  return (
    <div className="space-y-2 my-4">
      <div className="flex justify-between text-sm text-muted-foreground px-1">
        <span>{label}</span>
        <span>{Math.round(value)}%</span>
      </div>
      <Progress 
        value={animatedValue} 
        className="w-full h-2 [&>div]:transition-all [&>div]:duration-500 [&>div]:ease-out" 
      />
    </div>
  );
};