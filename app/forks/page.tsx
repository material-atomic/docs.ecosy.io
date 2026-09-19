export const dynamic = "force-static";
/* Without this line, vinext's response for this page carries
   cache-control: no-store, and the prerender step reads "no-store" as
   dynamic and skips the page — the build still exits 0, with no warning,
   and the page is simply absent from dist/client (measured on vinext
   1.0.0-beta.8, task 0063 mục 2.4/3.1). */

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
