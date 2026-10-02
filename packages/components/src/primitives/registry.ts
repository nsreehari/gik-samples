import type { CapabilityDescriptor } from "gik-kernel";
import type { ProjectionView } from "gik-react";

import { AccessGate, accessGateDefinition } from "./access-gate";
import { Alert, alertDefinition } from "./alert";
import { Chart, chartDefinition } from "./chart";
import { CollectionBoard, collectionBoardDefinition } from "./collection-board";
import { Content, contentDefinition } from "./content";
import { ContainerPrimitive, containerDefinition } from "./container";
import { DateTime, dateTimeDefinition } from "./datetime";
import { PaneWithTrigger, paneWithTriggerDefinition } from "./pane-with-trigger";
import { EditableTable, editableTableDefinition } from "./editable-table";
import { FileDownload, fileDownloadDefinition } from "./file-download";
import { FileInput, fileInputDefinition } from "./file-input";
import { FileList, fileListDefinition } from "./file-list";
import { Form, formDefinition } from "./form";
import { Gantt, ganttDefinition } from "./gantt";
import { GraphDiagram, graphDiagramDefinition } from "./graph-diagram";
import { GrowingContainerPrimitive, growingContainerDefinition } from "./growing-container";
import { InfiniteCanvasPrimitive, infiniteCanvasDefinition } from "./infinite-canvas";
import { MathChallenge, mathChallengeDefinition } from "./math-challenge";
import { Markdown, markdownDefinition } from "./markdown";
import { List, listDefinition } from "./list";
import { Metric, metricDefinition } from "./metric";
import { Note, noteDefinition } from "./note";
import { Property, propertyDefinition } from "./property";
import { SourceViewer, sourceViewerDefinition } from "./source-viewer";
import { Table, tableDefinition } from "./table";
import { TimerButton, timerButtonDefinition } from "./timer-button";
import { TodoList, todoListDefinition } from "./todo-list";

export const primitiveComponentViews: Record<string, ProjectionView> = {
  "access-gate": AccessGate,
  alert: Alert,
  chart: Chart,
  "collection-board": CollectionBoard,
  content: Content,
  container: ContainerPrimitive,
  datetime: DateTime,
  "pane-with-trigger": PaneWithTrigger,
  "editable-table": EditableTable,
  "file-download": FileDownload,
  "file-input": FileInput,
  "file-list": FileList,
  form: Form,
  gantt: Gantt,
  "graph-diagram": GraphDiagram,
  "growing-container": GrowingContainerPrimitive,
  "infinite-canvas": InfiniteCanvasPrimitive,
  "math-challenge": MathChallenge,
  markdown: Markdown,
  list: List,
  metric: Metric,
  note: Note,
  property: Property,
  "source-viewer": SourceViewer,
  table: Table,
  "timer-button": TimerButton,
  "todo-list": TodoList,
};

export const primitiveComponentDefinitions = {
  "access-gate": accessGateDefinition,
  alert: alertDefinition,
  chart: chartDefinition,
  "collection-board": collectionBoardDefinition,
  content: contentDefinition,
  container: containerDefinition,
  datetime: dateTimeDefinition,
  "pane-with-trigger": paneWithTriggerDefinition,
  "editable-table": editableTableDefinition,
  "file-download": fileDownloadDefinition,
  "file-input": fileInputDefinition,
  "file-list": fileListDefinition,
  form: formDefinition,
  gantt: ganttDefinition,
  "graph-diagram": graphDiagramDefinition,
  "growing-container": growingContainerDefinition,
  "infinite-canvas": infiniteCanvasDefinition,
  "math-challenge": mathChallengeDefinition,
  markdown: markdownDefinition,
  list: listDefinition,
  metric: metricDefinition,
  note: noteDefinition,
  property: propertyDefinition,
  "source-viewer": sourceViewerDefinition,
  table: tableDefinition,
  "timer-button": timerButtonDefinition,
  "todo-list": todoListDefinition,
} as const;

export const primitiveComponentCapabilities: Record<string, CapabilityDescriptor> = Object.fromEntries(
  Object.entries(primitiveComponentDefinitions).map(([name, definition]) => [name, {
    propsSchema: definition.getSchema(),
    ...(definition.dataProp ? { dataProp: definition.dataProp } : {}),
    ...(definition.slots ? { slots: [...definition.slots] } : {}),
    emits: [...definition.events],
  }])
);