import { tool, jsonSchema } from "ai";

const MAX_PAGE_TEXT_LENGTH = 4000;

function assertBrowser(toolName: string) {
  if (typeof document === "undefined") {
    throw new Error(`${toolName}() can only run in a browser environment.`);
  }
}

/**
 * MVP 2 read-only Browser Tools (guide.md 5번, 1단계).
 * Interaction tools (click/fill/scroll) are deferred to a later stage.
 */

export const getPageText = tool({
  description: "Get the visible text content of the current page.",
  inputSchema: jsonSchema<Record<string, never>>({
    type: "object",
    properties: {},
  }),
  execute: async () => {
    assertBrowser("getPageText");
    const text = document.body.innerText.trim();
    return text.length > MAX_PAGE_TEXT_LENGTH
      ? `${text.slice(0, MAX_PAGE_TEXT_LENGTH)}… (truncated)`
      : text;
  },
});

export const getSelectedText = tool({
  description: "Get the text currently selected/highlighted by the user on the page.",
  inputSchema: jsonSchema<Record<string, never>>({
    type: "object",
    properties: {},
  }),
  execute: async () => {
    assertBrowser("getSelectedText");
    return window.getSelection()?.toString() ?? "";
  },
});

export const findElement = tool({
  description:
    "Find the first element on the page matching a CSS selector, and return its tag name and text content.",
  inputSchema: jsonSchema<{ selector: string }>({
    type: "object",
    properties: {
      selector: {
        type: "string",
        description: "A CSS selector, e.g. 'button.submit' or '#main-title'.",
      },
    },
    required: ["selector"],
  }),
  execute: async ({ selector }) => {
    assertBrowser("findElement");
    const el = document.querySelector(selector);
    if (!el) return { found: false as const };
    return {
      found: true as const,
      tag: el.tagName.toLowerCase(),
      text: el.textContent?.trim().slice(0, 200) ?? "",
    };
  },
});

export const readOnlyBrowserTools = {
  getPageText,
  getSelectedText,
  findElement,
};
