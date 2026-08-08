import { createFileRoute } from "@tanstack/react-router";
import { KitchenScreen } from "#/components/kitchen-screen";

const Kitchen = () => <KitchenScreen />;

export const Route = createFileRoute("/kitchen")({ component: Kitchen });
