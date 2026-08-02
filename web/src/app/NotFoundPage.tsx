import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <>
      <h1 className="page-title">Page introuvable</h1>
      <p className="page-lede">Cette adresse n&apos;existe pas dans l&apos;application.</p>
      <Link to="/">Retour au tableau</Link>
    </>
  );
}
