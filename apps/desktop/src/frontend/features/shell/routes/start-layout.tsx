import { lazy } from "react";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { withSuspense } from "@/routes/with-suspense";

const AppLayout = lazy(() =>
  import("../components/layout/AppLayout").then((module) => ({ default: module.AppLayout }))
);
const Shell = () => (
  <AppLayout>
    <Outlet />
  </AppLayout>
);

export const Route = createFileRoute("/_app")({ component: withSuspense(Shell) });
