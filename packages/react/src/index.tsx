import {
  createContext,
  useContext,
  useEffect,
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
 * Dispose is deferred by one tick on unmount, and cancelled if a remount
 * follows in the same tick — React StrictMode's dev-only mount→unmount→mount
 * cycle runs synchronously, so this survives it, while a genuine unmount
 * (no remount follows) still terminates the Worker.
 */
export function BrowserAIProvider({ model, device, children }: BrowserAIProviderProps) {
  const controllerRef = useRef<ChatController | null>(null);
  const disposeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (!controllerRef.current) {
    const runtime = createTransformersRuntime(model, { device });
    controllerRef.current = createChatController(runtime);
  }

  useEffect(() => {
    // Cancel a dispose scheduled by a StrictMode phantom unmount — this runs
    // on both the real mount and StrictMode's simulated remount, whereas the
    // component body only re-runs on an actual re-render (which does NOT
    // happen between StrictMode's phantom cleanup and its remount).
    if (disposeTimerRef.current !== null) {
      clearTimeout(disposeTimerRef.current);
      disposeTimerRef.current = null;
    }

    return () => {
      const controller = controllerRef.current;
      disposeTimerRef.current = setTimeout(() => {
        controller?.dispose();
        controllerRef.current = null;
        disposeTimerRef.current = null;
      }, 0);
    };
  }, []);

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
