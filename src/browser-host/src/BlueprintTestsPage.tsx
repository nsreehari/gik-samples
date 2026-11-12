import React from "react";
import { parseBlueprintReference } from "gik-blueprint";
import {
  Badge,
  Body1,
  Caption1,
  Subtitle1,
  Title1,
  makeStyles,
  tokens,
} from "@fluentui/react-components";

import { getSampleBlueprintCatalog } from "../../bootstrap/catalog/blueprint-catalog";
import { runBlueprintTestDocument } from "../../testing/declarative-blueprint-tests";

const useStyles = makeStyles({
  page: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
    maxWidth: "960px",
    margin: "0 auto",
    padding: tokens.spacingVerticalXXL,
  },
  results: {
    display: "grid",
    gap: tokens.spacingVerticalS,
  },
  result: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
    padding: tokens.spacingVerticalM,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
  },
});

export function BlueprintTestsPage(): React.ReactElement {
  const styles = useStyles();
  const results = React.useMemo(
    () => {
      const catalog = getSampleBlueprintCatalog();
      return Object.values(catalog.tests).flatMap((document) =>
        runBlueprintTestDocument(document, {
          blueprint: catalog.entries[document.blueprint],
          resolveBlueprint: (reference) => catalog.entries[parseBlueprintReference(reference).id],
        }));
    },
    [],
  );
  const passed = results.filter((result) => result.passed).length;

  return (
    <main className={styles.page}>
      <header>
        <Title1>Blueprint tests</Title1>
        <Body1>{passed} of {results.length} declarative cases passed.</Body1>
      </header>
      <section className={styles.results} aria-label="Blueprint test results">
        {results.map((result) => (
          <article className={styles.result} key={`${result.blueprint}:${result.caseId}`}>
            <Badge color={result.passed ? "success" : "danger"}>
              {result.passed ? "Passed" : "Failed"}
            </Badge>
            <div>
              <Subtitle1>{result.blueprint}</Subtitle1>
              <Caption1>{result.caseId}</Caption1>
              {result.errors.map((error) => <Body1 key={error}>{error}</Body1>)}
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
