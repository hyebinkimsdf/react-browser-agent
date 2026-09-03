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

/**
 * MVP 3 interaction Browser Tools (guide.md 5번, 2단계). These mutate the
 * page, so keep their blast radius small: click/fill only ever act on the
 * single element a CSS selector resolves to.
 */

export const clickElement = tool({
  description: "Click the first element on the page matching a CSS selector.",
  inputSchema: jsonSchema<{ selector: string }>({
    type: "object",
    properties: {
      selector: {
        type: "string",
        description: "A CSS selector, e.g. 'button.submit' or '#accept-cookies'.",
      },
    },
    required: ["selector"],
  }),
  execute: async ({ selector }) => {
    assertBrowser("clickElement");
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) return { clicked: false as const };
    el.click();
    return { clicked: true as const };
  },
});

export const fillInput = tool({
  description:
    "Set the value of an <input> or <textarea> matching a CSS selector, and dispatch input/change events so the page's own JS notices.",
  inputSchema: jsonSchema<{ selector: string; value: string }>({
    type: "object",
    properties: {
      selector: {
        type: "string",
        description: "A CSS selector for the input/textarea, e.g. '#email'.",
      },
      value: {
        type: "string",
        description: "The text to enter into the field.",
      },
    },
    required: ["selector", "value"],
  }),
  execute: async ({ selector, value }) => {
    assertBrowser("fillInput");
    const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
    if (!el) return { filled: false as const };
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { filled: true as const };
  },
});

export const scrollPage = tool({
  description: "Scroll the page up, down, to the top, or to the bottom.",
  inputSchema: jsonSchema<{ direction: "up" | "down" | "top" | "bottom" }>({
    type: "object",
    properties: {
      direction: {
        type: "string",
        enum: ["up", "down", "top", "bottom"],
        description: "Which way to scroll.",
      },
    },
    required: ["direction"],
  }),
  execute: async ({ direction }) => {
    assertBrowser("scrollPage");
    const amount = window.innerHeight * 0.8;
    switch (direction) {
      case "up":
        window.scrollBy({ top: -amount, behavior: "smooth" });
        break;
      case "down":
        window.scrollBy({ top: amount, behavior: "smooth" });
        break;
      case "top":
        window.scrollTo({ top: 0, behavior: "smooth" });
        break;
      case "bottom":
        window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
        break;
    }
    return { scrolled: true as const, direction };
  },
});

export const interactionBrowserTools = {
  clickElement,
  fillInput,
  scrollPage,
};

export const allBrowserTools = {
  ...readOnlyBrowserTools,
  ...interactionBrowserTools,
};
