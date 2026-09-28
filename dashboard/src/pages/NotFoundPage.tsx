import { Link } from 'react-router-dom';
import { NotFoundIllustration } from '../components/ui/Illustrations';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

export function NotFoundPage({ what = 'page' }: { what?: 'page' | 'metro' }) {
  useDocumentTitle('Not found');
  return (
    <div className="card flex flex-col items-center gap-4 px-6 py-14 text-center">
      <NotFoundIllustration />
      <div>
        <h1 className="text-xl font-semibold">{what === 'metro' ? 'Metro not found' : 'Page not found'}</h1>
        <p className="mt-1 text-sm text-text-3">{what === 'metro' ? "We don't track a metro at that address." : "There's nothing at this address."}</p>
      </div>
      <div className="flex gap-2">
        <Link to="/metros" className="btn btn-primary">
          Browse all metros
        </Link>
        <Link to="/" className="btn">
          Overview
        </Link>
      </div>
    </div>
  );
}
