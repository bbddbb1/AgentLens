import { ReactNode } from 'react';

interface GlassPanelProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  hoverable?: boolean;
}

export function GlassPanel({ children, className = '', onClick, hoverable = false }: GlassPanelProps) {
  return (
    <div
      onClick={onClick}
      className={`rounded-xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] backdrop-blur-md p-3 shadow-sm ${
        hoverable ? 'hover:border-[rgba(255,255,255,0.12)] hover:bg-[rgba(255,255,255,0.04)] cursor-pointer transition-all' : ''
      } ${className}`}
    >
      {children}
    </div>
  );
}
