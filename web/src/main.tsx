import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { Layout } from './components/Layout.tsx';
import { IndexPage } from './pages/IndexPage.tsx';
import { NotFound, NumberRedirect } from './pages/NotFound.tsx';
import { SongPage } from './pages/SongPage.tsx';
import './index.css';

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <IndexPage /> },
      // Canonical: /songs/42/because-he-lives. The slug is optional.
      { path: 'songs/:number/:slug?', element: <SongPage /> },
      // Short form: /42 jumps straight to hymn 42.
      { path: ':number', element: <NumberRedirect /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
