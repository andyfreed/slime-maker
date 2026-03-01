import type { ReactNode } from 'react';

interface GlassCardProps {
  children: ReactNode;
  header?: ReactNode;
  subtitle?: string;
  className?: string;
}

export function GlassCard({ children, header, subtitle, className = '' }: GlassCardProps) {
  return (
    <section className={`glass-card ${className}`}>
      {header && (
        <div className="glass-card-header">
          {typeof header === 'string' ? <h2 className="glass-card-title">{header}</h2> : header}
          {subtitle && <p className="glass-card-subtitle">{subtitle}</p>}
        </div>
      )}
      {children}
    </section>
  );
}
