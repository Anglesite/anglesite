import type { BlockModel, BlockId, HostTransport, Op, OpResult } from "./types.js";
import type { Point } from "./hit-test.js";
import type { AppliedEvent, RejectedEvent } from "./op-queue.js";
import { ModelSync } from "./model-sync.js";
import { SelectionState } from "./selection.js";
import { OpQueue } from "./op-queue.js";
import { hitTest } from "./hit-test.js";

/**
 * Everything a host subscribed via `WysiwygEngine.onEvent` can observe. The op outcomes *compose*
 * `OpQueue`'s own event types rather than restating their shape, so a field added to `AppliedEvent`
 * or `RejectedEvent` (e.g. `RejectedEvent.model`) reaches consumers automatically. Declared here
 * rather than in types.ts because op-queue.ts imports types.ts — composing it there would cycle.
 */
export type EngineEvent =
  | { type: "model-updated"; model: BlockModel }
  | { type: "selection-changed"; blockId: BlockId | null }
  | AppliedEvent
  | RejectedEvent;

/**
 * The portable overlay engine core (spec §3.1). Wires model sync, selection, hit-testing, and the
 * op queue together behind one event stream. Owns nothing about rendering — a host (or, in this
 * slice's tests, e2e/fixture-page.ts) subscribes via `onEvent` and re-renders its own DOM
 * projection in response; the engine never touches the DOM itself.
 */
export class WysiwygEngine {
  readonly modelSync: ModelSync;
  readonly selection = new SelectionState();
  readonly opQueue: OpQueue;

  #listeners = new Set<(event: EngineEvent) => void>();
  #unsubscribeModel: () => void;
  #unsubscribeSelection: () => void;
  #unsubscribeOps: () => void;

  constructor(initialModel: BlockModel, transport: HostTransport) {
    this.modelSync = new ModelSync(initialModel);
    this.opQueue = new OpQueue(transport, this.modelSync);

    this.#unsubscribeModel = transport.onModelUpdate((model) => {
      this.modelSync.applyModel(model);
      this.#emit({ type: "model-updated", model });
      this.#invalidateSelectionIfGone(model);
    });
    this.#unsubscribeSelection = this.selection.onChange((blockId) => {
      this.#emit({ type: "selection-changed", blockId });
    });
    // `event.model` is present on every "applied" event and on a "rejected" one that adopted the
    // host's fresh model — both are model swaps that can delete the selected block.
    this.#unsubscribeOps = this.opQueue.onEvent((event) => {
      this.#emit(event);
      if (event.model) this.#invalidateSelectionIfGone(event.model);
    });
  }

  hitTest(point: Point, doc: Document = document): BlockId | null {
    return hitTest(point, doc);
  }

  submit(op: Op): Promise<OpResult> {
    return this.opQueue.submit(op);
  }

  /** Re-submits a previously rejected op against the now-current model version — the "replay" half
   *  of spec §9's rejection contract, and the counterpart to `submit`. Callers choose "drop" by not
   *  calling it. Exposed here so the whole contract is reachable from the engine's own API rather
   *  than by reaching through `opQueue`. */
  retry(op: Op): Promise<OpResult> {
    return this.opQueue.retry(op);
  }

  onEvent(listener: (event: EngineEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispose(): void {
    this.#unsubscribeModel();
    this.#unsubscribeSelection();
    this.#unsubscribeOps();
  }

  /** A model swap can remove the selected block — an outside hand edit, or an op that deleted it.
   *  Leaving `selection.current` pointing at a vanished ID would leave host chrome drawing handles
   *  around nothing and subsequent ops targeting a block that no longer exists, so drop it. */
  #invalidateSelectionIfGone(model: BlockModel): void {
    const selected = this.selection.current;
    if (selected !== null && !(selected in model.blocks)) this.selection.clear();
  }

  #emit(event: EngineEvent): void {
    for (const listener of this.#listeners) listener(event);
  }
}
