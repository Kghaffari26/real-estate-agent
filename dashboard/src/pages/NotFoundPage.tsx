import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { AtlasChrome } from '../ui/AtlasChrome';

/** Nothing at this address: say so plainly and offer the two ways back in. */
export function NotFoundPage() {
  useDocumentTitle('Not found');
  return (
    <AtlasChrome>
      <div className="grid min-h-[70vh] place-items-center px-6 text-center">
        <div>
          <div className="mp-label">404</div>
          <h1 className="mp-display mt-2 text-[40px] leading-tight sm:text-[56px]">There’s nothing at this address.</h1>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link to="/explore" className="inline-flex h-11 items-center rounded-control bg-mp-accent px-5 text-sm font-medium text-mp-accent-ink no-underline">
              Browse the atlas
            </Link>
            <Link to="/" className="inline-flex h-11 items-center rounded-control border border-mp-line px-5 text-sm text-mp-ink no-underline">
              Today’s brief
            </Link>
          </div>
        </div>
      </div>
    </AtlasChrome>
  );
}
