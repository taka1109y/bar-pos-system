import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import POSPage from './pages/POSPage';
import BoardPage from './pages/BoardPage';
import TablePage from './pages/TablePage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<POSPage />} />
          <Route path="/board" element={<BoardPage />} />
          <Route path="/table/:tableId" element={<TablePage />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
