import { RouterProvider } from "@tanstack/react-router";
import { AppProviders } from "@/providers/app-providers";
import { router } from "@/routes/router";

export default function App() {
  return (
    <AppProviders navigate={router.navigate}>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
