import React from "react";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  makeStyles,
  mergeClasses,
  tokens,
  type ButtonProps,
} from "@fluentui/react-components";
import {
  ChevronLeftRegular,
  ChevronRightRegular,
  DismissRegular,
} from "@fluentui/react-icons";
import type { Json } from "@gik/kernel";
import { runDeclarativeValidators } from "@gik/evaluators";
import { readProps, type ProjectionView } from "@gik/react";

import {
  defineComponent,
  eventContract,
  trialNode,
  type ComponentDescription,
  type ComponentValidationReport,
} from "../../shared/definition";
import { componentRootProps, withComponentStylePropsSchema } from "../../shared/component";

export const PANE_WITH_TRIGGER_VARIANTS = ["drawer", "floating-drawer", "dialog-modal"] as const;
export type PaneWithTriggerVariant = typeof PANE_WITH_TRIGGER_VARIANTS[number];

const FAB_POSITIONS = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;
const TRIGGER_APPEARANCES = ["primary", "secondary", "subtle", "transparent", "outline"] as const;
type TriggerAppearance = Extract<ButtonProps["appearance"], typeof TRIGGER_APPEARANCES[number]>;

const useStyles = makeStyles({
  root: {
    position: "fixed",
    top: tokens.spacingVerticalS,
    bottom: tokens.spacingVerticalS,
    zIndex: 1040,
    display: "flex",
    alignItems: "flex-start",
    pointerEvents: "none",
  },
  left: { left: tokens.spacingHorizontalS },
  right: { right: tokens.spacingHorizontalS, flexDirection: "row-reverse" },
  floatingRoot: { pointerEvents: "auto" },
  toggle: {
    zIndex: 2,
    pointerEvents: "auto",
    boxShadow: tokens.shadow8,
  },
  bottom: { alignSelf: "flex-end" },
  edgeHandle: {
    zIndex: 2,
    width: "24px",
    minWidth: "24px",
    height: "72px",
    padding: 0,
    borderRadius: 0,
    boxShadow: tokens.shadow16,
    pointerEvents: "auto",
  },
  edgeHandleLeft: {
    borderTopRightRadius: tokens.borderRadiusLarge,
    borderBottomRightRadius: tokens.borderRadiusLarge,
  },
  edgeHandleRight: {
    borderTopLeftRadius: tokens.borderRadiusLarge,
    borderBottomLeftRadius: tokens.borderRadiusLarge,
  },
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 0,
    backgroundColor: tokens.colorBackgroundOverlay,
    pointerEvents: "none",
  },
  panel: {
    position: "relative",
    zIndex: 1,
    display: "flex",
    flexDirection: "column",
    width: "min(var(--gik-drawer-width), calc(100vw - 4.5rem))",
    height: "100%",
    minWidth: 0,
    overflow: "auto",
    boxSizing: "border-box",
    padding: tokens.spacingHorizontalL,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow64,
    pointerEvents: "auto",
  },
  floatingHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalM,
    marginBottom: tokens.spacingVerticalM,
  },
  floatingTitle: {
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
  },
});

export const PaneWithTrigger: ProjectionView = ({ node, emit, children }) => {
  const styles = useStyles();
  const props = readProps(node);
  const variant = props.str("variant", "drawer") as PaneWithTriggerVariant;
  const position = props.str("fabPosition", "top-left");
  const isRight = position.endsWith("-right");
  const isBottom = position.startsWith("bottom-");
  const controlled = typeof node.props.open === "boolean";
  const [localOpen, setLocalOpen] = React.useState(() =>
    typeof node.props.defaultOpen === "boolean"
      ? node.props.defaultOpen
      : variant === "floating-drawer");
  const open = controlled ? props.bool("open") : localOpen;
  const title = props.str("title", "Panel");
  const openLabel = props.str("openLabel", `Open ${title}`);
  const closeLabel = props.str("closeLabel", `Close ${title}`);
  const triggerLabel = props.str("triggerLabel", openLabel);
  const authoredWidthPercent = typeof node.props.panelWidthPercent === "number"
    ? node.props.panelWidthPercent
    : 80;
  const widthPercent = Math.min(80, Math.max(20, authoredWidthPercent));
  const authoredWidthPx = typeof node.props.panelWidthPx === "number"
    ? node.props.panelWidthPx
    : undefined;
  const panelWidth = authoredWidthPx === undefined
    ? `${widthPercent}vw`
    : `${Math.min(720, Math.max(240, authoredWidthPx))}px`;
  const rootProps = componentRootProps(node);
  const setOpen = (nextOpen: boolean) => {
    if (!controlled) setLocalOpen(nextOpen);
    void emit("openChange", { open: nextOpen });
  };

  if (variant === "dialog-modal") {
    return (
      <Dialog
        open={open}
        modalType="modal"
        onOpenChange={(_event, data) => setOpen(data.open)}
      >
        <DialogTrigger disableButtonEnhancement>
          <Button appearance={props.str("triggerAppearance") as TriggerAppearance || undefined}>
            {triggerLabel}
          </Button>
        </DialogTrigger>
        <DialogSurface
          {...rootProps}
          aria-label={props.str("ariaLabel", title)}
        >
          <DialogBody>
            <DialogTitle
              action={(
                <DialogTrigger action="close" disableButtonEnhancement>
                  <Button appearance="subtle" icon={<DismissRegular />} aria-label={closeLabel} />
                </DialogTrigger>
              )}
            >
              {title}
            </DialogTitle>
            <DialogContent>{children}</DialogContent>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    );
  }

  const toggleIcon = isRight === open ? <ChevronRightRegular /> : <ChevronLeftRegular />;
  const toggle = variant === "floating-drawer"
    ? (
        <Button
          className={mergeClasses(
            styles.edgeHandle,
            isRight ? styles.edgeHandleRight : styles.edgeHandleLeft,
            isBottom && styles.bottom,
          )}
          appearance="primary"
          icon={toggleIcon}
          aria-label={openLabel}
          title={openLabel}
          aria-expanded={false}
          onClick={() => setOpen(true)}
        />
      )
    : (
        <Button
          className={mergeClasses(styles.toggle, isBottom && styles.bottom)}
          appearance="primary"
          shape="circular"
          size="large"
          icon={toggleIcon}
          aria-label={open ? closeLabel : openLabel}
          title={open ? closeLabel : openLabel}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        />
      );

  return (
    <aside
      {...rootProps}
      className={mergeClasses(
        styles.root,
        isRight ? styles.right : styles.left,
        variant === "floating-drawer" && styles.floatingRoot,
        rootProps.className,
      )}
      aria-label={props.str("ariaLabel", title)}
    >
      {!open ? toggle : variant === "drawer" ? toggle : null}
      {open ? (
        <>
          {variant === "drawer"
            ? <div className={styles.backdrop} data-pane-backdrop aria-hidden="true" />
            : null}
          <div
            className={styles.panel}
            style={{ "--gik-drawer-width": panelWidth } as React.CSSProperties}
          >
            {variant === "floating-drawer" ? (
              <div className={styles.floatingHeader}>
                <span className={styles.floatingTitle}>{title}</span>
                <Button
                  appearance="subtle"
                  size="small"
                  icon={isRight ? <ChevronRightRegular /> : <ChevronLeftRegular />}
                  aria-label={closeLabel}
                  title={closeLabel}
                  onClick={() => setOpen(false)}
                />
              </div>
            ) : null}
            {children}
          </div>
        </>
      ) : null}
    </aside>
  );
};

const schema = withComponentStylePropsSchema({
  type: "object",
  additionalProperties: false,
  required: ["variant", "title"],
  properties: {
    variant: { enum: PANE_WITH_TRIGGER_VARIANTS },
    open: { type: "boolean" },
    defaultOpen: { type: "boolean" },
    fabPosition: { enum: FAB_POSITIONS },
    ariaLabel: { type: "string", minLength: 1 },
    title: { type: "string", minLength: 1 },
    openLabel: { type: "string", minLength: 1 },
    closeLabel: { type: "string", minLength: 1 },
    triggerLabel: { type: "string", minLength: 1 },
    triggerAppearance: { type: "string", enum: TRIGGER_APPEARANCES },
    panelWidthPercent: { type: "number", minimum: 20, maximum: 80 },
    panelWidthPx: { type: "number", minimum: 240, maximum: 720 },
  },
  allOf: [
    {
      if: { properties: { variant: { const: "dialog-modal" } }, required: ["variant"] },
      then: { required: ["triggerLabel", "closeLabel"] },
    },
  ],
} as const);

const description: ComponentDescription = {
  capability: "primitive:pane-with-trigger",
  summary: "Reveals authored children in a trigger-controlled drawer or modal dialog.",
  slots: ["children"],
  events: ["openChange"],
  eventContracts: {
    openChange: eventContract("The drawer open state changed; handling this event is optional unless open is controlled.", { open: { type: "boolean" } }),
  },
  semanticTokens: [],
  defaultVariant: "drawer",
  variants: [
    {
      value: "drawer",
      summary: "Composes a corner-pinned circular toggle with a dimmed full-height overlay panel.",
      useWhen: ["Secondary tools should visually suppress the workspace while open"],
    },
    {
      value: "floating-drawer",
      summary: "Composes a non-dimming floating panel with an internal hide action and a directional edge handle when closed.",
      useWhen: ["Controls should open by default alongside a visible, interactive workspace"],
    },
    {
      value: "dialog-modal",
      summary: "Composes a labeled trigger with a modal dialog, title, and close action.",
      useWhen: ["A focused temporary workflow must interrupt the current surface"],
    },
  ],
  authoring: {
    useWhen: ["Authored children belong in a temporary surface opened by its own trigger"],
    avoidWhen: ["Content should permanently remain in the page flow"],
    rules: [
      "Choose drawer when the open pane should visually suppress the workspace",
      "Choose floating-drawer when controls and the workspace must remain visible together",
      "Floating-drawer opens by default; set defaultOpen only when it should initially be closed",
      "Floating-drawer derives its edge and hide direction from fabPosition",
      "Choose dialog-modal for a focused modal workflow",
      "Prefer local pane state; use defaultOpen only to choose its initial state",
      "Bind open only when application behavior or cross-Cell coordination must control the drawer",
      "Handle openChange only when the application needs to observe or control pane state",
      "Place all authored children inside the pane",
      "For drawer and floating-drawer, choose the toggle corner with fabPosition",
      "Use panelWidthPx for a stable pane width or panelWidthPercent for a viewport-relative drawer width; do not provide both",
      "For dialog-modal, provide triggerLabel and closeLabel",
      "Provide concise accessible labels for both variants",
    ],
  },
};

export function validatePaneWithTrigger(props: unknown): ComponentValidationReport {
  return runDeclarativeValidators([{
    kind: "ajv-schema",
    schema,
    message: "Invalid primitive:pane-with-trigger props",
    code: "primitive-pane-with-trigger-schema",
  }], props as Json);
}

export function materializePaneWithTriggerTrial() {
  return trialNode("primitive:pane-with-trigger", {
    variant: "drawer",
    defaultOpen: true,
    fabPosition: "top-left",
    title: "Source reports",
    triggerLabel: "Open source reports",
    closeLabel: "Close source reports",
    panelWidthPercent: 80,
  });
}

export const paneWithTriggerDefinition = defineComponent({
  description,
  version: "1.0.0",
  component: PaneWithTrigger,
  getSchema: () => schema as unknown as Record<string, unknown>,
  validate: validatePaneWithTrigger,
  materializeTrial: materializePaneWithTriggerTrial,
});