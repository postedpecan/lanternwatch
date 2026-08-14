import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getProjectFilterState } from "./project-filter-state.ts";

function renderFilter(state) {
  return renderToStaticMarkup(createElement(
    "select",
    {
      disabled: state.disabled,
      "aria-label": "Filter dashboard by project",
      "aria-describedby": state.descriptionId,
      defaultValue: "",
    },
    createElement("option", { value: "" }, "All projects"),
  ));
}

test("project filter has identical disabled HTML for SSR and first client render", () => {
  const serverState = getProjectFilterState("live", 0);
  const firstClientState = getProjectFilterState("live", 0);
  const serverHtml = renderFilter(serverState);
  const firstClientHtml = renderFilter(firstClientState);

  assert.equal(serverHtml, firstClientHtml);
  assert.match(serverHtml, / disabled=""/);
  assert.doesNotMatch(serverHtml, /aria-describedby/);
});

test("project filter enables after data loads and disables with an accessible demo note", () => {
  const loadedHtml = renderFilter(getProjectFilterState("live", 2));
  const demoState = getProjectFilterState("demo", 2);
  const demoHtml = renderFilter(demoState);

  assert.doesNotMatch(loadedHtml, / disabled=""/);
  assert.match(demoHtml, / disabled=""/);
  assert.match(demoHtml, /aria-describedby="demoScopeNote"/);
  assert.equal(demoState.showDemoNote, true);
});
