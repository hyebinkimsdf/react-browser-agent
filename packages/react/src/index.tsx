import {
  createContext,
  useContext,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createChatController, type ChatController } from "@browser-ai-sdk/core";
import {
  createTransformersRuntime,
  type TransformersDevice,
} from "@browser-ai-sdk/transformers";

export interface BrowserAIProviderProps {
  model: string;
  device?: TransformersDevice;
  children: ReactNode;
}

const ChatControllerContext = createContext<ChatController | null>(null);

/**
 * Wires the Transformers Adapter (guide.md packages/transformers) to Core's
 * chat controller and exposes it via context. Model loading starts as soon
 * as this mounts.
 *
 * Known MVP-1 gap: the controller is intentionally never disposed on unmount
 * (see design note in packages/react/README once written) to avoid
 * React StrictMode's mount→unmount→mount dev cycle tearing down the Worker
 * mid-load. Proper lifecycle management is deferred to MVP 2+.
 */
export function BrowserAIProvider({ model, device, children }: BrowserAIProviderProps) {
  const controllerRef = useRef<ChatController | null>(null);

  if (!controllerRef.current) {
    const runtime = createTransformersRuntime(model, { device });
    controllerRef.current = createChatController(runtime);
  }

  return (
    <ChatControllerContext.Provider value={controllerRef.current}>
      {children}
    </ChatControllerContext.Provider>
  );
}

export function useBrowserChat() {
  const controller = useContext(ChatControllerContext);
  if (!controller) {
    throw new Error("useBrowserChat() must be used inside <BrowserAIProvider>.");
  }

  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );

  return {
    messages: state.messages,
    status: state.status,
    progress: state.progress,
    error: state.error,
    isLoading: state.status === "loading-model" || state.status === "streaming",
    sendMessage: controller.sendMessage,
    stop: controller.stop,
  };
}
