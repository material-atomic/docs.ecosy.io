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
