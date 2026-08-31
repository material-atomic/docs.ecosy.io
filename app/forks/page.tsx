import { GroupPage } from "@/components/GroupPage";

export const metadata = {
  title: "Forks — ecosy",
  description: "Forks carrying fixes upstream has not released.",
};

export default function Forks() {
  return (
    <GroupPage
      type="fork"
      title="Forks"
      lead="Someone else's package, carrying a fix upstream has not released. Each page points at the original documentation and lists only what differs — a fork that documents itself twice is a fork whose two copies drift apart."
    />
  );
}
