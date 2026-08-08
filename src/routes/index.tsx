import { createFileRoute } from "@tanstack/react-router";

const Home = () => {
  return (
    <main className="p-8">
      <h1 className="text-4xl font-bold">Self-service web checkout</h1>
    </main>
  );
};

export const Route = createFileRoute("/")({ component: Home });
