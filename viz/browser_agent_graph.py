"""LangGraph mirror of packages/core/src/index.ts's createChatController.

This is NOT part of the shipped SDK — the real state machine is plain
TypeScript (no LangGraph dependency, by design; see design-decisions.md).
This file exists only so the "LangGraph Visualizer" VS Code extension
(hfloveyy.langgraphv) has real StateGraph code to render, mirroring the
same nodes/edges as the hand-drawn diagram published earlier in this
session. Open this file in VS Code and run "Open LangGraph Visualizer"
from the command palette.

This graph shows CONTROL FLOW only (states + branches) — deliberately not
DEPENDENCY LAYERING (which package wraps which library). Those are two
different questions and don't belong in one graph: layering has no
branches, so cramming it in here as sequential nodes just adds boxes with
no real state-machine information (tried it, reverted it — see chat log).

For the layering question ("where is Transformers.js actually used"), the
answer is a straight line, not a graph:
  packages/react -> packages/core -> packages/transformers
    -> @browser-ai/transformers-js -> @huggingface/transformers (this IS
    "Transformers.js") -> onnxruntime-web (WASM/WebGPU)
    -> huggingface.co/<MODEL_ID> (actual weights, e.g. onnx/model_q4.onnx)
packages/core and packages/react never import any of this directly
(Adapter Pattern, guide.md 13번) — packages/transformers/src/index.ts:1 is
the only import site.

Node <-> source mapping:
  load_model   -> runtime.prepare()                 (BrowserAIRuntime)
  ready        -> await sendMessage()                (ChatController)
  model_step   -> streamText().fullStream            (createChatController)
  execute_tool -> tool.execute(input)                (packages/tools)
  error        -> status: "error"                    (ChatState)
"""

from typing import Literal, Optional, TypedDict

from langgraph.graph import END, START, StateGraph

MAX_TOOL_STEPS = 5  # packages/core/src/index.ts
MODEL_ID = "onnx-community/Qwen3-0.6B-ONNX"  # examples/react-vite/src/App.tsx


class ActiveTool(TypedDict):
    tool_name: str
    status: Literal["calling", "done", "error"]


class ChatState(TypedDict):
    status: Literal["loading-model", "ready", "streaming", "error"]
    progress: int
    error: Optional[str]
    active_tool: Optional[ActiveTool]
    step_count: int
    model_id: str


def load_model(state: ChatState) -> ChatState:
    """runtime.prepare(onProgress) — downloads/initializes MODEL_ID.

    Internally this one call walks a fixed, non-branching layer stack —
    packages/transformers -> @browser-ai/transformers-js ->
    @huggingface/transformers (= Transformers.js) -> onnxruntime-web ->
    huggingface.co/<MODEL_ID> — but that's dependency layering, not
    control flow, so it isn't drawn as separate graph nodes here (see the
    module docstring). Which model this is is a runtime prop
    (<BrowserAIProvider model=...>), not a different graph shape —
    swapping models never changes this graph."""
    return {**state, "model_id": MODEL_ID}


def ready(state: ChatState) -> ChatState:
    """Idle state: controller waits for the next sendMessage(text) call."""
    return state


def model_step(state: ChatState) -> ChatState:
    """One streamText() call; consumes fullStream (text-delta / tool-call /
    tool-result / tool-error) and appends to the assistant message."""
    return state


def execute_tool(state: ChatState) -> ChatState:
    """AI SDK auto-invokes the matched tool's execute(); result re-enters
    the next model_step as a tool-result message."""
    return {**state, "step_count": state["step_count"] + 1}


def error(state: ChatState) -> ChatState:
    """Terminal state for this turn — e.g. OOM (std::bad_alloc, see
    MVP2-RESULTS.md) during load, or a stream exception/abort() mid-turn."""
    return state


def route_after_load(state: ChatState) -> Literal["ready", "error"]:
    return "error" if state["status"] == "error" else "ready"


def route_after_model_step(state: ChatState) -> Literal["execute_tool", "ready", "error"]:
    if state["status"] == "error":
        return "error"
    active_tool = state.get("active_tool")
    if active_tool and active_tool["status"] == "calling" and state["step_count"] < MAX_TOOL_STEPS:
        return "execute_tool"
    return "ready"


graph = StateGraph(ChatState)

graph.add_node("load_model", load_model)
graph.add_node("ready", ready)
graph.add_node("model_step", model_step)
graph.add_node("execute_tool", execute_tool)
graph.add_node("error", error)

graph.add_edge(START, "load_model")
graph.add_conditional_edges("load_model", route_after_load, {"ready": "ready", "error": "error"})
graph.add_edge("ready", "model_step")  # sendMessage(text)
graph.add_conditional_edges(
    "model_step",
    route_after_model_step,
    {"execute_tool": "execute_tool", "ready": "ready", "error": "error"},
)
graph.add_edge("execute_tool", "model_step")  # tool-result, step < MAX_TOOL_STEPS
graph.add_edge("error", END)

app = graph.compile()
