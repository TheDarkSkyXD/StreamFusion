import { Outlet, useNavigate } from "@tanstack/react-router";
import { AppProviders } from "@/providers/app-providers";
import "../i18n";

export default function DesktopRuntime() {
  const navigate = useNavigate();
  return (
    <AppProviders navigate={navigate}>
      <Outlet />
    </AppProviders>
  );
}
