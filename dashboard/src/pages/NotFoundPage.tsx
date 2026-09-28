import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

export function NotFoundPage({ what = 'page' }: { what?: 'page' | 'metro' }) {
  useDocumentTitle('Not found');
  return (
    <div className="card space-y-2">
      <h1 className="text-xl font-semibold">{what === 'metro' ? 'Metro not found' : 'Page not found'}</h1>
      <p className="muted">{what === 'metro' ? "We don't track a metro at that address." : "There's nothing at this address."}</p>
      <p>
        <Link to="/metros">Browse all metros</Link> or go to the <Link to="/">overview</Link>.
      </p>
    </div>
  );
}
