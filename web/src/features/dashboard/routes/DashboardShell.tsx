// Placeholder — real dashboard cards land phase by phase (balances in P3,
// debts in P5, profit in P6, full dashboard in P7). Today's job is proving
// the layout shell (bottom nav, RTL flip, safe-area insets) before anyone
// reads real numbers off it. See phase-1.md §5.

export function DashboardShell() {
  return (
    <>
      <h1 className="page-title">Tableau de bord</h1>
      <p className="page-lede">
        Les cartes arrivent phase par phase. Aujourd&apos;hui, cette page prouve la coquille :
        navigation basse, retour ligne arabe, marges de sécurité iOS.
      </p>
      <div className="placeholder-card">Solde par devise · à venir en P3</div>
    </>
  );
}
