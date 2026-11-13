import type { ServiceHost } from "gik-controlface/services";

/** Applications map action IDs to trusted handlers; Blueprint data never supplies executable actions. */
export async function renderProviderSettings(
  container: HTMLElement,
  getHost: () => ServiceHost,
  serviceIds: string[],
  actions: Readonly<Record<string, (serviceId: string, input: Record<string, string>) => void | Promise<void>>>,
  selection: {
    isEnabled(serviceId: string): boolean;
    setEnabled(serviceId: string, enabled: boolean): void | Promise<void>;
  },
) {
  const host = getHost();
  if (!host.describeServiceSetup) throw new Error("Host does not support provider setup discovery");
  container.replaceChildren();
  for (const serviceId of serviceIds) {
    const section = document.createElement("section");
    container.append(section);
    const label = document.createElement("label");
    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.checked = selection.isEnabled(serviceId);
    label.append(enabled, ` Enable ${serviceId}`);
    const failure = document.createElement("p");
    section.append(label, failure);
    enabled.addEventListener("change", () => {
      enabled.disabled = true;
      try {
        void Promise.resolve(selection.setEnabled(serviceId, enabled.checked)).then(
          () => renderProviderSettings(container, getHost, serviceIds, actions, selection),
        ).catch((error: unknown) => {
          failure.textContent = error instanceof Error ? error.message : String(error);
          enabled.checked = selection.isEnabled(serviceId);
          enabled.disabled = false;
        });
      } catch (error) {
        failure.textContent = error instanceof Error ? error.message : String(error);
        enabled.checked = selection.isEnabled(serviceId);
        enabled.disabled = false;
      }
    });
    if (!enabled.checked) continue;
    const report = await host.describeServiceSetup(serviceId);
    const title = document.createElement("h2");
    title.textContent = `${serviceId}: ${report.ready ? "ready" : "setup required"}`;
    section.append(title);
    const schema = host.describeKinds().find(({ manifest }) => manifest.id === report.kind)?.manifest.configSchema;
    const description = document.createElement("pre");
    description.textContent = JSON.stringify({ configSchema: schema, validation: report.validation }, null, 2);
    section.append(description);
    for (const { requirement, status } of report.dependencies) {
      const notice = document.createElement("p");
      notice.textContent = `${requirement.title}: ${status.state}${status.state === "ready" ? "" : ` - ${status.message}`}`;
      section.append(notice);
      for (const action of status.actions ?? []) {
        const handler = actions[action.id];
        if (!handler) throw new Error(`No trusted setup handler for '${action.id}'`);
        const form = document.createElement("form");
        const fields: HTMLInputElement[] = [];
        const properties = action.inputSchema?.properties;
        if (properties !== undefined) {
          if (!properties || typeof properties !== "object" || Array.isArray(properties)) throw new Error("Invalid setup action properties");
          for (const [name, value] of Object.entries(properties)) {
            if (!value || typeof value !== "object" || !("type" in value) || value.type !== "string") {
              throw new Error("This example supports only string setup fields; hosts must render other schemas explicitly");
            }
            const label = document.createElement("label");
            label.textContent = name;
            const input = document.createElement("input");
            input.name = name;
            input.type = "writeOnly" in value && value.writeOnly === true ? "password" : "text";
            input.autocomplete = input.type === "password" ? "off" : "on";
            label.append(input);
            form.append(label);
            fields.push(input);
          }
        }
        const button = document.createElement("button");
        button.type = "submit";
        button.textContent = action.title;
        form.append(button);
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          button.disabled = true;
          const input = Object.fromEntries(fields.map((field) => [field.name, field.value]));
          for (const field of fields) field.value = "";
          // Invoke immediately so browser OAuth handlers retain the user gesture.
          try {
            void Promise.resolve(handler(serviceId, input)).then(
              () => renderProviderSettings(container, getHost, serviceIds, actions, selection),
            ).catch((error: unknown) => {
              notice.textContent = error instanceof Error ? error.message : String(error);
              button.disabled = false;
            });
          } catch (error) {
            notice.textContent = error instanceof Error ? error.message : String(error);
            button.disabled = false;
          }
        });
        section.append(form);
      }
    }
    container.append(section);
  }
}
