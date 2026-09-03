import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createChatController, type ChatController, type ChatState } from "@browser-ai-sdk/core";
import type { ToolSet } from "ai";
import {
  createTransformersRuntime,
  type TransformersDevice,
  type TransformersDtype,
} from "@browser-ai-sdk/transformers";

export interface BrowserAIProviderProps {
  model: string;
  device?: TransformersDevice;
  /** Weight quantization — lower it if a model OOMs on WASM (see MVP2-RESULTS.md). */
  dtype?: TransformersDtype;
  /** Browser Tools the model may call (guide.md 5번). Omit for chat-only use. */
  tools?: ToolSet;
  children: ReactNode;
}

/** Distinguishes "no provider above this hook" from "provider present, not yet initialized". */
const NOT_IN_PROVIDER = Symbol("not-in-provider");
type ContextValue = ChatController | null | typeof NOT_IN_PROVIDER;
const ChatControllerContext = createContext<ContextValue>(NOT_IN_PROVIDER);

const INITIAL_STATE: ChatState = {
  status: "loading-model",
  progress: 0,
  messages: [],
  error: null,
  activeTool: null,
};
const getInitialState = () => INITIAL_STATE;
const noopSubscribe = () => () => {};

/**
 * Wires the Transformers Adapter (guide.md packages/transformers) to Core's
 * chat controller and exposes it via context.
 *
 * The runtime/controller is created inside an effect, not during render —
 * Next.js (and any other SSR setup) renders "use client" components on the
 * server too, where `Worker`/WebGPU/etc. don't exist. An effect only ever
 * runs client-side, so this keeps the SDK SSR-safe (guide.md 6번) without
 * every consumer having to remember `dynamic(..., { ssr: false })`.
 *
 * Dispose is deferred by one tick on unmount, and cancelled if a remount
 * follows in the same tick — React StrictMode's dev-only mount→unmount→mount
 * cycle runs synchronously, so this survives it, while a genuine unmount
 * (no remount follows) still terminates the Worker.
 */
export function BrowserAIProvider({
  model,
  device,
  dtype,
  tools,
  children,
}: BrowserAIProviderProps) {
  const [controller, setController] = useState<ChatController | null>(null);
  const controllerRef = useRef<ChatController | null>(null);
  const disposeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Cancel a dispose scheduled by a StrictMode phantom unmount — this runs
    // on both the real mount and StrictMode's simulated remount, whereas the
    // component body only re-runs on an actual re-render (which does NOT
    // happen between StrictMode's phantom cleanup and its remount).
    if (disposeTimerRef.current !== null) {
      clearTimeout(disposeTimerRef.current);
      disposeTimerRef.current = null;
    }

    if (!controllerRef.current) {
      const runtime = createTransformersRuntime(model, { device, dtype });
      const created = createChatController(runtime, { tools });
      controllerRef.current = created;
      setController(created);
    }

    return () => {
      const c = controllerRef.current;
      disposeTimerRef.current = setTimeout(() => {
        c?.dispose();
        controllerRef.current = null;
        disposeTimerRef.current = null;
      }, 0);
    };
    // model/device/dtype/tools are intentionally init-only, same as before.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ChatControllerContext.Provider value={controller}>
      {children}
    </ChatControllerContext.Provider>
  );
}

export function useBrowserChat() {
  const controller = useContext(ChatControllerContext);
  if (controller === NOT_IN_PROVIDER) {
    throw new Error("useBrowserChat() must be used inside <BrowserAIProvider>.");
  }

  const state = useSyncExternalStore(
    controller ? controller.subscribe : noopSubscribe,
    controller ? controller.getState : getInitialState,
    getInitialState,
  );

  return {
    messages: state.messages,
    status: state.status,
    progress: state.progress,
    error: state.error,
    activeTool: state.activeTool,
    isLoading: state.status === "loading-model" || state.status === "streaming",
    sendMessage: controller ? controller.sendMessage : async () => {},
    stop: controller ? controller.stop : () => {},
  };
}
