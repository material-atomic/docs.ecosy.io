export const dynamic = "force-static";
/* Without this line, vinext's response for this page carries
   cache-control: no-store, and the prerender step reads "no-store" as
   dynamic and skips the page — the build still exits 0, with no warning,
   and the page is simply absent from dist/client (measured on vinext
   1.0.0-beta.8, task 0063 mục 2.4/3.1). */

import { GroupPage } from "@/components/GroupPage";

export const metadata = {
  title: "Packages — ecosy",
  description: "Packages for building an application. Each one stands alone.",
};

export default function Packages() {
  return (
    <GroupPage
      type="module"
      title="Packages"
      lead="Things you install into an application. Most carry no dependencies at all; the ones that do depend only on another package here, and say so on their own page."
    />
  );
}
