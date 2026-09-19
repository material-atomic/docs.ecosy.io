export const dynamic = "force-static";
/* Without this line, vinext's response for this page carries
   cache-control: no-store, and the prerender step reads "no-store" as
   dynamic and skips the page — the build still exits 0, with no warning,
   and the page is simply absent from dist/client (measured on vinext
   1.0.0-beta.8, task 0063 mục 2.4/3.1). */

import { GroupPage } from "@/components/GroupPage";

export const metadata = {
  title: "Frameworks — ecosy",
  description: "Frameworks built on the ecosy packages.",
};

export default function Frameworks() {
  return (
    <GroupPage
      type="framework"
      title="Frameworks"
      lead="Built on the packages rather than beside them. You adopt one of these for a whole application, where a package you adopt for one job."
    />
  );
}
