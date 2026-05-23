export interface BreadcrumbsProps {
  segments: string[];
  banner?: string | null;
}

export function Breadcrumbs({ segments, banner }: BreadcrumbsProps) {
  return (
    <div className="breadcrumbs">
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1;
        return (
          <span key={`${seg}-${i}`} className="flex items-center gap-1.5">
            <span className={isLast ? "breadcrumbs__last" : undefined}>{seg}</span>
            {!isLast ? <span>/</span> : null}
          </span>
        );
      })}
      {banner ? <span className="breadcrumbs__agent-banner">{banner}</span> : null}
    </div>
  );
}
