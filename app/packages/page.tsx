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
