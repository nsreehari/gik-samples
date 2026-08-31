import React from "react";
import {
  Badge,
  Button,
  Card,
  Select,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  Title1,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { ArrowClockwise24Regular } from "@fluentui/react-icons";
import type { ProjectionView } from "@gik-ai/react";

type RecordValue = Record<string, unknown>;

const useStyles = makeStyles({
  root: {
    minHeight: "100vh",
    padding: tokens.spacingHorizontalXXL,
    color: tokens.colorNeutralForeground1,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  shell: {
    display: "grid",
    gap: tokens.spacingVerticalXL,
    maxWidth: "1440px",
    margin: "0 auto",
  },
  header: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalL,
    flexWrap: "wrap",
  },
  heading: { display: "grid", gap: tokens.spacingVerticalXS },
  subtitle: { color: tokens.colorNeutralForeground3 },
  toolbar: {
    display: "flex",
    alignItems: "end",
    gap: tokens.spacingHorizontalM,
    flexWrap: "wrap",
  },
  field: { display: "grid", gap: tokens.spacingVerticalXXS },
  metrics: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
    gap: tokens.spacingHorizontalM,
  },
  metric: { display: "grid", gap: tokens.spacingVerticalXS, padding: tokens.spacingHorizontalL },
  metricLabel: { color: tokens.colorNeutralForeground3 },
  sections: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))",
    gap: tokens.spacingHorizontalL,
    alignItems: "start",
  },
  section: { display: "grid", gap: tokens.spacingVerticalM, padding: tokens.spacingHorizontalL, overflow: "auto" },
  sectionHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: tokens.spacingHorizontalS },
  empty: { color: tokens.colorNeutralForeground3, padding: tokens.spacingVerticalM },
  validation: { display: "flex", gap: tokens.spacingHorizontalS, alignItems: "center", flexWrap: "wrap" },
  pending: { display: "grid", gap: tokens.spacingVerticalXS },
});

function records(value: unknown): RecordValue[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is RecordValue => !!entry && typeof entry === "object" && !Array.isArray(entry))
    : [];
}

function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}

function text(value: unknown): string {
  return value == null ? "" : String(value);
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

function Metric({ label, value }: { label: string; value: string }) {
  return <Card className={useStyles().metric}><Text className={useStyles().metricLabel}>{label}</Text><Text size={600} weight="semibold">{value}</Text></Card>;
}

function Section({ title, count, children }: React.PropsWithChildren<{ title: string; count: number }>) {
  const styles = useStyles();
  return <Card className={styles.section}>
    <div className={styles.sectionHeader}><Text size={500} weight="semibold">{title}</Text><Badge appearance="tint">{count}</Badge></div>
    {count > 0 ? children : <Text className={styles.empty}>No records for this selection.</Text>}
  </Card>;
}

export const FinbookExplorer: ProjectionView = ({ node, emit }) => {
  const styles = useStyles();
  const accounts = records(node.props.accounts);
  const income = record(node.props.income);
  const holdings = record(node.props.holdings);
  const gains = record(node.props.gains);
  const journal = record(node.props.journal);
  const validation = record(node.props.validation);
  const incomeRows = records(income.rows);
  const holdingRows = records(holdings.holdings);
  const gainRows = records(gains.rows);
  const journalSummary = record(journal.summary);
  const valid = validation.valid === true;
  const account = text(node.props.account);
  const fy = text(node.props.fy);
  const loading = node.props.loading === true;

  return <main className={styles.root}>
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <Title1>Finbook</Title1>
          <Text className={styles.subtitle}>A declarative, local-first finance reference application.</Text>
        </div>
        <div className={styles.toolbar}>
          <label className={styles.field}>
            <Text size={200}>Account</Text>
            <Select value={account} onChange={(event) => void emit("select-account", { account: event.currentTarget.value })}>
              {accounts.map((item) => <option key={text(item.account)} value={text(item.account)}>{text(item.name) || text(item.account)}</option>)}
            </Select>
          </label>
          <label className={styles.field}>
            <Text size={200}>Financial year</Text>
            <Select value={fy} onChange={(event) => void emit("select-fy", { fy: event.currentTarget.value })}>
              <option value="2024-25">2024-25</option>
              <option value="2025-26">2025-26</option>
            </Select>
          </label>
          <Button icon={<ArrowClockwise24Regular />} onClick={() => void emit("refresh")}>Refresh</Button>
          {loading ? <Spinner size="tiny" label="Loading" /> : null}
        </div>
      </header>

      <section className={styles.metrics}>
        <Metric label="Total income" value={inr.format(number(income.totalIncome))} />
        <Metric label="Portfolio cost" value={inr.format(number(holdings.totalPortfolioValue))} />
        <Metric label="Realized gain / loss" value={inr.format(number(gains.totalGainLoss))} />
        <Metric label="Pending changes" value={text(journalSummary.totalEntries || 0)} />
      </section>

      <Card className={styles.section}>
        <div className={styles.sectionHeader}><Text size={500} weight="semibold">Data health</Text><Badge color={valid ? "success" : "danger"}>{valid ? "Valid" : "Review needed"}</Badge></div>
        <div className={styles.validation}>
          <Text>{number(validation.errors)} errors</Text>
          <Text>{number(validation.warnings)} warnings</Text>
          <Text className={styles.subtitle}>Working state includes committed SQLite data plus active journal entries.</Text>
        </div>
      </Card>

      <section className={styles.sections}>
        <Section title="Income" count={incomeRows.length}>
          <Table size="small" aria-label="Income entries"><TableHeader><TableRow><TableHeaderCell>Date</TableHeaderCell><TableHeaderCell>Category</TableHeaderCell><TableHeaderCell>Description</TableHeaderCell><TableHeaderCell>Amount</TableHeaderCell></TableRow></TableHeader><TableBody>
            {incomeRows.map((row, index) => <TableRow key={`${text(row.date)}-${index}`}><TableCell>{text(row.date)}</TableCell><TableCell>{text(row.category)}</TableCell><TableCell>{text(row.description)}</TableCell><TableCell>{inr.format(number(row.amount))}</TableCell></TableRow>)}
          </TableBody></Table>
        </Section>
        <Section title="Holdings" count={holdingRows.length}>
          <Table size="small" aria-label="Holdings"><TableHeader><TableRow><TableHeaderCell>Security</TableHeaderCell><TableHeaderCell>Quantity</TableHeaderCell><TableHeaderCell>Average cost</TableHeaderCell><TableHeaderCell>Total cost</TableHeaderCell></TableRow></TableHeader><TableBody>
            {holdingRows.map((row) => <TableRow key={text(row.security)}><TableCell>{text(row.security)}</TableCell><TableCell>{text(row.quantity)}</TableCell><TableCell>{inr.format(number(row.avgCostINR))}</TableCell><TableCell>{inr.format(number(row.totalCostINR))}</TableCell></TableRow>)}
          </TableBody></Table>
        </Section>
        <Section title="Capital gains" count={gainRows.length}>
          <Table size="small" aria-label="Capital gains"><TableHeader><TableRow><TableHeaderCell>Date</TableHeaderCell><TableHeaderCell>Security</TableHeaderCell><TableHeaderCell>Term</TableHeaderCell><TableHeaderCell>Gain / loss</TableHeaderCell></TableRow></TableHeader><TableBody>
            {gainRows.map((row, index) => <TableRow key={`${text(row.date)}-${index}`}><TableCell>{text(row.date)}</TableCell><TableCell>{text(row.security)}</TableCell><TableCell>{text(row.holdingType)}</TableCell><TableCell>{inr.format(number(row.gainLoss))}</TableCell></TableRow>)}
          </TableBody></Table>
        </Section>
        <Section title="Journal" count={records(journalSummary.changeKinds).length}>
          <div className={styles.pending}>
            <Text weight="semibold">{text(journalSummary.cardTitle)}</Text>
            <Text className={styles.subtitle}>{text(journalSummary.shortSummary)}</Text>
            {records(journalSummary.changeKinds).map((kind) => <Text key={text(kind.kind)}>{text(kind.count)} {text(kind.label)}</Text>)}
          </div>
        </Section>
      </section>
    </div>
  </main>;
};

export const financeComponentViews: Record<string, ProjectionView> = {
  "finbook-explorer": FinbookExplorer,
};
