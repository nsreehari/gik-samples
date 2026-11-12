import React from "react";
import { Link, Title1, makeStyles, tokens } from "@fluentui/react-components";
import type { Meta, StoryObj } from "@storybook/react-vite";

const useStyles = makeStyles({
  page: {
    maxWidth: "800px",
    margin: "0 auto",
    display: "grid",
    gap: tokens.spacingVerticalL,
  },
  links: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalL,
  },
});

function Introduction() {
  const styles = useStyles();
  return (
    <article className={styles.page}>
      <Title1 as="h1">GIK Components workbench</Title1>
      <p>
        Explore individual components, their declared props, presentation variants, and emitted
        events. Components render data and emit intents; Blueprint Cells own application behavior,
        and hosts authorize external work.
      </p>
      <p>
        Choose a catalog in the sidebar. Its stories show materialized trial data and compact or
        standard presentation. Register only the projection providers your application uses.
      </p>
      <nav className={styles.links} aria-label="GIK resources">
        <Link href="../docs/" target="_top">Documentation hub</Link>
        <Link href="../getting-started/" target="_top">Build a sample app</Link>
        <Link href="../" target="_top">Blueprint Studio</Link>
        <Link href="../vendor/" target="_top">Package downloads</Link>
      </nav>
      <p>
        The <Link href="https://github.com/nsreehari/gik-samples/blob/main/packages/components/README.md">
          Components README
        </Link> owns installation, provider registration, and consumer APIs. Use the documentation
        hub for complete applications, DPPs, Senses, and host responsibilities.
      </p>
    </article>
  );
}

const meta = {
  title: "Start here",
  component: Introduction,
  parameters: { controls: { disable: true } },
} satisfies Meta<typeof Introduction>;

export default meta;
type Story = StoryObj<typeof meta>;
export const Overview: Story = {};
