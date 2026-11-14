import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TestRenderer, { act } from "react-test-renderer";
import { test } from "vitest";

import type { Json, ResolvedNode } from "gik-kernel";

import { FileDownload, fileDownloadDefinition } from "../src/primitives/file-download";
import { FileInput, fileInputDefinition } from "../src/primitives/file-input";
import { FileList, fileListDefinition } from "../src/primitives/file-list";
import { primitiveComponentDefinitions, primitiveComponentViews } from "../src/primitives/registry";

function node(capability: string, props: Record<string, unknown>): ResolvedNode {
  return { id: `${capability}-test`, capability, props: props as Record<string, Json>, visible: true, fallback: false, children: [] };
}

const emit = () => undefined;

test("file primitives expose closed declarative contracts", () => {
  assert.equal(fileInputDefinition.validate(fileInputDefinition.materializeTrial().props).ok, true);
  assert.equal(fileDownloadDefinition.validate(fileDownloadDefinition.materializeTrial().props).ok, true);
  assert.equal(fileListDefinition.validate(fileListDefinition.materializeTrial().props).ok, true);
  assert.equal(fileInputDefinition.validate({ unknown: true }).ok, false);
  assert.deepEqual(fileInputDefinition.events, ["select"]);
  assert.deepEqual(fileDownloadDefinition.events, ["download"]);
  assert.deepEqual(fileListDefinition.events, ["select", "download", "remove"]);
  assert.deepEqual(
    (fileInputDefinition.eventContracts.select.payloadSchema.properties as Record<string, { items?: { properties?: Record<string, unknown> } }>).files.items?.properties?.encoding,
    { enum: ["text", "base64"] },
  );
  assert.equal(fileListDefinition.validate({ files: [{ size: "large" }] }).ok, false);
});

test("file primitives are registered in the public primitive catalog", () => {
  for (const id of ["file-input", "file-download", "file-list"] as const) {
    assert.ok(id in primitiveComponentViews);
    assert.ok(id in primitiveComponentDefinitions);
  }
});

test("file input renders button and dropzone variants", () => {
  const button = renderToStaticMarkup(<FileInput node={node("primitive:file-input", { label: "Import", accept: ".json", readAs: "text" })} emit={emit} children={undefined} />);
  const dropzone = renderToStaticMarkup(<FileInput node={node("primitive:file-input", { label: "Drop files", variant: "dropzone", multiple: true })} emit={emit} children={undefined} />);

  assert.match(button, /type="file"/);
  assert.match(button, /accept="\.json"/);
  assert.match(button, />Import</);
  assert.match(dropzone, /role="button"/);
  assert.match(dropzone, /multiple/);
});

test.each(["button", "dropzone"])("file input rejects an oversized batch before reading and permits a boundary-size retry: %s", async (variant) => {
  let reads = 0;
  const events: Record<string, unknown>[] = [];
  const file = (size: number) => {
    const selected = new File(["x".repeat(size)], `file-${size}.txt`, { type: "text/plain" });
    Object.defineProperty(selected, "text", { value: async () => { reads += 1; return "x".repeat(size); } });
    Object.defineProperty(selected, "arrayBuffer", { value: async () => { reads += 1; return new ArrayBuffer(size); } });
    return selected;
  };
  let renderer!: TestRenderer.ReactTestRenderer;
  const props = { variant, readAs: "text", multiple: true, maxFileSize: 100000 };
  const onSelect: React.ComponentProps<typeof FileInput>["emit"] = (_name, payload) => {
    if (payload) events.push(payload);
  };
  const select = async (files: File[]) => {
    await act(async () => {
      if (variant === "button") renderer.root.findByType("input").props.onChange({ currentTarget: { files } });
      else renderer.root.findByProps({ role: "button" }).props.onDrop({ preventDefault() {}, dataTransfer: { files } });
    });
  };
  await act(async () => {
    renderer = TestRenderer.create(<FileInput node={node("primitive:file-input", props)} emit={onSelect} children={undefined} />);
  });
  await select([file(100000)]);
  assert.equal(events.length, 1);
  assert.equal(reads, 1);
  await select([file(50000), file(100001)]);
  assert.equal(events.length, 1);
  assert.equal(reads, 1);
  assert.match(renderer.root.findByProps({ role: "alert" }).props.children, /at most 100000 bytes/);
  await act(async () => {
    renderer.update(<FileInput node={node("primitive:file-input", { ...props, readAs: "base64" })} emit={onSelect} children={undefined} />);
  });
  await select([file(100001)]);
  assert.equal(events.length, 1);
  assert.equal(reads, 1);
  await act(async () => {
    renderer.update(<FileInput node={node("primitive:file-input", props)} emit={onSelect} children={undefined} />);
  });
  await select([file(100000)]);
  assert.equal(events.length, 2);
  assert.equal(reads, 2);
  assert.throws(() => renderer.root.findByProps({ role: "alert" }));
  await act(async () => renderer.unmount());
});

test("file input surfaces read errors without emitting a selection", async () => {
  const selected = new File(["text"], "unreadable.txt");
  Object.defineProperty(selected, "text", { value: async () => { throw new Error("Read failed"); } });
  let emitted = false;
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<FileInput node={node("primitive:file-input", { readAs: "text" })} emit={() => { emitted = true; }} children={undefined} />);
  });
  await act(async () => renderer.root.findByType("input").props.onChange({ currentTarget: { files: [selected] } }));
  assert.equal(emitted, false);
  assert.match(renderer.root.findByProps({ role: "alert" }).props.children, /Could not read the selected file: Read failed/);
  await act(async () => renderer.unmount());
});

test("file download and list render committed file data", () => {
  const download = renderToStaticMarkup(<FileDownload node={node("primitive:file-download", { label: "Export JSON", filename: "sample.json", content: "{}", mediaType: "application/json" })} emit={emit} children={undefined} />);
  const list = renderToStaticMarkup(<FileList node={node("primitive:file-list", { files: [{ name: "report.pdf", size: 2048, url: "/report.pdf" }], removable: true })} emit={emit} children={undefined} />);

  assert.match(download, />Export JSON</);
  assert.match(list, /report\.pdf/);
  assert.match(list, /2\.0 KB/);
  assert.match(list, />Remove</);
});
