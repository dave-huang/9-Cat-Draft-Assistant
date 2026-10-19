export function InjuryReserveSlots({ count }: { count: number }) {
  if (!count) return null;
  return (
    <div className="mt-3 border-t pt-3" data-testid="panel-injury-reserves">
      <div className="flex flex-wrap items-center gap-2">
        {Array.from({ length: count }, (_, i) => <span key={i} className="rounded border border-dashed px-2 py-1 font-mono text-xs">IL <span className="text-muted-foreground">reserve</span></span>)}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">{count} injury reserve spots · not extra draft picks. Players on IL do not create additional draft capacity here.</p>
    </div>
  );
}
