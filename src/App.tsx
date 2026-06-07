import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { Layout } from "./components/Layout";
import { AgentsPage } from "./pages/Agents";
import { DashboardPage } from "./pages/Dashboard";
import { OpsPage } from "./pages/Ops";
import { ProjectsPage } from "./pages/Projects";
import { ProjectViewPage } from "./pages/ProjectView";
import { SettingsPage } from "./pages/Settings";

// Live-updating by default: poll every few seconds and refetch when the tab
// regains focus, so board/story/activity changes (e.g. an agent working a story)
// show up without a manual refresh. Background tabs pause polling to save work.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 3_000,
      refetchInterval: 4_000,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: true,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:projectId" element={<Navigate to="board" replace />} />
            <Route path="/projects/:projectId/*" element={<ProjectViewPage />} />
            <Route path="/agents" element={<AgentsPage />} />
            <Route path="/ops" element={<OpsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster position="bottom-right" theme="dark" />
    </QueryClientProvider>
  );
}
