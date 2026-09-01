import React from "react";
import ReactDOM from "react-dom/client";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";

import { FinbookHost } from "./FinbookHost";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Finbook root element is missing");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <FluentProvider theme={webLightTheme}>
      <FinbookHost />
    </FluentProvider>
  </React.StrictMode>,
);
