/**
 * Generic skeleton loader for list views (inbox, queue, calendar).
 * Shows `count` pulsing rows while data is loading.
 */
export function SkeletonList({ count = 8 }: { count?: number }) {
  return (
    <div>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="thread-skeleton-row">
          <span className="thread-skeleton thread-skeleton-avatar" />
          <span className="thread-skeleton-lines">
            <span className="thread-skeleton thread-skeleton-line-medium" />
            <span className="thread-skeleton thread-skeleton-line-short" />
          </span>
          <span className="thread-skeleton thread-skeleton-date" />
        </div>
      ))}
    </div>
  );
}
