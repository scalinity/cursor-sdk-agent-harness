import { RightTabs } from "./RightTabs.js";
import { Breadcrumbs } from "./Breadcrumbs.js";
import { EditorPlaceholder } from "./EditorPlaceholder.js";

export function RightPane() {
  return (
    <section className="right-pane">
      <RightTabs
        tabs={[
          { id: "placeholder", label: "no-file-open", active: true, agentEditing: false },
        ]}
      />
      <Breadcrumbs segments={["harness", "phase-08", "placeholder.ts"]} banner={null} />
      <EditorPlaceholder />
    </section>
  );
}
