// The host-owned application switcher. It is deliberately shared by both host routes: selecting a
// Blueprint always sets `?b=<id>`, which is the one URL shape that opens the full single-Blueprint
// route, whether the user starts from the application root page or from another Blueprint.

import React from "react";
import { getSampleBlueprintCatalog } from "../../bootstrap/catalog/blueprint-catalog";

export function ApplicationSwitcher({ currentId }: { currentId?: string }): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const launches = [...getSampleBlueprintCatalog().launchProfiles]
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
  const selectBlueprint = (id: string) => {
    if (id === currentId) return;
    const url = new URL(window.location.href);
    url.searchParams.set("b", id);
    window.location.assign(url.toString());
  };
  const openScenarios = () => {
    const document = getSampleBlueprintCatalog().scenarios[currentId ?? ""];
    const scenario = document?.scenarios[0];
    const contextId = scenario?.contextPreset
      ?? scenario?.applicableContexts?.[0]
      ?? Object.keys(document?.contextPresets ?? {})[0];
    const url = new URL(`${import.meta.env.BASE_URL}scenarios/`, window.location.origin);
    if (document && scenario && contextId) {
      url.searchParams.set("b", document.blueprint);
      url.searchParams.set("scenario", scenario.id);
      url.searchParams.set("context", contextId);
    }
    window.location.assign(url.toString());
  };
  const openProvisioning = () => {
    window.location.assign(new URL(
      `${import.meta.env.BASE_URL}provisioning/`,
      window.location.origin,
    ).toString());
  };

  return (
    <div className="gx-switcher" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      {open ? (
        <div className="gx-switcher-panel" role="menu" aria-label="Switch application">
          <div className="gx-switcher-head">Application</div>
          {launches.map((launch) => {
            const selected = launch.blueprint === currentId;
            return (
              <button
                key={launch.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className={selected ? "gx-switcher-row selected" : "gx-switcher-row"}
                onClick={() => selectBlueprint(launch.blueprint)}
              >
                <span className="gx-switcher-check" aria-hidden="true">{selected ? "\u2713" : ""}</span>
                <span>{launch.label}</span>
              </button>
            );
          })}
          {Object.keys(getSampleBlueprintCatalog().scenarios).length > 0 ? (
            <button
              type="button"
              role="menuitem"
              className="gx-switcher-row"
              onClick={openScenarios}
            >
              <span className="gx-switcher-check" aria-hidden="true" />
              <span>Scenario Explorer</span>
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className="gx-switcher-row"
            onClick={openProvisioning}
          >
            <span className="gx-switcher-check" aria-hidden="true" />
            <span>Agent Provisioning</span>
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="gx-switcher-bubble"
          aria-label={currentId
            ? `Current application: ${currentId}. Hover to switch.`
            : "Open an application. Hover to browse."}
          onClick={() => setOpen(true)}
        >
          <span aria-hidden="true">&nbsp;</span>
        </button>
      )}
    </div>
  );
}
