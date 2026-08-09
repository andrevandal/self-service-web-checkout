import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { KioskClaimScreen } from "#/components/kiosk-claim-screen";
import { MenuScreen } from "#/components/menu-screen";
import { getKioskSession } from "#/lib/kiosk.functions";

const Home = () => {
  const session = Route.useLoaderData();
  const sessionQuery = useQuery({
    queryKey: ["kiosk-session"],
    queryFn: () => getKioskSession(),
    initialData: session,
  });

  if (!sessionQuery.data) {
    return <KioskClaimScreen />;
  }

  return <MenuScreen kioskId={sessionQuery.data.id} />;
};

export const Route = createFileRoute("/")({
  loader: () => getKioskSession(),
  component: Home,
});
