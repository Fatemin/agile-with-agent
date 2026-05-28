import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { Layout } from "./components/Layout";
import { AgentsPage } from "./pages/Agents";
import { DashboardPage } from "./pages/Dashboard";
import { ProjectsPage } from "./pages/Projects";
import { ProjectViewPage } from "./pages/ProjectView";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 10_000 } },
});

function ScrollPage({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 overflow-y-auto">{children}</div>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<ScrollPage><DashboardPage /></ScrollPage>} />
            <Route path="/projects" element={<ScrollPage><ProjectsPage /></ScrollPage>} />
            <Route path="/projects/:projectId/*" element={<ProjectViewPage />} />
            <Route path="/agents" element={<ScrollPage><AgentsPage /></ScrollPage>} />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster position="bottom-right" />
    </QueryClientProvider>
  );
}
