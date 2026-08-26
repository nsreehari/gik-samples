import React from "react";
import {
  Card,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  Text,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import {
  INFINITE_CANVAS_THEME_COLORS,
  InfiniteCanvas,
  type InfiniteCanvasNodeDescriptor,
  type InfiniteCanvasPort,
} from "@gik/components/primitives";
import { Handle } from "@xyflow/react";

import type {
  ScenarioDataFlowModel,
  ScenarioDataFlowNode,
  ScenarioDataFlowPort,
  ScenarioDataFlowSource,
} from "../../scenarios/scenario-data-flow";

const canvasThemeVariables = {
  "--xy-edge-stroke": INFINITE_CANVAS_THEME_COLORS.edge,
  "--xy-edge-stroke-selected": INFINITE_CANVAS_THEME_COLORS.accent,
  "--xy-connectionline-stroke": INFINITE_CANVAS_THEME_COLORS.accent,
  "--xy-background-color": tokens.colorNeutralBackground2,
  "--xy-background-pattern-color": INFINITE_CANVAS_THEME_COLORS.backgroundDot,
  "--xy-minimap-background-color": tokens.colorNeutralBackground1,
  "--xy-minimap-mask-background-color": tokens.colorNeutralBackgroundAlpha2,
  "--xy-minimap-node-background-color": tokens.colorNeutralBackground3,
  "--xy-minimap-node-stroke-color": tokens.colorNeutralStroke1,
} as React.CSSProperties;

const useStyles = makeStyles({
  root: {
    width: "100%",
    height: "100%",
    minWidth: 0,
    minHeight: 0,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  viewport: { width: "100%", height: "100%" },
  node: {
    width: "100%",
    minWidth: 0,
    padding: tokens.spacingHorizontalM,
    borderTop: `3px solid ${tokens.colorNeutralStroke1}`,
    boxShadow: tokens.shadow4,
  },
  nodeAccent: { borderTopColor: tokens.colorBrandBackground },
  nodeDanger: { borderTopColor: tokens.colorPaletteRedBackground3 },
  title: { display: "block", overflowWrap: "anywhere" },
  sources: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalXS,
    marginTop: tokens.spacingVerticalS,
  },
  source: {
    display: "inline-flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    minWidth: 0,
    padding: `${tokens.spacingVerticalXXS} ${tokens.spacingHorizontalS}`,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusCircular,
    color: tokens.colorNeutralForeground2,
    backgroundColor: tokens.colorNeutralBackground1,
    font: "inherit",
    fontSize: tokens.fontSizeBase200,
    whiteSpace: "nowrap",
    cursor: "pointer",
  },
  dot: {
    width: "7px",
    height: "7px",
    flex: "0 0 auto",
    borderRadius: "50%",
    backgroundColor: tokens.colorNeutralForeground4,
  },
  dotRunning: { backgroundColor: tokens.colorBrandBackground },
  dotQueued: { backgroundColor: tokens.colorPaletteDarkOrangeBackground3 },
  dotCompleted: { backgroundColor: tokens.colorPaletteGreenBackground3 },
  dotFailed: { backgroundColor: tokens.colorPaletteRedBackground3 },
  port: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    width: 0,
    minHeight: "25px",
    zIndex: 2,
  },
  portButton: {
    position: "absolute",
    width: "18px",
    height: "18px",
    padding: 0,
    border: 0,
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: "transparent",
    cursor: "pointer",
    zIndex: 3,
  },
  inputPortButton: { right: "-9px" },
  outputPortButton: { left: "-9px" },
  handle: {
    width: "8px",
    height: "8px",
    border: `2px solid ${tokens.colorNeutralBackground1}`,
    backgroundColor: tokens.colorBrandBackground,
    boxShadow: `0 0 0 1px ${tokens.colorBrandBackground}`,
    pointerEvents: "none",
  },
  leftHandle: { left: "-5px" },
  rightHandle: { right: "-5px", left: "auto" },
  popover: { maxWidth: "26rem" },
  popoverTitle: {
    display: "block",
    marginBottom: tokens.spacingVerticalXS,
    fontFamily: tokens.fontFamilyMonospace,
  },
  value: {
    maxWidth: "24rem",
    maxHeight: "18rem",
    margin: 0,
    overflow: "auto",
    color: tokens.colorNeutralForeground1,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
});

function statusLabel(status: ScenarioDataFlowSource["status"]): string {
  switch (status) {
    case "running": return "Running";
    case "queued": return "Queued";
    case "completed": return "Completed";
    case "failed": return "Last request failed";
    default: return "Idle";
  }
}

function dotClass(styles: ReturnType<typeof useStyles>, status: ScenarioDataFlowSource["status"]): string {
  return mergeClasses(
    styles.dot,
    status === "running" && styles.dotRunning,
    status === "queued" && styles.dotQueued,
    status === "completed" && styles.dotCompleted,
    status === "failed" && styles.dotFailed,
  );
}

function formattedValue(port: ScenarioDataFlowPort): string {
  if (!port.hasValue) return "No current value";
  return JSON.stringify(port.value, null, 2) ?? String(port.value);
}

function initialPositions(model: ScenarioDataFlowModel): Map<string, { x: number; y: number }> {
  const providers = new Map<string, string[]>();
  for (const node of model.nodes) {
    for (const port of model.nodePorts[node.id]?.right ?? []) {
      providers.set(port.token, [...(providers.get(port.token) ?? []), node.id]);
    }
  }
  const depths = new Map<string, number>();
  const depthOf = (nodeId: string, visiting: ReadonlySet<string>): number => {
    const known = depths.get(nodeId);
    if (known !== undefined) return known;
    if (visiting.has(nodeId)) return 0;
    const nextVisiting = new Set(visiting).add(nodeId);
    const dependencies = (model.nodePorts[nodeId]?.left ?? [])
      .flatMap((port) => providers.get(port.token) ?? [])
      .filter((providerId) => providerId !== nodeId);
    const depth = dependencies.length > 0
      ? Math.max(...dependencies.map((providerId) => depthOf(providerId, nextVisiting))) + 1
      : 0;
    depths.set(nodeId, depth);
    return depth;
  };
  const rowsByDepth = new Map<number, number>();
  const ordered = [...model.nodes].sort((left, right) =>
    depthOf(left.id, new Set()) - depthOf(right.id, new Set())
    || left.id.localeCompare(right.id));
  return new Map(ordered.map((node) => {
    const depth = depthOf(node.id, new Set());
    const row = rowsByDepth.get(depth) ?? 0;
    rowsByDepth.set(depth, row + 1);
    return [node.id, { x: depth * 380, y: row * 190 }];
  }));
}

export function ScenarioDataFlowCanvas({
  blueprintId,
  scenarioTitle,
  model,
}: {
  blueprintId: string;
  scenarioTitle: string;
  model: ScenarioDataFlowModel;
}): React.ReactElement {
  const styles = useStyles();
  const positions = React.useMemo(() => initialPositions(model), [model]);
  return (
    <section
      className={styles.root}
      style={canvasThemeVariables}
      aria-label={`${scenarioTitle} Blueprint Cell data flow`}
    >
      <InfiniteCanvas
        stateKey={`scenario-data-flow:v4:${blueprintId}`}
        nodes={model.nodes}
        nodePorts={model.nodePorts}
        miniMap
        controls
        selectionOnDrag={false}
        fitViewOptions={{ minZoom: 0.78, maxZoom: 1 }}
        viewportClassName={styles.viewport}
        getInitialNodePos={(descriptor) => positions.get(descriptor.id) ?? { x: 0, y: 0 }}
        renderNode={(descriptor: InfiniteCanvasNodeDescriptor) => {
          const cell = descriptor as ScenarioDataFlowNode;
          return (
            <Card
              appearance="outline"
              className={mergeClasses(
                styles.node,
                cell.tone === "accent" && styles.nodeAccent,
                cell.tone === "danger" && styles.nodeDanger,
              )}
            >
              <Text className={styles.title} weight="semibold" size={400}>{cell.title}</Text>
              {cell.sources.length > 0 ? (
                <div className={styles.sources}>
                  {cell.sources.map((source, index) => {
                    const detail = `${source.operation} · ${statusLabel(source.status)}`;
                    return (
                      <Popover key={`${source.service}:${source.operation}:${index}`} positioning="below-start" withArrow>
                        <Tooltip content={detail} relationship="description">
                          <PopoverTrigger disableButtonEnhancement>
                            <button className={mergeClasses(styles.source, "nodrag")} type="button">
                              <span className={dotClass(styles, source.status)} aria-hidden="true" />
                              <span>{source.service}</span>
                            </button>
                          </PopoverTrigger>
                        </Tooltip>
                        <PopoverSurface className={mergeClasses(styles.popover, "nodrag nowheel")}>
                          <Text weight="semibold">{source.service}</Text>
                          <Text block size={200}>{source.operation}</Text>
                          <Text block size={200}>{statusLabel(source.status)}</Text>
                        </PopoverSurface>
                      </Popover>
                    );
                  })}
                </div>
              ) : null}
            </Card>
          );
        }}
        renderNodePort={(canvasPort: InfiniteCanvasPort, context) => {
          const port = canvasPort as ScenarioDataFlowPort;
          const input = context.side === "left" || context.side === "top";
          return (
            <div className={styles.port}>
              <Popover positioning={input ? "before" : "after"} withArrow>
                <PopoverTrigger disableButtonEnhancement>
                  <button
                    className={mergeClasses(
                      styles.portButton,
                      input ? styles.inputPortButton : styles.outputPortButton,
                      "nodrag",
                    )}
                    type="button"
                    aria-label={`Inspect ${port.token}`}
                    title={port.token}
                  />
                </PopoverTrigger>
                <PopoverSurface className={mergeClasses(styles.popover, "nodrag nowheel")}>
                  <Text className={styles.popoverTitle} weight="semibold">{port.token}</Text>
                  <pre className={styles.value}>{formattedValue(port)}</pre>
                </PopoverSurface>
              </Popover>
              <Handle
                id={String(port.id)}
                type={input ? "target" : "source"}
                position={context.position}
                className={mergeClasses(
                  styles.handle,
                  input ? styles.leftHandle : styles.rightHandle,
                )}
                title={port.token}
              />
            </div>
          );
        }}
      />
    </section>
  );
}
