import { Outlet } from "react-router-dom";
import { Header } from "./Header";

export function Layout() {
  return (
    <div className="h-screen bg-surface-primary flex flex-col select-none antialiased">
      <Header />
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        <Outlet />
      </div>
      <footer className="shrink-0 sticky bottom-0 border-t border-border bg-surface-secondary/40 py-2.5 text-center font-mono text-[10px] text-content-tertiary tracking-wider uppercase select-none z-10">
        Agile with Agent&nbsp;•&nbsp;Developer Runtime&nbsp;•&nbsp;AI Context Streams
      </footer>
    </div>
  );
}
