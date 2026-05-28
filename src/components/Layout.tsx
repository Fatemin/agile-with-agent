import { Outlet } from "react-router-dom";
import { Header } from "./Header";

export function Layout() {
  return (
    <div className="h-screen overflow-hidden bg-surface-primary flex flex-col">
      <Header />
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        <Outlet />
      </div>
    </div>
  );
}
